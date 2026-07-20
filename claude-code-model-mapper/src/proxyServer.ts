import * as http from 'http';
import * as https from 'https';
import * as zlib from 'zlib';
import { EventEmitter } from 'events';
import { resolve as resolveModel } from './modelMapper';
import { ModelConfig, LMProviderConfig, ProxyServerOptions, RequestEvent } from './types';
import { anthropicToOpenAI } from './proxy/anthropicRequestAdapter';
import { appendProxyDebug } from './proxy/debugLogger';
import { buildUpstreamHeaders } from './proxy/headerBuilder';
import { summarizeOutboundBody } from './proxy/requestSummary';
import { buildDecodedResponseHeaders } from './proxy/responseHeaders';
import { adaptResponsesRequest, isResponsesEndpoint, openAIChatToResponses, parseNonStreamingResponse } from './proxy/responsesAdapter';
import { streamOpenAIAsAnthropic } from './proxy/streamingResponseAdapter';
import { buildUpstreamUrl } from './proxy/urlBuilder';

export { anthropicToOpenAI } from './proxy/anthropicRequestAdapter';
export { openAIChatToResponses } from './proxy/responsesAdapter';
export { mapStreamingFinishReason } from './proxy/streamingResponseAdapter';
export { extractDeltaText, extractTextContent, formatReviewFindings, sanitizeVisibleText } from './proxy/textAdapter';
export { buildUpstreamUrl } from './proxy/urlBuilder';

export class ProxyServer extends EventEmitter {
  private server: http.Server | null = null;
  private _actualPort: number | null = null;
  private _isRunning = false;
  private restartAttempts = 0;
  private readonly maxRestartAttempts = 3;
  private modelConfigs: ModelConfig[] = [];
  private providerConfig: LMProviderConfig = { baseUrl: 'https://openrouter.ai/api/v1' };
  private apiKey = '';

  get actualPort(): number | null { return this._actualPort; }
  get isRunning(): boolean { return this._isRunning; }

  updateConfig(modelConfigs: ModelConfig[], providerConfig: LMProviderConfig, apiKey: string): void {
    this.modelConfigs = modelConfigs;
    this.providerConfig = providerConfig;
    this.apiKey = apiKey;
  }

  async start(options: ProxyServerOptions): Promise<number> {
    const port = await this.tryBind(options.port, options.portRangeEnd);
    this._actualPort = port;
    this._isRunning = true;
    this.restartAttempts = 0;
    return port;
  }

