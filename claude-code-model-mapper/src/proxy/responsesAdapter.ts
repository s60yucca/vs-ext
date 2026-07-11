import { extractTextContent, sanitizeVisibleText } from './textAdapter';
import { decodeToolUseId, encodeToolUseId } from './toolCallCodec';

export type ResponsesFunctionCallItem = {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
};

export type AnthropicMessageResponse = {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<Record<string, unknown>>;
  model: string;
  stop_reason: string | null;
  stop_sequence: null;
  usage: { input_tokens: number; output_tokens: number };
};

export function isResponsesEndpoint(url: string): boolean {
  try {
    return new URL(url).pathname.replace(/\/+$/, '').endsWith('/responses');
  } catch {
    return false;
  }
}

export function openAIChatToResponses(
  body: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...body };
  const messages = result.messages;
  if (!Array.isArray(messages)) {
    return result;
  }

  const seenFunctionCallIds = new Set<string>();
  result.input = messages.flatMap(message => {
    if (!message || typeof message !== 'object') {
      return [];
    }
    const typed = message as { role?: unknown; content?: unknown; tool_calls?: unknown; tool_call_id?: unknown };
    const role = typeof typed.role === 'string' ? typed.role : 'user';
    if (role === 'tool') {
      const toolUseId = typeof typed.tool_call_id === 'string' ? typed.tool_call_id : '';
      const encodedFunctionCall = decodeToolUseId(toolUseId);
      const callId = encodedFunctionCall?.call_id || toolUseId;
      const output = { type: 'function_call_output', call_id: callId, output: stringifyOutput(typed.content) };
      if (encodedFunctionCall && !seenFunctionCallIds.has(callId)) {
        seenFunctionCallIds.add(callId);
        return [encodedFunctionCall, output];
      }
      return [output];
    }

    const items: Array<Record<string, unknown>> = [];
    const content = normalizeMessageContent(typed.content, role);
    if (content !== undefined) {
      items.push({ role, content });
    }
    if (Array.isArray(typed.tool_calls)) {
      typed.tool_calls.forEach((toolCall, index) => {
        const converted = convertChatToolCall(toolCall, index);
        if (converted) {
          seenFunctionCallIds.add(converted.call_id);
          items.push(converted);
        }
      });
    }
    return items;
  });
  delete result.messages;
  return result;
}

export function adaptResponsesRequest(body: Record<string, unknown>): Record<string, unknown> {
  const result = { ...body };
  if (result.max_tokens !== undefined) {
    result.max_output_tokens = result.max_tokens;
    delete result.max_tokens;
  }
  delete result.stream_options;
  delete result.stop;
  delete result.top_k;
  if (Array.isArray(result.tools)) {
    result.tools = result.tools.map(tool => {
      const typed = tool as { type?: unknown; function?: Record<string, unknown> };
      if (typed.type === 'function' && typed.function) {
        return {
          type: 'function',
          name: typed.function.name,
          description: typed.function.description,
          parameters: typed.function.parameters,
        };
      }
      return tool;
    });
  }
  const toolChoice = result.tool_choice as { type?: unknown; function?: { name?: unknown } } | undefined;
  if (toolChoice?.type === 'function' && toolChoice.function) {
    result.tool_choice = { type: 'function', name: toolChoice.function.name };
  }
  return result;
}

export function parseNonStreamingResponse(payload: Record<string, any>): {
  message: AnthropicMessageResponse;
  functionCalls: ResponsesFunctionCallItem[];
} {
  if (Array.isArray(payload.output) || typeof payload.output_text === 'string' || payload.object === 'response') {
    return parseResponsesApiResponse(payload);
  }
  return parseChatCompletionsResponse(payload);
}

function parseResponsesApiResponse(payload: Record<string, any>): {
  message: AnthropicMessageResponse;
  functionCalls: ResponsesFunctionCallItem[];
} {
  const output = Array.isArray(payload.output) ? payload.output as Array<Record<string, any>> : [];
  const nestedText = output
    .filter(item => item.type === 'message')
    .flatMap(item => Array.isArray(item.content) ? item.content : [])
    .filter(part => part?.type === 'output_text' || part?.type === 'text')
    .map(part => typeof part.text === 'string' ? part.text : '')
    .filter(Boolean)
    .join('\n');
  const text = typeof payload.output_text === 'string' && payload.output_text
    ? payload.output_text
    : nestedText;
  const functionCalls = output
    .filter(item => item.type === 'function_call')
    .map((item, index) => ({
      type: 'function_call' as const,
      call_id: String(item.call_id || item.id || `toolu_${index}`),
      name: String(item.name || ''),
      arguments: typeof item.arguments === 'string' ? item.arguments : '{}',
    }));
  const toolUses = functionCalls.map(call => ({
    type: 'tool_use',
    id: encodeToolUseId(call),
    name: call.name,
    input: parseArguments(call.arguments),
  }));
  return {
    message: buildAnthropicMessage(payload, text, toolUses, functionCalls.length > 0 ? 'tool_use' : mapResponsesStopReason(payload)),
    functionCalls,
  };
}

