import * as vscode from 'vscode';

export class StatusBar {
  private item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'claudeCodeModelMapper.openTrafficPanel';
    this.setStopped();
    this.item.show();
  }

  setRunning(port: number): void {
    this.item.text = `$(radio-tower) Proxy: localhost:${port}`;
    this.item.tooltip = 'Claude Code Model Mapper đang chạy. Click để mở Traffic Panel.';
    this.item.backgroundColor = undefined;
  }

  setStopped(): void {
    this.item.text = `$(circle-slash) Proxy: Stopped`;
    this.item.tooltip = 'Claude Code Model Mapper đã dừng.';
    this.item.backgroundColor = undefined;
  }

  setError(msg?: string): void {
    this.item.text = `$(error) Proxy: Error`;
    this.item.tooltip = msg || 'Proxy server gặp lỗi.';
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  }

  dispose(): void {
    this.item.dispose();
  }
}