  async stop(): Promise<void> {
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

  private tryBind(port: number, portRangeEnd: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const attempt = (candidate: number): void => {
        if (candidate > portRangeEnd) {
          reject(new Error(`Không tìm được port trống trong dải ${port}-${portRangeEnd}`));
          return;
        }
        const server = http.createServer((req, res) => this.handleRequest(req, res));
        server.once('error', (error: NodeJS.ErrnoException) => {
          if (error.code === 'EADDRINUSE') {
            attempt(candidate + 1);
          } else {
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

  private handleServerError(error: Error, port: number, portRangeEnd: number): void {
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

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const id = generateRequestId();
    this.emit('requestEvent', {
      id,
      sourceModel: '',
      targetModel: '',
      status: 'queued',
      startTime: Date.now(),
    } satisfies RequestEvent);

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

  private processRequestBody(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    id: string,
    rawBody: string
  ): void {
    let body: Record<string, unknown>;
    try {
      body = rawBody.trim() ? JSON.parse(rawBody) : {};
    } catch {
      this.sendError(res, id, 400, 'Invalid JSON body');
      return;
    }

    const requestedMaxTokens = body.max_tokens;
    if (typeof requestedMaxTokens === 'number' && requestedMaxTokens > 4096) {
      body.max_tokens = 4096;
    }
    const sourceModel = typeof body.model === 'string' ? body.model : '';
    const targetModel = resolveModel(sourceModel, this.modelConfigs);
    body.model = targetModel;
    this.emitUpdate(id, { sourceModel, targetModel, status: 'processing' });

    const isStreaming = !!body.stream;
    const convertResponse = isMessagesRequest(req.url) && !this.providerConfig.nativeAnthropic;
    let rewrittenUrl = req.url || '/';
    if (convertResponse) {
      body = anthropicToOpenAI(body);
      rewrittenUrl = rewrittenUrl.replace('/messages', '/chat/completions').replace(/\?.*$/, '');
      const finalUrl = this.providerConfig.isFullEndpoint
        ? this.providerConfig.baseUrl
        : buildUpstreamUrl(this.providerConfig.baseUrl, rewrittenUrl).toString();
      if (isResponsesEndpoint(finalUrl)) {
        if (typeof requestedMaxTokens === 'number') {
          body.max_tokens = requestedMaxTokens;
        }
        body = adaptResponsesRequest(openAIChatToResponses(body));
      }
    }
    this.forwardRequest(req, JSON.stringify(body), rewrittenUrl, convertResponse, isStreaming, res, id);
  }

  private forwardRequest(
    req: http.IncomingMessage,
    body: string,
    rewrittenUrl: string,
    convertResponse: boolean,
    isStreaming: boolean,
    res: http.ServerResponse,
    id: string
  ): void {
    const url = this.providerConfig.isFullEndpoint
      ? new URL(this.providerConfig.baseUrl)
      : buildUpstreamUrl(this.providerConfig.baseUrl, rewrittenUrl);
    appendProxyDebug(`[${id}] request url=${url.toString()} ${summarizeOutboundBody(body)}`);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;
    const headers = buildUpstreamHeaders(
      req.headers,
      this.providerConfig,
      this.apiKey,
      Buffer.byteLength(body),
      convertResponse
    );
    const proxyReq = transport.request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: req.method,
      headers,
      timeout: 120_000,
    }, proxyRes => this.handleUpstreamResponse(proxyRes, body, convertResponse, isStreaming, res, id, url));

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

  private handleUpstreamResponse(
    proxyRes: http.IncomingMessage,
    requestBody: string,
    convertResponse: boolean,
    isStreaming: boolean,
    res: http.ServerResponse,
    id: string,
    url: URL
  ): void {
    const upstream = getDecodedResponseStream(proxyRes);
    if ((proxyRes.statusCode || 200) >= 400) {
      this.forwardUpstreamError(upstream, proxyRes, res, id, url);
      return;
    }
    if (convertResponse && isStreaming) {
      res.writeHead(proxyRes.statusCode || 200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      const model = (JSON.parse(requestBody).model as string) || '';
      streamOpenAIAsAnthropic(upstream, res, { model }).then(() => {
        appendProxyDebug(`[${id}] completed status=${proxyRes.statusCode || 200} streaming=true`);
        this.emitUpdate(id, { status: 'completed', endTime: Date.now() });
      }).catch(error => {
        appendProxyDebug(`[${id}] stream-error error=${String(error)}`);
        this.emitUpdate(id, { status: 'error', error: String(error), endTime: Date.now() });
      });
      return;
    }
    if (convertResponse) {
      this.forwardNonStreamingResponse(upstream, proxyRes, res, id);
      return;
    }
    res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
    proxyRes.pipe(res);
    proxyRes.on('end', () => {
      appendProxyDebug(`[${id}] completed status=${proxyRes.statusCode || 200} streaming=false passthrough=true`);
      this.emitUpdate(id, { status: 'completed', endTime: Date.now() });
    });
  }

  private forwardNonStreamingResponse(
    upstream: NodeJS.ReadableStream,
    proxyRes: http.IncomingMessage,
    res: http.ServerResponse,
    id: string
  ): void {
    let responseBody = '';
    upstream.on('data', chunk => { responseBody += chunk.toString(); });
    upstream.on('end', () => {
      try {
        const parsed = parseNonStreamingResponse(JSON.parse(responseBody));
        const output = JSON.stringify(parsed.message);
        res.writeHead(proxyRes.statusCode || 200, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(output).toString(),
        });
        res.end(output);
      } catch {
        res.writeHead(proxyRes.statusCode || 200, buildDecodedResponseHeaders(proxyRes.headers, responseBody));
        res.end(responseBody);
      }
      appendProxyDebug(`[${id}] completed status=${proxyRes.statusCode || 200} streaming=false converted=true`);
      this.emitUpdate(id, { status: 'completed', endTime: Date.now() });
    });
  }

  private forwardUpstreamError(
    upstream: NodeJS.ReadableStream,
    proxyRes: http.IncomingMessage,
    res: http.ServerResponse,
    id: string,
    url: URL
  ): void {
    let responseBody = '';
    upstream.on('data', chunk => { responseBody += chunk.toString(); });
    upstream.on('end', () => {
      let errorMessage = `HTTP ${proxyRes.statusCode} -> ${url.toString()}`;
      try {
        const parsed = JSON.parse(responseBody);
        errorMessage = parsed?.error?.message || parsed?.message || errorMessage;
      } catch {
        // Keep the HTTP status and URL fallback.
      }
      appendProxyDebug(`[${id}] upstream-error status=${proxyRes.statusCode || 500} url=${url.toString()} error=${errorMessage}`);
      res.writeHead(proxyRes.statusCode || 500, buildDecodedResponseHeaders(proxyRes.headers, responseBody));
      res.end(responseBody);
      this.emitUpdate(id, { status: 'error', error: errorMessage, endTime: Date.now() });
    });
  }

  private sendLocalResponse(res: http.ServerResponse, id: string, model: string, body: Record<string, unknown>): void {
    this.emitUpdate(id, { sourceModel: model, targetModel: 'local', status: 'processing' });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
    this.emitUpdate(id, { status: 'completed', endTime: Date.now() });
  }

  private sendError(res: http.ServerResponse, id: string, status: number, message: string): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
    this.emitUpdate(id, { status: 'error', error: message, endTime: Date.now() });
  }

  private emitUpdate(id: string, update: Partial<RequestEvent>): void {
    this.emit('requestUpdate', { id, update });
  }
}

function generateRequestId(): string {
  const hex = (Date.now() ^ (Math.random() * 0xffff | 0)).toString(16).slice(-4);
  return `req-${hex}`;
}

function isMessagesRequest(url: string | undefined): boolean {
  try {
    return new URL(url || '/', 'http://localhost').pathname.endsWith('/messages');
  } catch {
    return false;
  }
}

function getDecodedResponseStream(proxyRes: http.IncomingMessage): NodeJS.ReadableStream {
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
