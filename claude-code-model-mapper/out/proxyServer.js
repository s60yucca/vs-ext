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
exports.ProxyServer = exports.buildUpstreamUrl = exports.sanitizeVisibleText = exports.formatReviewFindings = exports.extractTextContent = exports.extractDeltaText = exports.mapStreamingFinishReason = exports.openAIChatToResponses = exports.anthropicToOpenAI = void 0;
const http = __importStar(require("http"));
const https = __importStar(require("https"));
const zlib = __importStar(require("zlib"));
const events_1 = require("events");
const modelMapper_1 = require("./modelMapper");
const anthropicRequestAdapter_1 = require("./proxy/anthropicRequestAdapter");
const debugLogger_1 = require("./proxy/debugLogger");
const functionCallStore_1 = require("./proxy/functionCallStore");
const headerBuilder_1 = require("./proxy/headerBuilder");
const requestSummary_1 = require("./proxy/requestSummary");
const responsesAdapter_1 = require("./proxy/responsesAdapter");
const streamingResponseAdapter_1 = require("./proxy/streamingResponseAdapter");
const urlBuilder_1 = require("./proxy/urlBuilder");
var anthropicRequestAdapter_2 = require("./proxy/anthropicRequestAdapter");
Object.defineProperty(exports, "anthropicToOpenAI", { enumerable: true, get: function () { return anthropicRequestAdapter_2.anthropicToOpenAI; } });
var responsesAdapter_2 = require("./proxy/responsesAdapter");
Object.defineProperty(exports, "openAIChatToResponses", { enumerable: true, get: function () { return responsesAdapter_2.openAIChatToResponses; } });
var streamingResponseAdapter_2 = require("./proxy/streamingResponseAdapter");
Object.defineProperty(exports, "mapStreamingFinishReason", { enumerable: true, get: function () { return streamingResponseAdapter_2.mapStreamingFinishReason; } });
var textAdapter_1 = require("./proxy/textAdapter");
Object.defineProperty(exports, "extractDeltaText", { enumerable: true, get: function () { return textAdapter_1.extractDeltaText; } });
Object.defineProperty(exports, "extractTextContent", { enumerable: true, get: function () { return textAdapter_1.extractTextContent; } });
Object.defineProperty(exports, "formatReviewFindings", { enumerable: true, get: function () { return textAdapter_1.formatReviewFindings; } });
Object.defineProperty(exports, "sanitizeVisibleText", { enumerable: true, get: function () { return textAdapter_1.sanitizeVisibleText; } });
var urlBuilder_2 = require("./proxy/urlBuilder");
Object.defineProperty(exports, "buildUpstreamUrl", { enumerable: true, get: function () { return urlBuilder_2.buildUpstreamUrl; } });
class ProxyServer extends events_1.EventEmitter {
    constructor() {
        super(...arguments);
        this.server = null;
        this._actualPort = null;
        this._isRunning = false;
        this.restartAttempts = 0;
        this.maxRestartAttempts = 3;
        this.functionCallStore = new functionCallStore_1.ConversationFunctionCallStore();
        this.modelConfigs = [];
        this.providerConfig = { baseUrl: 'https://openrouter.ai/api/v1' };
        this.apiKey = '';
    }
    get actualPort() { return this._actualPort; }
    get isRunning() { return this._isRunning; }
    updateConfig(modelConfigs, providerConfig, apiKey) {
        this.modelConfigs = modelConfigs;
        this.providerConfig = providerConfig;
        this.apiKey = apiKey;
        this.functionCallStore.clear();
    }
    async start(options) {
        const port = await this.tryBind(options.port, options.portRangeEnd);
        this._actualPort = port;
        this._isRunning = true;
        this.restartAttempts = 0;
        return port;
    }
    async stop() {
        return new Promise(resolve => {
            if (!this.server) {
                resolve();
                return;
            }
            this.server.close(() => {
                this._isRunning = false;
                this._actualPort = null;
                this.server = null;
                resolve();
            });
        });
    }
    tryBind(port, portRangeEnd) {
        return new Promise((resolve, reject) => {
            const attempt = (candidate) => {
                if (candidate > portRangeEnd) {
                    reject(new Error(`Không tìm được port trống trong dải ${port}-${portRangeEnd}`));
                    return;
                }
                const server = http.createServer((req, res) => this.handleRequest(req, res));
                server.once('error', (error) => {
                    if (error.code === 'EADDRINUSE') {
                        attempt(candidate + 1);
                    }
                    else {
                        reject(error);
                    }
                });
                server.listen(candidate, '127.0.0.1', () => {
                    this.server = server;
                    server.on('error', error => this.handleServerError(error, port, portRangeEnd));
                    resolve(candidate);
                });
            };
            attempt(port);
        });
    }
    handleServerError(error, port, portRangeEnd) {
        this._isRunning = false;
        this.emit('error', error);
        if (this.restartAttempts >= this.maxRestartAttempts) {
            this.emit('fatalError', new Error(`Proxy server crash sau ${this.maxRestartAttempts} lần restart`));
            return;
        }
        this.restartAttempts++;
        setTimeout(() => {
            this.tryBind(port, portRangeEnd).then(boundPort => {
                this._actualPort = boundPort;
                this._isRunning = true;
                this.restartAttempts = 0;
                this.emit('restarted', boundPort);
            }).catch(bindError => this.emit('fatalError', bindError));
        }, 1000);
    }
    handleRequest(req, res) {
        const id = generateRequestId();
        this.emit('requestEvent', {
            id,
            sourceModel: '',
            targetModel: '',
            status: 'queued',
            startTime: Date.now(),
        });
        if (req.url?.includes('/messages/count_tokens')) {
            this.sendLocalResponse(res, id, 'local-token-counter', { input_tokens: 0 });
            return;
        }
        if (req.url === '/' || req.url === '') {
            this.sendLocalResponse(res, id, 'local-healthcheck', { status: 'ok' });
            return;
        }
        let rawBody = '';
        req.on('data', chunk => { rawBody += chunk; });
        req.on('end', () => this.processRequestBody(req, res, id, rawBody));
    }
    processRequestBody(req, res, id, rawBody) {
        let body;
        try {
            body = rawBody.trim() ? JSON.parse(rawBody) : {};
        }
        catch {
            this.sendError(res, id, 400, 'Invalid JSON body');
            return;
        }
        if (typeof body.max_tokens === 'number' && body.max_tokens > 4096) {
            body.max_tokens = 4096;
        }
        const sourceModel = typeof body.model === 'string' ? body.model : '';
        const conversationKey = (0, functionCallStore_1.createConversationKey)(body);
        const targetModel = (0, modelMapper_1.resolve)(sourceModel, this.modelConfigs);
        body.model = targetModel;
        this.emitUpdate(id, { sourceModel, targetModel, status: 'processing' });
        const isStreaming = !!body.stream;
        const convertResponse = isMessagesRequest(req.url) && !this.providerConfig.nativeAnthropic;
        let rewrittenUrl = req.url || '/';
        if (convertResponse) {
            body = (0, anthropicRequestAdapter_1.anthropicToOpenAI)(body);
            rewrittenUrl = rewrittenUrl.replace('/messages', '/chat/completions').replace(/\?.*$/, '');
            const finalUrl = this.providerConfig.isFullEndpoint
                ? this.providerConfig.baseUrl
                : (0, urlBuilder_1.buildUpstreamUrl)(this.providerConfig.baseUrl, rewrittenUrl).toString();
            if ((0, responsesAdapter_1.isResponsesEndpoint)(finalUrl)) {
                body = (0, responsesAdapter_1.adaptResponsesRequest)((0, responsesAdapter_1.openAIChatToResponses)(body, this.functionCallStore.get(conversationKey)));
            }
        }
        this.forwardRequest(req, JSON.stringify(body), rewrittenUrl, convertResponse, isStreaming, res, id, conversationKey);
    }
    forwardRequest(req, body, rewrittenUrl, convertResponse, isStreaming, res, id, conversationKey) {
        const url = this.providerConfig.isFullEndpoint
            ? new URL(this.providerConfig.baseUrl)
            : (0, urlBuilder_1.buildUpstreamUrl)(this.providerConfig.baseUrl, rewrittenUrl);
        (0, debugLogger_1.appendProxyDebug)(`\n\n--- NEW REQUEST TO: ${url.toString()} ---\n${(0, requestSummary_1.summarizeOutboundBody)(body)}\n`);
        const isHttps = url.protocol === 'https:';
        const transport = isHttps ? https : http;
        const headers = (0, headerBuilder_1.buildUpstreamHeaders)(req.headers, this.providerConfig, this.apiKey, Buffer.byteLength(body), convertResponse);
        const proxyReq = transport.request({
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search,
            method: req.method,
            headers,
            timeout: 120000,
        }, proxyRes => this.handleUpstreamResponse(proxyRes, body, convertResponse, isStreaming, res, id, conversationKey, url));
        proxyReq.on('timeout', () => proxyReq.destroy(new Error('Read timeout - upstream did not respond in time')));
        proxyReq.on('error', error => {
            if (!res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Bad Gateway', detail: error.message }));
            }
            this.emitUpdate(id, { status: 'error', error: error.message, endTime: Date.now() });
        });
        proxyReq.write(body);
        proxyReq.end();
    }
    handleUpstreamResponse(proxyRes, requestBody, convertResponse, isStreaming, res, id, conversationKey, url) {
        const upstream = getDecodedResponseStream(proxyRes);
        if ((proxyRes.statusCode || 200) >= 400) {
            this.forwardUpstreamError(upstream, proxyRes, res, id, url);
            return;
        }
        if (convertResponse && isStreaming) {
            res.writeHead(proxyRes.statusCode || 200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
            const model = JSON.parse(requestBody).model || '';
            (0, streamingResponseAdapter_1.streamOpenAIAsAnthropic)(upstream, res, {
                model,
                onFunctionCall: item => this.functionCallStore.remember(conversationKey, item),
            }).then(() => {
                this.emitUpdate(id, { status: 'completed', endTime: Date.now() });
            }).catch(error => {
                this.emitUpdate(id, { status: 'error', error: String(error), endTime: Date.now() });
            });
            return;
        }
        if (convertResponse) {
            this.forwardNonStreamingResponse(upstream, proxyRes, res, id, conversationKey);
            return;
        }
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
        proxyRes.pipe(res);
        proxyRes.on('end', () => this.emitUpdate(id, { status: 'completed', endTime: Date.now() }));
    }
    forwardNonStreamingResponse(upstream, proxyRes, res, id, conversationKey) {
        let responseBody = '';
        upstream.on('data', chunk => { responseBody += chunk.toString(); });
        upstream.on('end', () => {
            try {
                const parsed = (0, responsesAdapter_1.parseNonStreamingResponse)(JSON.parse(responseBody));
                parsed.functionCalls.forEach(item => this.functionCallStore.remember(conversationKey, item));
                const output = JSON.stringify(parsed.message);
                res.writeHead(proxyRes.statusCode || 200, {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(output).toString(),
                });
                res.end(output);
            }
            catch {
                res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
                res.end(responseBody);
            }
            this.emitUpdate(id, { status: 'completed', endTime: Date.now() });
        });
    }
    forwardUpstreamError(upstream, proxyRes, res, id, url) {
        let responseBody = '';
        upstream.on('data', chunk => { responseBody += chunk.toString(); });
        upstream.on('end', () => {
            let errorMessage = `HTTP ${proxyRes.statusCode} -> ${url.toString()}`;
            try {
                const parsed = JSON.parse(responseBody);
                errorMessage = parsed?.error?.message || parsed?.message || errorMessage;
            }
            catch {
                // Keep the HTTP status and URL fallback.
            }
            (0, debugLogger_1.appendProxyDebug)(`--- UPSTREAM ERROR ${proxyRes.statusCode} ---\n${responseBody}\n`);
            res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
            res.end(responseBody);
            this.emitUpdate(id, { status: 'error', error: errorMessage, endTime: Date.now() });
        });
    }
    sendLocalResponse(res, id, model, body) {
        this.emitUpdate(id, { sourceModel: model, targetModel: 'local', status: 'processing' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
        this.emitUpdate(id, { status: 'completed', endTime: Date.now() });
    }
    sendError(res, id, status, message) {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: message }));
        this.emitUpdate(id, { status: 'error', error: message, endTime: Date.now() });
    }
    emitUpdate(id, update) {
        this.emit('requestUpdate', { id, update });
    }
}
exports.ProxyServer = ProxyServer;
function generateRequestId() {
    const hex = (Date.now() ^ (Math.random() * 0xffff | 0)).toString(16).slice(-4);
    return `req-${hex}`;
}
function isMessagesRequest(url) {
    try {
        return new URL(url || '/', 'http://localhost').pathname.endsWith('/messages');
    }
    catch {
        return false;
    }
}
function getDecodedResponseStream(proxyRes) {
    const encoding = String(proxyRes.headers['content-encoding'] || '').toLowerCase();
    if (encoding.includes('gzip')) {
        return proxyRes.pipe(zlib.createGunzip());
    }
    if (encoding.includes('br')) {
        return proxyRes.pipe(zlib.createBrotliDecompress());
    }
    if (encoding.includes('deflate')) {
        return proxyRes.pipe(zlib.createInflate());
    }
    return proxyRes;
}
//# sourceMappingURL=proxyServer.js.map