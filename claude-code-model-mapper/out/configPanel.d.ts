import * as vscode from 'vscode';
import { ConfigStore } from './configStore';
export declare class ConfigPanel implements vscode.WebviewViewProvider {
    private readonly store;
    private readonly extensionUri;
    static readonly viewId = "claudeCodeModelMapper.configPanel";
    private view?;
    private onConfigChangedCallback?;
    private onMapperToggledCallback?;
    constructor(store: ConfigStore, extensionUri: vscode.Uri);
    onConfigChanged(cb: () => Promise<void> | void): void;
    onMapperToggled(cb: (enabled: boolean) => Promise<void> | void): void;
    resolveWebviewView(webviewView: vscode.WebviewView): void;
    private sendInit;
    private handleSaveConfigs;
    private handleSaveLMProvider;
    private handleToggleMapper;
    private post;
}
//# sourceMappingURL=configPanel.d.ts.map