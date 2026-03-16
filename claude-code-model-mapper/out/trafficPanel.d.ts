import * as vscode from 'vscode';
import { RequestEvent } from './types';
export declare class TrafficPanel implements vscode.WebviewViewProvider {
    static readonly viewId = "claudeCodeModelMapper.trafficPanel";
    private view?;
    private requests;
    resolveWebviewView(webviewView: vscode.WebviewView): void;
    addRequest(event: RequestEvent): void;
    updateRequest(id: string, update: Partial<RequestEvent>): void;
    clearCompleted(): void;
    private enforceLimit;
    private post;
}
//# sourceMappingURL=trafficPanel.d.ts.map