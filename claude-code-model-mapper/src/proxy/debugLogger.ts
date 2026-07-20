import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_DEBUG_FILE = path.resolve(__dirname, '../../proxy_debug.log');
const MAX_DEBUG_FILE_BYTES = 2 * 1024 * 1024;
let writeQueue = Promise.resolve();
let enabled = false;

export function setProxyDebugEnabled(value: boolean): void {
  enabled = value;
}

export async function clearProxyDebugLogs(): Promise<void> {
  const debugFile = process.env.CCMM_PROXY_DEBUG_FILE || DEFAULT_DEBUG_FILE;
  writeQueue = writeQueue.then(async () => {
    await Promise.all([
      fs.promises.unlink(debugFile).catch(() => undefined),
      fs.promises.unlink(`${debugFile}.1`).catch(() => undefined),
    ]);
  });
  await writeQueue;
}

export function appendProxyDebug(message: string): void {
  if (!enabled) { return; }
  const debugFile = process.env.CCMM_PROXY_DEBUG_FILE || DEFAULT_DEBUG_FILE;
  writeQueue = writeQueue
    .then(async () => {
      try {
        const stat = await fs.promises.stat(debugFile);
        if (stat.size >= MAX_DEBUG_FILE_BYTES) {
          await fs.promises.rename(debugFile, `${debugFile}.1`).catch(() => undefined);
        }
      } catch {
        // The log does not exist yet.
      }
      const line = message.replace(/[\r\n]+/g, ' ').trim();
      await fs.promises.appendFile(debugFile, `${new Date().toISOString()} ${line}\n`);
    })
    .catch(() => undefined);
}
