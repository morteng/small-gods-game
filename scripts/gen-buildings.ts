/**
 * Regenerate building sprites through the prompt-generation system.
 *
 *   PIXELLAB_API_KEY=… npx tsx scripts/gen-buildings.ts [preset…]
 *
 * For each preset it runs: descriptor → buildingBrief → PixfluxCompiler →
 * pixflux request, at the view registry's NATIVE size (footprint-fitted, not a
 * fixed square) with the compiled, tri-aligned prompt. Writes each PNG to
 * tmp/pixellab-probe/<preset>-<W>x<H>.png and a seed sidecar to
 * tmp/building-seed.json (consumed by seed-base-library.mjs).
 *
 * Geometry guidance (door-aligned massing init_image) needs a canvas, which
 * Node lacks. If a pre-rendered guidance PNG exists at tmp/guidance/<preset>.png
 * (e.g. exported from the in-browser renderMassingToImage), it is sent as
 * init_image; otherwise the call is text-only and that is logged — never
 * silently dropped.
 */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { BUILDING_PRESETS, synthesizeFromPreset } from '@/world/building-presets';
import { buildingBrief } from '@/assetgen/producers/building-producer';
import { PixfluxCompiler } from '@/assetgen/compilers/pixflux-compiler';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tmp/pixellab-probe');
const GUIDANCE = join(ROOT, 'tmp/guidance');
const API = 'https://api.pixellab.ai/v2/create-image-pixflux';

const apiKey = process.env.PIXELLAB_API_KEY;
if (!apiKey) {
  console.error('PIXELLAB_API_KEY not set. Aborting.');
  process.exit(1);
}

const compiler = new PixfluxCompiler();
const requested = process.argv.slice(2);
const presets = requested.length ? requested : Object.keys(BUILDING_PRESETS);

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

await mkdir(OUT, { recursive: true });

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

  // Optional geometry guidance (pre-rendered in-browser).
  const guidancePath = join(GUIDANCE, `${name}.png`);
  let guided = false;
  const body: Record<string, unknown> = {
    description: opts.prompt,
    image_size: { width: opts.width, height: opts.height },
    no_background: true,
    outline: opts.outline,
    shading: opts.shading,
    detail: opts.detail,
    seed: opts.seed ?? 0,
  };
  if (await exists(guidancePath)) {
    const b64 = (await readFile(guidancePath)).toString('base64');
    body.init_image = { type: 'base64', base64: b64, format: 'png' };
    body.init_image_strength = opts.initImageStrength ?? 500;
    guided = true;
  }

  const file = `${name}-${opts.width}x${opts.height}.png`;
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text().catch(() => '')}`.trim());
    const json: any = await res.json();
    const imgB64 = json?.image?.base64;
    if (!imgB64) throw new Error('missing image.base64');
    await writeFile(join(OUT, file), Buffer.from(imgB64, 'base64'));
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
  console.log(`✓ ${name.padEnd(14)} ${opts.width}x${opts.height}  guided=${guided}`);
}

await writeFile(join(ROOT, 'tmp/building-seed.json'), JSON.stringify(rows, null, 2));
console.log(`\nGenerated ${rows.length}/${presets.length} → tmp/building-seed.json`);
if (failures.length) {
  console.warn(`\n${failures.length} FAILED (not seeded):`);
  for (const f of failures) console.warn(`  - ${f}`);
}
