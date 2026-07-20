import * as vscode from 'vscode';
import { ConfigStore } from './configStore';
import { DEFAULT_MODEL_CONFIGS } from './modelConfigDefaults';
import { validateModelConfig, validateBaseUrl } from './validation';
import { ConfigPanelMessage, ConfigPanelResponse, ModelConfig, LMProviderConfig } from './types';
import { clearProxyDebugLogs, setProxyDebugEnabled } from './proxy/debugLogger';

export class ConfigPanel implements vscode.WebviewViewProvider {
  public static readonly viewId = 'claudeCodeModelMapper.configPanel';

  private view?: vscode.WebviewView;
  private onConfigChangedCallback?: () => Promise<void> | void;
  private onMapperToggledCallback?: (enabled: boolean) => Promise<void> | void;

  constructor(
    private readonly store: ConfigStore,
    private readonly extensionUri: vscode.Uri
  ) {}

  onConfigChanged(cb: () => Promise<void> | void): void {
    this.onConfigChangedCallback = cb;
  }

  onMapperToggled(cb: (enabled: boolean) => Promise<void> | void): void {
    this.onMapperToggledCallback = cb;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getHtml(webviewView.webview, this.extensionUri);

    webviewView.webview.onDidReceiveMessage(async (msg: ConfigPanelMessage) => {
      if (msg.type === 'ready') {
        await this.sendInit();
      } else if (msg.type === 'saveConfigs') {
        vscode.window.showInformationMessage(`Đang lưu ${msg.configs.length} mappings...`);
        await this.handleSaveConfigs(msg.configs);
      } else if (msg.type === 'saveLMProvider') {
        vscode.window.showInformationMessage(`Đang lưu provider: ${msg.config.baseUrl}`);
        await this.handleSaveLMProvider(msg.config, msg.apiKey);
      } else if (msg.type === 'toggleMapper') {
        await this.handleToggleMapper(msg.enabled);
      } else if (msg.type === 'toggleDebugLogging') {
        await this.store.setDebugLoggingEnabled(msg.enabled);
        setProxyDebugEnabled(msg.enabled);
        this.post({ type: 'saved', scope: 'debugLogging' });
        await this.sendInit();
      } else if (msg.type === 'clearDebugLogs') {
        await clearProxyDebugLogs();
        this.post({ type: 'logsCleared' });
      }
    });
  }

  private async sendInit(): Promise<void> {
    let configs = this.store.getModelConfigs();
    if (configs.length === 0) {
      configs = DEFAULT_MODEL_CONFIGS;
      await this.store.setModelConfigs(configs);
    }
    const lmProvider = this.store.getLMProviderConfig();
    const apiKey = await this.store.getApiKey();
    const version = vscode.extensions.getExtension('thohoang.claude-code-model-mapper')?.packageJSON?.version || 'unknown';
    this.post({ type: 'init', configs, lmProvider, hasApiKey: !!apiKey, mapperEnabled: this.store.isMapperEnabled(), debugLoggingEnabled: this.store.isDebugLoggingEnabled(), version });
  }

  private async handleSaveConfigs(configs: ModelConfig[]): Promise<void> {
    for (const c of configs) {
      const result = validateModelConfig(c);
      if (!result.valid) {
        this.post({ type: 'error', message: result.error! });
        return;
      }
    }
    // Enforce uniqueness: last entry wins for duplicate sourceModel
    const unique = new Map<string, ModelConfig>();
    for (const c of configs) { unique.set(c.sourceModel, c); }
    try {
      await this.store.setModelConfigs([...unique.values()]);
      await this.onConfigChangedCallback?.();
      vscode.window.showInformationMessage(`Đã lưu ${unique.size} mappings.`);
      this.post({ type: 'saved', scope: 'configs' });
      await this.sendInit();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Không lưu được mappings: ${message}`);
      this.post({ type: 'error', message: `Không lưu được mappings: ${message}` });
    }
  }

  private async handleSaveLMProvider(config: LMProviderConfig, apiKey?: string): Promise<void> {
    const urlResult = validateBaseUrl(config.baseUrl);
    if (!urlResult.valid) {
      this.post({ type: 'error', message: urlResult.error! });
      return;
    }
    try {
      await this.store.setLMProviderConfig(config);
      // Only update key if user typed a new non-empty value
      if (apiKey !== undefined && apiKey.trim() !== '') {
        await this.store.setApiKey(apiKey.trim());
      }
      await this.onConfigChangedCallback?.();
      vscode.window.showInformationMessage(`Đã lưu provider: ${config.baseUrl}`);
      this.post({ type: 'saved', scope: 'provider' });
      await this.sendInit();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Không lưu được provider: ${message}`);
      this.post({ type: 'error', message: `Không lưu được provider: ${message}` });
    }
  }

  private async handleToggleMapper(enabled: boolean): Promise<void> {
    try {
      await this.store.setMapperEnabled(enabled);
      await this.onMapperToggledCallback?.(enabled);
      this.post({ type: 'saved', scope: 'mapper' });
      await this.sendInit();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.post({ type: 'error', message: `Không đổi được mapper mode: ${message}` });
    }
  }

  private post(msg: ConfigPanelResponse): void {
    this.view?.webview.postMessage(msg);
  }
}

