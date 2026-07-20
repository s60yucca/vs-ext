import * as vscode from 'vscode';
import { ClaudeEnvironmentManager } from './claudeEnvironment';
import { ConfigPanel } from './configPanel';
import { ConfigStore } from './configStore';
import { ProxyServer } from './proxyServer';
import { StatusBar } from './statusBar';
import { TrafficPanel } from './trafficPanel';
import { RequestEvent } from './types';

let activeProxy: ProxyServer | undefined;
let activeEnvironment: ClaudeEnvironmentManager | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const store = new ConfigStore(context);
  const proxy = new ProxyServer();
  const environment = new ClaudeEnvironmentManager(context);
  const trafficPanel = new TrafficPanel();
  const configPanel = new ConfigPanel(store, context.extensionUri);
  const statusBar = new StatusBar();
  activeProxy = proxy;
  activeEnvironment = environment;

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(TrafficPanel.viewId, trafficPanel),
    vscode.window.registerWebviewViewProvider(ConfigPanel.viewId, configPanel),
    statusBar,
  );

  proxy.on('requestEvent', (event: RequestEvent) => trafficPanel.addRequest(event));
  proxy.on('requestUpdate', ({ id, update }: { id: string; update: Partial<RequestEvent> }) => {
    trafficPanel.updateRequest(id, update);
  });
  proxy.on('restarted', async (port: number) => {
    if (!store.isMapperEnabled()) { return; }
    await environment.enable(port);
    statusBar.setRunning(port);
    vscode.window.showInformationMessage(`Model Mapper restarted on port ${port}.`);
  });
  proxy.on('fatalError', (error: Error) => {
    statusBar.setError(error.message);
    vscode.window.showErrorMessage(`Model Mapper error: ${error.message}`, 'Retry').then(choice => {
      if (choice === 'Retry') { void setMapperEnabled(true, true); }
    });
  });

  const syncProxyConfig = async (): Promise<void> => {
    const apiKey = await store.getApiKey() ?? '';
    proxy.updateConfig(store.getModelConfigs(), store.getLMProviderConfig(), apiKey);
  };

  const enableMapper = async (showMessage: boolean): Promise<void> => {
    await syncProxyConfig();
    const port = proxy.isRunning && proxy.actualPort !== null
      ? proxy.actualPort
      : await proxy.start(store.getProxyOptions());
    await environment.enable(port);
    statusBar.setRunning(port);
    if (showMessage) {
      vscode.window.showInformationMessage(`Model Mapper enabled at http://127.0.0.1:${port}. New Claude sessions will use mapper config.`);
    }
  };

  const disableMapper = async (showMessage: boolean): Promise<void> => {
    if (proxy.isRunning) {
      await proxy.stop();
    }
    await environment.disable();
    statusBar.setStopped();
    if (showMessage) {
      vscode.window.showInformationMessage('Model Mapper disabled. New Claude sessions will use your Claude subscription.');
    }
  };

  let transition = Promise.resolve();
  const applyConfiguredState = (showMessage = false): Promise<void> => {
    transition = transition.then(async () => {
      if (store.isMapperEnabled()) {
        await enableMapper(showMessage);
      } else {
        await disableMapper(showMessage);
      }
    }).catch(error => {
      const message = error instanceof Error ? error.message : String(error);
      statusBar.setError(message);
      vscode.window.showErrorMessage(`Cannot change Model Mapper mode: ${message}`);
    });
    return transition;
  };

  const setMapperEnabled = async (enabled: boolean, showMessage = true): Promise<void> => {
    await store.setMapperEnabled(enabled);
    await applyConfiguredState(showMessage);
  };

  configPanel.onConfigChanged(syncProxyConfig);
  configPanel.onMapperToggled(async () => {
    await applyConfiguredState(true);
  });
  context.subscriptions.push(store.onDidChange(() => { void applyConfiguredState(false); }));

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeCodeModelMapper.enableMapper', () => setMapperEnabled(true, true)),
    vscode.commands.registerCommand('claudeCodeModelMapper.disableMapper', () => setMapperEnabled(false, true)),
    vscode.commands.registerCommand('claudeCodeModelMapper.toggleMapper', () => setMapperEnabled(!store.isMapperEnabled(), true)),
    vscode.commands.registerCommand('claudeCodeModelMapper.startProxy', () => setMapperEnabled(true, true)),
    vscode.commands.registerCommand('claudeCodeModelMapper.stopProxy', () => setMapperEnabled(false, true)),
    vscode.commands.registerCommand('claudeCodeModelMapper.openTrafficPanel', () => {
      void vscode.commands.executeCommand('claudeCodeModelMapper.trafficPanel.focus');
    }),
    vscode.commands.registerCommand('claudeCodeModelMapper.openConfigPanel', () => {
      void vscode.commands.executeCommand('claudeCodeModelMapper.configPanel.focus');
    }),
  );

  await applyConfiguredState(false);
}

export async function deactivate(): Promise<void> {
  await activeProxy?.stop();
  await activeEnvironment?.disable();
  activeProxy = undefined;
  activeEnvironment = undefined;
}
