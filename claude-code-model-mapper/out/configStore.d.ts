import * as vscode from 'vscode';
import { ModelConfig, LMProviderConfig, ProxyServerOptions } from './types';
export declare class ConfigStore {
    private readonly context;
    constructor(context: vscode.ExtensionContext);
    getModelConfigs(): ModelConfig[];
    setModelConfigs(configs: ModelConfig[]): Promise<void>;
    isMapperEnabled(): boolean;
    setMapperEnabled(enabled: boolean): Promise<void>;
    getLMProviderConfig(): LMProviderConfig;
    setLMProviderConfig(config: LMProviderConfig): Promise<void>;
    getApiKey(): Promise<string | undefined>;
    setApiKey(key: string): Promise<void>;
    getProxyOptions(): ProxyServerOptions;
    onDidChange(handler: () => void): vscode.Disposable;
    private getConfigurationTarget;
}
//# sourceMappingURL=configStore.d.ts.map