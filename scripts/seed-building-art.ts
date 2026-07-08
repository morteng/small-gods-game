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
import { mkdirSync, existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PNG } from 'pngjs';

import { composeStructure } from '../src/assetgen/compose';
import { toGeometry } from '../src/blueprint/compile/to-geometry';
import { synthesizeBlueprint, resolveAsset, BUILDING_BLUEPRINTS } from '../src/blueprint/presets';
import { planVariants, defaultVariantMatrix, type PlannedVariant } from '../src/blueprint/variant-plan';
import type { ResolvedBlueprint, Descriptors } from '../src/blueprint/types';
import { buildingImagePrompt } from '../src/assetgen/building-image-prompt';
import { compositeOverChroma, chromaKeyMagenta } from '../src/render/chroma-key';
import { canonicalJson, generatedArtKey } from '../src/render/generated-art-cache';
import {
  type Raster, cropRaster, borderKeyedFraction, registerAlbedo, quantizePalette,
} from '../src/render/sprite-postprocess';
import {
  MIN_BORDER_KEYED, MIN_SILHOUETTE_IOU, QUANT_COLORS,
} from '../src/render/generated-building-art-source';
import { generateBuildingImage, BuildingImageError, BUILDING_IMAGE_MODEL } from '../src/llm/openrouter-image-client';
import { ART_RECIPE_VERSION } from '../src/core/content-version';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/asset-library/building-sprites');
const MANIFEST = join(OUT, 'manifest.json');
const MAX_ATTEMPTS = 3;

interface ManifestEntry {
  file: string; targetWidth: number; preset: string; anchors?: string;
  normal?: string; material?: string; emissive?: string;
  // Variant DB axes (Slice F) — present only on non-base variants so base rows
  // stay byte-stable. Let an agent/Fate query the manifest ("ruined tavern").
  label?: string; era?: string; stage?: string; descriptors?: Descriptors; tags?: string[];
}
interface Manifest { recipeVersion?: string; model: string; entries: Record<string, ManifestEntry> }

/** Cache keys embed the model id (contains `/` and `:`) — not filesystem/URL safe. */
const safeName = (key: string) => key.replace(/[^a-zA-Z0-9._-]/g, '_');

const plan = process.argv.includes('--plan');
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey && !plan && !process.argv.includes('--relink')) { console.error('OPENROUTER_API_KEY not set. Aborting.'); process.exit(1); }

const force = process.argv.includes('--force');
// Rebuild manifest rows from PNGs already on disk — NO API calls. Salvages sprites
// whose generation succeeded but whose run crashed before the manifest was written
// (the old end-of-run write orphaned every PNG when one gen threw). Free.
const relink = process.argv.includes('--relink');
// Matrix mode (Slice F): seed the default variant DB (each type's poor/rich/ruined
// cuts + every plant stage) instead of just the bare presets. Combine with --plan
// to dry-run the whole matrix (count + per-variant key/prompt, no API, no spend).
const matrix = process.argv.includes('--matrix');
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

/** The outcome of one seed job — returned (never inferred from manifest size,
 *  which is racy under the concurrent worker pool in main()). `seeded` = a new
 *  sprite was written this run; `skipped` = already present / no such preset /
 *  plan mode; `failed` = generation failed after all retries (retryable). */
type SeedOutcome = { cost: number; status: 'seeded' | 'skipped' | 'failed' };

async function seed(preset: string, manifest: Manifest): Promise<SeedOutcome> {
  const rb = synthesizeBlueprint(preset);
  if (!rb) { console.warn(`(skip ${preset}: no preset)`); return { cost: 0, status: 'skipped' }; }
  return seedResolved(preset, rb, manifest);
}

/** Seed ONE planned variant (era/descriptor/stage cut) — same pipeline, records
 *  the variant axes on the manifest row so the library is queryable. The base /
 *  default cut collapses onto the bare preset key (no duplicate sprite). */
async function seedVariant(v: PlannedVariant, manifest: Manifest): Promise<SeedOutcome> {
  const rb = resolveAsset(v.request);
  if (!rb) { console.warn(`(skip ${v.label}: unknown type)`); return { cost: 0, status: 'skipped' }; }
  return seedResolved(v.type, rb, manifest, v);
}

