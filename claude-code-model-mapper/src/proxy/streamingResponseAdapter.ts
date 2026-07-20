import * as http from 'http';
import { mapFinishReason, ResponsesFunctionCallItem } from './responsesAdapter';
import { extractDeltaText, StreamingVisibleTextAdapter } from './textAdapter';
import { encodeToolUseId } from './toolCallCodec';

type DeltaToolCall = {
  index?: number;
  callId?: string;
  itemId?: string;
  name?: string;
  argumentsChunk?: string;
};
type ToolState = {
  id: string;
  name: string;
  arguments: string;
  started: boolean;
  blockIndex?: number;
};

export type StreamingAdapterOptions = {
  model: string;
};

export function streamOpenAIAsAnthropic(
  upstream: NodeJS.ReadableStream,
  res: http.ServerResponse,
  options: StreamingAdapterOptions
): Promise<void> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let sentStart = false;
    let nextContentBlockIndex = 0;
    let textBlockStarted = false;
    let textBlockIndex: number | null = null;
    let finishReason: string | null = null;
    let streamFinalized = false;
    const textAdapter = new StreamingVisibleTextAdapter();
    const toolStates = new Set<ToolState>();
    const toolStatesByIndex = new Map<number, ToolState>();
    const toolStatesById = new Map<string, ToolState>();

    const writeEvent = (event: string, data: Record<string, unknown>): void => {
      if (res.writableEnded) { return; }
      const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      res.write(payload);
    };

    const ensureMessageStart = (id = 'msg_proxy'): void => {
      if (sentStart) { return; }
      sentStart = true;
      writeEvent('message_start', {
        type: 'message_start',
        message: {
          id,
          type: 'message',
          role: 'assistant',
          content: [],
          model: options.model,
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: inputTokens, output_tokens: 0 },
        },
      });
      writeEvent('ping', { type: 'ping' });
    };

    const emitText = (text: string): void => {
      if (!text) { return; }
      ensureMessageStart();
      if (!textBlockStarted) {
        textBlockStarted = true;
        textBlockIndex = nextContentBlockIndex++;
        writeEvent('content_block_start', {
          type: 'content_block_start',
          index: textBlockIndex,
          content_block: { type: 'text', text: '' },
        });
      }
      writeEvent('content_block_delta', {
        type: 'content_block_delta',
        index: textBlockIndex ?? 0,
        delta: { type: 'text_delta', text },
      });
    };

    const finish = (): void => {
      if (streamFinalized) { return; }
      streamFinalized = true;
      emitText(textAdapter.push('', true));
      ensureMessageStart();
      if (textBlockStarted) {
        writeEvent('content_block_stop', { type: 'content_block_stop', index: textBlockIndex ?? 0 });
      }
      for (const toolState of toolStates.values()) {
        emitToolState(toolState);
      }
      writeEvent('message_delta', {
        type: 'message_delta',
        delta: {
          stop_reason: mapStreamingFinishReason(finishReason, hasStartedToolUse(toolStates)),
          stop_sequence: null,
        },
        usage: { output_tokens: outputTokens },
      });
      writeEvent('message_stop', { type: 'message_stop' });
    };

    const emitToolState = (state: ToolState): void => {
      if (state.started || !state.name) { return; }
      ensureMessageStart();
      state.started = true;
      state.blockIndex = nextContentBlockIndex++;
      const functionCall: ResponsesFunctionCallItem = {
        type: 'function_call',
        call_id: state.id,
        name: state.name,
        arguments: state.arguments || '{}',
      };
      writeEvent('content_block_start', {
        type: 'content_block_start',
        index: state.blockIndex,
        content_block: { type: 'tool_use', id: encodeToolUseId(functionCall), name: state.name, input: {} },
      });
      writeEvent('content_block_delta', {
        type: 'content_block_delta',
        index: state.blockIndex,
        delta: { type: 'input_json_delta', partial_json: functionCall.arguments },
      });
      writeEvent('content_block_stop', { type: 'content_block_stop', index: state.blockIndex });
    };

    const abort = (error: Error): void => {
      if (streamFinalized) { return; }
      streamFinalized = true;
      writeEvent('error', {
        type: 'error',
        error: { type: 'api_error', message: error.message },
      });
      res.end();
      reject(error);
    };

    upstream.on('data', (chunkBuffer: Buffer | string) => {
      const chunkText = chunkBuffer.toString();
      buffer += chunkText;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) { continue; }
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          finish();
          continue;
        }
        try {
          processUpstreamEvent(JSON.parse(data));
        } catch {
          // Ignore malformed or unsupported SSE events.
        }
      }
    });

    upstream.on('end', () => {
      finish();
      res.end();
      resolve();
    });
    upstream.on('error', error => abort(error instanceof Error ? error : new Error(String(error))));

    function processUpstreamEvent(chunk: Record<string, any>): void {
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? chunk.usage.input_tokens ?? inputTokens;
        outputTokens = chunk.usage.completion_tokens ?? chunk.usage.output_tokens ?? outputTokens;
      }
      const choice = chunk.choices?.[0];
      let delta = choice?.delta;
      if (!delta && (typeof chunk.delta === 'string' || chunk.type === 'response.output_item.added')) {
        delta = responsesEventToDelta(chunk);
      }

      if (choice?.finish_reason) {
        finishReason = choice.finish_reason;
      } else if (chunk.type === 'response.done' || chunk.type === 'response.completed' || chunk.type === 'response.incomplete') {
        finishReason = chunk.type === 'response.incomplete'
          ? chunk.response?.incomplete_details?.reason || 'max_output_tokens'
          : 'stop';
        outputTokens = chunk.response?.usage?.output_tokens ?? outputTokens;
        finish();
        return;
      }
      if (!delta) { return; }

      ensureMessageStart(chunk.id || 'msg_proxy');
      emitText(textAdapter.push(extractDeltaText(delta)));
      for (const toolCall of extractDeltaToolCalls(delta)) {
        const state = resolveToolState(toolCall);
        if (toolCall.name) { state.name = toolCall.name; }
        if (toolCall.argumentsChunk) {
          state.arguments += toolCall.argumentsChunk;
        }
      }
    }

    function resolveToolState(toolCall: DeltaToolCall): ToolState {
      const existing = (toolCall.itemId ? toolStatesById.get(toolCall.itemId) : undefined)
        || (toolCall.callId ? toolStatesById.get(toolCall.callId) : undefined)
        || (toolCall.index !== undefined ? toolStatesByIndex.get(toolCall.index) : undefined);
      const state = existing || {
        id: toolCall.callId || toolCall.itemId || `toolu_${toolCall.index ?? toolStates.size}`,
        name: '',
        arguments: '',
        started: false,
      };
      if (!state.started && toolCall.callId) {
        state.id = toolCall.callId;
      }
      toolStates.add(state);
      if (toolCall.index !== undefined) { toolStatesByIndex.set(toolCall.index, state); }
      if (toolCall.callId) { toolStatesById.set(toolCall.callId, state); }
      if (toolCall.itemId) { toolStatesById.set(toolCall.itemId, state); }
      return state;
    }
  });
}

