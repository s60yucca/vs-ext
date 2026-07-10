import * as http from 'http';
import { appendProxyDebug } from './debugLogger';
import { mapFinishReason, ResponsesFunctionCallItem } from './responsesAdapter';
import { extractDeltaText, StreamingVisibleTextAdapter } from './textAdapter';

type DeltaToolCall = { index: number; id?: string; name?: string; argumentsChunk?: string };
type ToolState = {
  id: string;
  name: string;
  arguments: string;
  started: boolean;
  blockIndex?: number;
};

export type StreamingAdapterOptions = {
  model: string;
  onFunctionCall: (item: ResponsesFunctionCallItem) => void;
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
    const toolStates = new Map<number, ToolState>();

    const writeEvent = (event: string, data: Record<string, unknown>): void => {
      const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      appendProxyDebug(`OUT: ${payload}`);
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
        if (toolState.started && toolState.blockIndex !== undefined) {
          writeEvent('content_block_stop', { type: 'content_block_stop', index: toolState.blockIndex });
        }
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

    upstream.on('data', (chunkBuffer: Buffer | string) => {
      const chunkText = chunkBuffer.toString();
      appendProxyDebug(chunkText);
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
    upstream.on('error', reject);

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
      } else if (chunk.type === 'response.done' || chunk.type === 'response.completed') {
        finishReason = 'stop';
        outputTokens = chunk.response?.usage?.output_tokens ?? outputTokens;
        finish();
        return;
      }
      if (!delta) { return; }

      ensureMessageStart(chunk.id || 'msg_proxy');
      emitText(textAdapter.push(extractDeltaText(delta)));
      for (const toolCall of extractDeltaToolCalls(delta)) {
        const state = toolStates.get(toolCall.index) || {
          id: toolCall.id || `toolu_${toolCall.index}`,
          name: toolCall.name || '',
          arguments: '',
          started: false,
        };
        if (toolCall.id) { state.id = toolCall.id; }
        if (toolCall.name) { state.name = toolCall.name; }
        if (!state.started && state.name) {
          state.started = true;
          state.blockIndex = nextContentBlockIndex++;
          writeEvent('content_block_start', {
            type: 'content_block_start',
            index: state.blockIndex,
            content_block: { type: 'tool_use', id: state.id, name: state.name, input: {} },
          });
        }
        if (state.started && toolCall.argumentsChunk) {
          state.arguments += toolCall.argumentsChunk;
          writeEvent('content_block_delta', {
            type: 'content_block_delta',
            index: state.blockIndex ?? 0,
            delta: { type: 'input_json_delta', partial_json: toolCall.argumentsChunk },
          });
        }
        if (state.started && state.id && state.name) {
          options.onFunctionCall({
            type: 'function_call',
            call_id: state.id,
            name: state.name,
            arguments: state.arguments || '{}',
          });
        }
        toolStates.set(toolCall.index, state);
      }
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
        index: chunk.output_index || 0,
        id: chunk.item.call_id || chunk.item.id || 'tool_0',
        function: { name: chunk.item.name, arguments: '' },
      }],
    };
  }
  if (chunk.type?.includes('function') || chunk.type?.includes('tool')) {
    return {
      tool_calls: [{
        index: chunk.output_index || 0,
        id: chunk.call_id || chunk.item_id || 'tool_0',
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
  return toolCalls.flatMap((toolCall, fallbackIndex) => {
    if (!toolCall || typeof toolCall !== 'object') {
      return [];
    }
    const typed = toolCall as {
      index?: unknown;
      id?: unknown;
      function?: { name?: unknown; arguments?: unknown };
    };
    return [{
      index: typeof typed.index === 'number' ? typed.index : fallbackIndex,
      id: typeof typed.id === 'string' ? typed.id : undefined,
      name: typeof typed.function?.name === 'string' ? typed.function.name : undefined,
      argumentsChunk: typeof typed.function?.arguments === 'string' ? typed.function.arguments : undefined,
    }];
  });
}

export function mapStreamingFinishReason(reason: unknown, hasToolUse: boolean): string | null {
  return hasToolUse ? 'tool_use' : mapFinishReason(reason);
}

function hasStartedToolUse(toolStates: Map<number, { started: boolean }>): boolean {
  return Array.from(toolStates.values()).some(toolState => toolState.started);
}

