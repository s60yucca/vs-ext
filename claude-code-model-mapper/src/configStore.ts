import * as vscode from 'vscode';
import { ModelConfig, LMProviderConfig, ProxyServerOptions } from './types';
import { DEFAULT_MODEL_CONFIGS, mergeModelConfigs } from './modelConfigDefaults';

const SECRET_KEY = 'claudeCodeModelMapper.apiKey';
const CFG = 'claudeCodeModelMapper';

export class ConfigStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  getModelConfigs(): ModelConfig[] {
    const raw = vscode.workspace.getConfiguration(CFG).get<ModelConfig[]>('modelConfigs', []);
    return mergeModelConfigs(raw);
  }

  async setModelConfigs(configs: ModelConfig[]): Promise<void> {
    const configuration = vscode.workspace.getConfiguration(CFG);
    const target = this.getConfigurationTarget();
    await configuration.update('modelConfigs', configs, target);
    if (target === vscode.ConfigurationTarget.Workspace) {
      await configuration.update('modelConfigs', configs, vscode.ConfigurationTarget.Global);
    }
  }

  isMapperEnabled(): boolean {
    return vscode.workspace.getConfiguration(CFG).get<boolean>('enabled', true);
  }

  async setMapperEnabled(enabled: boolean): Promise<void> {
    await vscode.workspace.getConfiguration(CFG).update('enabled', enabled, this.getConfigurationTarget());
  }

  isDebugLoggingEnabled(): boolean {
    return vscode.workspace.getConfiguration(CFG).get<boolean>('debugLoggingEnabled', false);
  }

  async setDebugLoggingEnabled(enabled: boolean): Promise<void> {
    await vscode.workspace.getConfiguration(CFG).update('debugLoggingEnabled', enabled, this.getConfigurationTarget());
  }

  getLMProviderConfig(): LMProviderConfig {
    const config = vscode.workspace.getConfiguration(CFG).get<LMProviderConfig>(
      'lmProvider', { baseUrl: 'https://openrouter.ai/api/v1' }
    );
    return {
      baseUrl: config.baseUrl || 'https://openrouter.ai/api/v1',
      nativeAnthropic: config.nativeAnthropic || false,
      authHeader: config.authHeader,
      authValuePrefix: config.authValuePrefix,
      isFullEndpoint: config.isFullEndpoint || false,
    };
  }

  async setLMProviderConfig(config: LMProviderConfig): Promise<void> {
    await vscode.workspace.getConfiguration(CFG).update('lmProvider', config, true);
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

  private getConfigurationTarget(): vscode.ConfigurationTarget {
    return vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
  }
}
