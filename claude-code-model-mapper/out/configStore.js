"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigStore = void 0;
const vscode = __importStar(require("vscode"));
const modelConfigDefaults_1 = require("./modelConfigDefaults");
const SECRET_KEY = 'claudeCodeModelMapper.apiKey';
const CFG = 'claudeCodeModelMapper';
class ConfigStore {
    constructor(context) {
        this.context = context;
    }
    getModelConfigs() {
        const raw = vscode.workspace.getConfiguration(CFG).get('modelConfigs', []);
        return (0, modelConfigDefaults_1.mergeModelConfigs)(raw);
    }
    async setModelConfigs(configs) {
        const configuration = vscode.workspace.getConfiguration(CFG);
        const target = this.getConfigurationTarget();
        await configuration.update('modelConfigs', configs, target);
        if (target === vscode.ConfigurationTarget.Workspace) {
            await configuration.update('modelConfigs', configs, vscode.ConfigurationTarget.Global);
        }
    }
    getLMProviderConfig() {
        const config = vscode.workspace.getConfiguration(CFG).get('lmProvider', { baseUrl: 'https://openrouter.ai/api/v1' });
        return {
            baseUrl: config.baseUrl || 'https://openrouter.ai/api/v1',
            nativeAnthropic: config.nativeAnthropic || false,
        };
    }
    async setLMProviderConfig(config) {
        await vscode.workspace.getConfiguration(CFG).update('lmProvider', config, true);
    }
    async getApiKey() {
        return this.context.secrets.get(SECRET_KEY);
    }
    async setApiKey(key) {
        await this.context.secrets.store(SECRET_KEY, key);
    }
    getProxyOptions() {
        const cfg = vscode.workspace.getConfiguration(CFG);
        return {
            port: cfg.get('proxyPort', 3456),
            portRangeEnd: cfg.get('proxyPortRangeEnd', 3466),
        };
    }
    onDidChange(handler) {
        return vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(CFG)) {
                handler();
            }
        });
    }
    getConfigurationTarget() {
        return vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global;
    }
}
exports.ConfigStore = ConfigStore;
//# sourceMappingURL=configStore.js.map