/**
 * Seed the vendored NPC-sprite base library through the G0 pipeline
 * (`src/assetgen/npc-sprite-pipeline.ts`: rig frame → chroma-margined init →
 * img2img → key → border + silhouette-IoU + shimmer gates → register onto the
 * rig alpha → one shared palette) — the author-time counterpart of
 * `scripts/seed-building-art.ts`, mirroring its shape exactly.
 *
 *   REPLICATE_API_TOKEN=… npx tsx scripts/seed-npc-art.ts [--force]
 *   npx tsx scripts/seed-npc-art.ts --plan        # no key: print key/seed/prompt per target, no API calls
 *
 * The default model (NPC_IMAGE_MODEL, `src/llm/npc-image.ts`) is
 * qwen-image-edit-2511 on Replicate — REPLICATE_API_TOKEN is required;
 * OPENROUTER_API_KEY only matters for a non-qwen model override, same rule as
 * the building seeder.
 *
 * THIS IS THE ONLY PLACE MONEY MOVES IN THE NPC-ART EPIC. There is
 * deliberately no `--go`/autonomous-batch flag: a human types the token, reads
 * what `--plan` printed first, and runs it themselves. `--force` re-spends on
 * a key already in the manifest; everything else is skip-if-present.
 *
 * Writes public/asset-library/npc-sprites/{manifest.json, <key>.png}. A
 * manifest row's `file` IS `NpcSheetResult.strip` — frames laid out left to
 * right, exactly what a spritesheet consumer wants, exactly what
 * `assembleStrip` inside the pipeline already produced.
 *
 * TARGETS ARE A SMALL, EXPLICIT TABLE (`NPC_SEED_TARGETS` below) — not a sweep
 * over every clip × facing × subject the rig could produce. Every entry is a
 * real backend call per frame (`NPC_MAX_FRAME_ATTEMPTS` retries each), so the
 * table stays short on purpose; grow it deliberately, with the user's
 * confirmation, after a funded run's `shimmer` number has actually calibrated
 * the still-untuned gate constants (G0's second honest limit) rather than
 * before.
 *
 * The pure parts — the target table, key derivation, the wardrobe hash, the
 * plan-mode print, and manifest row construction — are exported at module
 * scope so tests can exercise them with zero backend calls; only `main()`
 * touches the network or a token, and only runs when this file is the
 * process entry point (the `seed-parametric-sprites.ts` guard), so importing
 * this module for its pure exports never spends anything.
 */
import { mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { PNG } from 'pngjs';

import type { AssetLineage, AssetProvider } from '@/core/types';
import { NPC_ART_RECIPE_VERSION } from '@/core/content-version';
import { NPC_IMAGE_MODEL } from '@/llm/npc-image';
import { isReplicateImageModel } from '@/llm/image-dispatch';
import { BuildingImageError } from '@/llm/openrouter-image-client';
import { createSpriteBackend } from '@/assetgen/compilers/backend-registry';
import type { SpriteJobField } from '@/assetgen/compilers/backend';
import {
  generateNpcSheet, npcSheetSeed,
  type NpcSheetResult,
} from '@/assetgen/npc-sprite-pipeline';
import { npcImagePrompt, type NpcSubject } from '@/assetgen/npc-image-prompt';
import { bakeClip, type Clip } from '@/render/paperdoll/rig';
import { DEFAULT_HUMANOID_LAYERS, HUMANOID_SOURCE, CLIP_PRAY_RAISE, CLIP_IDLE_SHIFT } from '@/render/paperdoll/lpc-humanoid';
import { IMPORTED_CLIPS } from '@/render/paperdoll/clips';
import type { Raster } from '@/render/sprite-postprocess';
import { RIG, RIG_CELL, RIG_FACINGS, type RigFacing, cellAt, loadDefaultWardrobeSheets } from './lib/rig-bake-node';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/asset-library/npc-sprites');
const MANIFEST = join(OUT, 'manifest.json');

/** Cache keys embed clip/facing (ASCII already) but stay through the same
 *  sanitizer as the building seeder's `safeName` for parity and in case a
 *  future subject id is not filesystem-clean. */
const safeName = (key: string) => key.replace(/[^a-zA-Z0-9._-]/g, '_');

// ---------------------------------------------------------------------------
// Pure — target table, key/seed derivation, plan-mode text, manifest rows.
// Nothing below this line touches a network, a file, or an env var, so it is
// safe to import from a test.
// ---------------------------------------------------------------------------

/** One sheet to seed: who, doing what, seen from where. */
export interface NpcSeedTarget {
  readonly subject: NpcSubject;
  /** Clip name — must exist in `IMPORTED_CLIPS` or be one of the hand-authored
   *  devotional clips (`pray-raise`, `idle-shift`) `rig-rows.ts` bakes onto
   *  every live NPC. */
  readonly clip: string;
  /** Must be a facing THIS clip actually bakes — see `availableFacings`. */
  readonly facing: RigFacing;
}

/**
 * Deliberately ONE sheet by default. Every target here is real spend —
 * `pray-raise` is 7 frames, each up to `NPC_MAX_FRAME_ATTEMPTS` (2) backend
 * calls, so this one target is 7–14 calls (~$0.03/call on qwen ⇒ roughly
 * $0.21–$0.42 worst case) before the shimmer gate has ever seen a real
 * generation to calibrate against (G0's second honest limit). Per the Phase G
 * risk note, Tier-1 img2img suits SLOW/stately motion first — worship,
 * procession — which is why this is a prayer pose and not a walk cycle. Add
 * more targets deliberately, with the user's confirmation, once this run's
 * numbers say the gates are trustworthy — never as a batch, never via a
 * `--go` flag (there isn't one).
 */
export const NPC_SEED_TARGETS: readonly NpcSeedTarget[] = [
  {
    subject: {
      id: 'rival-acolyte',
      name: 'an acolyte of a rival cult',
      wears: [
        'a dark hooded cassock cinched with a rope belt',
        'a bone talisman on a cord at the throat',
        'wrapped leather sandals',
      ],
      note: 'A different faith practising the same gesture — the wardrobe should read as a rival cult, not our own believers.',
    },
    clip: 'pray-raise',
    facing: 'down',
  },
];

/** The facings a given clip name actually bakes for the humanoid rig. Empty
 *  for an unknown clip — never a guess. Imported clips (`IMPORTED_CLIPS`) bake
 *  all three authored angles; the hand-authored devotional clips only bake
 *  south/north (`rig-rows.ts`'s `RIG_ROW_CLIPS`) because the west template is a
 *  different chip vocabulary neither clip is authored against
 *  (`rig-catalog.ts`'s `clipsFor` filters them out there). */
export function availableFacings(clip: string): readonly RigFacing[] {
  if (clip in IMPORTED_CLIPS) return RIG_FACINGS;
  if (clip === CLIP_PRAY_RAISE.name || clip === CLIP_IDLE_SHIFT.name) return ['down', 'up'];
  return [];
}

/** The actual `Clip` to bake for a (clip name, facing) pair, or undefined when
 *  the rig has no bake for that combination — see `availableFacings`. */
export function clipFor(clip: string, facing: RigFacing): Clip | undefined {
  const imported = IMPORTED_CLIPS[clip];
  if (imported) return imported[facing];
  if (facing !== 'down' && facing !== 'up') return undefined;
  if (clip === CLIP_PRAY_RAISE.name) return CLIP_PRAY_RAISE;
  if (clip === CLIP_IDLE_SHIFT.name) return CLIP_IDLE_SHIFT;
  return undefined;
}

/** Library key: recipe-versioned so a bump re-rolls instead of resurrecting
 *  art made under rules that no longer hold, same convention as the building
 *  seeder's `generatedArtKey`. */
export function npcArtKey(target: NpcSeedTarget): string {
  return `${NPC_ART_RECIPE_VERSION}:${target.subject.id}:${target.clip}:${target.facing}`;
}

/**
 * Deterministic stand-in for "which wardrobe was this baked from" — the other
 * half of `npcSheetSeed`. Only one wardrobe exists today (`DEFAULT_HUMANOID_
 * LAYERS`), so this hashes its spec (path + chip assignment per layer) rather
 * than pixels; a future per-subject wardrobe would hash ITS spec the same way.
 * Pure — reads only static layer specs, no disk access.
 */
export function wardrobeLayerHash(): string {
  const spec = DEFAULT_HUMANOID_LAYERS.map((l) => `${l.path}|${l.assign ?? ''}`).join(',');
  let h = 0x811c9dc5;
  for (const ch of spec) h = Math.imul(h ^ (ch.codePointAt(0) ?? 0), 0x01000193) >>> 0;
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * What `--plan` prints, per target: the library key, the derived seed, the
 * frame count, and the prompt for frame 0 — the ONE prompt the pipeline
 * actually sends for every frame of the sheet (`NpcSheetJob.prompt` is a
 * single string reused across the whole cycle; see the report on this in the
 * script's tail comment for why "frame 0" is the whole story, not a sample).
 * Pure: no backend, no `SpriteBackend` import reachable from this function.
 */
export function planLines(targets: readonly NpcSeedTarget[]): string[] {
  const layerSetHash = wardrobeLayerHash();
  const lines: string[] = [];
  for (const target of targets) {
    const key = npcArtKey(target);
    const clip = clipFor(target.clip, target.facing);
    if (!clip) {
      lines.push(`${key}: SKIPPED — '${target.clip}' has no bake for facing '${target.facing}'`);
      continue;
    }
    const seed = npcSheetSeed(target.clip, layerSetHash);
    const prompt = npcImagePrompt({
      subject: target.subject,
      clip: target.clip,
      facing: target.facing,
      model: NPC_IMAGE_MODEL,
      frame: 0,
      frames: clip.frames,
    });
    lines.push(`${key}: seed ${seed} · ${clip.frames} frames · cell ${RIG_CELL}px`);
    lines.push(`  prompt: ${prompt}`);
  }
  return lines;
}

/** One manifest row. `seedReproducible` sits beside `seed` on purpose — G0's
 *  first honest limit is that every shipped img2img editor declares
 *  `seed: false`, so `seed` alone would otherwise silently imply a
 *  reproducibility this pipeline usually cannot deliver. */
export interface NpcManifestEntry {
  file: string;
  subjectId: string;
  subjectName: string;
  clip: string;
  facing: RigFacing;
  provider: AssetProvider;
  model: string;
  seed: number;
  seedReproducible: boolean;
  lineage: AssetLineage;
  recipeVersion: string;
  frames: number;
  cellSize: number;
  shimmer: number;
  sourceShimmer: number;
  iou: number[];
  costUsd: number;
  attempts: number;
  ignored: SpriteJobField[];
}

export interface NpcManifest {
  model: string;
  recipeVersion: string;
  entries: Record<string, NpcManifestEntry>;
}

/** Build the manifest row for a finished sheet. Pure: takes the already-
 *  validated pipeline result, invents nothing. */
export function buildManifestRow(
  target: NpcSeedTarget,
  key: string,
  result: NpcSheetResult,
): NpcManifestEntry {
  return {
    file: `${safeName(key)}.png`,
    subjectId: target.subject.id,
    subjectName: target.subject.name,
    clip: target.clip,
    facing: target.facing,
    provider: result.provider,
    model: result.model,
    seed: result.seed,
    seedReproducible: !result.ignored.includes('seed'),
    lineage: result.lineage,
    recipeVersion: result.recipeVersion,
    frames: result.frames.length,
    cellSize: result.frames[0]?.w ?? RIG_CELL,
    shimmer: result.shimmer,
    sourceShimmer: result.sourceShimmer,
    iou: result.iou,
    costUsd: result.costUsd,
    attempts: result.attempts,
    ignored: [...result.ignored],
  };
}

// ---------------------------------------------------------------------------
// Node-only — PNG encode/decode. Pure with respect to state (no I/O by
// themselves), kept separate from the pipeline `deps` wiring below for
// readability.
// ---------------------------------------------------------------------------

function toPng(r: Raster): Buffer {
  const png = new PNG({ width: r.w, height: r.h });
  png.data = Buffer.from(r.data.buffer, r.data.byteOffset, r.data.byteLength);
  return PNG.sync.write(png);
}

function fromPng(buf: Buffer): Raster {
  const png = PNG.sync.read(buf);
  return { data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength), w: png.width, h: png.height };
}

async function decodeImage(blob: Blob): Promise<Raster | null> {
  try {
    return fromPng(Buffer.from(await blob.arrayBuffer()));
  } catch {
    return null;
  }
}

async function encodeInit(r: Raster): Promise<string | null> {
  return `data:image/png;base64,${toPng(r).toString('base64')}`;
}

async function loadManifest(): Promise<NpcManifest> {
  try { return JSON.parse(await readFile(MANIFEST, 'utf8')) as NpcManifest; }
  catch { return { model: NPC_IMAGE_MODEL, recipeVersion: NPC_ART_RECIPE_VERSION, entries: {} }; }
}

// ---------------------------------------------------------------------------
// main() — the only function that reads argv/env or spends anything. Guarded
// at the bottom so importing this module (tests, or a future caller wanting
// the pure exports) never runs it.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const plan = args.includes('--plan');
  const force = args.includes('--force');

  if (plan) {
    console.log(planLines(NPC_SEED_TARGETS).join('\n'));
    console.log('\n(plan mode — nothing written, nothing spent)');
    return;
  }

  // Same rule as seed-building-art.ts: the default model is Replicate-hosted
  // (qwen) → REPLICATE_API_TOKEN pays; OPENROUTER_API_KEY only matters for a
  // non-qwen override. Checked here, not at module scope, so importing this
  // file for its pure exports never touches process.exit.
  const modelIsReplicate = isReplicateImageModel(NPC_IMAGE_MODEL);
  const apiKey = process.env.OPENROUTER_API_KEY;
  const replicateToken = process.env.REPLICATE_API_TOKEN;
  if (modelIsReplicate && !replicateToken) {
    console.error(`REPLICATE_API_TOKEN not set (${NPC_IMAGE_MODEL} is Replicate-hosted). Aborting — nothing spent.`);
    process.exit(1);
  }
  if (!modelIsReplicate && !apiKey) {
    console.error('OPENROUTER_API_KEY not set. Aborting — nothing spent.');
    process.exit(1);
  }

  mkdirSync(OUT, { recursive: true });
  const manifest = await loadManifest();
  manifest.model = NPC_IMAGE_MODEL;
  manifest.recipeVersion = NPC_ART_RECIPE_VERSION;
  // Keys embed the recipe version — prune entries from older recipes so the
  // manifest doesn't accumulate unmatchable rows (PNGs stay on disk, harmless).
  for (const k of Object.keys(manifest.entries)) {
    if (!k.startsWith(`${NPC_ART_RECIPE_VERSION}:`)) delete manifest.entries[k];
  }

  const provider: AssetProvider = modelIsReplicate ? 'replicate' : 'openrouter';
  const backend = createSpriteBackend(provider, {
    img2img: {
      model: NPC_IMAGE_MODEL,
      providers: { openrouter: { apiKey: apiKey ?? '' }, replicate: { apiToken: replicateToken } },
    },
  });

  const sheets = await loadDefaultWardrobeSheets();
  const layerSetHash = wardrobeLayerHash();

  let total = 0;
  const failed: string[] = [];
  for (const target of NPC_SEED_TARGETS) {
    const key = npcArtKey(target);
    if (!force && manifest.entries[key]) { console.log(`${key}: already seeded`); continue; }

    const clip = clipFor(target.clip, target.facing);
    if (!clip) { console.warn(`${key}: SKIPPED — '${target.clip}' has no bake for facing '${target.facing}'`); continue; }

    const { template, row } = RIG[target.facing];
    const layers = sheets.map((sheet, i) => ({
      raster: cellAt(sheet, HUMANOID_SOURCE.col, row),
      assign: DEFAULT_HUMANOID_LAYERS[i].assign,
    }));
    const frames = bakeClip(template, layers, clip);
    const prompt = npcImagePrompt({
      subject: target.subject,
      clip: target.clip,
      facing: target.facing,
      model: NPC_IMAGE_MODEL,
      frame: 0,
      frames: frames.length,
    });

    let result: NpcSheetResult | null;
    try {
      result = await generateNpcSheet(
        { clip: target.clip, layerSetHash, prompt, frames },
        { backend, decodeImage, encodeInit, onNote: (m) => console.log(m) },
      );
    } catch (err) {
      // Fatal (spend limit / bad key): every later target would fail the same
      // way — stop rather than burning attempts and quota on the rest.
      if (err instanceof BuildingImageError && err.fatal) {
        console.error(`\n⛔ ABORTED at "${key}" — ${err.hint}.`);
        console.error(`   ${err.message}`);
        console.error(`   Fix it here: ${err.helpUrl}`);
        process.exitCode = 1;
        break;
      }
      console.error(`${key}: generation error: ${(err as Error).message}`);
      failed.push(key);
      continue;
    }

    if (!result) { console.error(`${key}: FAILED — gates rejected every attempt, not seeded`); failed.push(key); continue; }

    total += result.costUsd;
    await writeFile(join(OUT, `${safeName(key)}.png`), toPng(result.strip));
    manifest.entries[key] = buildManifestRow(target, key, result);
    await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
    console.log(
      `${key}: seeded ${safeName(key)}.png (${result.frames.length} frames, shimmer ${result.shimmer.toFixed(4)}` +
        `, IoU ${Math.min(...result.iou).toFixed(3)}–${Math.max(...result.iou).toFixed(3)}, $${result.costUsd.toFixed(4)})`,
    );
  }

  console.log(`\nDone. ${Object.keys(manifest.entries).length} sheet(s) in the library, $${total.toFixed(4)} spent this run.`);
  if (failed.length) {
    console.error(`Not seeded (gate rejected or errored, retryable): ${failed.join(', ')}`);
    process.exitCode = 1;
  }
}

// Only run the seeder when executed directly — the pure exports above (target
// table, key/seed derivation, plan text, manifest row shape) are importable
// for tests with zero backend calls, the same guard `seed-parametric-
// sprites.ts` uses.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e: unknown) => { console.error(e); process.exit(1); });
}
