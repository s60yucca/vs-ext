export function summarizeOutboundBody(body: string): string {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const input = parsed.input;
    const messages = parsed.messages;
    const inputItems = Array.isArray(input) ? input : [];
    const messageItems = Array.isArray(messages) ? messages : [];
    const inputWithToolCalls = inputItems.filter(
      item => item && typeof item === 'object' && 'tool_calls' in item
    ).length;
    const responsesFunctionCalls = countInputType(inputItems, 'function_call');
    const responsesFunctionOutputs = countInputType(inputItems, 'function_call_output');
    const inputTypeCounts: Record<string, number> = {};
    for (const item of inputItems) {
      if (!item || typeof item !== 'object') {
        inputTypeCounts[typeof item] = (inputTypeCounts[typeof item] || 0) + 1;
        continue;
      }
      const typed = item as { type?: unknown; role?: unknown };
      const type = String(typed.type || typed.role || 'object');
      inputTypeCounts[type] = (inputTypeCounts[type] || 0) + 1;
    }
    return JSON.stringify({
      model: parsed.model,
      hasMessages: Array.isArray(messages),
      messageCount: messageItems.length,
      hasInput: Array.isArray(input),
      inputCount: inputItems.length,
      inputTypeCounts,
      inputWithToolCallsCount: inputWithToolCalls,
      responsesFunctionCalls,
      responsesFunctionOutputs,
      toolCount: Array.isArray(parsed.tools) ? parsed.tools.length : 0,
      hasMaxTokens: parsed.max_tokens !== undefined,
      hasMaxOutputTokens: parsed.max_output_tokens !== undefined,
      hasStreamOptions: parsed.stream_options !== undefined,
    });
  } catch {
    return JSON.stringify({ unparseableBodyBytes: Buffer.byteLength(body) });
  }
}

function countInputType(items: unknown[], type: string): number {
  return items.filter(item => item && typeof item === 'object' && (item as { type?: unknown }).type === type).length;
}
