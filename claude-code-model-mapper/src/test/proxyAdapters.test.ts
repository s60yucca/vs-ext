import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'stream';
import { buildUpstreamHeaders } from '../proxy/headerBuilder';
import { buildDecodedResponseHeaders } from '../proxy/responseHeaders';
import { adaptResponsesRequest, isResponsesEndpoint, parseNonStreamingResponse } from '../proxy/responsesAdapter';
import { streamOpenAIAsAnthropic } from '../proxy/streamingResponseAdapter';
import { StreamingVisibleTextAdapter } from '../proxy/textAdapter';
import { decodeToolUseId, encodeToolUseId } from '../proxy/toolCallCodec';

class CapturingResponse extends Writable {
  output = '';

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.output += chunk.toString();
    callback();
  }
}

test('parseNonStreamingResponse converts Responses text and usage', () => {
  const parsed = parseNonStreamingResponse({
    id: 'resp_1',
    model: 'gpt-5.5',
    status: 'completed',
    output: [
      {
        type: 'message',
        content: [{ type: 'output_text', text: 'Human-readable result' }],
      },
    ],
    usage: { input_tokens: 12, output_tokens: 7 },
  });

  assert.deepEqual(parsed.message, {
    id: 'resp_1',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'Human-readable result' }],
    model: 'gpt-5.5',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 12, output_tokens: 7 },
  });
  assert.deepEqual(parsed.functionCalls, []);
});

test('parseNonStreamingResponse converts Responses function calls', () => {
  const parsed = parseNonStreamingResponse({
    id: 'resp_2',
    model: 'gpt-5.5',
    status: 'completed',
    output: [
      {
        type: 'function_call',
        call_id: 'call_1',
        name: 'TodoWrite',
        arguments: '{"todos":[]}',
      },
    ],
    usage: { input_tokens: 4, output_tokens: 3 },
  });

  const toolUse = parsed.message.content[0] as { type: string; id: string; name: string; input: unknown };
  assert.equal(toolUse.type, 'tool_use');
  assert.equal(toolUse.name, 'TodoWrite');
  assert.deepEqual(toolUse.input, { todos: [] });
  assert.equal(decodeToolUseId(toolUse.id)?.call_id, 'call_1');
  assert.equal(parsed.message.stop_reason, 'tool_use');
  assert.equal(parsed.functionCalls[0].call_id, 'call_1');
});

test('buildUpstreamHeaders removes inbound credentials when provider key is injected', () => {
  const headers = buildUpstreamHeaders(
    {
      authorization: 'Bearer claude-dummy',
      'x-api-key': 'claude-dummy',
      'content-type': 'application/json',
    },
    {
      baseUrl: 'https://example.openai.azure.com/openai/v1/responses',
      authHeader: 'api-key',
      authValuePrefix: '',
    },
    'azure-secret',
    42,
    true
  );

  assert.equal(headers.authorization, undefined);
  assert.equal(headers['x-api-key'], undefined);
  assert.equal(headers['api-key'], 'azure-secret');
  assert.equal(headers['content-type'], 'application/json');
});

test('tool-call ids carry their own Responses association without shared memory', () => {
  const original = {
    type: 'function_call',
    call_id: 'call_0',
    name: 'TodoWrite',
    arguments: '{"todos":[]}',
  } as const;
  assert.deepEqual(decodeToolUseId(encodeToolUseId(original)), original);
});

test('isResponsesEndpoint matches the endpoint path, not query substrings', () => {
  assert.equal(isResponsesEndpoint('https://example.test/openai/v1/responses?api-version=1'), true);
  assert.equal(isResponsesEndpoint('https://example.test/chat/completions?next=/responses'), false);
});

test('adaptResponsesRequest removes Chat Completions-only stop and top_k fields', () => {
  const adapted = adaptResponsesRequest({
    model: 'gpt-5.5',
    input: [{ role: 'user', content: 'Hello' }],
    max_tokens: 32_000,
    stop: ['END'],
    top_k: 40,
    top_p: 0.9,
  });

  assert.equal(adapted.stop, undefined);
  assert.equal(adapted.top_k, undefined);
  assert.equal(adapted.top_p, 0.9);
  assert.equal(adapted.max_output_tokens, 32_000);
});

