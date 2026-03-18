import * as vscode from 'vscode';
import { ModelConfig, LMProviderConfig, ProxyServerOptions } from './types';

const SECRET_KEY = 'claudeCodeModelMapper.apiKey';
const CFG = 'claudeCodeModelMapper';

export const DEFAULT_MODEL_CONFIGS: ModelConfig[] = [
  { sourceModel: 'claude-haiku',  targetModel: 'minimax/minimax-m2.5',                    enabled: true },
  { sourceModel: 'claude-sonnet', targetModel: 'meta-llama/llama-3.3-70b-instruct',       enabled: true },
  { sourceModel: 'claude-opus',   targetModel: 'nvidia/llama-3.1-nemotron-ultra-253b',    enabled: true },
];

export class ConfigStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  getModelConfigs(): ModelConfig[] {
    const raw = vscode.workspace.getConfiguration(CFG).get<ModelConfig[]>('modelConfigs', []);
    return raw.length > 0 ? raw : DEFAULT_MODEL_CONFIGS;
  }

  async setModelConfigs(configs: ModelConfig[]): Promise<void> {
    await vscode.workspace.getConfiguration(CFG).update(
      'modelConfigs', configs, vscode.ConfigurationTarget.Global
    );
  }

  getLMProviderConfig(): LMProviderConfig {
    return vscode.workspace.getConfiguration(CFG).get<LMProviderConfig>(
      'lmProvider', { baseUrl: 'https://openrouter.ai/api/v1' }
    );
  }

  async setLMProviderConfig(config: LMProviderConfig): Promise<void> {
    await vscode.workspace.getConfiguration(CFG).update(
      'lmProvider', config, vscode.ConfigurationTarget.Global
    );
  }

  async getApiKey(): Promise<string | undefined> {
    return this.context.secrets.get(SECRET_KEY);
  }

  async setApiKey(key: string): Promise<void> {
    await this.context.secrets.store(SECRET_KEY, key);
  }

  getProxyOptions(): ProxyServerOptions {
    const cfg = vscode.workspace.getConfiguration(CFG);
    return {
      port: cfg.get<number>('proxyPort', 3456),
      portRangeEnd: cfg.get<number>('proxyPortRangeEnd', 3466),
    };
  }

  onDidChange(handler: () => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration(CFG)) {
        handler();
      }
    });
  }
}
