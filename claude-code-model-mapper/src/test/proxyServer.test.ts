import test from 'node:test';
import assert from 'node:assert/strict';
import { anthropicToOpenAI, buildUpstreamUrl, extractDeltaText, extractTextContent, formatReviewFindings, mapStreamingFinishReason, openAIChatToResponses, sanitizeVisibleText } from '../proxyServer';

test('buildUpstreamUrl keeps /v1 when provider base url has no version suffix', () => {
  const url = buildUpstreamUrl('https://api.openadapter.in', '/v1/chat/completions');
  assert.equal(url.toString(), 'https://api.openadapter.in/v1/chat/completions');
});

test('buildUpstreamUrl avoids duplicated /v1 when provider base url already includes it', () => {
  const url = buildUpstreamUrl('https://openrouter.ai/api/v1', '/v1/chat/completions');
  assert.equal(url.toString(), 'https://openrouter.ai/api/v1/chat/completions');
});

test('anthropicToOpenAI preserves MiniMax target model and converts system plus messages', () => {
  const converted = anthropicToOpenAI({
    model: 'minimax/minimax-m2.7',
    system: 'You are helpful.',
    stream: false,
    max_tokens: 512,
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
    ],
  });

  assert.deepEqual(converted, {
    model: 'minimax/minimax-m2.7',
    messages: [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
    ],
    stream: false,
    max_tokens: 512,
  });
});

test('anthropicToOpenAI preserves tools, tool choice, tool_use and tool_result blocks', () => {
  const converted = anthropicToOpenAI({
    model: 'minimax/minimax-m2.7',
    stream: true,
    tools: [
      {
        name: 'Skill',
        description: 'Run a skill',
        input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      },
    ],
    tool_choice: { type: 'tool', name: 'Skill' },
    messages: [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Using tool.' },
          { type: 'tool_use', id: 'toolu_1', name: 'Skill', input: { name: 'brainstorming' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: 'done' },
        ],
      },
    ],
  });

  assert.deepEqual(converted, {
    model: 'minimax/minimax-m2.7',
    messages: [
      {
        role: 'assistant',
        content: 'Using tool.',
        tool_calls: [
          {
            id: 'toolu_1',
            type: 'function',
            function: {
              name: 'Skill',
              arguments: JSON.stringify({ name: 'brainstorming' }),
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'toolu_1',
        content: 'done',
      },
    ],
    stream: true,
    stream_options: {
      include_usage: true,
    },
    tools: [
      {
        type: 'function',
        function: {
          name: 'Skill',
          description: 'Run a skill',
          parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
        },
      },
    ],
    tool_choice: {
      type: 'function',
      function: { name: 'Skill' },
    },
  });
});

test('openAIChatToResponses converts chat tool calls into Responses input items', () => {
  const converted = openAIChatToResponses({
    model: 'gpt-5.5',
    messages: [
      { role: 'system', content: 'You are helpful.' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'toolu_1',
            type: 'function',
            function: {
              name: 'Skill',
              arguments: JSON.stringify({ name: 'brainstorming' }),
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'toolu_1',
        content: 'done',
      },
      { role: 'user', content: 'Continue' },
    ],
  });

  assert.deepEqual(converted, {
    model: 'gpt-5.5',
    input: [
      { role: 'system', content: 'You are helpful.' },
      {
        type: 'function_call',
        call_id: 'toolu_1',
        name: 'Skill',
        arguments: JSON.stringify({ name: 'brainstorming' }),
      },
      {
        type: 'function_call_output',
        call_id: 'toolu_1',
        output: 'done',
      },
      { role: 'user', content: 'Continue' },
    ],
  });
});

test('openAIChatToResponses injects remembered function calls before orphaned tool outputs', () => {
  const converted = openAIChatToResponses(
    {
      model: 'gpt-5.5',
      messages: [
        {
          role: 'tool',
          tool_call_id: 'call_todo_1',
          content: JSON.stringify({ ok: true }),
        },
        { role: 'user', content: 'Continue' },
      ],
    },
    new Map([
      [
        'call_todo_1',
        {
          type: 'function_call',
          call_id: 'call_todo_1',
          name: 'TodoWrite',
          arguments: JSON.stringify({ todos: [] }),
        },
      ],
    ])
  );

  assert.deepEqual(converted, {
    model: 'gpt-5.5',
    input: [
      {
        type: 'function_call',
        call_id: 'call_todo_1',
        name: 'TodoWrite',
        arguments: JSON.stringify({ todos: [] }),
      },
      {
        type: 'function_call_output',
        call_id: 'call_todo_1',
        output: JSON.stringify({ ok: true }),
      },
      { role: 'user', content: 'Continue' },
    ],
  });
});

test('mapStreamingFinishReason preserves tool_use when Responses streams function calls', () => {
  assert.equal(mapStreamingFinishReason('stop', true), 'tool_use');
  assert.equal(mapStreamingFinishReason('stop', false), 'end_turn');
});

test('extractTextContent supports OpenAI-style content arrays', () => {
  const text = extractTextContent([
    { type: 'text', text: 'First line' },
    { type: 'input_text', text: 'ignored' },
    'Second line',
  ]);

  assert.equal(text, 'First line\nSecond line');
});

test('extractDeltaText supports OpenAI-style delta content arrays', () => {
  const text = extractDeltaText({
    content: [
      { type: 'text', text: 'Visible' },
      { type: 'reasoning', text: 'hidden' },
    ],
  });

  assert.equal(text, 'Visible');
});

test('sanitizeVisibleText strips internal reasoning and tool tags', () => {
  const text = sanitizeVisibleText([
    '<think>The user wants hidden reasoning.</think>',
    '<fast_path>skip this too</fast_path>',
    'Final answer',
    '<tool_call><name>Skill</name></tool_call>',
  ].join('\n'));

  assert.equal(text, 'Final answer');
});

test('formatReviewFindings renders the Claude review schema as readable Markdown', () => {
  const text = formatReviewFindings(JSON.stringify([
    {
      file: 'src/proxyServer.ts',
      line: 430,
      summary: 'Responses replies are parsed as chat completions.',
      failure_scenario: 'A non-streaming response loses its text and tool calls.',
    },
  ]));

  assert.equal(text, [
    '## Review findings',
    '',
    '### 1. Responses replies are parsed as chat completions.',
    '',
    '`src/proxyServer.ts:430`',
    '',
    'A non-streaming response loses its text and tool calls.',
  ].join('\n'));
});

test('formatReviewFindings leaves unrelated JSON unchanged', () => {
  const text = JSON.stringify([{ name: 'ordinary data', value: 1 }]);
  assert.equal(formatReviewFindings(text), text);
});
