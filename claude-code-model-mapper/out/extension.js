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
const claudeEnvironment_1 = require("./claudeEnvironment");
const configPanel_1 = require("./configPanel");
const configStore_1 = require("./configStore");
const proxyServer_1 = require("./proxyServer");
const statusBar_1 = require("./statusBar");
const trafficPanel_1 = require("./trafficPanel");
const debugLogger_1 = require("./proxy/debugLogger");
let activeProxy;
let activeEnvironment;
async function activate(context) {
    const store = new configStore_1.ConfigStore(context);
    const proxy = new proxyServer_1.ProxyServer();
    const environment = new claudeEnvironment_1.ClaudeEnvironmentManager(context);
    const trafficPanel = new trafficPanel_1.TrafficPanel();
    const configPanel = new configPanel_1.ConfigPanel(store, context.extensionUri);
    const statusBar = new statusBar_1.StatusBar();
    activeProxy = proxy;
    activeEnvironment = environment;
    (0, debugLogger_1.setProxyDebugEnabled)(store.isDebugLoggingEnabled());
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(trafficPanel_1.TrafficPanel.viewId, trafficPanel), vscode.window.registerWebviewViewProvider(configPanel_1.ConfigPanel.viewId, configPanel), statusBar);
    proxy.on('requestEvent', (event) => trafficPanel.addRequest(event));
    proxy.on('requestUpdate', ({ id, update }) => {
        trafficPanel.updateRequest(id, update);
    });
    proxy.on('restarted', async (port) => {
        if (!store.isMapperEnabled()) {
            return;
        }
        await environment.enable(port);
        statusBar.setRunning(port);
        vscode.window.showInformationMessage(`Model Mapper restarted on port ${port}.`);
    });
    proxy.on('fatalError', (error) => {
        statusBar.setError(error.message);
        vscode.window.showErrorMessage(`Model Mapper error: ${error.message}`, 'Retry').then(choice => {
            if (choice === 'Retry') {
                void setMapperEnabled(true, true);
            }
        });
    });
    const syncProxyConfig = async () => {
        const apiKey = await store.getApiKey() ?? '';
        proxy.updateConfig(store.getModelConfigs(), store.getLMProviderConfig(), apiKey);
    };
    const enableMapper = async (showMessage) => {
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
    const disableMapper = async (showMessage) => {
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
    const applyConfiguredState = (showMessage = false) => {
        transition = transition.then(async () => {
            if (store.isMapperEnabled()) {
                await enableMapper(showMessage);
            }
            else {
                await disableMapper(showMessage);
            }
        }).catch(error => {
            const message = error instanceof Error ? error.message : String(error);
            statusBar.setError(message);
            vscode.window.showErrorMessage(`Cannot change Model Mapper mode: ${message}`);
        });
        return transition;
    };
    const setMapperEnabled = async (enabled, showMessage = true) => {
        await store.setMapperEnabled(enabled);
        await applyConfiguredState(showMessage);
    };
    configPanel.onConfigChanged(syncProxyConfig);
    configPanel.onMapperToggled(async () => {
        await applyConfiguredState(true);
    });
    context.subscriptions.push(store.onDidChange(() => {
        (0, debugLogger_1.setProxyDebugEnabled)(store.isDebugLoggingEnabled());
        void applyConfiguredState(false);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('claudeCodeModelMapper.enableMapper', () => setMapperEnabled(true, true)), vscode.commands.registerCommand('claudeCodeModelMapper.disableMapper', () => setMapperEnabled(false, true)), vscode.commands.registerCommand('claudeCodeModelMapper.toggleMapper', () => setMapperEnabled(!store.isMapperEnabled(), true)), vscode.commands.registerCommand('claudeCodeModelMapper.startProxy', () => setMapperEnabled(true, true)), vscode.commands.registerCommand('claudeCodeModelMapper.stopProxy', () => setMapperEnabled(false, true)), vscode.commands.registerCommand('claudeCodeModelMapper.toggleDebugLogging', async () => {
        const enabled = !store.isDebugLoggingEnabled();
        await store.setDebugLoggingEnabled(enabled);
        (0, debugLogger_1.setProxyDebugEnabled)(enabled);
        vscode.window.showInformationMessage(`Model Mapper debug logging ${enabled ? 'enabled' : 'disabled'}.`);
    }), vscode.commands.registerCommand('claudeCodeModelMapper.clearDebugLogs', async () => {
        await (0, debugLogger_1.clearProxyDebugLogs)();
        vscode.window.showInformationMessage('Model Mapper debug logs cleared.');
    }), vscode.commands.registerCommand('claudeCodeModelMapper.openTrafficPanel', () => {
        void vscode.commands.executeCommand('claudeCodeModelMapper.trafficPanel.focus');
    }), vscode.commands.registerCommand('claudeCodeModelMapper.openConfigPanel', () => {
        void vscode.commands.executeCommand('claudeCodeModelMapper.configPanel.focus');
    }));
    await applyConfiguredState(false);
}
async function deactivate() {
    await activeProxy?.stop();
    await activeEnvironment?.disable();
    activeProxy = undefined;
    activeEnvironment = undefined;
}
//# sourceMappingURL=extension.js.map