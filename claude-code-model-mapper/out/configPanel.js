"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigPanel = void 0;
const validation_1 = require("./validation");
class ConfigPanel {
    constructor(store) {
        this.store = store;
    }
    onConfigChanged(cb) {
        this.onConfigChangedCallback = cb;
    }
    resolveWebviewView(webviewView) {
        this.view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = getHtml();
        webviewView.webview.onDidReceiveMessage(async (msg) => {
            if (msg.type === 'ready') {
                await this.sendInit();
            }
            else if (msg.type === 'saveConfigs') {
                await this.handleSaveConfigs(msg.configs);
            }
            else if (msg.type === 'saveLMProvider') {
                await this.handleSaveLMProvider(msg.config, msg.apiKey);
            }
        });
    }
    async sendInit() {
        const configs = this.store.getModelConfigs();
        const lmProvider = this.store.getLMProviderConfig();
        this.post({ type: 'init', configs, lmProvider });
    }
    async handleSaveConfigs(configs) {
        for (const c of configs) {
            const result = (0, validation_1.validateModelConfig)(c);
            if (!result.valid) {
                this.post({ type: 'error', message: result.error });
                return;
            }
        }
        // Enforce uniqueness: last entry wins for duplicate sourceModel
        const unique = new Map();
        for (const c of configs) {
            unique.set(c.sourceModel, c);
        }
        await this.store.setModelConfigs([...unique.values()]);
        this.post({ type: 'saved' });
        this.onConfigChangedCallback?.();
    }
    async handleSaveLMProvider(config, apiKey) {
        const urlResult = (0, validation_1.validateBaseUrl)(config.baseUrl);
        if (!urlResult.valid) {
            this.post({ type: 'error', message: urlResult.error });
            return;
        }
        await this.store.setLMProviderConfig(config);
        if (apiKey !== undefined && apiKey !== '') {
            await this.store.setApiKey(apiKey);
        }
        this.post({ type: 'saved' });
        this.onConfigChangedCallback?.();
    }
    post(msg) {
        this.view?.webview.postMessage(msg);
    }
}
exports.ConfigPanel = ConfigPanel;
ConfigPanel.viewId = 'claudeCodeModelMapper.configPanel';
function getHtml() {
    return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-panel-background); margin: 0; padding: 8px; }
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
  label { font-size: 11px; opacity: 0.7; display: block; margin-bottom: 2px; }
</style>
</head>
<body>
<div class="section">
  <h3>Model Mappings</h3>
  <div id="mappings"></div>
  <div class="add-row">
    <input id="newSource" placeholder="claude-haiku" title="Source model">
    <input id="newTarget" placeholder="minimax/minimax-m2.5" title="Target model">
    <button id="addBtn">+</button>
  </div>
  <div id="mapMsg"></div>
  <button id="saveMapBtn" style="margin-top:8px">Lưu mappings</button>
</div>

<div class="section">
  <h3>LM Provider</h3>
  <div class="provider-grid">
    <div><label>Base URL</label><input id="baseUrl" placeholder="https://openrouter.ai/api/v1"></div>
    <div><label>API Key</label><input id="apiKey" type="password" placeholder="sk-..."></div>
  </div>
  <div id="provMsg"></div>
  <button id="saveProvBtn" style="margin-top:8px">Lưu provider</button>
</div>

<script>
  const vscode = acquireVsCodeApi();
  let configs = [];

  function renderMappings() {
    const el = document.getElementById('mappings');
    if (configs.length === 0) { el.innerHTML = '<div style="opacity:0.4;font-size:11px">Chưa có mapping nào.</div>'; return; }
    el.innerHTML = configs.map((c, i) => \`
      <div class="row">
        <input value="\${esc(c.sourceModel)}" data-i="\${i}" data-f="sourceModel" onchange="update(this)">
        <input value="\${esc(c.targetModel)}" data-i="\${i}" data-f="targetModel" onchange="update(this)">
        <input type="checkbox" class="toggle" \${c.enabled ? 'checked' : ''} title="Bật/tắt" data-i="\${i}" onchange="toggle(this)">
        <button class="secondary" onclick="remove(\${i})">✕</button>
      </div>\`).join('');
  }

  function esc(s) { return (s||'').replace(/"/g,'&quot;'); }
  function update(el) { configs[+el.dataset.i][el.dataset.f] = el.value; }
  function toggle(el) { configs[+el.dataset.i].enabled = el.checked; }
  function remove(i) { configs.splice(i, 1); renderMappings(); }

  document.getElementById('addBtn').addEventListener('click', () => {
    const src = document.getElementById('newSource').value.trim();
    const tgt = document.getElementById('newTarget').value.trim();
    if (!src || !tgt) { showMsg('mapMsg', 'Vui lòng nhập đủ source và target.', true); return; }
    configs.push({ sourceModel: src, targetModel: tgt, enabled: true });
    document.getElementById('newSource').value = '';
    document.getElementById('newTarget').value = '';
    renderMappings();
  });

  document.getElementById('saveMapBtn').addEventListener('click', () => {
    vscode.postMessage({ type: 'saveConfigs', configs });
  });

  document.getElementById('saveProvBtn').addEventListener('click', () => {
    const baseUrl = document.getElementById('baseUrl').value.trim();
    const apiKey = document.getElementById('apiKey').value;
    vscode.postMessage({ type: 'saveLMProvider', config: { baseUrl }, apiKey });
  });

  function showMsg(id, msg, isError) {
    const el = document.getElementById(id);
    el.className = isError ? 'error' : 'success';
    el.textContent = msg;
    setTimeout(() => { el.textContent = ''; }, 3000);
  }

  window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.type === 'init') {
      configs = msg.configs || [];
      renderMappings();
      if (msg.lmProvider) document.getElementById('baseUrl').value = msg.lmProvider.baseUrl || '';
    } else if (msg.type === 'saved') {
      showMsg('mapMsg', 'Đã lưu.', false);
      showMsg('provMsg', 'Đã lưu.', false);
    } else if (msg.type === 'error') {
      showMsg('mapMsg', msg.message, true);
      showMsg('provMsg', msg.message, true);
    }
  });

  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}
//# sourceMappingURL=configPanel.js.map