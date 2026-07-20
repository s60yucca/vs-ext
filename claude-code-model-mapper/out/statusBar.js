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
exports.StatusBar = void 0;
const vscode = __importStar(require("vscode"));
class StatusBar {
    constructor() {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.item.command = 'claudeCodeModelMapper.toggleMapper';
        this.setStopped();
        this.item.show();
    }
    setRunning(port) {
        this.item.text = `$(radio-tower) Mapper: On (${port})`;
        this.item.tooltip = 'Model Mapper is on. Click to switch to Claude subscription.';
        this.item.backgroundColor = undefined;
    }
    setStopped() {
        this.item.text = `$(circle-slash) Mapper: Off`;
        this.item.tooltip = 'Using Claude subscription. Click to enable Model Mapper.';
        this.item.backgroundColor = undefined;
    }
    setError(msg) {
        this.item.text = `$(error) Proxy: Error`;
        this.item.tooltip = msg || 'Proxy server gặp lỗi.';
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    }
    dispose() {
        this.item.dispose();
    }
}
exports.StatusBar = StatusBar;
//# sourceMappingURL=statusBar.js.map