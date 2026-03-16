"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateModelConfig = validateModelConfig;
exports.validateBaseUrl = validateBaseUrl;
function validateModelConfig(config) {
    if (!config.sourceModel || config.sourceModel.trim() === '') {
        return { valid: false, error: 'Source model không được để trống.' };
    }
    if (!config.targetModel || config.targetModel.trim() === '') {
        return { valid: false, error: 'Target model không được để trống.' };
    }
    return { valid: true };
}
function validateBaseUrl(url) {
    if (!url || url.trim() === '') {
        return { valid: false, error: 'Base URL không được để trống.' };
    }
    const trimmed = url.trim();
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
        return { valid: false, error: 'Base URL phải bắt đầu bằng http:// hoặc https://.' };
    }
    return { valid: true };
}
//# sourceMappingURL=validation.js.map