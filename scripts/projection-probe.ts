/**
 * Projection probe — measures PixelLab's real iso tile ratio so we can converge
 * our grid (128×64 = 2:1) with what the model actually renders.
 *
 *   PIXELLAB_API_KEY=… npx tsx scripts/projection-probe.ts
 *
 * Generates a clean FLAT floor tile under each candidate `view` setting (and one
 * 3×3 platform), isolates it on transparency, measures the opaque diamond's
 * bounding box W×H, and prints the height:width ratio vs our target 0.5. A flat
 * iso tile's bbox IS its tile diamond, so bboxH/bboxW = the projection ratio.
 * Writes PNGs to tmp/projection-probe/ for eyeballing.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { request } from 'node:https';
import { PNG } from 'pngjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tmp/projection-probe');
const PALETTE = join(ROOT, 'public/sprites/palette/lpc-anchor.png');
const API = 'https://api.pixellab.ai/v2/create-image-pixflux';
const BG_API = 'https://api.pixellab.ai/v2/remove-background';

const apiKey = process.env.PIXELLAB_API_KEY;
if (!apiKey) { console.error('PIXELLAB_API_KEY not set.'); process.exit(1); }

const FLAT_TILE = 'a single flat square stone floor tile seen from above, plain flat ground, no walls, no building, no thickness';
const NEG = 'wall, building, roof, thickness, tall, side view, 3d block, multiple tiles, object, character';

function postJson(url: string, payload: unknown): Promise<any> {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json',
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
    req.on('error', reject); req.write(body); req.end();
  });
}

async function removeBg(b64: string, width: number, height: number): Promise<string> {
  const json = await postJson(BG_API, {
    image: { type: 'base64', base64: b64, format: 'png' },
    image_size: { width, height }, background_removal_task: 'remove_complex_background', text: 'stone floor tile',
  });
  if (!json?.image?.base64) throw new Error('remove-bg: missing image.base64');
  return json.image.base64;
}

/** Opaque bounding box of a PNG buffer. */
function opaqueBBox(buf: Buffer): { w: number; h: number; minX: number; maxX: number; minY: number; maxY: number } {
  const png = PNG.sync.read(buf);
  const { width, height, data } = png;
  let minX = width, maxX = -1, minY = height, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 24) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  return { w: maxX - minX + 1, h: maxY - minY + 1, minX, maxX, minY, maxY };
}

const paletteB64 = (await readFile(PALETTE)).toString('base64');
await mkdir(OUT, { recursive: true });

function body(prompt: string, view: string, size: number, noBg: boolean): Record<string, unknown> {
  return {
    description: prompt, image_size: { width: size, height: size },
    no_background: noBg, outline: 'single color black outline', shading: 'basic shading', detail: 'low detail',
    isometric: true, view, text_guidance_scale: 9, negative_description: NEG, seed: 0,
    color_image: { type: 'base64', base64: paletteB64, format: 'png' },
  };
}

interface Probe { label: string; view: string; size: number; prompt: string; noBg: boolean }
const probes: Probe[] = [
  { label: 'tile-high', view: 'high top-down', size: 128, prompt: FLAT_TILE, noBg: true },
  { label: 'tile-low', view: 'low top-down', size: 128, prompt: FLAT_TILE, noBg: true },
  { label: 'tile-side', view: 'side', size: 128, prompt: FLAT_TILE, noBg: true },
  { label: 'plat3-high', view: 'high top-down', size: 256, prompt: 'a flat 3 by 3 grid of square stone floor tiles seen from above, plain flat ground, no walls', noBg: false },
];

console.log('label        view            bbox        H:W ratio  (our target 0.500)');
for (const pr of probes) {
  try {
    const json = await postJson(API, body(pr.prompt, pr.view, pr.size, pr.noBg));
    let b64 = json?.image?.base64;
    if (!b64) throw new Error('missing image.base64');
    if (!pr.noBg) b64 = await removeBg(b64, pr.size, pr.size);
    const buf = Buffer.from(b64, 'base64');
    await writeFile(join(OUT, `${pr.label}.png`), buf);
    const bb = opaqueBBox(buf);
    const ratio = bb.h / bb.w;
    console.log(`${pr.label.padEnd(12)} ${pr.view.padEnd(15)} ${String(bb.w).padStart(3)}x${String(bb.h).padStart(3)}    ${ratio.toFixed(3)}`);
  } catch (e) {
    console.error(`${pr.label.padEnd(12)} ${pr.view.padEnd(15)} ERROR ${(e as Error).message}`);
  }
}
console.log(`\nPNGs → tmp/projection-probe/  (2:1 grid wants H:W ≈ 0.500 for a single flat tile)`);
