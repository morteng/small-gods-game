import type { Plugin } from 'vite';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';

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

/** Dev-only plugin: POST /__promote-asset { meta, blobBase64 } → write into public/. */
export function promoteAssetPlugin(): Plugin {
  const libDir = join(process.cwd(), 'public', 'asset-library');
  const blobsDir = join(libDir, 'blobs');
  const manifestPath = join(libDir, 'manifest.ndjson');

  return {
    name: 'promote-asset',
    apply: 'serve', // dev server only — never in the production build
    configureServer(server) {
      server.middlewares.use('/__promote-asset', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('POST only'); return; }
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', async () => {
          try {
            const { meta, blobBase64 } = JSON.parse(body) as { meta: PromoteMeta; blobBase64: string };
            await mkdir(blobsDir, { recursive: true });
            await writeFile(join(blobsDir, blobFileName(meta.kind, meta.key)), Buffer.from(blobBase64, 'base64'));
            await appendFile(manifestPath, buildManifestLine(meta));
            res.statusCode = 200; res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.statusCode = 500; res.end(String((e as Error).message));
          }
        });
      });
    },
  };
}
