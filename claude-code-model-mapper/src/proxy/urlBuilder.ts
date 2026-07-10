export function buildUpstreamUrl(baseUrl: string, rewrittenUrl: string): URL {
  const base = baseUrl.replace(/\/$/, '');
  const incomingPath = rewrittenUrl || '/';
  const requestPath = base.endsWith('/v1') ? incomingPath.replace(/^\/v1/, '') : incomingPath;
  return new URL(base + requestPath);
}