function responsesEventToDelta(chunk: Record<string, any>): Record<string, unknown> {
  if (chunk.type?.includes('text')) {
    return { content: chunk.delta };
  }
  if (chunk.type === 'response.output_item.added' && chunk.item?.type === 'function_call') {
    return {
      tool_calls: [{
        index: typeof chunk.output_index === 'number' ? chunk.output_index : undefined,
        id: chunk.item.call_id,
        item_id: chunk.item.id,
        function: { name: chunk.item.name, arguments: '' },
      }],
    };
  }
  if (chunk.type?.includes('function') || chunk.type?.includes('tool')) {
    return {
      tool_calls: [{
        index: typeof chunk.output_index === 'number' ? chunk.output_index : undefined,
        id: chunk.call_id,
        item_id: chunk.item_id,
        function: { arguments: chunk.delta },
      }],
    };
  }
  return { content: chunk.delta || '' };
}

function extractDeltaToolCalls(delta: unknown): DeltaToolCall[] {
  if (!delta || typeof delta !== 'object') {
    return [];
  }
  const toolCalls = (delta as { tool_calls?: unknown }).tool_calls;
  if (!Array.isArray(toolCalls)) {
    return [];
  }
  return toolCalls.flatMap(toolCall => {
    if (!toolCall || typeof toolCall !== 'object') {
      return [];
    }
    const typed = toolCall as {
      index?: unknown;
      id?: unknown;
      item_id?: unknown;
      function?: { name?: unknown; arguments?: unknown };
    };
    return [{
      index: typeof typed.index === 'number' ? typed.index : undefined,
      callId: typeof typed.id === 'string' ? typed.id : undefined,
      itemId: typeof typed.item_id === 'string' ? typed.item_id : undefined,
      name: typeof typed.function?.name === 'string' ? typed.function.name : undefined,
      argumentsChunk: typeof typed.function?.arguments === 'string' ? typed.function.arguments : undefined,
    }];
  });
}

export function mapStreamingFinishReason(reason: unknown, hasToolUse: boolean): string | null {
  return hasToolUse ? 'tool_use' : mapFinishReason(reason);
}

function hasStartedToolUse(toolStates: Iterable<{ started: boolean }>): boolean {
  return Array.from(toolStates).some(toolState => toolState.started);
}
