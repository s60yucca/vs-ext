import * as http from 'http';
import { LMProviderConfig } from '../types';

export function buildUpstreamHeaders(
  incoming: http.IncomingHttpHeaders,
  provider: LMProviderConfig,
  apiKey: string,
  bodyLength: number,
  convertResponse: boolean
): Record<string, string> {
  const headers: Record<string, string> = {};
  const configuredAuthHeader = (provider.authHeader || 'authorization').toLowerCase();
  for (const [name, value] of Object.entries(incoming)) {
    const lowerName = name.toLowerCase();
    const replacesCredential = !!apiKey && (lowerName === 'authorization' || lowerName === configuredAuthHeader);
    if (lowerName === 'host' || lowerName === 'x-api-key' || lowerName.startsWith('anthropic-') || replacesCredential) {
      continue;
    }
    if (value) {
      headers[name] = Array.isArray(value) ? value.join(', ') : value;
    }
  }
  if (apiKey) {
    const authHeader = provider.authHeader || 'authorization';
    const prefix = provider.authValuePrefix ?? 'Bearer ';
    headers[authHeader] = prefix ? prefix + apiKey : apiKey;
  }
  if (convertResponse) {
    headers['accept-encoding'] = 'identity';
  }
  headers['content-length'] = bodyLength.toString();
  return headers;
}

