import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeModelConfigs } from '../modelConfigDefaults';

test('getModelConfigs returns defaults when no config is stored', () => {
  const configs = mergeModelConfigs([]);

  assert.equal(configs.length, 3);
  assert.equal(configs[0]?.sourceModel, 'claude-haiku');
  assert.equal(configs[1]?.sourceModel, 'claude-sonnet');
  assert.equal(configs[2]?.sourceModel, 'claude-opus');
});

test('getModelConfigs merges missing defaults into older partial configs', () => {
  const configs = mergeModelConfigs([
    { sourceModel: 'claude-haiku', targetModel: 'minimax/minimax-m2.7', enabled: true },
  ]);

  assert.equal(configs.length, 3);
  assert.deepEqual(
    configs.map(config => config.sourceModel),
    ['claude-haiku', 'claude-sonnet', 'claude-opus']
  );
});
