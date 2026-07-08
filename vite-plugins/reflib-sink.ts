import type { Plugin } from 'vite';
import { readdirSync, existsSync, statSync, createReadStream, mkdirSync, writeFileSync, appendFileSync, readFileSync, rmSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { apiKey, generateTti } from '../scripts/tti-generate';

/** True if the request originates from the local dev machine (loopback host). */
function isLocalRequest(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  const host = String(req.headers['host'] ?? '');
  return /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/.test(host);
}

/** A bare path segment (slug / filename) — no separators, no dot-escape. */
function safeSegment(raw: string): string | null {
  const s = String(raw || '');
  if (!s || s === '.' || s === '..' || /[/\\]/.test(s)) return null;
  return s;
}

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.txt': 'text/plain; charset=utf-8', '.tsv': 'text/tab-separated-values; charset=utf-8' };

/** Handle a POST regen: parse { prompt, model, confirm }, run the paid TTI call, and write the
 *  result (model-tti.png + prompt.txt + a manifest row) into <root>/<slug>/. SPENDS MONEY. */
async function regen(
  slug: string, rawBody: string, root: string, res: import('node:http').ServerResponse,
  json: (obj: unknown) => void,
): Promise<void> {
  const fail = (code: number, msg: string): void => { res.statusCode = code; res.end(msg); };
  let body: { prompt?: string; model?: string; confirm?: boolean };
  try { body = JSON.parse(rawBody || '{}'); } catch { return fail(400, 'bad JSON body'); }
  const prompt = String(body.prompt ?? '').trim();
  const model = String(body.model ?? '').trim();
  if (!body.confirm) return fail(400, 'regen requires confirm:true (it SPENDS money)');
  if (!prompt || !model) return fail(400, 'prompt and model are required');
  const key = apiKey();
  if (!key) return fail(400, 'OPENROUTER_API_KEY not set (env or .env) — cannot generate');
  try {
    const { buf, cost } = await generateTti(key, prompt, model);
    const dir = join(root, slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'model-tti.png'), buf);
    writeFileSync(join(dir, 'prompt.txt'), `model: ${model}\n\n${prompt}\n`);
    appendFileSync(join(root, 'manifest.tsv'), `${slug}\t${model}\t${cost.toFixed(4)}\n`);
    json({ ok: true, slug, model, cost, bytes: buf.length });
  } catch (e) {
    res.statusCode = 502;
    res.end(`TTI generate failed: ${String((e as Error).message ?? e)}`);
  }
}

/**
 * Dev-only reference-library sink. The TTI reference-library (`reference-library/tti/<slug>/`:
 * a `model-tti.png` text-to-image reference, our `ours-massing.png`, and the `prompt.txt`) is
 * gitignored and lives OUTSIDE the served app, so the browser studio can't `fetch()` it. This
 * middleware exposes it read-only over dev-only URLs so the studio can show each subject's
 * reference image inline in its pipeline strip (a manual eval tool: our sprite vs the reference).
 *
 *   GET  /__reflib            → { slugs: string[] }   (dirs that contain a model-tti.png)
 *   GET  /__reflib/<slug>     → { slug, files: string[] }
 *   GET  /__reflib/<slug>/<f> → the raw file (png/txt), local requests only
 *   POST /__reflib/<slug>     → REGENERATE: body { prompt, model, confirm:true } runs a paid TTI
 *                               call (SPENDS MONEY) and writes model-tti.png + prompt.txt + a
 *                               manifest row into <slug>/. Local-only; requires confirm:true.
 *   DELETE /__reflib/<slug>   → remove the reference dir + its manifest rows (free, local-only).
 *
 * `apply:'serve'` keeps it out of production builds entirely.
 */
export function reflibSinkPlugin(): Plugin {
  const MOUNT = '/__reflib';
  return {
    name: 'reflib-sink',
    apply: 'serve',
    configureServer(server) {
      const root = resolve(server.config.root, 'reference-library', 'tti');
      server.middlewares.use(MOUNT, (req, res) => {
        if (!isLocalRequest(req)) { res.statusCode = 403; res.end('local requests only'); return; }
        const json = (obj: unknown) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };

        const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
        const parts = path.split('/').filter(Boolean);   // MOUNT is stripped → [] | [slug] | [slug, file]

        // POST /__reflib/<slug> → paid regen (writes into <slug>/). Requires confirm:true.
        if (req.method === 'POST') {
          const slug = safeSegment(parts[0] ?? '');
          if (!slug || parts.length !== 1) { res.statusCode = 400; return res.end('POST /__reflib/<slug>'); }
          const chunks: Buffer[] = [];
          req.on('data', (c) => chunks.push(Buffer.from(c)));
          req.on('end', () => { void regen(slug, Buffer.concat(chunks).toString('utf8'), root, res, json); });
          return;
        }
        // DELETE /__reflib/<slug> → remove the reference dir + its manifest rows (free, local-only).
        if (req.method === 'DELETE') {
          const slug = safeSegment(parts[0] ?? '');
          if (!slug || parts.length !== 1) { res.statusCode = 400; return res.end('DELETE /__reflib/<slug>'); }
          const dir = join(root, slug);
          if (!existsSync(dir)) { res.statusCode = 404; return res.end('no such reference'); }
          try {
            rmSync(dir, { recursive: true, force: true });
            const mf = join(root, 'manifest.tsv');
            if (existsSync(mf)) {
              const kept = readFileSync(mf, 'utf8').split('\n').filter((l) => l && l.split('\t')[0] !== slug);
              writeFileSync(mf, kept.length ? `${kept.join('\n')}\n` : '');
            }
            return json({ ok: true, slug });
          } catch (e) { res.statusCode = 500; return res.end(`delete failed: ${String((e as Error).message ?? e)}`); }
        }
        if (req.method !== 'GET') { res.statusCode = 405; res.end('GET/POST/DELETE only'); return; }

        // Index: every slug dir that holds a model-tti.png (the reference-bearing subjects).
        if (parts.length === 0) {
          if (!existsSync(root)) return json({ slugs: [] });
          const slugs = readdirSync(root)
            .filter((d) => { try { return statSync(join(root, d)).isDirectory() && existsSync(join(root, d, 'model-tti.png')); } catch { return false; } })
            .sort();
          return json({ slugs });
        }

        const slug = safeSegment(parts[0]);
        if (!slug) { res.statusCode = 400; return res.end('bad slug'); }
        // A single segment that is a FILE at the root (e.g. manifest.tsv) → serve it directly,
        // before we assume the segment names a reference DIRECTORY (else manifest.tsv 404s).
        if (parts.length === 1) {
          const rootFile = join(root, slug);
          if (existsSync(rootFile) && statSync(rootFile).isFile()) {
            res.setHeader('Content-Type', MIME[extname(slug).toLowerCase()] ?? 'application/octet-stream');
            res.setHeader('Cache-Control', 'no-cache');
            return createReadStream(rootFile).pipe(res);
          }
        }
        const dir = join(root, slug);
        if (!existsSync(dir) || !statSync(dir).isDirectory()) { res.statusCode = 404; return res.end('no such reference'); }

        // Per-slug listing.
        if (parts.length === 1) return json({ slug, files: readdirSync(dir).sort() });

        // File fetch.
        const file = safeSegment(parts[1]);
        if (!file) { res.statusCode = 400; return res.end('bad file'); }
        const full = join(dir, file);
        if (!existsSync(full) || !statSync(full).isFile()) { res.statusCode = 404; return res.end('no such file'); }
        res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        createReadStream(full).pipe(res);
      });
    },
  };
}
