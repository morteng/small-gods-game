/**
 * Seed the vendored building-sprite base library through the SAME pipeline the
 * game uses at runtime (geometry init → OpenRouter img2img → chroma-key →
 * validate → register → quantize), so keyless players get real art and the
 * IndexedDB runtime cache only ever fills gaps (novel/patched blueprints).
 *
 *   OPENROUTER_API_KEY=… npx tsx scripts/seed-building-art.ts [preset…]
 *   npx tsx scripts/seed-building-art.ts --plan        # no key: print key/prompt per preset, no API calls
 *
 * Key identity matches the runtime exactly: worldgen synthesizes blueprints with
 * no patches and a name-derived seed (building-placer.ts), and the cache key is
 * generatedArtKey(canonicalJson(rb), model, footprint) on both sides. Writes
 * public/asset-library/building-sprites/{manifest.json, <key>.png + companion
 * normal/material/emissive PNGs}. Re-runnable: presets already in the manifest
 * at the current recipe version are skipped (pass --force to regenerate).
 */
import { mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PNG } from 'pngjs';

import { composeStructure } from '../src/assetgen/compose';
import { toGeometry } from '../src/blueprint/compile/to-geometry';
import { synthesizeBlueprint, BUILDING_BLUEPRINTS } from '../src/blueprint/presets';
import { buildingImagePrompt } from '../src/assetgen/building-image-prompt';
import { compositeOverChroma, chromaKeyMagenta } from '../src/render/chroma-key';
import { canonicalJson, generatedArtKey } from '../src/render/generated-art-cache';
import {
  type Raster, cropRaster, borderKeyedFraction, registerAlbedo, quantizePalette,
} from '../src/render/sprite-postprocess';
import {
  MIN_BORDER_KEYED, MIN_SILHOUETTE_IOU, QUANT_COLORS,
} from '../src/render/generated-building-art-source';
import { generateBuildingImage, BUILDING_IMAGE_MODEL } from '../src/llm/openrouter-image-client';
import { ART_RECIPE_VERSION } from '../src/core/content-version';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/asset-library/building-sprites');
const MANIFEST = join(OUT, 'manifest.json');
const MAX_ATTEMPTS = 2;

interface ManifestEntry {
  file: string; targetWidth: number; preset: string; anchors?: string;
  normal?: string; material?: string; emissive?: string;
}
interface Manifest { recipeVersion?: string; model: string; entries: Record<string, ManifestEntry> }

const plan = process.argv.includes('--plan');
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey && !plan) { console.error('OPENROUTER_API_KEY not set. Aborting.'); process.exit(1); }

const force = process.argv.includes('--force');
const wanted = process.argv.slice(2).filter(a => !a.startsWith('--'));
const presets = wanted.length ? wanted : Object.keys(BUILDING_BLUEPRINTS);

function toPng(buf: Uint8ClampedArray, w: number, h: number): Buffer {
  const png = new PNG({ width: w, height: h });
  png.data = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  return PNG.sync.write(png);
}
function fromPng(buf: Buffer): Raster {
  const png = PNG.sync.read(buf);
  return { data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength), w: png.width, h: png.height };
}

async function loadManifest(): Promise<Manifest> {
  try { return JSON.parse(await readFile(MANIFEST, 'utf8')) as Manifest; }
  catch { return { model: BUILDING_IMAGE_MODEL, entries: {} }; }
}

async function seed(preset: string, manifest: Manifest): Promise<number> {
  const rb = synthesizeBlueprint(preset);
  if (!rb) { console.warn(`(skip ${preset}: no preset)`); return 0; }
  const key = generatedArtKey(canonicalJson(rb), BUILDING_IMAGE_MODEL, rb.footprint);
  if (!force && manifest.entries[key]) { console.log(`${preset}: already seeded (${key})`); return 0; }

  const r = await composeStructure(toGeometry(rb));
  const bb = {
    x: Math.round(r.bbox.x), y: Math.round(r.bbox.y),
    w: Math.max(1, Math.round(r.bbox.w)), h: Math.max(1, Math.round(r.bbox.h)),
  };
  const full = (buf: Uint8ClampedArray): Raster => ({ data: buf, w: r.size, h: r.size });
  const mask = cropRaster(full(r.grey), bb);
  const initDataUri = `data:image/png;base64,${toPng(compositeOverChroma(r.grey), r.size, r.size).toString('base64')}`;
  const prompt = buildingImagePrompt(rb, BUILDING_IMAGE_MODEL);
  if (plan) {
    console.log(`${preset}: key ${key} · mask ${mask.w}×${mask.h} · init ${Math.round(initDataUri.length / 1024)}kB\n  prompt: ${prompt}`);
    return 0;
  }

  let cost = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await generateBuildingImage({ apiKey: apiKey! }, { initImageDataUri: initDataUri, prompt });
    cost += res.costUsd;
    const raw = fromPng(Buffer.from(await res.blob.arrayBuffer()));
    chromaKeyMagenta(raw.data);
    const border = borderKeyedFraction(raw);
    if (border < MIN_BORDER_KEYED) { console.warn(`${preset}: attempt ${attempt} — background did not key (ring ${border.toFixed(2)})`); continue; }
    const reg = registerAlbedo(raw, mask);
    if (!reg) { console.warn(`${preset}: attempt ${attempt} — nothing survived keying`); continue; }
    if (reg.iou < MIN_SILHOUETTE_IOU) { console.warn(`${preset}: attempt ${attempt} — silhouette IoU ${reg.iou.toFixed(2)} < ${MIN_SILHOUETTE_IOU}`); continue; }
    const sprite = quantizePalette(reg.sprite, QUANT_COLORS);

    const entry: ManifestEntry = {
      file: `${key}.png`, targetWidth: sprite.w, preset, anchors: JSON.stringify(r.anchors),
      normal: `${key}.normal.png`, material: `${key}.material.png`, emissive: `${key}.emissive.png`,
    };
    await writeFile(join(OUT, entry.file), toPng(sprite.data, sprite.w, sprite.h));
    const writeMap = async (name: string, buf: Uint8ClampedArray) => {
      const c = cropRaster(full(buf), bb);
      await writeFile(join(OUT, name), toPng(c.data, c.w, c.h));
    };
    await writeMap(entry.normal!, r.normal);
    await writeMap(entry.material!, r.material);
    await writeMap(entry.emissive!, r.emissive);
    manifest.entries[key] = entry;
    console.log(`${preset}: seeded ${entry.file} (${sprite.w}×${sprite.h}, IoU ${reg.iou.toFixed(2)}, $${cost.toFixed(4)})`);
    return cost;
  }
  console.error(`${preset}: FAILED after ${MAX_ATTEMPTS} attempts — not seeded`);
  return cost;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const manifest = await loadManifest();
  manifest.model = BUILDING_IMAGE_MODEL;
  manifest.recipeVersion = ART_RECIPE_VERSION;
  // Keys embed the recipe version — prune entries from older recipes so the
  // manifest doesn't accumulate unmatchable rows (their PNGs stay on disk until
  // a manual clean; harmless, never fetched).
  for (const k of Object.keys(manifest.entries)) {
    if (!k.startsWith(`${ART_RECIPE_VERSION}:`)) delete manifest.entries[k];
  }
  let total = 0;
  for (const preset of presets) total += await seed(preset, manifest);
  if (plan) { console.log('(plan mode — nothing written, nothing spent)'); return; }
  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Done. ${Object.keys(manifest.entries).length} sprites in the library, $${total.toFixed(4)} spent this run.`);
}

main().catch(err => { console.error(err); process.exit(1); });
