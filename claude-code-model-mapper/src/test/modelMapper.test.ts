import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeClaudeModelName, resolve } from '../modelMapper';
import { DEFAULT_MODEL_CONFIGS } from '../modelConfigDefaults';

const configs = DEFAULT_MODEL_CONFIGS.map(config => ({ ...config }));

test('resolve maps current Claude Code model aliases to default families', () => {
  assert.equal(resolve('claude-opus-4-8', configs), 'accounts/fireworks/models/deepseek-r1');
  assert.equal(resolve('claude-sonnet-5', configs), 'accounts/fireworks/models/llama-v3p1-70b-instruct');
  assert.equal(resolve('claude-haiku-4-5-20251001', configs), 'accounts/fireworks/models/llama-v3p2-3b-instruct');
});

test('resolve strips Claude Code context suffixes before matching', () => {
  assert.equal(resolve('claude-opus-4-8[1m]', configs), 'accounts/fireworks/models/deepseek-r1');
  assert.equal(resolve('claude-sonnet-5[1m]', configs), 'accounts/fireworks/models/llama-v3p1-70b-instruct');
});

test('resolve strips ANSI color sequences from model names before matching', () => {
  assert.equal(resolve('\x1b[1mclaude-opus-4-8\x1b[0m', configs), 'accounts/fireworks/models/deepseek-r1');
});

test('normalizeClaudeModelName removes suffixes without changing real model ids', () => {
  assert.equal(normalizeClaudeModelName('claude-opus-4-8[1m]'), 'claude-opus-4-8');
  assert.equal(normalizeClaudeModelName('\x1b[1mclaude-sonnet-5\x1b[0m'), 'claude-sonnet-5');
  assert.equal(normalizeClaudeModelName('claude-haiku-4-5-20251001'), 'claude-haiku-4-5-20251001');
});
