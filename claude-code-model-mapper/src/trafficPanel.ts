import * as vscode from 'vscode';
import { RequestEvent, TrafficPanelMessage, TrafficPanelCommand } from './types';

const MAX_REQUESTS = 200;

export class TrafficPanel implements vscode.WebviewViewProvider {
  public static readonly viewId = 'claudeCodeModelMapper.trafficPanel';

  private view?: vscode.WebviewView;
  private requests: RequestEvent[] = [];

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getHtml();

    webviewView.webview.onDidReceiveMessage((msg: TrafficPanelCommand) => {
      if (msg.type === 'clearCompleted') { this.clearCompleted(); }
      if (msg.type === 'ready') { this.post({ type: 'init', requests: this.requests }); }
    });
  }

  addRequest(event: RequestEvent): void {
    this.requests.push(event);
    this.enforceLimit();
    this.post({ type: 'add', request: event });
  }

  updateRequest(id: string, update: Partial<RequestEvent>): void {
    const idx = this.requests.findIndex(r => r.id === id);
    if (idx !== -1) {
      this.requests[idx] = { ...this.requests[idx], ...update };
    }
    this.post({ type: 'update', id, update });
  }

  clearCompleted(): void {
    this.requests = this.requests.filter(r => r.status === 'queued' || r.status === 'processing');
    this.post({ type: 'clear' });
    this.post({ type: 'init', requests: this.requests });
  }

  private enforceLimit(): void {
    if (this.requests.length <= MAX_REQUESTS) { return; }
    // Remove oldest completed/error first
    const toRemove = this.requests.length - MAX_REQUESTS;
    let removed = 0;
    this.requests = this.requests.filter(r => {
      if (removed < toRemove && (r.status === 'completed' || r.status === 'error')) {
        removed++;
        return false;
      }
      return true;
    });
    // If still over limit, remove oldest regardless
    if (this.requests.length > MAX_REQUESTS) {
      this.requests = this.requests.slice(this.requests.length - MAX_REQUESTS);
    }
  }

  private post(msg: TrafficPanelMessage): void {
    this.view?.webview.postMessage(msg);
  }
}

function getHtml(): string {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-panel-background); margin: 0; padding: 8px; }
  .toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .toolbar h3 { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.7; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 3px 8px; cursor: pointer; font-size: 11px; border-radius: 2px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  #list { display: flex; flex-direction: column; gap: 4px; }
  .row { background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border, #333); border-radius: 3px; padding: 6px 8px; font-size: 11px; }
  .row-header { display: flex; justify-content: space-between; align-items: center; }
  .req-id { font-family: monospace; opacity: 0.6; }
  .models { margin-top: 3px; opacity: 0.85; }
  .arrow { margin: 0 4px; opacity: 0.5; }
  .badge { padding: 1px 6px; border-radius: 10px; font-size: 10px; font-weight: 600; }
  .badge-queued    { background: #555; color: #ccc; }
  .badge-processing{ background: #0e639c; color: #fff; }
  .badge-completed { background: #388a34; color: #fff; }
  .badge-error     { background: #a1260d; color: #fff; }
  .duration { opacity: 0.5; font-size: 10px; margin-left: 6px; }
  .empty { opacity: 0.4; text-align: center; margin-top: 24px; font-size: 12px; }
  .error-msg { margin-top: 3px; color: #f48771; font-size: 10px; word-break: break-all; }
</style>
</head>
<body>
<div class="toolbar">
  <h3>Lưu lượng trực tiếp</h3>
  <button id="clearBtn">Xóa đã xong</button>
</div>
<div id="list"><div class="empty">Chưa có request nào.</div></div>
<script>
  const vscode = acquireVsCodeApi();
  let requests = [];

  document.getElementById('clearBtn').addEventListener('click', () => {
    vscode.postMessage({ type: 'clearCompleted' });
  });

  function fmt(ms) {
    if (ms < 1000) return ms + 'ms';
    return (ms / 1000).toFixed(1) + 's';
  }

  function render() {
    const list = document.getElementById('list');
    if (requests.length === 0) {
      list.innerHTML = '<div class="empty">Chưa có request nào.</div>';
      return;
    }
    list.innerHTML = [...requests].reverse().map(r => {
      const dur = r.endTime ? fmt(r.endTime - r.startTime) : fmt(Date.now() - r.startTime);
      return \`<div class="row" id="r-\${r.id}">
        <div class="row-header">
          <span class="req-id">\${r.id}</span>
          <span>
            <span class="badge badge-\${r.status}">\${statusLabel(r.status)}</span>
            <span class="duration">\${dur}</span>
          </span>
        </div>
        <div class="models">
          <span>\${r.sourceModel || '?'}</span>
          <span class="arrow">→</span>
          <span>\${r.targetModel || '?'}</span>
        </div>
        \${r.error ? \`<div class="error-msg">\${r.error}</div>\` : ''}
      </div>\`;
    }).join('');
  }

  function statusLabel(s) {
    return { queued: 'Đang chờ', processing: 'Đang xử lý', completed: 'Hoàn thành', error: 'Lỗi' }[s] || s;
  }

  window.addEventListener('message', e => {
    const msg = e.data;
    if (msg.type === 'init') { requests = msg.requests; render(); }
    else if (msg.type === 'add') { requests.push(msg.request); render(); }
    else if (msg.type === 'update') {
      const idx = requests.findIndex(r => r.id === msg.id);
      if (idx !== -1) requests[idx] = { ...requests[idx], ...msg.update };
      render();
    }
    else if (msg.type === 'clear') { requests = []; render(); }
  });

  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}
