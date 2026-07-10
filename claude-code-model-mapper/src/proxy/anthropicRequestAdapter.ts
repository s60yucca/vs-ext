export function anthropicToOpenAI(body: Record<string, unknown>): Record<string, unknown> {
  const messages: Array<Record<string, unknown>> = [];
  if (body.system) {
    const system = body.system;
    const text = typeof system === 'string'
      ? system
      : Array.isArray(system)
        ? (system as Array<{ text?: string }>).map(block => block.text || '').join('\n')
        : String(system);
    messages.push({ role: 'system', content: text });
  }

  for (const message of (body.messages as Array<{ role: string; content: unknown }> || [])) {
    const content = message.content;
    if (typeof content === 'string') {
      messages.push({ role: message.role, content });
      continue;
    }
    if (!Array.isArray(content)) {
      messages.push({ role: message.role, content: String(content) });
      continue;
    }

    const blocks = content as Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: unknown;
      tool_use_id?: string;
      content?: unknown;
      source?: { media_type: string; data: string };
      is_error?: boolean;
    }>;
    const text = blocks.filter(block => block.type === 'text').map(block => block.text || '').join('\n');

    if (message.role === 'assistant') {
      const toolCalls = blocks
        .filter(block => block.type === 'tool_use')
        .map((block, index) => ({
          id: block.id || `toolu_${index}`,
          type: 'function',
          function: { name: block.name || '', arguments: JSON.stringify(block.input ?? {}) },
        }));
      if (text || toolCalls.length > 0) {
        messages.push({ role: 'assistant', content: text || null, tool_calls: toolCalls.length > 0 ? toolCalls : undefined });
      }
      continue;
    }

    if (message.role === 'user') {
      const contentArray: Array<Record<string, unknown>> = [];
      if (text) {
        contentArray.push({ type: 'text', text });
      }
      contentArray.push(...blocks
        .filter(block => block.type === 'image' && block.source)
        .map(block => ({
          type: 'image_url',
          image_url: { url: `data:${block.source!.media_type};base64,${block.source!.data}` },
        })));
      const textMessages = contentArray.length > 0
        ? [{ role: 'user', content: contentArray.length === 1 && contentArray[0].type === 'text' ? text : contentArray }]
        : [];
      const toolResults = blocks
        .filter(block => block.type === 'tool_result')
        .map(block => ({
          role: 'tool',
          tool_call_id: block.tool_use_id || '',
          content: truncateToolOutput(block.content, !!block.is_error),
        }));
      messages.push(...toolResults, ...textMessages);
      continue;
    }
    messages.push({ role: message.role, content: text });
  }

  const result: Record<string, unknown> = {
    model: body.model,
    messages,
    stream: body.stream ?? false,
  };
  if (result.stream) {
    result.stream_options = { include_usage: true };
  }
  if (body.max_tokens) { result.max_tokens = body.max_tokens; }
  if (body.temperature !== undefined) { result.temperature = body.temperature; }
  if (body.top_p !== undefined) { result.top_p = body.top_p; }
  if (body.top_k !== undefined) { result.top_k = body.top_k; }
  if (Array.isArray(body.stop_sequences) && body.stop_sequences.length > 0) { result.stop = body.stop_sequences; }
  if (Array.isArray(body.tools)) {
    result.tools = (body.tools as Array<{ name?: string; description?: string; input_schema?: unknown }>).map(tool => ({
      type: 'function',
      function: {
        name: tool.name || '',
        description: tool.description || '',
        parameters: tool.input_schema ?? { type: 'object', properties: {} },
      },
    }));
  }
  if (body.tool_choice && typeof body.tool_choice === 'object') {
    const toolChoice = body.tool_choice as { type?: string; name?: string; disable_parallel_tool_use?: boolean };
    if (toolChoice.type === 'auto') {
      result.tool_choice = 'auto';
    } else if (toolChoice.type === 'any') {
      result.tool_choice = 'required';
    } else if (toolChoice.type === 'tool' && toolChoice.name) {
      result.tool_choice = { type: 'function', function: { name: toolChoice.name } };
    }
    if (toolChoice.disable_parallel_tool_use === true) {
      result.parallel_tool_calls = false;
    }
  }
  return result;
}

function truncateToolOutput(content: unknown, isError: boolean): string {
  let output = typeof content === 'string' ? content : JSON.stringify(content ?? '');
  const maxLength = 10_000;
  if (output.length > maxLength) {
    const half = Math.floor(maxLength / 2);
    output = `${output.slice(0, half)}\n\n... [PROXY AUTO-TRUNCATED: ${output.length - maxLength} chars removed to save tokens] ...\n\n${output.slice(-half)}`;
  }
  return isError ? `Error: ${output}` : output;
}

