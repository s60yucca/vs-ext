import * as http from 'http';
import * as https from 'https';
import * as zlib from 'zlib';
import { EventEmitter } from 'events';
import { ModelConfig, LMProviderConfig, ProxyServerOptions, RequestEvent, RequestStatus } from './types';
import { resolve as resolveModel } from './modelMapper';

const PROXY_DEBUG_FILE = '/Users/thohoang/Dev/AI/vs-ext/claude-code-model-mapper/proxy_debug.log';

function generateRequestId(): string {
  const hex = (Date.now() ^ (Math.random() * 0xffff | 0)).toString(16).slice(-4);
  return `req-${hex}`;
}

export class ProxyServer extends EventEmitter {
  private server: http.Server | null = null;
  private _actualPort: number | null = null;
  private _isRunning = false;
  private restartAttempts = 0;
  private readonly MAX_RESTART = 3;

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
      if (!this.server) { resolve(); return; }
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
      const attempt = (p: number) => {
        if (p > portRangeEnd) {
          reject(new Error(`Không tìm được port trống trong dải ${port}-${portRangeEnd}`));
          return;
        }
        const srv = http.createServer((req, res) => this.handleRequest(req, res));
        srv.once('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE') { attempt(p + 1); }
          else { reject(err); }
        });
        srv.listen(p, '127.0.0.1', () => {
          this.server = srv;
          this.server.on('error', (err) => this.handleServerError(err, port, portRangeEnd));
          resolve(p);
        });
      };
      attempt(port);
    });
  }

  private handleServerError(err: Error, port: number, portRangeEnd: number): void {
    this._isRunning = false;
    this.emit('error', err);
    if (this.restartAttempts < this.MAX_RESTART) {
      this.restartAttempts++;
      setTimeout(() => {
        this.tryBind(port, portRangeEnd).then(p => {
          this._actualPort = p;
          this._isRunning = true;
          this.restartAttempts = 0;
          this.emit('restarted', p);
        }).catch(e => this.emit('fatalError', e));
      }, 1000);
    } else {
      this.emit('fatalError', new Error(`Proxy server crash sau ${this.MAX_RESTART} lần restart`));
    }
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const id = generateRequestId();
    
    const event: RequestEvent = {
      id,
      sourceModel: '',
      targetModel: '',
      status: 'queued',
      startTime: Date.now(),
    };
    this.emit('requestEvent', { ...event });
    
    // Handle Claude Code's token counting endpoint locally
    if (req.url?.includes('/messages/count_tokens')) {
      this.emitUpdate(id, { sourceModel: 'local-token-counter', targetModel: 'local', status: 'processing' });
      // Mock response for token counting since most OpenAI compatible APIs don't support it directly
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ input_tokens: 0 }));
      this.emitUpdate(id, { status: 'completed', endTime: Date.now() });
      return;
    }
    
    // Handle root / healthcheck endpoints locally
    if (req.url === '/' || req.url === '') {
      this.emitUpdate(id, { sourceModel: 'local-healthcheck', targetModel: 'local', status: 'processing' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      this.emitUpdate(id, { status: 'completed', endTime: Date.now() });
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let parsed: Record<string, unknown> = {};
      if (body.trim()) {
        try {
          parsed = JSON.parse(body);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON body' }));
          this.emitUpdate(id, { status: 'error', error: 'Invalid JSON body', endTime: Date.now() });
          return;
        }
      }

      // Fix for Fireworks AI and strict providers: ALWAYS cap max_tokens to 4096
      // Fireworks has a hard limit on max_tokens for Anthropic-compatible /v1/messages
      // and OpenAI format also supports capping to prevent 400 Bad Request
      if (typeof parsed['max_tokens'] === 'number' && parsed['max_tokens'] > 4096) {
        parsed['max_tokens'] = 4096;
      }

      const sourceModel = (parsed['model'] as string) || '';
      const targetModel = resolveModel(sourceModel, this.modelConfigs);
      parsed['model'] = targetModel;

      this.emitUpdate(id, { sourceModel, targetModel, status: 'processing' });

      // Convert Anthropic /messages format → OpenAI /chat/completions format
      const isMessagesEndpoint = (req.url || '').includes('/messages');
      let rewrittenBody: string;
      let rewrittenUrl = req.url || '/';
      const isStreaming = !!(parsed['stream']);
      const shouldConvert = isMessagesEndpoint && !this.providerConfig.nativeAnthropic;

      if (shouldConvert) {
        parsed = anthropicToOpenAI(parsed);
        rewrittenUrl = rewrittenUrl.replace('/messages', '/chat/completions').replace(/\?.*$/, '');

        // Support for OpenAI Responses API (e.g. gpt-5.5) which uses 'input' instead of 'messages'
        const finalUrl = this.providerConfig.isFullEndpoint
          ? this.providerConfig.baseUrl
          : buildUpstreamUrl(this.providerConfig.baseUrl, rewrittenUrl).toString();

        if (finalUrl.includes('/responses')) {
          parsed = openAIChatToResponses(parsed);
          if (parsed['max_tokens'] !== undefined) {
            parsed['max_output_tokens'] = parsed['max_tokens'];
            delete parsed['max_tokens'];
          }
          if (parsed['stream_options'] !== undefined) {
            delete parsed['stream_options'];
          }
          if (Array.isArray(parsed['tools'])) {
            parsed['tools'] = parsed['tools'].map((t: any) => {
              if (t.type === 'function' && t.function) {
                return {
                  type: 'function',
                  name: t.function.name,
                  description: t.function.description,
                  parameters: t.function.parameters
                };
              }
              return t;
            });
          }
          const tc = parsed['tool_choice'] as any;
          if (tc && typeof tc === 'object' && tc.type === 'function' && tc.function) {
            parsed['tool_choice'] = {
              type: 'function',
              name: tc.function.name
            };
          }
        }
      }
      rewrittenBody = JSON.stringify(parsed);

      this.forwardRequest(req, rewrittenBody, rewrittenUrl, shouldConvert, isStreaming, res, id);
    });
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
    appendProxyDebug(`\n\n--- NEW REQUEST TO: ${url.toString()} ---\n${summarizeOutboundBody(body)}\n`);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      const lowerK = k.toLowerCase();
      if (lowerK === 'host' || lowerK === 'x-api-key' || lowerK.startsWith('anthropic-')) { continue; }
      if (v) { headers[k] = Array.isArray(v) ? v.join(', ') : v; }
    }
    if (this.apiKey) {
      const authHeader = this.providerConfig.authHeader || 'authorization';
      const authPrefix = this.providerConfig.authValuePrefix ?? 'Bearer ';
      headers[authHeader] = authPrefix ? authPrefix + this.apiKey : this.apiKey;
    }
    if (convertResponse) {
      headers['accept-encoding'] = 'identity';
    }
    headers['content-length'] = Buffer.byteLength(body).toString();

    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: req.method,
      headers,
      timeout: 120_000, // 2 minutes — free models can be slow
    };

    const proxyReq = transport.request(options, proxyRes => {
      const upstream = getDecodedResponseStream(proxyRes);
      const isError = (proxyRes.statusCode || 200) >= 400;
      if (isError) {
        let errBody = '';
        upstream.on('data', chunk => { errBody += chunk.toString(); });
        upstream.on('end', () => {
          let errMsg = `HTTP ${proxyRes.statusCode} → ${url.toString()}`;
          try {
            const parsed = JSON.parse(errBody);
            errMsg = parsed?.error?.message || parsed?.message || errMsg;
          } catch { /* use status code + url */ }
          appendProxyDebug(`--- UPSTREAM ERROR ${proxyRes.statusCode} ---\n${errBody}\n`);
          res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
          res.end(errBody);
          this.emitUpdate(id, { status: 'error', error: errMsg, endTime: Date.now() });
        });
      } else {
        if (convertResponse && isStreaming) {
          // Stream: convert OpenAI SSE chunks → Anthropic SSE events
          res.writeHead(proxyRes.statusCode || 200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
          const fs = require('fs');
          const debugFile = PROXY_DEBUG_FILE;
          const originalWrite = res.write.bind(res);
          res.write = (chunk: any) => {
            fs.appendFileSync(debugFile, `OUT: ${chunk.toString()}`);
            return originalWrite(chunk);
          };
          let buffer = '';
          let inputTokens = 0;
          let outputTokens = 0;
          let sentStart = false;
          const sanitizer = new StreamingTextSanitizer();
          const toolStates = new Map<number, { id: string; name: string; started: boolean; blockIndex?: number }>();
          let nextContentBlockIndex = 0;
          let textBlockStarted = false;
          let textBlockIndex: number | null = null;
          let finishReason: string | null = null;
          const model = body ? (JSON.parse(body)['model'] as string) || '' : '';
          upstream.on('data', (chunkBuffer: Buffer | string) => {
            const chunkStr = chunkBuffer.toString();
            fs.appendFileSync(debugFile, chunkStr);
            buffer += chunkStr;
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              if (!line.startsWith('data: ')) { continue; }
              const data = line.slice(6).trim();
              if (data === '[DONE]') {
                if (textBlockStarted) {
                  res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: textBlockIndex ?? 0 })}\n\n`);
                }
                for (const toolState of toolStates.values()) {
                  if (toolState.started && toolState.blockIndex !== undefined) {
                    res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: toolState.blockIndex })}\n\n`);
                  }
                }
                res.write(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: mapStreamingFinishReason(finishReason, hasStartedToolUse(toolStates)), stop_sequence: null }, usage: { output_tokens: outputTokens } })}\n\n`);
                res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
                return;
              }
              try {
                const chunk = JSON.parse(data);
                if (chunk.usage) {
                  inputTokens = chunk.usage.prompt_tokens || 0;
                  outputTokens = chunk.usage.completion_tokens || 0;
                }
                let choice = chunk.choices?.[0];
                let delta = choice?.delta;

                // Support for Responses API where delta is often a string and type indicates the event
                if (!delta && (typeof chunk.delta === 'string' || chunk.type === 'response.output_item.added')) {
                  if (chunk.type?.includes('text')) {
                    delta = { content: chunk.delta };
                  } else if (chunk.type === 'response.output_item.added' && chunk.item?.type === 'function_call') {
                    delta = {
                      tool_calls: [{
                        index: chunk.output_index || 0,
                        id: chunk.item.call_id || chunk.item.id || 'tool_0',
                        function: { name: chunk.item.name, arguments: '' }
                      }]
                    };
                  } else if (chunk.type?.includes('function') || chunk.type?.includes('tool')) {
                    // Rough approximation for tool call delta
                    delta = {
                      tool_calls: [{
                        index: chunk.output_index || 0,
                        id: chunk.call_id || chunk.item_id || 'tool_0',
                        function: { arguments: chunk.delta }
                      }]
                    };
                  } else {
                    delta = { content: chunk.delta || '' };
                  }
                }

                if (choice?.finish_reason) {
                  finishReason = choice.finish_reason;
                } else if (chunk.type === 'response.done' || chunk.type === 'response.completed') {
                  finishReason = 'stop';
                  if (chunk.response?.usage) {
                    outputTokens = chunk.response.usage.output_tokens || outputTokens;
                  }
                  if (textBlockStarted) {
                    res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: textBlockIndex ?? 0 })}\n\n`);
                  }
                  for (const toolState of toolStates.values()) {
                    if (toolState.started && toolState.blockIndex !== undefined) {
                      res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: toolState.blockIndex })}\n\n`);
                    }
                  }
                  res.write(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: mapStreamingFinishReason(finishReason, hasStartedToolUse(toolStates)), stop_sequence: null }, usage: { output_tokens: outputTokens } })}\n\n`);
                  res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
                  return;
                }

                if (!delta) { continue; }
                if (!sentStart) {
                  sentStart = true;
                  res.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: chunk.id || 'msg_proxy', type: 'message', role: 'assistant', content: [], model, stop_reason: null, stop_sequence: null, usage: { input_tokens: inputTokens, output_tokens: 0 } } })}\n\n`);
                  res.write(`event: ping\ndata: ${JSON.stringify({ type: 'ping' })}\n\n`);
                }
                const text = sanitizer.push(extractDeltaText(delta));
                if (text) {
                  if (!textBlockStarted) {
                    textBlockStarted = true;
                    textBlockIndex = nextContentBlockIndex++;
                    res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: textBlockIndex, content_block: { type: 'text', text: '' } })}\n\n`);
                  }
                  res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: textBlockIndex ?? 0, delta: { type: 'text_delta', text } })}\n\n`);
                }
                for (const toolCall of extractDeltaToolCalls(delta)) {
                  const existing = toolStates.get(toolCall.index) || {
                    id: toolCall.id || `toolu_${toolCall.index}`,
                    name: toolCall.name || '',
                    started: false,
                  };
                  if (toolCall.id) existing.id = toolCall.id;
                  if (toolCall.name) existing.name = toolCall.name;
                  if (!existing.started && existing.name) {
                    existing.started = true;
                    existing.blockIndex = nextContentBlockIndex++;
                    res.write(`event: content_block_start\ndata: ${JSON.stringify({
                      type: 'content_block_start',
                      index: existing.blockIndex,
                      content_block: { type: 'tool_use', id: existing.id, name: existing.name, input: {} },
                    })}\n\n`);
                  }
                  if (existing.started && toolCall.argumentsChunk) {
                    res.write(`event: content_block_delta\ndata: ${JSON.stringify({
                      type: 'content_block_delta',
                      index: existing.blockIndex ?? 0,
                      delta: { type: 'input_json_delta', partial_json: toolCall.argumentsChunk },
                    })}\n\n`);
                  }
                  toolStates.set(toolCall.index, existing);
                }
              } catch { /* skip malformed chunk */ }
            }
          });
          upstream.on('end', () => {
            res.end();
            this.emitUpdate(id, { status: 'completed', endTime: Date.now() });
          });
        } else if (convertResponse && !isStreaming) {
          // Non-stream: buffer full response, convert to Anthropic format
          let respBody = '';
          upstream.on('data', (chunk: Buffer | string) => { respBody += chunk.toString(); });
          upstream.on('end', () => {
            try {
              const oai = JSON.parse(respBody);
              const text = sanitizeVisibleText(extractTextContent(oai.choices?.[0]?.message?.content));
              const toolUses = convertToolCallsToAnthropic(oai.choices?.[0]?.message?.tool_calls);
              const anthropicResp = {
                id: oai.id || 'msg_proxy',
                type: 'message',
                role: 'assistant',
                content: [
                  ...(text ? [{ type: 'text', text }] : []),
                  ...toolUses,
                ],
                model: oai.model || '',
                stop_reason: mapFinishReason(oai.choices?.[0]?.finish_reason),
                stop_sequence: null,
                usage: { input_tokens: oai.usage?.prompt_tokens || 0, output_tokens: oai.usage?.completion_tokens || 0 },
              };
              const out = JSON.stringify(anthropicResp);
              res.writeHead(proxyRes.statusCode || 200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(out).toString() });
              res.end(out);
            } catch {
              res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
              res.end(respBody);
            }
            this.emitUpdate(id, { status: 'completed', endTime: Date.now() });
          });
        } else {
          res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
          proxyRes.pipe(res);
          proxyRes.on('end', () => {
            this.emitUpdate(id, { status: 'completed', endTime: Date.now() });
          });
        }
      }
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy(new Error('Read timeout — upstream did not respond in time'));
    });

    proxyReq.on('error', err => {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad Gateway', detail: err.message }));
      }
      this.emitUpdate(id, { status: 'error', error: err.message, endTime: Date.now() });
    });

    proxyReq.write(body);
    proxyReq.end();
  }

  private emitUpdate(id: string, update: Partial<RequestEvent>): void {
    this.emit('requestUpdate', { id, update });
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

export function buildUpstreamUrl(baseUrl: string, rewrittenUrl: string): URL {
  const base = baseUrl.replace(/\/$/, '');
  const incomingPath = rewrittenUrl || '/';
  const reqPath = base.endsWith('/v1') ? incomingPath.replace(/^\/v1/, '') : incomingPath;
  return new URL(base + reqPath);
}

export function extractTextContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === 'string') {
          return part;
        }
        if (part && typeof part === 'object') {
          const typedPart = part as { type?: unknown; text?: unknown };
          if (typedPart.type === 'text' && typeof typedPart.text === 'string') {
            return typedPart.text;
          }
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

export function extractDeltaText(delta: unknown): string {
  if (!delta || typeof delta !== 'object') {
    return '';
  }

  const typedDelta = delta as { content?: unknown };
  return extractTextContent(typedDelta.content);
}

export function sanitizeVisibleText(text: string): string {
  return new StreamingTextSanitizer().push(text, true).trim();
}

type DeltaToolCall = { index: number; id?: string; name?: string; argumentsChunk?: string };

class StreamingTextSanitizer {
  private pending = '';
  private hiddenTag: string | null = null;

  push(input: string, flush = false): string {
    if (!input && !flush) {
      return '';
    }

    this.pending += input;
    let output = '';

    while (this.pending.length > 0) {
      if (this.hiddenTag) {
        const closeTag = `</${this.hiddenTag}>`;
        const closeIndex = this.pending.indexOf(closeTag);
        if (closeIndex === -1) {
          if (flush) {
            this.pending = '';
            this.hiddenTag = null;
          }
          break;
        }
        this.pending = this.pending.slice(closeIndex + closeTag.length);
        this.hiddenTag = null;
        continue;
      }

      const openMatch = this.pending.match(/<(think|fast_path|tool_call)>/);
      if (!openMatch || openMatch.index === undefined) {
        output += stripStandaloneTags(flush ? this.pending : safeVisiblePrefix(this.pending));
        this.pending = flush ? '' : this.pending.slice(safeVisiblePrefix(this.pending).length);
        break;
      }

      const openIndex = openMatch.index;
      const visible = this.pending.slice(0, openIndex);
      output += stripStandaloneTags(visible);
      this.pending = this.pending.slice(openIndex + openMatch[0].length);
      this.hiddenTag = openMatch[1];
    }

    return output;
  }
}

function safeVisiblePrefix(text: string): string {
  const lastOpen = text.lastIndexOf('<');
  const lastClose = text.lastIndexOf('>');
  if (lastOpen > lastClose) {
    return text.slice(0, lastOpen);
  }
  return text;
}

function stripStandaloneTags(text: string): string {
  return text.replace(/<\/?(think|fast_path|tool_call)>/g, '');
}

function extractDeltaToolCalls(delta: unknown): DeltaToolCall[] {
  if (!delta || typeof delta !== 'object') {
    return [];
  }

  const toolCalls = (delta as { tool_calls?: unknown }).tool_calls;
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  const result: DeltaToolCall[] = [];
  for (const [fallbackIndex, toolCall] of toolCalls.entries()) {
    if (!toolCall || typeof toolCall !== 'object') {
      continue;
    }
    const typed = toolCall as {
      index?: unknown;
      id?: unknown;
      function?: { name?: unknown; arguments?: unknown };
    };
    result.push({
      index: typeof typed.index === 'number' ? typed.index : fallbackIndex,
      id: typeof typed.id === 'string' ? typed.id : undefined,
      name: typeof typed.function?.name === 'string' ? typed.function.name : undefined,
      argumentsChunk: typeof typed.function?.arguments === 'string' ? typed.function.arguments : undefined,
    });
  }
  return result;
}

function convertToolCallsToAnthropic(toolCalls: unknown): Array<{ type: 'tool_use'; id: string; name: string; input: unknown }> {
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  return toolCalls.flatMap((toolCall, index) => {
    if (!toolCall || typeof toolCall !== 'object') {
      return [];
    }
    const typed = toolCall as {
      id?: unknown;
      function?: { name?: unknown; arguments?: unknown };
    };
    const name = typeof typed.function?.name === 'string' ? typed.function.name : '';
    const rawArguments = typeof typed.function?.arguments === 'string' ? typed.function.arguments : '{}';
    let input: unknown = {};
    try {
      input = JSON.parse(rawArguments);
    } catch {
      input = {};
    }

    return [{
      type: 'tool_use' as const,
      id: typeof typed.id === 'string' ? typed.id : `toolu_${index}`,
      name,
      input,
    }];
  });
}

function mapFinishReason(reason: unknown): string | null {
  if (reason === 'stop') {
    return 'end_turn';
  }
  if (reason === 'tool_calls') {
    return 'tool_use';
  }
  return typeof reason === 'string' ? reason : null;
}

export function mapStreamingFinishReason(reason: unknown, hasToolUse: boolean): string | null {
  if (hasToolUse) {
    return 'tool_use';
  }
  return mapFinishReason(reason);
}

function hasStartedToolUse(toolStates: Map<number, { started: boolean }>): boolean {
  return Array.from(toolStates.values()).some(toolState => toolState.started);
}

// Convert Anthropic Messages API body → OpenAI Chat Completions body
export function anthropicToOpenAI(body: Record<string, unknown>): Record<string, unknown> {
  const messages: Array<Record<string, unknown>> = [];

  // system prompt → system message
  if (body['system']) {
    const sys = body['system'];
    const text = typeof sys === 'string' ? sys
      : Array.isArray(sys) ? (sys as Array<{ text?: string }>).map(b => b.text || '').join('\n')
      : String(sys);
    messages.push({ role: 'system', content: text });
  }

  // Anthropic messages → OpenAI messages
  for (const msg of (body['messages'] as Array<{ role: string; content: unknown }> || [])) {
    const content = msg.content;
    if (typeof content === 'string') {
      messages.push({ role: msg.role, content });
    } else if (Array.isArray(content)) {
      const blocks = content as Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: string; source?: { type: string; media_type: string; data: string }; is_error?: boolean }>;
      const text = blocks
        .filter(b => b.type === 'text')
        .map(b => b.text || '')
        .join('\n');

      if (msg.role === 'assistant') {
        const toolCalls = blocks
          .filter(b => b.type === 'tool_use')
          .map((block, index) => ({
            id: block.id || `toolu_${index}`,
            type: 'function',
            function: {
              name: block.name || '',
              arguments: JSON.stringify(block.input ?? {}),
            },
          }));

        if (text || toolCalls.length > 0) {
          messages.push({ role: 'assistant', content: text || null, tool_calls: toolCalls.length > 0 ? toolCalls : undefined });
        }
        continue;
      }

      if (msg.role === 'user') {
        const contentArray: any[] = [];
        if (text) contentArray.push({ type: 'text', text });
        const imageBlocks = blocks
          .filter(b => b.type === 'image' && b.source)
          .map(b => ({
            type: 'image_url',
            image_url: { url: `data:${b.source!.media_type};base64,${b.source!.data}` }
          }));
        contentArray.push(...imageBlocks);

        const textBlocks = contentArray.length > 0 ? [{ role: 'user', content: contentArray.length === 1 && contentArray[0].type === 'text' ? text : contentArray }] : [];
        const toolResults = blocks
          .filter(b => b.type === 'tool_result')
          .map(block => {
            let contentStr = typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? '');
            
            // Tích hợp tư tưởng RTK: Auto-truncate massive tool outputs to save tokens
            const MAX_LEN = 10000;
            if (contentStr.length > MAX_LEN) {
              const half = Math.floor(MAX_LEN / 2);
              contentStr = contentStr.slice(0, half) + 
                           `\n\n... [PROXY AUTO-TRUNCATED: ${contentStr.length - MAX_LEN} chars removed to save tokens] ...\n\n` + 
                           contentStr.slice(-half);
            }

            return {
              role: 'tool',
              tool_call_id: block.tool_use_id || '',
              content: block.is_error ? `Error: ${contentStr}` : contentStr,
            };
          });
        messages.push(...toolResults, ...textBlocks);
        continue;
      }

      messages.push({ role: msg.role, content: text });
    } else {
      messages.push({ role: msg.role, content: String(content) });
    }
  }

  const result: Record<string, unknown> = {
    model: body['model'],
    messages,
    stream: body['stream'] ?? false,
  };

  if (result.stream) {
    result['stream_options'] = { include_usage: true };
  }

  if (body['max_tokens']) { result['max_tokens'] = body['max_tokens']; }
  if (body['temperature'] !== undefined) { result['temperature'] = body['temperature']; }
  if (body['top_p'] !== undefined) { result['top_p'] = body['top_p']; }
  if (body['top_k'] !== undefined) { result['top_k'] = body['top_k']; }
  if (body['stop_sequences'] && Array.isArray(body['stop_sequences']) && body['stop_sequences'].length > 0) { result['stop'] = body['stop_sequences']; }
  if (Array.isArray(body['tools'])) {
    result['tools'] = (body['tools'] as Array<{ name?: string; description?: string; input_schema?: unknown }>).map(tool => ({
      type: 'function',
      function: {
        name: tool.name || '',
        description: tool.description || '',
        parameters: tool.input_schema ?? { type: 'object', properties: {} },
      },
    }));
  }
  if (body['tool_choice'] && typeof body['tool_choice'] === 'object') {
    const toolChoice = body['tool_choice'] as { type?: string; name?: string; disable_parallel_tool_use?: boolean };
    if (toolChoice.type === 'auto') {
      result['tool_choice'] = 'auto';
    } else if (toolChoice.type === 'any') {
      result['tool_choice'] = 'required';
    } else if (toolChoice.type === 'tool' && toolChoice.name) {
      result['tool_choice'] = { type: 'function', function: { name: toolChoice.name } };
    }
    if (toolChoice.disable_parallel_tool_use === true) {
      result['parallel_tool_calls'] = false;
    }
  }

  return result;
}

export function openAIChatToResponses(body: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...body };
  const messages = result['messages'];
  if (!Array.isArray(messages)) {
    return result;
  }

  result['input'] = messages.flatMap(message => {
    if (!message || typeof message !== 'object') {
      return [];
    }

    const typed = message as {
      role?: unknown;
      content?: unknown;
      tool_calls?: unknown;
      tool_call_id?: unknown;
    };
    const role = typeof typed.role === 'string' ? typed.role : 'user';

    if (role === 'tool') {
      return [{
        type: 'function_call_output',
        call_id: typeof typed.tool_call_id === 'string' ? typed.tool_call_id : '',
        output: stringifyResponsesOutput(typed.content),
      }];
    }

    const items: Array<Record<string, unknown>> = [];
    const content = normalizeResponsesMessageContent(typed.content, role);
    if (content !== undefined) {
      items.push({ role, content });
    }

    const toolCalls = typed.tool_calls;
    if (Array.isArray(toolCalls)) {
      for (const [index, toolCall] of toolCalls.entries()) {
        const converted = convertChatToolCallToResponses(toolCall, index);
        if (converted) {
          items.push(converted);
        }
      }
    }

    return items;
  });
  delete result['messages'];
  return result;
}

function normalizeResponsesMessageContent(content: unknown, role: string): unknown {
  if (content === null) {
    return role === 'assistant' ? undefined : '';
  }
  if (!Array.isArray(content)) {
    return content;
  }

  return content.flatMap(part => {
    if (!part || typeof part !== 'object') {
      return [];
    }
    const typed = part as {
      type?: unknown;
      text?: unknown;
      image_url?: { url?: unknown };
    };
    if (typed.type === 'text' && typeof typed.text === 'string') {
      return [{ type: role === 'assistant' ? 'output_text' : 'input_text', text: typed.text }];
    }
    if (typed.type === 'image_url' && typeof typed.image_url?.url === 'string') {
      return [{ type: 'input_image', image_url: typed.image_url.url }];
    }
    return [part as Record<string, unknown>];
  });
}

function stringifyResponsesOutput(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (content === undefined || content === null) {
    return '';
  }
  return JSON.stringify(content);
}

function convertChatToolCallToResponses(toolCall: unknown, index: number): Record<string, unknown> | null {
  if (!toolCall || typeof toolCall !== 'object') {
    return null;
  }
  const typed = toolCall as {
    id?: unknown;
    function?: { name?: unknown; arguments?: unknown };
  };
  const name = typeof typed.function?.name === 'string' ? typed.function.name : '';
  const args = typeof typed.function?.arguments === 'string' ? typed.function.arguments : '{}';
  return {
    type: 'function_call',
    call_id: typeof typed.id === 'string' ? typed.id : `toolu_${index}`,
    name,
    arguments: args,
  };
}

function appendProxyDebug(message: string): void {
  try {
    const fs = require('fs') as typeof import('fs');
    fs.appendFileSync(PROXY_DEBUG_FILE, message);
  } catch {
    // Debug logging must never break proxy traffic.
  }
}

function summarizeOutboundBody(body: string): string {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const input = parsed['input'];
    const messages = parsed['messages'];
    const inputItems = Array.isArray(input) ? input : [];
    const messageItems = Array.isArray(messages) ? messages : [];
    const inputWithToolCalls = inputItems
      .map((item, index) => item && typeof item === 'object' && 'tool_calls' in item ? index : -1)
      .filter(index => index >= 0);
    const inputTypes = inputItems.map(item => {
      if (!item || typeof item !== 'object') {
        return typeof item;
      }
      const typed = item as { type?: unknown; role?: unknown };
      return String(typed.type || typed.role || 'object');
    });

    return JSON.stringify({
      model: parsed['model'],
      hasMessages: Array.isArray(messages),
      messageCount: messageItems.length,
      hasInput: Array.isArray(input),
      inputCount: inputItems.length,
      inputTypes,
      inputWithToolCalls,
      toolCount: Array.isArray(parsed['tools']) ? parsed['tools'].length : 0,
      hasMaxTokens: parsed['max_tokens'] !== undefined,
      hasMaxOutputTokens: parsed['max_output_tokens'] !== undefined,
      hasStreamOptions: parsed['stream_options'] !== undefined,
    });
  } catch {
    return JSON.stringify({ unparseableBodyBytes: Buffer.byteLength(body) });
  }
}
