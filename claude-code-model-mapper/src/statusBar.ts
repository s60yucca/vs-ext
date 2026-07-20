import * as vscode from 'vscode';

export class StatusBar {
  private item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'claudeCodeModelMapper.toggleMapper';
    this.setStopped();
    this.item.show();
  }

  setRunning(port: number): void {
    this.item.text = `$(radio-tower) Mapper: On (${port})`;
    this.item.tooltip = 'Model Mapper is on. Click to switch to Claude subscription.';
    this.item.backgroundColor = undefined;
  }

  setStopped(): void {
    this.item.text = `$(circle-slash) Mapper: Off`;
    this.item.tooltip = 'Using Claude subscription. Click to enable Model Mapper.';
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
