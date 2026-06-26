import type { Plugin } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** True if the request originates from the local dev machine (loopback host). */
function isLocalRequest(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  const host = String(req.headers['host'] ?? '');
  return /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/.test(host);
}

/** Sanitise a caller-supplied grab name to a bare filename stem (no path escape). */
function safeName(raw: string): string {
  const stem = String(raw || 'grab').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  return stem || 'grab';
}

/**
 * Dev-only canvas-grab sink. The visual dev loop captures the WebGPU canvas via
 * `__debug.grab()` (a `canvas.toDataURL()` — `page.screenshot()` times out / returns
 * blank on the live WebGPU surface). This middleware lets `__debug.grabFile(name)` POST
 * that data URL and have it written straight to disk under `.dev-grabs/`, so an agent or
 * script can Read the PNG without shuttling megabytes of base64 through a tool boundary.
 *
 * POST `/__grab?name=foo` with a body of either a `data:image/png;base64,…` URL or raw
 * base64 → writes `.dev-grabs/foo.png`, responds `{ path }`. `apply:'serve'` keeps it out
 * of production builds entirely.
 */
export function grabSinkPlugin(): Plugin {
  const MOUNT = '/__grab';
  return {
    name: 'grab-sink',
    apply: 'serve',
    configureServer(server) {
      const outDir = resolve(server.config.root, '.dev-grabs');
      server.middlewares.use(MOUNT, (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('POST only'); return; }
        if (!isLocalRequest(req)) { res.statusCode = 403; res.end('local requests only'); return; }
        const url = new URL(req.url ?? '', 'http://localhost');
        const name = safeName(url.searchParams.get('name') ?? 'grab');
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(Buffer.from(c)));
        req.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf8');
            const b64 = body.replace(/^data:image\/\w+;base64,/, '').trim();
            const bytes = Buffer.from(b64, 'base64');
            mkdirSync(outDir, { recursive: true });
            const path = resolve(outDir, `${name}.png`);
            writeFileSync(path, bytes);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ path, bytes: bytes.length }));
          } catch (e) {
            res.statusCode = 500;
            res.end(`grab write failed: ${String(e)}`);
          }
        });
      });
    },
  };
}
