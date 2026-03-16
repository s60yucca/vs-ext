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
exports.ProxyServer = void 0;
const http = __importStar(require("http"));
const https = __importStar(require("https"));
const events_1 = require("events");
const modelMapper_1 = require("./modelMapper");
function generateRequestId() {
    const hex = (Date.now() ^ (Math.random() * 0xffff | 0)).toString(16).slice(-4);
    return `req-${hex}`;
}
class ProxyServer extends events_1.EventEmitter {
    constructor() {
        super(...arguments);
        this.server = null;
        this._actualPort = null;
        this._isRunning = false;
        this.restartAttempts = 0;
        this.MAX_RESTART = 3;
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
            const attempt = (p) => {
                if (p > portRangeEnd) {
                    reject(new Error(`Không tìm được port trống trong dải ${port}-${portRangeEnd}`));
                    return;
                }
                const srv = http.createServer((req, res) => this.handleRequest(req, res));
                srv.once('error', (err) => {
                    if (err.code === 'EADDRINUSE') {
                        attempt(p + 1);
                    }
                    else {
                        reject(err);
                    }
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
    handleServerError(err, port, portRangeEnd) {
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
        }
        else {
            this.emit('fatalError', new Error(`Proxy server crash sau ${this.MAX_RESTART} lần restart`));
        }
    }
    handleRequest(req, res) {
        const id = generateRequestId();
        const event = {
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
            let parsed;
            try {
                parsed = JSON.parse(body);
            }
            catch {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON body' }));
                this.emitUpdate(id, { status: 'error', error: 'Invalid JSON body', endTime: Date.now() });
                return;
            }
            const sourceModel = parsed['model'] || '';
            const targetModel = (0, modelMapper_1.resolve)(sourceModel, this.modelConfigs);
            parsed['model'] = targetModel;
            this.emitUpdate(id, { sourceModel, targetModel, status: 'processing' });
            const rewrittenBody = JSON.stringify(parsed);
            this.forwardRequest(req, rewrittenBody, res, id);
        });
    }
    forwardRequest(req, body, res, id) {
        const base = this.providerConfig.baseUrl.replace(/\/$/, '');
        const url = new URL(base + (req.url || '/'));
        const isHttps = url.protocol === 'https:';
        const transport = isHttps ? https : http;
        const headers = {};
        for (const [k, v] of Object.entries(req.headers)) {
            if (k.toLowerCase() === 'host') {
                continue;
            }
            if (v) {
                headers[k] = Array.isArray(v) ? v.join(', ') : v;
            }
        }
        if (this.apiKey) {
            headers['authorization'] = `Bearer ${this.apiKey}`;
        }
        headers['content-length'] = Buffer.byteLength(body).toString();
        const options = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search,
            method: req.method,
            headers,
        };
        const proxyReq = transport.request(options, proxyRes => {
            res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
            proxyRes.pipe(res);
            proxyRes.on('end', () => {
                const status = (proxyRes.statusCode || 200) >= 400 ? 'error' : 'completed';
                this.emitUpdate(id, { status, endTime: Date.now() });
            });
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
    emitUpdate(id, update) {
        this.emit('requestUpdate', { id, update });
    }
}
exports.ProxyServer = ProxyServer;
//# sourceMappingURL=proxyServer.js.map