/**
 * Regenerate building sprites through the prompt-generation system.
 *
 *   PIXELLAB_API_KEY=… npx tsx scripts/gen-buildings.ts [preset…]
 *
 * For each preset: descriptor → buildingBrief → PixfluxCompiler → pixflux request
 * at the view registry's TRUE NATIVE size (= the footprint diamond size, so the
 * renderer blits it 1:1). The request uses pixflux's real controls — `isometric`
 * + `view` + `text_guidance_scale` + `negative_description` + a broad LPC
 * `color_image` palette — and NO init_image (pixflux is img2img; any init gets
 * reproduced flat). Text-only lets the model draw a detailed iso building.
 *
 * Because `no_background` only cuts cleanly ≤128px and our sprites are larger, we
 * generate OPAQUE (`no_background:false`) then run a second `remove-background`
 * pass to get the transparent cutout.
 *
 * Writes each PNG to tmp/pixellab-probe/<preset>-<W>x<H>.png and a seed sidecar to
 * tmp/building-seed.json (consumed by seed-base-library.mjs).
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { request } from 'node:https';

import { BUILDING_PRESETS, synthesizeFromPreset } from '@/world/building-presets';
import { buildingBrief } from '@/assetgen/producers/building-producer';
import { PixfluxCompiler } from '@/assetgen/compilers/pixflux-compiler';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tmp/pixellab-probe');
// Project-wide LPC anchor palette — a BROAD coherent colour range. Using the
// building's own 2-3 material anchors as color_image forces a near-monochrome
// sprite (color_image is a forced palette); the broad palette lets the model
// differentiate roof / walls / trim / door while the PROMPT names the materials.
const PALETTE = join(ROOT, 'public/sprites/palette/lpc-anchor.png');
const API = 'https://api.pixellab.ai/v2/create-image-pixflux';
const BG_API = 'https://api.pixellab.ai/v2/remove-background';

const apiKey = process.env.PIXELLAB_API_KEY;
if (!apiKey) {
  console.error('PIXELLAB_API_KEY not set. Aborting.');
  process.exit(1);
}

const compiler = new PixfluxCompiler();

/**
 * POST JSON via node:https. PixelLab generation is slow (often >120s, and longer
 * for big sprites); the global `fetch` (undici) drops the socket at its internal
 * headers-timeout → "fetch failed". A raw https request has NO default timeout,
 * so it waits the request out. Returns the parsed JSON response.
 */
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
        if ((res.statusCode ?? 0) >= 400) {
          reject(new Error(`HTTP ${res.statusCode} ${text.slice(0, 200)}`));
          return;
        }
        try { resolve(JSON.parse(text)); }
        catch { reject(new Error(`bad JSON (${text.slice(0, 120)})`)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/** Cut the opaque pixflux render onto transparency via PixelLab remove-background. */
async function removeBackground(
  imgB64: string, width: number, height: number, text: string,
): Promise<string> {
  const json = await postJson(BG_API, {
    image: { type: 'base64', base64: imgB64, format: 'png' },
    image_size: { width, height },
    background_removal_task: 'remove_complex_background', // crisp building silhouettes
    text,
  });
  const out = json?.image?.base64;
  if (!out) throw new Error('remove-bg: missing image.base64');
  return out;
}

const requested = process.argv.slice(2);
const presets = requested.length ? requested : Object.keys(BUILDING_PRESETS);

await mkdir(OUT, { recursive: true });

const paletteB64 = (await readFile(PALETTE)).toString('base64');

interface SeedRow {
  file: string; prompt: string; width: number; height: number;
  kind: 'building'; tags: string[]; affinity: { era: string[] };
  recipeVersion?: string; initStrength?: number; paletteAnchors?: string[];
}

const rows: SeedRow[] = [];
const failures: string[] = [];

for (const name of presets) {
  const d = synthesizeFromPreset(name);
  if (!d) { failures.push(`${name}: unknown preset`); continue; }

  const brief = buildingBrief(d, 0); // seed 0 → canonical base-library variant
  const opts = compiler.compile(brief);

  const body: Record<string, unknown> = {
    description: opts.prompt,
    image_size: { width: opts.width, height: opts.height },
    no_background: false, // opaque; a remove-background pass cuts it out below
    outline: opts.outline,
    shading: opts.shading,
    detail: opts.detail,
    seed: opts.seed ?? 0,
  };
  if (opts.negativeDescription) body.negative_description = opts.negativeDescription;
  if (opts.isometric) body.isometric = true;
  if (opts.view) body.view = opts.view;
  if (opts.textGuidanceScale !== undefined) body.text_guidance_scale = opts.textGuidanceScale;

  // Colours: the broad LPC palette so the model can differentiate parts (the
  // prompt names the materials; the palette supplies a coherent multi-hue range).
  body.color_image = { type: 'base64', base64: paletteB64, format: 'png' };

  const file = `${name}-${opts.width}x${opts.height}.png`;
  try {
    const json = await postJson(API, body);
    const opaqueB64 = json?.image?.base64;
    if (!opaqueB64) throw new Error('missing image.base64');
    // Cut the building out of its opaque background → transparent sprite.
    const cutB64 = await removeBackground(opaqueB64, opts.width, opts.height, name.replace(/_/g, ' '));
    await writeFile(join(OUT, file), Buffer.from(cutB64, 'base64'));
  } catch (err) {
    failures.push(`${name}: ${(err as Error).message}`);
    console.error(`✗ ${name} (${opts.width}x${opts.height}) — ${(err as Error).message}`);
    continue;
  }

  rows.push({
    file, prompt: opts.prompt, width: opts.width, height: opts.height,
    kind: 'building', tags: [name], affinity: { era: [d.era] },
    recipeVersion: opts.recipeVersion, initStrength: opts.initImageStrength,
    paletteAnchors: opts.paletteAnchors,
  });
  console.log(`✓ ${name.padEnd(14)} ${opts.width}x${opts.height}  text-only`);
}

await writeFile(join(ROOT, 'tmp/building-seed.json'), JSON.stringify(rows, null, 2));
console.log(`\nGenerated ${rows.length}/${presets.length} → tmp/building-seed.json`);
if (failures.length) {
  console.warn(`\n${failures.length} FAILED (not seeded):`);
  for (const f of failures) console.warn(`  - ${f}`);
}