test('StreamingVisibleTextAdapter streams JSON arrays immediately without reformatting', () => {
  const ordinary = new StreamingVisibleTextAdapter();
  assert.equal(ordinary.push('Normal response'), 'Normal response');

  const jsonAdapter = new StreamingVisibleTextAdapter();
  const json = JSON.stringify([{
    file: 'src/a.ts',
    line: 10,
    summary: 'Problem found.',
    failure_scenario: 'The request fails.',
  }]);
  assert.equal(jsonAdapter.push(json), json);
  assert.equal(jsonAdapter.push('', true), '');
});

test('parseNonStreamingResponse falls back to top-level output_text', () => {
  const parsed = parseNonStreamingResponse({
    object: 'response',
    id: 'resp_output_text',
    model: 'gpt-5.5',
    status: 'completed',
    output: [],
    output_text: 'Visible convenience text',
  });
  assert.deepEqual(parsed.message.content, [{ type: 'text', text: 'Visible convenience text' }]);
});

test('buildDecodedResponseHeaders removes stale compression and length headers', () => {
  const headers = buildDecodedResponseHeaders({
    'content-type': 'application/json',
    'content-encoding': 'gzip',
    'content-length': '999',
    'transfer-encoding': 'chunked',
  }, '{"error":"plain"}');
  assert.equal(headers['content-encoding'], undefined);
  assert.equal(headers['transfer-encoding'], undefined);
  assert.equal(headers['content-length'], '17');
});

test('Responses argument deltas resolve through item_id aliases', async () => {
  const upstream = new PassThrough();
  const response = new CapturingResponse();
  const completed = streamOpenAIAsAnthropic(upstream, response as unknown as import('http').ServerResponse, { model: 'gpt-5.5' });
  upstream.write(sseData({
    type: 'response.output_item.added',
    output_index: 1,
    item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'TodoWrite' },
  }));
  upstream.write(sseData({
    type: 'response.function_call_arguments.delta',
    item_id: 'fc_1',
    delta: '{"todos":[]}',
  }));
  upstream.write(sseData({ type: 'response.completed', response: { usage: { output_tokens: 5 } } }));
  upstream.end();
  await completed;

  const events = parseSseData(response.output);
  const toolStart = events.find(event => event.type === 'content_block_start' && event.content_block?.type === 'tool_use');
  assert.ok(toolStart);
  assert.deepEqual(decodeToolUseId(toolStart.content_block.id), {
    type: 'function_call',
    call_id: 'call_1',
    name: 'TodoWrite',
    arguments: '{"todos":[]}',
  });
  const argumentDelta = events.find(event => event.delta?.type === 'input_json_delta');
  assert.equal(argumentDelta?.delta?.partial_json, '{"todos":[]}');
});

test('streaming upstream errors notify and terminate the client response', async () => {
  const upstream = new PassThrough();
  const response = new CapturingResponse();
  const completed = streamOpenAIAsAnthropic(upstream, response as unknown as import('http').ServerResponse, { model: 'gpt-5.5' });
  upstream.destroy(new Error('upstream disconnected'));
  await assert.rejects(completed, /upstream disconnected/);
  assert.match(response.output, /event: error/);
  assert.match(response.output, /upstream disconnected/);
  assert.equal(response.writableEnded, true);
});

test('Responses incomplete events terminate with Anthropic max_tokens', async () => {
  const upstream = new PassThrough();
  const response = new CapturingResponse();
  const completed = streamOpenAIAsAnthropic(upstream, response as unknown as import('http').ServerResponse, { model: 'gpt-5.5' });
  upstream.write(sseData({
    type: 'response.incomplete',
    response: {
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      usage: { output_tokens: 4096 },
    },
  }));
  upstream.end();
  await completed;

  const events = parseSseData(response.output);
  const messageDelta = events.find(event => event.type === 'message_delta');
  assert.equal(messageDelta?.delta?.stop_reason, 'max_tokens');
  assert.equal(messageDelta?.usage?.output_tokens, 4096);
  assert.ok(events.some(event => event.type === 'message_stop'));
});

function sseData(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function parseSseData(stream: string): Array<Record<string, any>> {
  return stream
    .split('\n')
    .filter(line => line.startsWith('data: '))
    .map(line => JSON.parse(line.slice(6)));
}