function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'configPanel.js'));
  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-panel-background); margin: 0; padding: 8px; }
  .release-banner { margin-bottom: 10px; padding: 6px 8px; border: 1px solid var(--vscode-focusBorder); border-radius: 4px; font-size: 11px; color: var(--vscode-editor-foreground); background: color-mix(in srgb, var(--vscode-button-background) 18%, transparent); }
  .mode-switch { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px; border: 1px solid var(--vscode-panel-border, #555); border-radius: 4px; }
  .mode-switch label { display: flex; align-items: center; gap: 7px; margin: 0; font-size: 12px; opacity: 1; cursor: pointer; }
  .mode-state { font-size: 11px; opacity: 0.75; text-align: right; }
  h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.7; margin: 12px 0 6px; }
  input { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, #555); padding: 4px 6px; width: 100%; box-sizing: border-box; font-size: 12px; border-radius: 2px; }
  input:focus { outline: 1px solid var(--vscode-focusBorder); }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 10px; cursor: pointer; font-size: 12px; border-radius: 2px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #ccc); }
  .row { display: grid; grid-template-columns: 1fr 1fr auto auto; gap: 4px; align-items: center; margin-bottom: 4px; }
  .row input { min-width: 0; }
  .toggle { cursor: pointer; }
  .error { color: var(--vscode-errorForeground, #f48771); font-size: 11px; margin: 4px 0; }
  .success { color: #4ec9b0; font-size: 11px; margin: 4px 0; }
  .add-row { display: flex; gap: 4px; margin-top: 6px; }
  .add-row input { flex: 1; }
  .section { margin-bottom: 16px; }
  .provider-grid { display: grid; gap: 4px; }
  select { background: var(--vscode-dropdown-background, var(--vscode-input-background)); color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground)); border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, #555)); padding: 4px 6px; width: 100%; box-sizing: border-box; font-size: 12px; border-radius: 2px; }
  .hint { font-size: 11px; opacity: 0.7; margin-top: 4px; }
  label { font-size: 11px; opacity: 0.7; display: block; margin-bottom: 2px; }
</style>
</head>
<body>
<div class="release-banner" id="releaseBanner">Claude Code Model Mapper · Release</div>
<div class="section">
  <div class="mode-switch">
    <label><input type="checkbox" id="mapperEnabled" style="width:auto"> Use Model Mapper</label>
    <span class="mode-state" id="mapperState">Loading...</span>
  </div>
  <div id="mapperMsg"></div>
</div>
<div class="section">
  <h3>Model Mappings</h3>
  <div id="mappings"></div>
  <div class="add-row">
    <input id="newSource" placeholder="claude-haiku" title="Source model">
    <input id="newTarget" placeholder="minimax/minimax-m2.7" title="Target model">
    <button id="addBtn">+</button>
  </div>
  <div id="mapMsg"></div>
  <button id="saveMapBtn" style="margin-top:8px">Lưu mappings</button>
</div>

<div class="section">
  <h3>LM Provider</h3>
  <div class="provider-grid">
    <div>
      <label>Preset</label>
      <select id="providerPreset">
        <option value="openrouter">OpenRouter</option>
        <option value="openadapter">OpenAdapter</option>
        <option value="fireworks">Fireworks AI</option>
        <option value="azure">Azure OpenAI</option>
        <option value="custom">Custom</option>
      </select>
    </div>
    <div><label>Base URL</label><input id="baseUrl" placeholder="https://openrouter.ai/api/v1"></div>
    <div><label>API Key</label><input id="apiKey" type="password" placeholder="sk-..."></div>
    <div style="margin-top: 8px;">
      <label style="display: flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer;">
        <input type="checkbox" id="nativeAnthropic" style="width: auto;">
        Bypass OpenAI format (Provider supports Anthropic Native API)
      </label>
    </div>
    <details id="advancedSection" style="margin-top: 8px;">
      <summary style="cursor: pointer; font-size: 11px; opacity: 0.7;">Advanced Auth &amp; URL</summary>
      <div style="margin-top: 6px; display: grid; gap: 4px;">
        <div>
          <label>Auth Header</label>
          <input id="authHeader" placeholder="authorization">
        </div>
        <div>
          <label>Auth Value Prefix</label>
          <input id="authValuePrefix" placeholder="Bearer ">
        </div>
        <div>
          <label style="display: flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer;">
            <input type="checkbox" id="isFullEndpoint" style="width: auto;">
            Full endpoint URL (don't append path)
          </label>
        </div>
      </div>
    </details>
  </div>
  <div class="hint">For Azure, set Base URL to the full endpoint (e.g. <code>https://YOUR.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-08-01-preview</code>), Auth Header to <code>api-key</code>, and check Full endpoint.</div>
  <div id="provMsg"></div>
  <button id="saveProvBtn" style="margin-top:8px">Lưu provider</button>
</div>
<div class="section">
  <h3>Debug Logs</h3>
  <div class="mode-switch">
    <label><input type="checkbox" id="debugLoggingEnabled" style="width:auto"> Enable debug logging</label>
    <button class="secondary" id="clearDebugLogsBtn">Clear logs</button>
  </div>
  <div class="hint">Off by default. Logs contain metadata only and rotate at 2 MB.</div>
  <div id="debugLogMsg"></div>
</div>
<script src="${scriptUri}"></script>
</body>
</html>`;
}