async function seedResolved(preset: string, rb: ResolvedBlueprint, manifest: Manifest, variant?: PlannedVariant): Promise<SeedOutcome> {
  const key = generatedArtKey(canonicalJson(rb), BUILDING_IMAGE_MODEL, rb.footprint);
  const label = variant?.label ?? preset;
  if (!force && manifest.entries[key]) { console.log(`${label}: already seeded (${key})`); return { cost: 0, status: 'skipped' }; }

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
    console.log(`${label}: key ${key} · mask ${mask.w}×${mask.h} · init ${Math.round(initDataUri.length / 1024)}kB\n  prompt: ${prompt}`);
    return { cost: 0, status: 'skipped' };
  }

  let cost = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // The model intermittently returns a text-only response (no image), which
    // throws; treat it as a failed attempt and retry rather than aborting the
    // whole batch (the same goes for transient network errors).
    let res: Awaited<ReturnType<typeof generateBuildingImage>>;
    try {
      res = await generateBuildingImage({ apiKey: apiKey! }, { initImageDataUri: initDataUri, prompt });
    } catch (err) {
      // A spend-limit / bad-key failure will hit every subsequent call too — abort
      // the whole batch (caught in main) rather than burning attempts and quota.
      if (err instanceof BuildingImageError && err.fatal) throw err;
      console.warn(`${preset}: attempt ${attempt} — generation error: ${(err as Error).message}`);
      continue;
    }
    cost += res.costUsd;
    const raw = fromPng(Buffer.from(await res.blob.arrayBuffer()));
    chromaKeyMagenta(raw.data);
    const border = borderKeyedFraction(raw);
    if (border < MIN_BORDER_KEYED) { console.warn(`${preset}: attempt ${attempt} — background did not key (ring ${border.toFixed(2)})`); continue; }
    const reg = registerAlbedo(raw, mask);
    if (!reg) { console.warn(`${preset}: attempt ${attempt} — nothing survived keying`); continue; }
    if (reg.iou < MIN_SILHOUETTE_IOU) { console.warn(`${preset}: attempt ${attempt} — silhouette IoU ${reg.iou.toFixed(2)} < ${MIN_SILHOUETTE_IOU}`); continue; }
    const sprite = quantizePalette(reg.sprite, QUANT_COLORS);

    const base = safeName(key);
    const entry: ManifestEntry = {
      file: `${base}.png`, targetWidth: sprite.w, preset, anchors: JSON.stringify(r.anchors),
      normal: `${base}.normal.png`, material: `${base}.material.png`, emissive: `${base}.emissive.png`,
      // Variant axes (Slice F) — recorded only when this is a non-base cut so base
      // rows stay byte-identical to a pre-variant manifest.
      ...(variant && variant.label !== preset ? {
        label: variant.label,
        ...(rb.era ? { era: rb.era } : {}),
        ...(rb.stage ? { stage: rb.stage } : {}),
        ...(rb.descriptors ? { descriptors: rb.descriptors } : {}),
        ...(variant.tags.length ? { tags: variant.tags } : {}),
      } : {}),
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
    return { cost, status: 'seeded' };
  }
  console.error(`${preset}: FAILED after ${MAX_ATTEMPTS} attempts — not seeded`);
  return { cost, status: 'failed' };
}

/** Rebuild a preset's manifest row from a PNG already on disk (NO API). The
 *  anchors come from geometry (free); targetWidth from the PNG itself. Returns
 *  true if a sprite existed and was (re)linked. */
