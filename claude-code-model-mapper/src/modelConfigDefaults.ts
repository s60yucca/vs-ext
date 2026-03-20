import { ModelConfig } from './types';

export const DEFAULT_MODEL_CONFIGS: ModelConfig[] = [
  { sourceModel: 'claude-haiku',  targetModel: 'minimax/minimax-m2.7',                    enabled: true },
  { sourceModel: 'claude-sonnet', targetModel: 'meta-llama/llama-3.3-70b-instruct',       enabled: true },
  { sourceModel: 'claude-opus',   targetModel: 'nvidia/llama-3.1-nemotron-ultra-253b',    enabled: true },
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
