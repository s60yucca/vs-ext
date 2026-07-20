import { ModelConfig } from './types';
/**
 * Resolves a Claude source model name to the configured target model.
 * Priority: exact match > prefix match > pass-through (return sourceModel unchanged)
 */
export declare function resolve(sourceModel: string, configs: ModelConfig[]): string;
export declare function normalizeClaudeModelName(sourceModel: string): string;
//# sourceMappingURL=modelMapper.d.ts.map