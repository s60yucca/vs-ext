import { EventEmitter } from 'events';
import { ModelConfig, LMProviderConfig, ProxyServerOptions } from './types';
export { anthropicToOpenAI } from './proxy/anthropicRequestAdapter';
export { openAIChatToResponses } from './proxy/responsesAdapter';
export { mapStreamingFinishReason } from './proxy/streamingResponseAdapter';
export { extractDeltaText, extractTextContent, formatReviewFindings, sanitizeVisibleText } from './proxy/textAdapter';
export { buildUpstreamUrl } from './proxy/urlBuilder';
export declare class ProxyServer extends EventEmitter {
    private server;
    private _actualPort;
    private _isRunning;
    private restartAttempts;
    private readonly maxRestartAttempts;
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
    private processRequestBody;
    private forwardRequest;
    private handleUpstreamResponse;
    private forwardNonStreamingResponse;
    private forwardUpstreamError;
    private sendLocalResponse;
    private sendError;
    private emitUpdate;
}
//# sourceMappingURL=proxyServer.d.ts.map