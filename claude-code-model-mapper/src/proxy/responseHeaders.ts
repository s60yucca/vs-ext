import * as http from 'http';

export function buildDecodedResponseHeaders(
  headers: http.IncomingHttpHeaders,
  body: string
): http.OutgoingHttpHeaders {
  const decoded: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    const lowerName = name.toLowerCase();
    if (lowerName === 'content-encoding' || lowerName === 'content-length' || lowerName === 'transfer-encoding') {
      continue;
    }
    if (value !== undefined) {
      decoded[name] = value;
    }
  }
  decoded['content-length'] = Buffer.byteLength(body).toString();
  return decoded;
}
