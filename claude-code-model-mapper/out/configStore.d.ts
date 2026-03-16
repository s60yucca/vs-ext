import * as vscode from 'vscode';
import { ModelConfig, LMProviderConfig, ProxyServerOptions } from './types';
export declare const DEFAULT_MODEL_CONFIGS: ModelConfig[];
export declare class ConfigStore {
    private readonly context;
    constructor(context: vscode.ExtensionContext);
    getModelConfigs(): ModelConfig[];
    setModelConfigs(configs: ModelConfig[]): Promise<void>;
    getLMProviderConfig(): LMProviderConfig;
    setLMProviderConfig(config: LMProviderConfig): Promise<void>;
    getApiKey(): Promise<string | undefined>;
    setApiKey(key: string): Promise<void>;
    getProxyOptions(): ProxyServerOptions;
    onDidChange(handler: () => void): vscode.Disposable;
}
//# sourceMappingURL=configStore.d.ts.map