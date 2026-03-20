import * as vscode from 'vscode';
import { ConfigStore } from './configStore';
import { ProxyServer } from './proxyServer';
import { TrafficPanel } from './trafficPanel';
import { ConfigPanel } from './configPanel';
import { StatusBar } from './statusBar';
import { RequestEvent } from './types';

let activeProxy: ProxyServer | undefined;

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
    vscode.window.showInformationMessage('Claude Code Model Mapper: Proxy đã dừng.');
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

function configureClaudeCode(port: number): void {
  const url = `http://127.0.0.1:${port}`;
  const terminalEnv = vscode.workspace.getConfiguration('terminal.integrated.env');
  const envConfig = vscode.workspace.getConfiguration();
  const claudeCodeConfig = vscode.workspace.getConfiguration('claudeCode');
  const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
  const current = terminalEnv.get<Record<string, string>>(platform, {});
  terminalEnv.update(platform, {
    ...current,
    ANTHROPIC_BASE_URL: url,
    ANTHROPIC_API_KEY: current['ANTHROPIC_API_KEY'] || 'dummy',
    ANTHROPIC_AUTH_TOKEN: '',   // clear conflicting token
  }, vscode.ConfigurationTarget.Workspace);

  const currentEnv = envConfig.get<Record<string, string>>('env', {});
  envConfig.update('env', {
    ...currentEnv,
    ANTHROPIC_BASE_URL: url,
    ANTHROPIC_API_KEY: currentEnv['ANTHROPIC_API_KEY'] || 'dummy',
    ANTHROPIC_AUTH_TOKEN: '',
  }, vscode.ConfigurationTarget.Workspace);

  const currentClaudeVars = claudeCodeConfig.get<Array<{ name: string; value: string }>>('environmentVariables', []);
  const mergedClaudeVars = upsertEnvironmentVariable(currentClaudeVars, 'ANTHROPIC_BASE_URL', url);
  const withApiKey = upsertEnvironmentVariable(mergedClaudeVars, 'ANTHROPIC_API_KEY', currentEnv['ANTHROPIC_API_KEY'] || 'dummy');
  const finalClaudeVars = upsertEnvironmentVariable(withApiKey, 'ANTHROPIC_AUTH_TOKEN', '');
  claudeCodeConfig.update('environmentVariables', finalClaudeVars, vscode.ConfigurationTarget.Workspace);
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