function parseChatCompletionsResponse(payload: Record<string, any>): {
  message: AnthropicMessageResponse;
  functionCalls: ResponsesFunctionCallItem[];
} {
  const choice = payload.choices?.[0];
  const toolCalls = Array.isArray(choice?.message?.tool_calls) ? choice.message.tool_calls : [];
  const functionCalls: ResponsesFunctionCallItem[] = toolCalls.map((toolCall: any, index: number) => ({
    type: 'function_call' as const,
    call_id: String(toolCall.id || `toolu_${index}`),
    name: String(toolCall.function?.name || ''),
    arguments: typeof toolCall.function?.arguments === 'string' ? toolCall.function.arguments : '{}',
  }));
  const toolUses = functionCalls.map(call => ({
    type: 'tool_use',
    id: encodeToolUseId(call),
    name: call.name,
    input: parseArguments(call.arguments),
  }));
  return {
    message: buildAnthropicMessage(
      payload,
      extractTextContent(choice?.message?.content),
      toolUses,
      functionCalls.length > 0 ? 'tool_use' : mapFinishReason(choice?.finish_reason)
    ),
    functionCalls,
  };
}

function buildAnthropicMessage(
  payload: Record<string, any>,
  rawText: string,
  toolUses: Array<Record<string, unknown>>,
  stopReason: string | null
): AnthropicMessageResponse {
  const text = sanitizeVisibleText(rawText);
  return {
    id: payload.id || 'msg_proxy',
    type: 'message',
    role: 'assistant',
    content: [...(text ? [{ type: 'text', text }] : []), ...toolUses],
    model: payload.model || '',
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: payload.usage?.input_tokens ?? payload.usage?.prompt_tokens ?? 0,
      output_tokens: payload.usage?.output_tokens ?? payload.usage?.completion_tokens ?? 0,
    },
  };
}

function normalizeMessageContent(content: unknown, role: string): unknown {
  if (content === null) {
    return role === 'assistant' ? undefined : '';
  }
  if (!Array.isArray(content)) {
    return content;
  }
  return content.flatMap(part => {
    if (!part || typeof part !== 'object') {
      return [];
    }
    const typed = part as { type?: unknown; text?: unknown; image_url?: { url?: unknown } };
    if (typed.type === 'text' && typeof typed.text === 'string') {
      return [{ type: role === 'assistant' ? 'output_text' : 'input_text', text: typed.text }];
    }
    if (typed.type === 'image_url' && typeof typed.image_url?.url === 'string') {
      return [{ type: 'input_image', image_url: typed.image_url.url }];
    }
    return [part as Record<string, unknown>];
  });
}

function convertChatToolCall(toolCall: unknown, index: number): ResponsesFunctionCallItem | null {
  if (!toolCall || typeof toolCall !== 'object') {
    return null;
  }
  const typed = toolCall as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
  const encoded = typeof typed.id === 'string' ? decodeToolUseId(typed.id) : null;
  return {
    type: 'function_call',
    call_id: encoded?.call_id || (typeof typed.id === 'string' ? typed.id : `toolu_${index}`),
    name: typeof typed.function?.name === 'string' ? typed.function.name : encoded?.name || '',
    arguments: typeof typed.function?.arguments === 'string' ? typed.function.arguments : encoded?.arguments || '{}',
  };
}

function stringifyOutput(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  return content === undefined || content === null ? '' : JSON.stringify(content);
}

function parseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function mapResponsesStopReason(payload: Record<string, any>): string | null {
  if (payload.status === 'incomplete' && payload.incomplete_details?.reason === 'max_output_tokens') {
    return 'max_tokens';
  }
  return payload.status === 'completed' ? 'end_turn' : null;
}

export function mapFinishReason(reason: unknown): string | null {
  if (reason === 'stop') {
    return 'end_turn';
  }
  if (reason === 'tool_calls') {
    return 'tool_use';
  }
  if (reason === 'length' || reason === 'max_output_tokens') {
    return 'max_tokens';
  }
  return typeof reason === 'string' ? reason : null;
}
