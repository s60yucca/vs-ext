import * as vscode from 'vscode';
import { ConfigStore } from './configStore';
import { ProxyServer } from './proxyServer';
import { TrafficPanel } from './trafficPanel';
import { ConfigPanel } from './configPanel';
import { StatusBar } from './statusBar';
import { RequestEvent } from './types';

let activeProxy: ProxyServer | undefined;

// Store original Claude Code settings before overwriting
let originalSettings: {
  baseUrl?: string;
  apiKey?: string;
  authToken?: string;
} = {};

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const store = new ConfigStore(context);
  const proxy = new ProxyServer();
  activeProxy = proxy;
  const trafficPanel = new TrafficPanel();
  const configPanel = new ConfigPanel(store, context.extensionUri);
  const statusBar = new StatusBar();

  // Register webview providers
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(TrafficPanel.viewId, trafficPanel),
    vscode.window.registerWebviewViewProvider(ConfigPanel.viewId, configPanel),
    statusBar,
  );

  // Wire proxy events → traffic panel
  proxy.on('requestEvent', (event: RequestEvent) => {
    trafficPanel.addRequest(event);
  });
  proxy.on('requestUpdate', ({ id, update }: { id: string; update: Partial<RequestEvent> }) => {
    trafficPanel.updateRequest(id, update);
  });
  proxy.on('restarted', (port: number) => {
    statusBar.setRunning(port);
    vscode.window.showInformationMessage(`Proxy server đã khởi động lại trên port ${port}.`);
  });
  proxy.on('fatalError', (err: Error) => {
    statusBar.setError(err.message);
    vscode.window.showErrorMessage(
      `Proxy server lỗi: ${err.message}`,
      'Thử lại', 'Xem log'
    ).then(choice => {
      if (choice === 'Thử lại') { startProxy(); }
    });
  });

  // Wire config changes → proxy update
  const syncProxyConfig = async () => {
    const apiKey = await store.getApiKey() ?? '';
    proxy.updateConfig(store.getModelConfigs(), store.getLMProviderConfig(), apiKey);
  };

  configPanel.onConfigChanged(syncProxyConfig);
  context.subscriptions.push(store.onDidChange(syncProxyConfig));

  // Start proxy
  const startProxy = async () => {
    try {
      await syncProxyConfig();
      const port = await proxy.start(store.getProxyOptions());
      statusBar.setRunning(port);
      configureClaudeCode(port);
      vscode.window.showInformationMessage(
        `Claude Code Model Mapper: Proxy đang chạy tại http://127.0.0.1:${port}`,
        'Copy URL'
      ).then(choice => {
        if (choice === 'Copy URL') {
          vscode.env.clipboard.writeText(`http://127.0.0.1:${port}`);
        }
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      statusBar.setError(msg);
      vscode.window.showErrorMessage(
        `Không thể khởi động proxy: ${msg}`,
        'Thử lại'
      ).then(choice => { if (choice === 'Thử lại') { startProxy(); } });
    }
  };

  const stopProxy = async () => {
    await proxy.stop();
    statusBar.setStopped();
    restoreOriginalSettings();
    vscode.window.showInformationMessage('Claude Code Model Mapper: Proxy đã dừng. Claude Code sẽ dùng API key gốc.');
  };

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCodeModelMapper.startProxy', startProxy),
    vscode.commands.registerCommand('claudeCodeModelMapper.stopProxy', stopProxy),
    vscode.commands.registerCommand('claudeCodeModelMapper.openTrafficPanel', () => {
      vscode.commands.executeCommand('claudeCodeModelMapper.trafficPanel.focus');
    }),
    vscode.commands.registerCommand('claudeCodeModelMapper.openConfigPanel', () => {
      vscode.commands.executeCommand('claudeCodeModelMapper.configPanel.focus');
    }),
  );

  // Auto-start on activation
  await startProxy();

  // After proxy starts, configure Claude Code env
  proxy.once('restarted', (port: number) => configureClaudeCode(port));
}

function saveOriginalSettings(): void {
  // Only save if not already saved (first time only)
  if (originalSettings.baseUrl !== undefined) return;

  const claudeCodeConfig = vscode.workspace.getConfiguration('claudeCode');
  const currentVars = claudeCodeConfig.get<Array<{ name: string; value: string }>>('environmentVariables', []);

  originalSettings.baseUrl = currentVars.find(v => v.name === 'ANTHROPIC_BASE_URL')?.value;
  originalSettings.apiKey = currentVars.find(v => v.name === 'ANTHROPIC_API_KEY')?.value;
  originalSettings.authToken = currentVars.find(v => v.name === 'ANTHROPIC_AUTH_TOKEN')?.value;
}

