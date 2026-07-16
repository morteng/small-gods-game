/**
 * Seed the vendored FLORA-sprite base library through the SAME pipeline the game
 * uses at runtime (geometry init → OpenRouter img2img → chroma-key → validate →
 * register → quantize), so keyless players get real tree/plant art and the IndexedDB
 * runtime cache only fills gaps. The plant analogue of scripts/seed-building-art.ts.
 *
 *   OPENROUTER_API_KEY=… npx tsx scripts/seed-flora-art.ts [speciesId…]
 *   npx tsx scripts/seed-flora-art.ts --plan        # no key: print key/prompt per species, no API calls
 *
 * Key identity matches the runtime exactly: worldgen places species ids as entity
 * kinds, GeneratedFloraArtSource synthesizes the SAME branched blueprint (no patches,
 * name-derived seed) and the cache key is generatedArtKey(canonicalJson(rb), model,
 * footprint) on both sides. Writes public/asset-library/flora-sprites/{manifest.json,
 * <key>.png + companion normal/material/emissive PNGs}. Re-runnable: species already
 * in the manifest at the current recipe version are skipped (pass --force to redo).
 */
import { mkdirSync, existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PNG } from 'pngjs';

import { composeStructure } from '../src/assetgen/compose';
import { toGeometry } from '../src/blueprint/compile/to-geometry';
import { synthesizeBlueprint } from '../src/blueprint/presets';
import type { ResolvedBlueprint } from '../src/blueprint/types';
import { allFloraSpecies } from '../src/flora/flora-registry';
import { deriveGenParams } from '../src/flora/flora-species';
import { floraImagePrompt, FLORA_IMAGE_MODEL } from '../src/assetgen/flora-image-prompt';
import { compositeOverChroma, chromaKeyMagenta } from '../src/render/chroma-key';
import { canonicalJson, generatedArtKey } from '../src/render/generated-art-cache';
import {
  type Raster, cropRaster, borderKeyedFraction, registerAlbedo, quantizePalette, boxDownscale,
} from '../src/render/sprite-postprocess';
import { MIN_BORDER_KEYED, QUANT_COLORS } from '../src/render/generated-building-art-source';
import { FLORA_MIN_SILHOUETTE_IOU } from '../src/render/generated-flora-art-source';
import { generateBuildingImage, BuildingImageError, BUILDING_IMAGE_MODEL } from '../src/llm/openrouter-image-client';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/asset-library/flora-sprites');
const MANIFEST = join(OUT, 'manifest.json');
const MAX_ATTEMPTS = 3;

interface ManifestEntry {
  file: string; targetWidth: number; species: string; anchors?: string;
  normal?: string; material?: string; emissive?: string;
}
interface Manifest { recipeVersion?: string; model: string; entries: Record<string, ManifestEntry> }

const safeName = (key: string) => key.replace(/[^a-zA-Z0-9._-]/g, '_');

const plan = process.argv.includes('--plan');
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey && !plan) { console.error('OPENROUTER_API_KEY not set. Aborting (use --plan for a dry run).'); process.exit(1); }

const force = process.argv.includes('--force');
// --model=<id> A/B a different img2img model (default Klein). The model rides in the
// cache key, so each model writes its own sprite file — no clobber across models.
const MODEL = process.argv.find((a) => a.startsWith('--model='))?.slice('--model='.length) ?? FLORA_IMAGE_MODEL;
// --maxinit=<px> downscales the img2img INIT to at most N px on its longest side (the
// final sprite still registers at full geometry resolution — registerAlbedo rescales
// the result to the mask). Big dense crowns (beech/ash) preserve their low-poly facets
// because the facets are large in the model's working space; shrinking the init makes
// them sub-brush so Klein dissolves them into painterly foliage. 0/absent = no downscale.
const MAX_INIT = Number(process.argv.find((a) => a.startsWith('--maxinit='))?.slice('--maxinit='.length) ?? 0) || 0;
const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'));
// Plant species only (rocks have no img2img recipe — they render from geometry).
const allPlantIds = allFloraSpecies().filter((s) => deriveGenParams(s).kind === 'plant').map((s) => s.id);
const species = wanted.length ? wanted : allPlantIds;

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

