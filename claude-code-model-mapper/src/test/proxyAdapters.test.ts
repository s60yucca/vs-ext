import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationFunctionCallStore, createConversationKey } from '../proxy/functionCallStore';
import { buildUpstreamHeaders } from '../proxy/headerBuilder';
import { isResponsesEndpoint, parseNonStreamingResponse } from '../proxy/responsesAdapter';
import { StreamingVisibleTextAdapter } from '../proxy/textAdapter';

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

  assert.deepEqual(parsed.message.content, [{
    type: 'tool_use',
    id: 'call_1',
    name: 'TodoWrite',
    input: { todos: [] },
  }]);
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

test('ConversationFunctionCallStore isolates identical call ids by conversation', () => {
  const store = new ConversationFunctionCallStore();
  store.remember('conversation-a', {
    type: 'function_call',
    call_id: 'call_0',
    name: 'TodoWrite',
    arguments: '{"todos":[]}',
  });

  assert.equal(store.get('conversation-a').get('call_0')?.name, 'TodoWrite');
  assert.equal(store.get('conversation-b').get('call_0'), undefined);
});

test('createConversationKey separates conversations with different first user messages', () => {
  const first = createConversationKey({
    model: 'claude-opus-4-8',
    system: 'system',
    messages: [{ role: 'user', content: 'Review workspace A' }],
  });
  const second = createConversationKey({
    model: 'claude-opus-4-8',
    system: 'system',
    messages: [{ role: 'user', content: 'Review workspace B' }],
  });
  assert.notEqual(first, second);
});

test('isResponsesEndpoint matches the endpoint path, not query substrings', () => {
  assert.equal(isResponsesEndpoint('https://example.test/openai/v1/responses?api-version=1'), true);
  assert.equal(isResponsesEndpoint('https://example.test/chat/completions?next=/responses'), false);
});

test('StreamingVisibleTextAdapter streams ordinary text and buffers review JSON only', () => {
  const ordinary = new StreamingVisibleTextAdapter();
  assert.equal(ordinary.push('Normal response'), 'Normal response');

  const review = new StreamingVisibleTextAdapter();
  const json = JSON.stringify([{
    file: 'src/a.ts',
    line: 10,
    summary: 'Problem found.',
    failure_scenario: 'The request fails.',
  }]);
  assert.equal(review.push(json), '');
  assert.match(review.push('', true), /^## Review findings/);
});

