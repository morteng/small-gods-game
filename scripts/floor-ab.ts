/**
 * Floor-guide A/B — does a LOW-strength floor-diamond init_image make PixelLab
 * draw buildings aligned + sized to our exact 2:1 grid (vs text-only drift)?
 *
 *   PIXELLAB_API_KEY=… npx tsx scripts/floor-ab.ts
 *
 * For each test preset it generates: a text-only CONTROL, plus the floor-guide
 * init at each STRENGTH. Each render is cut via remove-background and written to
 * tmp/floor-ab/<preset>-<variant>.png for side-by-side visual comparison. Does
 * NOT touch the base library — purely an experiment to settle the approach
 * before any full regen.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { request } from 'node:https';
import { PNG } from 'pngjs';

import { synthesizeFromPreset } from '@/world/building-presets';
import { buildingBrief } from '@/assetgen/producers/building-producer';
import { PixfluxCompiler } from '@/assetgen/compilers/pixflux-compiler';
import { buildFloorGuide } from '@/assetgen/floor-guide';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tmp/floor-ab');
const PALETTE = join(ROOT, 'public/sprites/palette/lpc-anchor.png');
const API = 'https://api.pixellab.ai/v2/create-image-pixflux';
const BG_API = 'https://api.pixellab.ai/v2/remove-background';

const TEST_PRESETS = ['cottage', 'longhouse']; // square + wide (skew compounds)
const STRENGTHS = [200, 400];                  // loose → firmer floor adherence

const apiKey = process.env.PIXELLAB_API_KEY;
if (!apiKey) { console.error('PIXELLAB_API_KEY not set.'); process.exit(1); }

const compiler = new PixfluxCompiler();

function postJson(url: string, payload: unknown): Promise<any> {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if ((res.statusCode ?? 0) >= 400) { reject(new Error(`HTTP ${res.statusCode} ${text.slice(0, 200)}`)); return; }
        try { resolve(JSON.parse(text)); } catch { reject(new Error(`bad JSON (${text.slice(0, 120)})`)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function removeBackground(b64: string, width: number, height: number, text: string): Promise<string> {
  const json = await postJson(BG_API, {
    image: { type: 'base64', base64: b64, format: 'png' },
    image_size: { width, height },
    background_removal_task: 'remove_complex_background',
    text,
  });
  if (!json?.image?.base64) throw new Error('remove-bg: missing image.base64');
  return json.image.base64;
}

function floorGuideB64(width: number, height: number, fw: number, fh: number): string {
  const g = buildFloorGuide(width, height, fw, fh);
  const png = new PNG({ width, height });
  png.data = Buffer.from(g.data.buffer);
  return PNG.sync.write(png).toString('base64');
}

await mkdir(OUT, { recursive: true });
const paletteB64 = (await readFile(PALETTE)).toString('base64');

function baseBody(opts: ReturnType<PixfluxCompiler['compile']>): Record<string, unknown> {
  const body: Record<string, unknown> = {
    description: opts.prompt,
    image_size: { width: opts.width, height: opts.height },
    no_background: false,
    outline: opts.outline, shading: opts.shading, detail: opts.detail,
    seed: opts.seed ?? 0,
    color_image: { type: 'base64', base64: paletteB64, format: 'png' },
  };
  if (opts.negativeDescription) body.negative_description = opts.negativeDescription;
  if (opts.isometric) body.isometric = true;
  if (opts.view) body.view = opts.view;
  if (opts.textGuidanceScale !== undefined) body.text_guidance_scale = opts.textGuidanceScale;
  return body;
}

async function renderVariant(name: string, variant: string, body: Record<string, unknown>, w: number, h: number): Promise<void> {
  const json = await postJson(API, body);
  const opaque = json?.image?.base64;
  if (!opaque) throw new Error('missing image.base64');
  const cut = await removeBackground(opaque, w, h, name.replace(/_/g, ' '));
  const file = `${name}-${variant}.png`;
  await writeFile(join(OUT, file), Buffer.from(cut, 'base64'));
  console.log(`  ✓ ${file}`);
}

for (const name of TEST_PRESETS) {
  const d = synthesizeFromPreset(name);
  if (!d) { console.log(`skip ${name}`); continue; }
  const opts = compiler.compile(buildingBrief(d, 0));
  console.log(`\n${name} ${opts.width}x${opts.height} (fp ${d.footprint.w}x${d.footprint.h})`);

  // Control: text-only (current pipeline).
  try { await renderVariant(name, 'control', baseBody(opts), opts.width, opts.height); }
  catch (e) { console.error(`  ✗ control — ${(e as Error).message}`); }

  // Floor-guide init at each strength.
  const initB64 = floorGuideB64(opts.width, opts.height, d.footprint.w, d.footprint.h);
  for (const strength of STRENGTHS) {
    const body = baseBody(opts);
    body.init_image = { type: 'base64', base64: initB64, format: 'png' };
    body.init_image_strength = strength;
    try { await renderVariant(name, `floor${strength}`, body, opts.width, opts.height); }
    catch (e) { console.error(`  ✗ floor${strength} — ${(e as Error).message}`); }
  }
}

console.log(`\nDone → tmp/floor-ab/  (compare control vs floorNNN per preset)`);
