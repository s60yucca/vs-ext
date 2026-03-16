import * as vscode from 'vscode';
import { ConfigStore } from './configStore';
export declare class ConfigPanel implements vscode.WebviewViewProvider {
    private readonly store;
    static readonly viewId = "claudeCodeModelMapper.configPanel";
    private view?;
    private onConfigChangedCallback?;
    constructor(store: ConfigStore);
    onConfigChanged(cb: () => void): void;
    resolveWebviewView(webviewView: vscode.WebviewView): void;
    private sendInit;
    private handleSaveConfigs;
    private handleSaveLMProvider;
    private post;
}
//# sourceMappingURL=configPanel.d.ts.map