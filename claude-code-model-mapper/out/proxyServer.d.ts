import { EventEmitter } from 'events';
import { ModelConfig, LMProviderConfig, ProxyServerOptions } from './types';
export declare class ProxyServer extends EventEmitter {
    private server;
    private _actualPort;
    private _isRunning;
    private restartAttempts;
    private readonly MAX_RESTART;
    private modelConfigs;
    private providerConfig;
    private apiKey;
    get actualPort(): number | null;
    get isRunning(): boolean;
    updateConfig(modelConfigs: ModelConfig[], providerConfig: LMProviderConfig, apiKey: string): void;
    start(options: ProxyServerOptions): Promise<number>;
    stop(): Promise<void>;
    private tryBind;
    private handleServerError;
    private handleRequest;
    private forwardRequest;
    private emitUpdate;
}
export declare function buildUpstreamUrl(baseUrl: string, rewrittenUrl: string): URL;
export declare function extractTextContent(content: unknown): string;
export declare function extractDeltaText(delta: unknown): string;
export declare function sanitizeVisibleText(text: string): string;
export declare function anthropicToOpenAI(body: Record<string, unknown>): Record<string, unknown>;
//# sourceMappingURL=proxyServer.d.ts.map