function configureClaudeCode(port: number): void {
  const url = `http://127.0.0.1:${port}`;
  // Dummy key must be exactly 108 characters (13 prefix + 95 alphanumeric/hyphens) to pass Claude Code's regex validation
  const dummyKey = 'sk-ant-api03-dummykey000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';

  // Save original settings before overwriting (first time only)
  saveOriginalSettings();

  const terminalEnv = vscode.workspace.getConfiguration('terminal.integrated.env');
  const envConfig = vscode.workspace.getConfiguration();
  const claudeCodeConfig = vscode.workspace.getConfiguration('claudeCode');
  const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
  const current = terminalEnv.get<Record<string, string>>(platform, {});
  terminalEnv.update(platform, {
    ...current,
    ANTHROPIC_BASE_URL: url,
    ANTHROPIC_API_KEY: dummyKey,
    ANTHROPIC_AUTH_TOKEN: '',   // clear conflicting token
  }, vscode.ConfigurationTarget.Workspace);

  const currentEnv = envConfig.get<Record<string, string>>('env', {});
  envConfig.update('env', {
    ...currentEnv,
    ANTHROPIC_BASE_URL: url,
    ANTHROPIC_API_KEY: dummyKey,
    ANTHROPIC_AUTH_TOKEN: '',
  }, vscode.ConfigurationTarget.Workspace);

  const currentClaudeVars = claudeCodeConfig.get<Array<{ name: string; value: string }>>('environmentVariables', []);
  const mergedClaudeVars = upsertEnvironmentVariable(currentClaudeVars, 'ANTHROPIC_BASE_URL', url);
  const withApiKey = upsertEnvironmentVariable(mergedClaudeVars, 'ANTHROPIC_API_KEY', dummyKey);
  const finalClaudeVars = upsertEnvironmentVariable(withApiKey, 'ANTHROPIC_AUTH_TOKEN', '');
  claudeCodeConfig.update('environmentVariables', finalClaudeVars, vscode.ConfigurationTarget.Workspace);
}

function restoreOriginalSettings(): void {
  if (!originalSettings.baseUrl && !originalSettings.apiKey && !originalSettings.authToken) {
    vscode.window.showInformationMessage('Không có settings gốc để restore.');
    return;
  }

  const claudeCodeConfig = vscode.workspace.getConfiguration('claudeCode');
  let currentVars = claudeCodeConfig.get<Array<{ name: string; value: string }>>('environmentVariables', []);

  // Remove ANTHROPIC_* variables
  currentVars = currentVars.filter(v => !v.name.startsWith('ANTHROPIC_'));

  // Restore original settings if they exist
  if (originalSettings.baseUrl) {
    currentVars.push({ name: 'ANTHROPIC_BASE_URL', value: originalSettings.baseUrl });
  }
  if (originalSettings.apiKey) {
    currentVars.push({ name: 'ANTHROPIC_API_KEY', value: originalSettings.apiKey });
  }
  if (originalSettings.authToken) {
    currentVars.push({ name: 'ANTHROPIC_AUTH_TOKEN', value: originalSettings.authToken });
  }

  claudeCodeConfig.update('environmentVariables', currentVars, vscode.ConfigurationTarget.Workspace);

  // Also restore terminal environment
  const terminalEnv = vscode.workspace.getConfiguration('terminal.integrated.env');
  const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
  const current = terminalEnv.get<Record<string, string>>(platform, {});

  const updatedTerminalEnv = { ...current };
  if (originalSettings.baseUrl) updatedTerminalEnv.ANTHROPIC_BASE_URL = originalSettings.baseUrl;
  if (originalSettings.apiKey) updatedTerminalEnv.ANTHROPIC_API_KEY = originalSettings.apiKey;
  if (originalSettings.authToken) updatedTerminalEnv.ANTHROPIC_AUTH_TOKEN = originalSettings.authToken;

  terminalEnv.update(platform, updatedTerminalEnv, vscode.ConfigurationTarget.Workspace);

  // Clear the stored original settings
  originalSettings = {};

  vscode.window.showInformationMessage('Đã restore settings gốc của Claude Code. Khởi động lại Claude Code để áp d��ng.');
}

function upsertEnvironmentVariable(
  vars: Array<{ name: string; value: string }>,
  name: string,
  value: string
): Array<{ name: string; value: string }> {
  const filtered = vars.filter(entry => entry.name !== name);
  filtered.push({ name, value });
  return filtered;
}

export async function deactivate(): Promise<void> {
  await activeProxy?.stop();
  activeProxy = undefined;
}