async function relinkOne(preset: string, manifest: Manifest): Promise<boolean> {
  const rb = synthesizeBlueprint(preset);
  if (!rb) return false;
  const key = generatedArtKey(canonicalJson(rb), BUILDING_IMAGE_MODEL, rb.footprint);
  const base = safeName(key);
  const spritePath = join(OUT, `${base}.png`);
  if (!existsSync(spritePath)) return false;
  const sprite = fromPng(await readFile(spritePath));
  const r = await composeStructure(toGeometry(rb));
  const companion = (suffix: string): string | undefined =>
    existsSync(join(OUT, `${base}.${suffix}.png`)) ? `${base}.${suffix}.png` : undefined;
  manifest.entries[key] = {
    file: `${base}.png`, targetWidth: sprite.w, preset, anchors: JSON.stringify(r.anchors),
    normal: companion('normal'), material: companion('material'), emissive: companion('emissive'),
  };
  console.log(`${preset}: relinked ${base}.png (${sprite.w}px)`);
  return true;
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

  // Relink mode: salvage on-disk PNGs into the manifest, no API. Used to recover
  // sprites from a run that crashed before persisting (and to re-index after a
  // recipe bump where the pixels are still valid).
  if (relink) {
    let n = 0;
    for (const preset of presets) if (await relinkOne(preset, manifest)) n++;
    await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Relinked ${n} sprite(s) from disk. ${Object.keys(manifest.entries).length} in the library now. $0 spent.`);
    return;
  }

  // Build the job list: bare presets, or — in matrix mode — the default variant DB
  // (poor/rich/ruined cuts per building + every plant stage), restricted to any
  // types named on the CLI. Each job carries a label + a thunk that seeds it.
  type Job = { label: string; run: () => Promise<SeedOutcome> };
  let jobs: Job[];
  if (matrix) {
    const want = new Set(wanted);
    const specs = defaultVariantMatrix().filter(s => !want.size || want.has(s.type));
    const variants = planVariants(specs, BUILDING_IMAGE_MODEL);
    console.log(`Matrix: ${variants.length} variants across ${specs.length} types.`);
    jobs = variants.map(v => ({ label: v.label, run: () => seedVariant(v, manifest) }));
  } else {
    jobs = presets.map(p => ({ label: p, run: () => seed(p, manifest) }));
  }

  let total = 0;
  const failed: string[] = [];
  const before = Object.keys(manifest.entries).length;
  // Held in an object (not bare `let`) so the type survives the worker-closure
  // boundary — TS control-flow can't see a closure's assignment to an outer
  // `let`, and would collapse it to `never` at the guard below.
  const abort: { err: BuildingImageError | null; at: string | null } = { err: null, at: null };

  // Serialize manifest writes behind a promise chain: at most one write in
  // flight, each a COMPLETE in-memory snapshot. JS is single-threaded, so
  // JSON.stringify captures the shared manifest atomically between awaits;
  // chaining the writes means two workers can never interleave a half-written
  // file. Crash-safe — every persisted file is a superset of prior work.
  let writeChain: Promise<void> = Promise.resolve();
  const persist = (): Promise<void> =>
    (writeChain = writeChain.then(() => writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')));

  // Bounded worker pool over the job list. img2img is network-bound, so
  // overlapping calls is a real wall-time win (esp. --matrix). CONCURRENCY
  // multiplies the SPEND RATE (N calls burn budget N× faster), NOT the total —
  // default a conservative 4, tunable via SEED_CONCURRENCY; if OpenRouter 429s,
  // dial it down. --plan stays serial so the dry run prints in order. A fatal
  // error (spend limit / bad key) sets `aborted`, which stops workers from
  // pulling new jobs; in-flight jobs drain.
  const CONCURRENCY = plan ? 1 : Math.max(1, Number(process.env.SEED_CONCURRENCY) || 4);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < jobs.length && !abort.err) {
      const job = jobs[cursor++];
      try {
        const { cost, status } = await job.run();
        total += cost;
        if (plan) continue;
        if (status === 'seeded') await persist();      // crash-safe incremental write
        else if (status === 'failed') failed.push(job.label);
      } catch (err) {
        // Fatal (spend limit / bad key): every later job would fail too — stop
        // scheduling. Work done so far is already persisted by prior workers.
        if (err instanceof BuildingImageError && err.fatal) { abort.err = err; abort.at = job.label; return; }
        throw err;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  await writeChain;   // flush the last queued incremental write

  if (plan) { console.log('(plan mode — nothing written, nothing spent)'); return; }
  await persist();    // final full snapshot (also persists the recipe-version prune above)
  await writeChain;
  const added = Object.keys(manifest.entries).length - before;
  console.log(`Done. ${Object.keys(manifest.entries).length} sprites in the library (+${added} this run), $${total.toFixed(4)} spent.`);
  if (failed.length) console.error(`Skipped (gen failed, retryable): ${failed.join(', ')}`);
  if (abort.err) {
    console.error(`\n⛔ ABORTED at "${abort.at}" — ${abort.err.hint}.`);
    console.error(`   ${abort.err.message}`);
    console.error(`   Fix it here: ${abort.err.helpUrl}`);
    console.error(`   Then resume (already-seeded variants are skipped): npx tsx scripts/seed-building-art.ts${matrix ? ' --matrix' : ''}`);
    process.exitCode = 1;
  }
}

main().catch(err => { console.error(err); process.exit(1); });
