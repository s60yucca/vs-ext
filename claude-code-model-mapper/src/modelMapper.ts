import { ModelConfig } from './types';

/**
 * Resolves a Claude source model name to the configured target model.
 * Priority: exact match > prefix match > pass-through (return sourceModel unchanged)
 */
export function resolve(sourceModel: string, configs: ModelConfig[]): string {
  const enabled = configs.filter(c => c.enabled);
  const candidates = getModelCandidates(sourceModel);

  // 1. Exact match against the raw model and normalized aliases.
  for (const candidate of candidates) {
    const exact = enabled.find(c => c.sourceModel === candidate);
    if (exact) {
      return exact.targetModel;
    }
  }

  // 2. Prefix match — longest prefix wins to avoid ambiguity.
  let best: ModelConfig | undefined;
  for (const c of enabled) {
    if (candidates.some(candidate => candidate.startsWith(c.sourceModel))) {
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

function getModelCandidates(sourceModel: string): string[] {
  const normalized = normalizeClaudeModelName(sourceModel);
  const candidates = [sourceModel, normalized];
  const family = getClaudeModelFamily(normalized);
  if (family) {
    candidates.push(family);
  }
  return [...new Set(candidates.filter(Boolean))];
}

export function normalizeClaudeModelName(sourceModel: string): string {
  return sourceModel
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\[[^\]]+\]$/g, '')
    .trim();
}

function getClaudeModelFamily(sourceModel: string): string | undefined {
  if (sourceModel.startsWith('claude-opus')) {
    return 'claude-opus';
  }
  if (sourceModel.startsWith('claude-sonnet')) {
    return 'claude-sonnet';
  }
  if (sourceModel.startsWith('claude-haiku')) {
    return 'claude-haiku';
  }
  return undefined;
}
