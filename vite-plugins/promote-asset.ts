import type { Plugin } from 'vite';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

export interface PromoteMeta {
  key: string;
  kind: string;
  style: string;
  provider: string;
  model: string;
  recipeVersion: string;
  prompt: string;
  width: number;
  height: number;
  tags: string[];
  affinity?: { biome?: string[]; era?: string[] };
  generatedAt: number;
  description?: string;
}

export function blobFileName(kind: string, key: string): string {
  return `${kind}-${key}.png`;
}

/** One NDJSON line (with trailing newline) for the manifest. */
export function buildManifestLine(meta: PromoteMeta): string {
  const rec = { ...meta, blob: `blobs/${blobFileName(meta.kind, meta.key)}` };
  return JSON.stringify(rec) + '\n';
}

/** Identifier guard: alphanumerics, dash, underscore only, bounded length.
 *  Used on `kind`/`key` before they become a filename — blocks path traversal
 *  (`../`), separators, and other filesystem-meaningful characters. */
export function isSafeId(s: unknown, max: number): s is string {
  return typeof s === 'string' && new RegExp(`^[a-zA-Z0-9_-]{1,${max}}$`).test(s);
}

/** True if the request originates from the local dev machine. Blocks drive-by
 *  CSRF: a malicious site the developer visits cannot POST cross-origin to this
 *  write endpoint, because its Origin (when sent) won't be a localhost URL and
 *  the Host must be loopback. */
function isLocalRequest(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  const host = String(req.headers['host'] ?? '');
  const hostOk = /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/.test(host);
  const origin = req.headers['origin'];
  if (origin !== undefined) {
    // When present, Origin must itself be a loopback URL.
    const originOk = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(String(origin));
    if (!originOk) return false;
  }
  return hostOk;
}

/**
 * Dev-only plugin: POST /__promote-asset { meta, blobBase64 } → write a blob +
 * append a manifest line into public/asset-library/. Excluded from the prod
 * build (`apply: 'serve'`) and additionally gated behind ENABLE_ASSET_PROMOTE=1
 * so merely running `vite` does not expose a filesystem-writing endpoint.
 */
export function promoteAssetPlugin(): Plugin {
  const libDir = join(process.cwd(), 'public', 'asset-library');
  const blobsDir = join(libDir, 'blobs');
  const manifestPath = join(libDir, 'manifest.ndjson');
  const enabled = process.env.ENABLE_ASSET_PROMOTE === '1';

  return {
    name: 'promote-asset',
    apply: 'serve', // dev server only — never in the production build
    configureServer(server) {
      if (!enabled) return; // opt-in: set ENABLE_ASSET_PROMOTE=1 to enable
      server.middlewares.use('/__promote-asset', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('POST only'); return; }
        if (!isLocalRequest(req)) { res.statusCode = 403; res.end('local requests only'); return; }
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', async () => {
          try {
            const { meta, blobBase64 } = JSON.parse(body) as { meta: PromoteMeta; blobBase64: string };
            if (!isSafeId(meta?.kind, 32) || !isSafeId(meta?.key, 64)) {
              res.statusCode = 400; res.end('invalid kind/key'); return;
            }
            // Defense in depth: assert the resolved path stays under blobsDir.
            const target = resolve(blobsDir, blobFileName(meta.kind, meta.key));
            if (!target.startsWith(resolve(blobsDir) + sep)) {
              res.statusCode = 400; res.end('path escape'); return;
            }
            await mkdir(blobsDir, { recursive: true });
            await writeFile(target, Buffer.from(blobBase64, 'base64'));
            await appendFile(manifestPath, buildManifestLine(meta));
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.statusCode = 500; res.end(String((e as Error).message));
          }
        });
      });
    },
  };
}
