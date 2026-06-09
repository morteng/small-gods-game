import type { Plugin } from 'vite';

/** True if the request originates from the local dev machine (loopback host,
 *  and — when present — a loopback Origin). Blocks drive-by use of the proxy. */
function isLocalRequest(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  const host = String(req.headers['host'] ?? '');
  const hostOk = /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/.test(host);
  const origin = req.headers['origin'];
  if (origin !== undefined) {
    const originOk = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(String(origin));
    if (!originOk) return false;
  }
  return hostOk;
}

/**
 * Dev-only same-origin proxy for the LLM provider. The browser cannot call
 * `https://openrouter.ai` directly (CORS / net::ERR_FAILED), so in dev the
 * OpenRouter client targets `/api/llm/openrouter/...` and this middleware
 * forwards it server-side — no CORS involved.
 *
 * Auth: the browser's own `Authorization` header (from the BYOK config) passes
 * through. If absent, we inject `OPENROUTER_API_KEY` from the dev env so the
 * pipeline "just works" locally without configuring a key in the browser.
 *
 * `apply: 'serve'` keeps it out of the production build entirely.
 */
export function llmProxyPlugin(apiKey?: string): Plugin {
  const MOUNT = '/api/llm/openrouter';
  const UPSTREAM = 'https://openrouter.ai';
  const key = apiKey || process.env.OPENROUTER_API_KEY;

  return {
    name: 'llm-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(MOUNT, (req, res) => {
        if (!isLocalRequest(req)) { res.statusCode = 403; res.end('local requests only'); return; }

        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(Buffer.from(c)));
        req.on('end', async () => {
          try {
            // connect strips the mount prefix, so req.url is e.g. '/api/v1/chat/completions'.
            const target = UPSTREAM + (req.url ?? '');
            const headers: Record<string, string> = {
              'Content-Type': 'application/json',
              'HTTP-Referer': 'http://localhost:3000',
              'X-Title': 'Small Gods Game (dev proxy)',
            };
            // Forward the browser's auth if it sent one; otherwise inject the dev key.
            const incomingAuth = req.headers['authorization'];
            if (typeof incomingAuth === 'string' && incomingAuth.trim() && !/Bearer\s*$/.test(incomingAuth)) {
              headers['Authorization'] = incomingAuth;
            } else if (key) {
              headers['Authorization'] = `Bearer ${key}`;
            }
            // Pass through OpenRouter cache control headers if present.
            for (const h of ['x-openrouter-cache', 'x-openrouter-cache-ttl', 'x-openrouter-cache-clear']) {
              const v = req.headers[h];
              if (typeof v === 'string') headers[h] = v;
            }

            const body = chunks.length ? Buffer.concat(chunks) : undefined;
            const upstream = await fetch(target, { method: req.method, headers, body });
            const text = await upstream.text();
            res.statusCode = upstream.status;
            res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json');
            res.end(text);
          } catch (e) {
            res.statusCode = 502;
            res.end(JSON.stringify({ error: 'llm-proxy: ' + (e as Error).message }));
          }
        });
      });
    },
  };
}
