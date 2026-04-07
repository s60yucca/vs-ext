import { ModelConfig } from './types';

export const DEFAULT_MODEL_CONFIGS: ModelConfig[] = [
  { sourceModel: 'claude-haiku',  targetModel: 'accounts/fireworks/models/llama-v3p2-3b-instruct',    enabled: true },
  { sourceModel: 'claude-sonnet', targetModel: 'accounts/fireworks/models/llama-v3p1-70b-instruct', enabled: true },
  { sourceModel: 'claude-opus',   targetModel: 'accounts/fireworks/models/deepseek-r1',               enabled: true },
];

export function mergeModelConfigs(configs: ModelConfig[]): ModelConfig[] {
  if (configs.length === 0) {
    return DEFAULT_MODEL_CONFIGS;
  }

  const merged = new Map<string, ModelConfig>();
  for (const config of DEFAULT_MODEL_CONFIGS) {
    merged.set(config.sourceModel, config);
  }
  for (const config of configs) {
    merged.set(config.sourceModel, config);
  }

  return [...merged.values()];
}
