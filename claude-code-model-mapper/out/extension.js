"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const configStore_1 = require("./configStore");
const proxyServer_1 = require("./proxyServer");
const trafficPanel_1 = require("./trafficPanel");
const configPanel_1 = require("./configPanel");
const statusBar_1 = require("./statusBar");
async function activate(context) {
    const store = new configStore_1.ConfigStore(context);
    const proxy = new proxyServer_1.ProxyServer();
    const trafficPanel = new trafficPanel_1.TrafficPanel();
    const configPanel = new configPanel_1.ConfigPanel(store);
    const statusBar = new statusBar_1.StatusBar();
    // Register webview providers
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(trafficPanel_1.TrafficPanel.viewId, trafficPanel), vscode.window.registerWebviewViewProvider(configPanel_1.ConfigPanel.viewId, configPanel), statusBar);
    // Wire proxy events → traffic panel
    proxy.on('requestEvent', (event) => {
        trafficPanel.addRequest(event);
    });
    proxy.on('requestUpdate', ({ id, update }) => {
        trafficPanel.updateRequest(id, update);
    });
    proxy.on('restarted', (port) => {
        statusBar.setRunning(port);
        vscode.window.showInformationMessage(`Proxy server đã khởi động lại trên port ${port}.`);
    });
    proxy.on('fatalError', (err) => {
        statusBar.setError(err.message);
        vscode.window.showErrorMessage(`Proxy server lỗi: ${err.message}`, 'Thử lại', 'Xem log').then(choice => {
            if (choice === 'Thử lại') {
                startProxy();
            }
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
            vscode.window.showInformationMessage(`Claude Code Model Mapper: Proxy đang chạy tại http://127.0.0.1:${port}`, 'Copy URL').then(choice => {
                if (choice === 'Copy URL') {
                    vscode.env.clipboard.writeText(`http://127.0.0.1:${port}`);
                }
            });
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            statusBar.setError(msg);
            vscode.window.showErrorMessage(`Không thể khởi động proxy: ${msg}`, 'Thử lại').then(choice => { if (choice === 'Thử lại') {
                startProxy();
            } });
        }
    };
    const stopProxy = async () => {
        await proxy.stop();
        statusBar.setStopped();
        vscode.window.showInformationMessage('Claude Code Model Mapper: Proxy đã dừng.');
    };
    // Register commands
    context.subscriptions.push(vscode.commands.registerCommand('claudeCodeModelMapper.startProxy', startProxy), vscode.commands.registerCommand('claudeCodeModelMapper.stopProxy', stopProxy), vscode.commands.registerCommand('claudeCodeModelMapper.openTrafficPanel', () => {
        vscode.commands.executeCommand('claudeCodeModelMapper.trafficPanel.focus');
    }), vscode.commands.registerCommand('claudeCodeModelMapper.openConfigPanel', () => {
        vscode.commands.executeCommand('claudeCodeModelMapper.configPanel.focus');
    }));
    // Auto-start on activation
    await startProxy();
    // After proxy starts, configure Claude Code env
    proxy.once('restarted', (port) => configureClaudeCode(port));
}
function configureClaudeCode(port) {
    const url = `http://127.0.0.1:${port}`;
    const terminalEnv = vscode.workspace.getConfiguration('terminal.integrated.env');
    const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
    const current = terminalEnv.get(platform, {});
    terminalEnv.update(platform, {
        ...current,
        ANTHROPIC_BASE_URL: url,
        ANTHROPIC_API_KEY: current['ANTHROPIC_API_KEY'] || 'dummy',
        ANTHROPIC_AUTH_TOKEN: '', // clear conflicting token
    }, vscode.ConfigurationTarget.Workspace);
}
async function deactivate() {
    // Disposables in context.subscriptions are cleaned up automatically by VS Code
}
//# sourceMappingURL=extension.js.map