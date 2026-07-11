import type { ResponsesFunctionCallItem } from './responsesAdapter';

const PREFIX = 'ccmm1_';

export function encodeToolUseId(item: ResponsesFunctionCallItem): string {
  const payload = JSON.stringify({
    callId: item.call_id,
    name: item.name,
    arguments: item.arguments,
  });
  return PREFIX + Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeToolUseId(id: string): ResponsesFunctionCallItem | null {
  if (!id.startsWith(PREFIX)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(id.slice(PREFIX.length), 'base64url').toString('utf8')) as {
      callId?: unknown;
      name?: unknown;
      arguments?: unknown;
    };
    if (typeof payload.callId !== 'string' || typeof payload.name !== 'string' || typeof payload.arguments !== 'string') {
      return null;
    }
    return {
      type: 'function_call',
      call_id: payload.callId,
      name: payload.name,
      arguments: payload.arguments,
    };
  } catch {
    return null;
  }
}
