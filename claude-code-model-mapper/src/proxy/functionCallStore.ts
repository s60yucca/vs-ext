import { createHash } from 'crypto';
import { ResponsesFunctionCallItem } from './responsesAdapter';

export class ConversationFunctionCallStore {
  private readonly conversations = new Map<string, Map<string, ResponsesFunctionCallItem>>();

  constructor(
    private readonly maxConversations = 32,
    private readonly maxCallsPerConversation = 200
  ) {}

  get(conversationKey: string): ReadonlyMap<string, ResponsesFunctionCallItem> {
    return this.conversations.get(conversationKey) || new Map();
  }

  remember(conversationKey: string, item: ResponsesFunctionCallItem): void {
    let calls = this.conversations.get(conversationKey);
    if (!calls) {
      calls = new Map();
      this.conversations.set(conversationKey, calls);
    } else {
      this.conversations.delete(conversationKey);
      this.conversations.set(conversationKey, calls);
    }
    calls.set(item.call_id, item);
    trimOldest(calls, this.maxCallsPerConversation);
    trimOldest(this.conversations, this.maxConversations);
  }

  clear(): void {
    this.conversations.clear();
  }
}

export function createConversationKey(body: Record<string, unknown>): string {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const firstUserMessage = messages.find(message => {
    return !!message && typeof message === 'object' && (message as { role?: unknown }).role === 'user';
  });
  const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : undefined;
  const identity = JSON.stringify({
    model: body.model,
    metadata,
    system: body.system,
    firstUserMessage,
  });
  return createHash('sha256').update(identity).digest('hex').slice(0, 24);
}

function trimOldest<K, V>(map: Map<K, V>, maxSize: number): void {
  while (map.size > maxSize) {
    const oldestKey = map.keys().next().value as K | undefined;
    if (oldestKey === undefined) {
      return;
    }
    map.delete(oldestKey);
  }
}

