import * as http from 'http';
import * as https from 'https';
import { EventEmitter } from 'events';
import { ModelConfig, LMProviderConfig, ProxyServerOptions, RequestEvent, RequestStatus } from './types';
import { resolve as resolveModel } from './modelMapper';

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

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        this.emitUpdate(id, { status: 'error', error: 'Invalid JSON body', endTime: Date.now() });
        return;
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
      if (isMessagesEndpoint) {
        parsed = anthropicToOpenAI(parsed);
        rewrittenUrl = rewrittenUrl.replace('/messages', '/chat/completions').replace(/\?.*$/, '');
      }
      rewrittenBody = JSON.stringify(parsed);

      this.forwardRequest(req, rewrittenBody, rewrittenUrl, isMessagesEndpoint, isStreaming, res, id);
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
    const base = this.providerConfig.baseUrl.replace(/\/$/, '');
    const incomingPath = rewrittenUrl;
    const reqPath = base.endsWith('/v1') ? incomingPath.replace(/^\/v1/, '') : incomingPath;
    const url = new URL(base + reqPath);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (k.toLowerCase() === 'host') { continue; }
      if (v) { headers[k] = Array.isArray(v) ? v.join(', ') : v; }
    }
    if (this.apiKey) {
      headers['authorization'] = `Bearer ${this.apiKey}`;
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
      const isError = (proxyRes.statusCode || 200) >= 400;
      if (isError) {
        let errBody = '';
        proxyRes.on('data', chunk => { errBody += chunk; });
        proxyRes.on('end', () => {
          let errMsg = `HTTP ${proxyRes.statusCode} → ${url.toString()}`;
          try {
            const parsed = JSON.parse(errBody);
            errMsg = parsed?.error?.message || parsed?.message || errMsg;
          } catch { /* use status code + url */ }
          res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
          res.end(errBody);
          this.emitUpdate(id, { status: 'error', error: errMsg, endTime: Date.now() });
        });
      } else {
        if (convertResponse && isStreaming) {
          // Stream: convert OpenAI SSE chunks → Anthropic SSE events
          res.writeHead(proxyRes.statusCode || 200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
          let buffer = '';
          let inputTokens = 0;
          let outputTokens = 0;
          let sentStart = false;
          const model = body ? (JSON.parse(body)['model'] as string) || '' : '';
          proxyRes.on('data', (chunk: Buffer) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              if (!line.startsWith('data: ')) { continue; }
              const data = line.slice(6).trim();
              if (data === '[DONE]') {
                // send final delta stop + message_delta + message_stop
                res.write(`data: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`);
                res.write(`data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: outputTokens } })}\n\n`);
                res.write(`data: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
                return;
              }
              try {
                const chunk = JSON.parse(data);
                if (chunk.usage) {
                  inputTokens = chunk.usage.prompt_tokens || 0;
                  outputTokens = chunk.usage.completion_tokens || 0;
                }
                const delta = chunk.choices?.[0]?.delta;
                if (!delta) { continue; }
                if (!sentStart) {
                  sentStart = true;
                  res.write(`data: ${JSON.stringify({ type: 'message_start', message: { id: chunk.id || 'msg_proxy', type: 'message', role: 'assistant', content: [], model, usage: { input_tokens: inputTokens, output_tokens: 0 } } })}\n\n`);
                  res.write(`data: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`);
                  res.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`);
                }
                if (delta.content) {
                  res.write(`data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: delta.content } })}\n\n`);
                }
              } catch { /* skip malformed chunk */ }
            }
          });
          proxyRes.on('end', () => {
            res.end();
            this.emitUpdate(id, { status: 'completed', endTime: Date.now() });
          });
        } else if (convertResponse && !isStreaming) {
          // Non-stream: buffer full response, convert to Anthropic format
          let respBody = '';
          proxyRes.on('data', (chunk: Buffer) => { respBody += chunk.toString(); });
          proxyRes.on('end', () => {
            try {
              const oai = JSON.parse(respBody);
              const text = oai.choices?.[0]?.message?.content || '';
              const anthropicResp = {
                id: oai.id || 'msg_proxy',
                type: 'message',
                role: 'assistant',
                content: [{ type: 'text', text }],
                model: oai.model || '',
                stop_reason: oai.choices?.[0]?.finish_reason === 'stop' ? 'end_turn' : oai.choices?.[0]?.finish_reason,
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

// Convert Anthropic Messages API body → OpenAI Chat Completions body
function anthropicToOpenAI(body: Record<string, unknown>): Record<string, unknown> {
  const messages: Array<{ role: string; content: unknown }> = [];

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
      // Flatten content blocks to a single string for simplicity
      const text = (content as Array<{ type: string; text?: string }>)
        .filter(b => b.type === 'text')
        .map(b => b.text || '')
        .join('\n');
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

  if (body['max_tokens']) { result['max_tokens'] = body['max_tokens']; }
  if (body['temperature'] !== undefined) { result['temperature'] = body['temperature']; }
  if (body['top_p'] !== undefined) { result['top_p'] = body['top_p']; }
  if (body['stop_sequences']) { result['stop'] = body['stop_sequences']; }

  return result;
}
