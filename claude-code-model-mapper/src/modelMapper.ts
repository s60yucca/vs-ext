import { ModelConfig } from './types';

/**
 * Resolves a Claude source model name to the configured target model.
 * Priority: exact match > prefix match > pass-through (return sourceModel unchanged)
 */
export function resolve(sourceModel: string, configs: ModelConfig[]): string {
  const enabled = configs.filter(c => c.enabled);

  // 1. Exact match
  const exact = enabled.find(c => c.sourceModel === sourceModel);
  if (exact) {
    return exact.targetModel;
  }

  // 2. Prefix match — longest prefix wins to avoid ambiguity
  let best: ModelConfig | undefined;
  for (const c of enabled) {
    if (sourceModel.startsWith(c.sourceModel)) {
      if (!best || c.sourceModel.length > best.sourceModel.length) {
        best = c;
      }
    }
  }
  if (best) {
    return best.targetModel;
  }

  // 3. Pass-through
  return sourceModel;
}
