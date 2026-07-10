import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_DEBUG_FILE = path.resolve(__dirname, '../../proxy_debug.log');
let writeQueue = Promise.resolve();

export function appendProxyDebug(message: string): void {
  const debugFile = process.env.CCMM_PROXY_DEBUG_FILE || DEFAULT_DEBUG_FILE;
  writeQueue = writeQueue
    .then(() => fs.promises.appendFile(debugFile, message))
    .catch(() => undefined);
}