async function seed(speciesId: string, manifest: Manifest): Promise<number> {
  const rb: ResolvedBlueprint | undefined = synthesizeBlueprint(speciesId);
  if (!rb) { console.warn(`(skip ${speciesId}: not a plant species)`); return 0; }
  const key = generatedArtKey(canonicalJson(rb), MODEL, rb.footprint);
  if (!force && manifest.entries[key]) { console.log(`${speciesId}: already seeded (${key})`); return 0; }

  const r = await composeStructure(toGeometry(rb));
  const bb = {
    x: Math.round(r.bbox.x), y: Math.round(r.bbox.y),
    w: Math.max(1, Math.round(r.bbox.w)), h: Math.max(1, Math.round(r.bbox.h)),
  };
  const full = (buf: Uint8ClampedArray): Raster => ({ data: buf, w: r.size, h: r.size });
  const mask = cropRaster(full(r.grey), bb);
  // Composite the grey massing over the magenta chroma field, then optionally shrink it
  // so large facets fall below the img2img brush size (see --maxinit). The result always
  // re-registers at the full mask resolution, so the in-game sprite size is unchanged.
  let init: Raster = { data: compositeOverChroma(r.grey), w: r.size, h: r.size };
  if (MAX_INIT > 0 && r.size > MAX_INIT) init = boxDownscale(init, MAX_INIT, MAX_INIT);
  const initDataUri = `data:image/png;base64,${toPng(init.data, init.w, init.h).toString('base64')}`;
  const prompt = floraImagePrompt(rb, MODEL);
  if (plan) {
    console.log(`${speciesId}: key ${key} · mask ${mask.w}×${mask.h} · init ${Math.round(initDataUri.length / 1024)}kB\n  prompt: ${prompt}`);
    return 0;
  }

  let cost = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Awaited<ReturnType<typeof generateBuildingImage>>;
    try {
      res = await generateBuildingImage({ apiKey: apiKey! }, { initImageDataUri: initDataUri, prompt, model: MODEL });
    } catch (err) {
      if (err instanceof BuildingImageError && err.fatal) throw err;
      console.warn(`${speciesId}: attempt ${attempt} — generation error: ${(err as Error).message}`);
      continue;
    }
    cost += res.costUsd;
    const raw = fromPng(Buffer.from(await res.blob.arrayBuffer()));
    chromaKeyMagenta(raw.data);
    const border = borderKeyedFraction(raw);
    if (border < MIN_BORDER_KEYED) { console.warn(`${speciesId}: attempt ${attempt} — background did not key (ring ${border.toFixed(2)})`); continue; }
    const reg = registerAlbedo(raw, mask);
    if (!reg) { console.warn(`${speciesId}: attempt ${attempt} — nothing survived keying`); continue; }
    if (reg.iou < FLORA_MIN_SILHOUETTE_IOU) { console.warn(`${speciesId}: attempt ${attempt} — silhouette IoU ${reg.iou.toFixed(2)} < ${FLORA_MIN_SILHOUETTE_IOU}`); continue; }
    const sprite = quantizePalette(reg.sprite, QUANT_COLORS);

    const base = safeName(key);
    const entry: ManifestEntry = {
      file: `${base}.png`, targetWidth: sprite.w, species: speciesId, anchors: JSON.stringify(r.anchors),
      normal: `${base}.normal.png`, material: `${base}.material.png`, emissive: `${base}.emissive.png`,
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
    console.log(`${speciesId}: seeded ${entry.file} (${sprite.w}×${sprite.h}, IoU ${reg.iou.toFixed(2)}, $${cost.toFixed(4)})`);
    return cost;
  }
  console.error(`${speciesId}: FAILED after ${MAX_ATTEMPTS} attempts — not seeded`);
  return cost;
}

async function main(): Promise<void> {
  if (!plan && !existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  const manifest = await loadManifest();
  console.log(`${plan ? '[plan] ' : ''}Seeding ${species.length} flora species → ${OUT}`);
  let total = 0;
  try {
    for (const id of species) total += await seed(id, manifest);
  } finally {
    if (!plan) await writeFile(MANIFEST, JSON.stringify(manifest, null, 2));
  }
  console.log(`Done. ${plan ? '(dry run)' : `Spent ~$${total.toFixed(4)}.`} Manifest: ${Object.keys(manifest.entries).length} entries.`);
}

void main();
