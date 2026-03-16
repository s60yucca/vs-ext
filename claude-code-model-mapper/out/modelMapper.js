"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve = resolve;
/**
 * Resolves a Claude source model name to the configured target model.
 * Priority: exact match > prefix match > pass-through (return sourceModel unchanged)
 */
function resolve(sourceModel, configs) {
    const enabled = configs.filter(c => c.enabled);
    // 1. Exact match
    const exact = enabled.find(c => c.sourceModel === sourceModel);
    if (exact) {
        return exact.targetModel;
    }
    // 2. Prefix match — longest prefix wins to avoid ambiguity
    let best;
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
//# sourceMappingURL=modelMapper.js.map