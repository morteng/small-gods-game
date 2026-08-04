/**
 * G0 — the rig-frame → img2img NPC sprite pipeline.
 *
 * The building pipeline's shape, applied to a subject that differs from a
 * building in one decisive way: **we already have the picture.** A composed
 * building is grey massing that the paint model must invent a material for. A
 * baked rig frame is finished pixel art in the right palette, in the right
 * pose, at the right size — the model is not being asked what this thing looks
 * like, only to redress a character we already drew. So the init image is
 * strong, the acceptable drift is small, and the rig's alpha stays
 * authoritative throughout (`registerAlbedo`, exactly as geometry alpha is for
 * buildings): the model contributes COLOUR, never silhouette.
 *
 * This module is PURE UNTIL THE BACKEND CALL. Every environment-bound
 * capability — decoding a PNG, encoding one, the generator itself — arrives
 * through `NpcSheetDeps`, so the same code runs in the browser (G2's runtime
 * source), in a Node author-time script (G1's seeder, which has `pngjs` and no
 * canvas), and in tests against the mock backend. It also never persists
 * anything: it returns a validated sheet or null, which is validate-BEFORE-
 * persist by construction rather than by discipline.
 *
 * THREE HONEST LIMITS, stated here because each one is a thing a reader would
 * otherwise assume we had:
 *
 * 1. **The seed is very likely ignored.** `npcSheetSeed` derives one seed per
 *    SHEET so that all its frames are generated alike — but every img2img
 *    editor we ship declares `seed: false` (`IMG2IMG_CAPABILITIES`), so the
 *    seed reaches nothing and the result says so in `ignored`. Temporal
 *    coherence therefore rests on the three mechanisms that DO work: the rig
 *    alpha being authoritative, one shared palette across the sheet, and
 *    consecutive frames differing only slightly in their init. The seed is
 *    carried anyway because a seed-capable backend (PixelLab, a local SD) is
 *    already reachable through the same seam, and a sheet generated without one
 *    must be recorded as unseeded rather than assumed reproducible.
 *
 * 2. **The shimmer gate has never seen a real generation.** `NPC_MAX_SHIMMER`
 *    is a first guess. It is deliberately loose and the measured value is
 *    reported on every result, success or failure, so the first funded run
 *    produces the number to tune it with instead of merely passing or failing.
 *
 * 3. **A magenta wardrobe cannot go through this pipeline.** The chroma key
 *    that separates subject from background does not know that this violet is
 *    a cloak and that one is the backdrop. Rather than punch a hole through a
 *    character and gate on the damage afterwards, `prepareFrame` refuses up
 *    front — before any spend — and names the colour collision.
 *
 * What this module does NOT do, on purpose: no interior-tearing gate. That
 * instrument (`fragmentation` in `clip-measure.ts`) earned its place in M4
 * because a chip decomposition can drop pixels INSIDE a silhouette that IoU
 * scores as fine. It has nothing to measure here — `registerAlbedo` forces
 * alpha to the mask across the eroded core and clips to it at the edge, so an
 * interior hole is not a thing the output can contain. IoU measured BEFORE
 * that negotiation is the real question ("did the model repaint this pose, or
 * paint a different one?"), and that is what gates.
 */
import { NPC_ART_RECIPE_VERSION } from '@/core/content-version';
import type { AssetLineage, AssetProvider } from '@/core/types';
import { chromaKeyMagenta, chromaWouldKey, compositeOverChroma } from '@/render/chroma-key';
import {
  type Raster,
  cropRaster,
  borderKeyedFraction,
  opaqueBBox,
  quantizePaletteOklab,
  registerAlbedo,
  rgbToOklab,
} from '@/render/sprite-postprocess';
import type { SpriteBackend, SpriteJob, SpriteJobField } from './compilers/backend';

/** Minimum fraction of the generated image's border ring that must key out —
 *  did the model honour the magenta backdrop, or paint a scene behind our NPC?
 *  Same value and same reasoning as the building pipeline's gate. */
export const NPC_MIN_BORDER_KEYED = 0.6;

/**
 * Minimum silhouette agreement (alpha IoU, measured after crop+scale
 * normalisation and BEFORE alpha negotiation) between the generation and the
 * rig frame that seeded it.
 *
 * Set ABOVE the building gate's 0.9 on purpose. A building init is grey massing
 * and the model is inventing surface; an NPC init is a finished 64px character
 * and the model is redressing it. Drift that reads as artistic licence on a
 * roofline reads as a different person on a 24-pixel-wide body, and a walk
 * cycle whose frames disagree about where the legs are is not a walk cycle.
 */
export const NPC_MIN_SILHOUETTE_IOU = 0.93;

/** Palette size for the ONE quantize pass over the assembled sheet. Half the
 *  building pipeline's 64: a character cell is a fraction of a building's area
 *  and shares its whole palette across every frame, so a wide palette buys
 *  per-frame noise rather than fidelity. */
export const NPC_QUANT_COLORS = 32;

/**
 * Ceiling on mean frame-to-frame colour distance (Oklab) across the generated
 * sheet, as a MULTIPLE of the same measure on the rig frames that seeded it.
 *
 * Per-frame generation's known weakness is shimmer: neighbouring frames come
 * back subtly different and the sprite boils. The source sheet already moves —
 * a limb swings, pixels change — so the honest question is not "did anything
 * change?" but "did the generation add change the animation did not ask for?"
 *
 * FIRST GUESS, no live evidence. See limit 2 in the header.
 */
export const NPC_MAX_SHIMMER = 2.5;

/** Floor under the shimmer comparison, in Oklab units. A near-static clip
 *  (`idle-shift`) has almost no source movement, and a pure ratio against
 *  almost-zero is a gate no generation could ever pass. */
export const NPC_SHIMMER_FLOOR = 0.04;

/** Long-side pixel target for the init image. A 64px cell — and a pose bbox
 *  inside it is smaller still — sits well below every image model's native
 *  band, where they hallucinate detail rather than edit. */
export const NPC_INIT_TARGET_PX = 512;

/** Chroma margin around the upscaled subject, as a fraction of its long side.
 *  Without it the figure touches all four borders, `borderKeyedFraction` reads
 *  ~0 on a perfect generation, and the gate rejects good art for a framing
 *  choice we made. */
export const NPC_INIT_MARGIN_FRAC = 0.08;

/** Absolute floor for that margin, in output pixels. */
export const NPC_INIT_MARGIN_MIN_PX = 8;

/** Attempts per FRAME before the sheet is abandoned. The model is
 *  nondeterministic, so one re-roll is worth its cost; a second is buying
 *  lottery tickets with the user's money. */
export const NPC_MAX_FRAME_ATTEMPTS = 2;

/** Every NPC sheet is repainted from an LPC-derived rig frame, so the result
 *  inherits LPC's share-alike obligation. Not a parameter — a fact about the
 *  input, which is why it is a constant here and not a caller's choice. */
export const NPC_SHEET_LINEAGE: AssetLineage = 'lpc-derived';

// ---------------------------------------------------------------------------
// Pure geometry helpers (exported for tests, and for the studio lane that will
// want to show each stage)
// ---------------------------------------------------------------------------

/** Integer nearest-neighbour upscale. Integer and nearest are both required:
 *  a fractional or filtered scale puts colours in the init that are in neither
 *  the source palette nor any pixel grid, and the model faithfully repaints the
 *  blur. */
export function nearestUpscale(r: Raster, factor: number): Raster {
  const f = Math.max(1, Math.floor(factor));
  if (f === 1) return { data: new Uint8ClampedArray(r.data), w: r.w, h: r.h };
  const w = r.w * f, h = r.h * f;
  const out: Raster = { data: new Uint8ClampedArray(w * h * 4), w, h };
  for (let y = 0; y < h; y++) {
    const sy = Math.floor(y / f);
    for (let x = 0; x < w; x++) {
      const s = (sy * r.w + Math.floor(x / f)) * 4;
      const d = (y * w + x) * 4;
      out.data[d] = r.data[s];
      out.data[d + 1] = r.data[s + 1];
      out.data[d + 2] = r.data[s + 2];
      out.data[d + 3] = r.data[s + 3];
    }
  }
  return out;
}

/** The largest integer factor that keeps the long side at or under `target`,
 *  never below 1 (a subject already larger than the target is left alone rather
 *  than downscaled — it is the model's problem to be given too much, not too
 *  little). */
export function upscaleFactorFor(w: number, h: number, target = NPC_INIT_TARGET_PX): number {
  return Math.max(1, Math.floor(target / Math.max(1, Math.max(w, h))));
}

/** Surround with fully transparent pixels. */
export function padRaster(r: Raster, margin: number): Raster {
  const m = Math.max(0, Math.round(margin));
  if (m === 0) return { data: new Uint8ClampedArray(r.data), w: r.w, h: r.h };
  const w = r.w + m * 2, h = r.h + m * 2;
  const out: Raster = { data: new Uint8ClampedArray(w * h * 4), w, h };
  for (let y = 0; y < r.h; y++) {
    const src = y * r.w * 4;
    out.data.set(r.data.subarray(src, src + r.w * 4), ((y + m) * w + m) * 4);
  }
  return out;
}

/** Draw `src` into a fresh `w`×`h` transparent cell with its top-left at
 *  (x, y) — the inverse of the crop that produced it, so a registered sprite
 *  lands back on the animation grid it came off. */
export function pasteInto(src: Raster, w: number, h: number, x: number, y: number): Raster {
  const out: Raster = { data: new Uint8ClampedArray(w * h * 4), w, h };
  for (let sy = 0; sy < src.h; sy++) {
    const dy = y + sy;
    if (dy < 0 || dy >= h) continue;
    for (let sx = 0; sx < src.w; sx++) {
      const dx = x + sx;
      if (dx < 0 || dx >= w) continue;
      const s = (sy * src.w + sx) * 4, d = (dy * w + dx) * 4;
      out.data[d] = src.data[s];
      out.data[d + 1] = src.data[s + 1];
      out.data[d + 2] = src.data[s + 2];
      out.data[d + 3] = src.data[s + 3];
    }
  }
  return out;
}

/** Lay frames out left to right, one row. Throws on a ragged sheet rather than
 *  silently cropping — a mismatched frame means the caller baked two different
 *  templates into one sheet, and that is worth stopping for. */
export function assembleStrip(frames: readonly Raster[]): Raster {
  if (frames.length === 0) throw new Error('assembleStrip: no frames');
  const { w, h } = frames[0];
  for (const f of frames) {
    if (f.w !== w || f.h !== h) throw new Error('assembleStrip: frames differ in size');
  }
  const out: Raster = { data: new Uint8ClampedArray(w * frames.length * h * 4), w: w * frames.length, h };
  frames.forEach((f, i) => {
    for (let y = 0; y < h; y++) {
      const src = y * w * 4;
      out.data.set(f.data.subarray(src, src + w * 4), (y * out.w + i * w) * 4);
    }
  });
  return out;
}

/** Cut a strip back into `count` equal cells. */
export function sliceStrip(strip: Raster, count: number): Raster[] {
  const w = strip.w / count;
  if (!Number.isInteger(w)) throw new Error('sliceStrip: strip width is not a multiple of the frame count');
  return Array.from({ length: count }, (_, i) => cropRaster(strip, { x: i * w, y: 0, w, h: strip.h }));
}

/**
 * One seed per SHEET, derived rather than random so the same sheet asked for
 * twice is the same request twice. FNV-1a over the identity triple; the recipe
 * version is in there so a recipe bump re-rolls instead of resurrecting art
 * made under rules that no longer hold.
 */
export function npcSheetSeed(
  clip: string,
  layerSetHash: string,
  recipeVersion: string = NPC_ART_RECIPE_VERSION,
): number {
  let h = 0x811c9dc5;
  for (const ch of `${clip}|${layerSetHash}|${recipeVersion}`) {
    h = Math.imul(h ^ (ch.codePointAt(0) ?? 0), 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Mean Oklab distance between two frames over pixels opaque in BOTH — the
 * per-pair term behind `sheetShimmer`. Pixels opaque in only one frame are
 * skipped deliberately: a swinging limb uncovers background, and counting that
 * as colour change would make every animated clip look like it shimmers.
 */
export function meanFrameDistance(a: Raster, b: Raster): number {
  if (a.w !== b.w || a.h !== b.h) throw new Error('meanFrameDistance: dimension mismatch');
  let sum = 0, n = 0;
  for (let i = 0; i < a.w * a.h; i++) {
    const o = i * 4;
    if (a.data[o + 3] < 8 || b.data[o + 3] < 8) continue;
    const [al, aa, ab] = rgbToOklab(a.data[o], a.data[o + 1], a.data[o + 2]);
    const [bl, ba, bb] = rgbToOklab(b.data[o], b.data[o + 1], b.data[o + 2]);
    sum += Math.hypot(al - bl, aa - ba, ab - bb);
    n++;
  }
  return n === 0 ? 0 : sum / n;
}

/** Mean colour distance between consecutive frames. Zero for a single frame —
 *  a one-frame sheet cannot shimmer. */
export function sheetShimmer(frames: readonly Raster[]): number {
  if (frames.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < frames.length; i++) sum += meanFrameDistance(frames[i - 1], frames[i]);
  return sum / (frames.length - 1);
}

/** Fraction of a frame's OPAQUE pixels that the chroma key would erase or
 *  fringe. Anything above zero means the subject and the backdrop share a
 *  colour; see limit 3 in the header. */
export function chromaCollisionFraction(r: Raster): number {
  let hit = 0, n = 0;
  for (let i = 0; i < r.w * r.h; i++) {
    const o = i * 4;
    if (r.data[o + 3] < 8) continue;
    n++;
    if (chromaWouldKey(r.data[o], r.data[o + 1], r.data[o + 2])) hit++;
  }
  return n === 0 ? 0 : hit / n;
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

/** One frame, prepared for generation: what to send, and what to gate against. */
export interface NpcFramePrep {
  /** Where in the cell the pose sits — the offset the registered sprite is
   *  pasted back at, so the sheet keeps its animation grid. */
  bbox: { x: number; y: number; w: number; h: number };
  /** The pose cropped to its bbox: the mask `registerAlbedo` registers onto and
   *  the silhouette the IoU gate measures against. */
  mask: Raster;
  /** Upscaled, chroma-margined, composited over magenta — ready to encode. */
  init: Raster;
  /** Integer factor actually applied, recorded for the studio lane. */
  factor: number;
}

export interface NpcSheetJob {
  /** Clip name, e.g. 'march'. Half the sheet's identity, and half the seed. */
  clip: string;
  /** Hash of the wardrobe layer set this sheet was baked from — the other half.
   *  The caller owns the hashing; it already has the spec. */
  layerSetHash: string;
  /** What to paint. Built by the caller (G1/G2 own the prompt lore). */
  prompt: string;
  negative?: string;
  /** Rig-baked cells, in play order, all the same size. */
  frames: readonly Raster[];
  /** img2img adherence, 0 = keep the init. Low by design: we want a redress,
   *  not a reinterpretation. Backends without a strength control ignore it and
   *  say so. */
  denoise01?: number;
}

export interface NpcSheetDeps {
  backend: SpriteBackend;
  /** Blob → pixels. Browser: `decodePngToRaster`. Node: pngjs. */
  decodeImage(blob: Blob): Promise<Raster | null>;
  /** Pixels → 'data:image/png;base64,…'. Same split. */
  encodeInit(r: Raster): Promise<string | null>;
  /** Diagnostics. Every gate failure and every measured number arrives here;
   *  nothing is swallowed. */
  onNote?(msg: string): void;
  signal?: AbortSignal;
}

export interface NpcSheetResult {
  /** Registered, cell-sized, sharing the sheet's one palette. */
  frames: Raster[];
  /** The same frames as one row — what a spritesheet consumer wants. */
  strip: Raster;
  seed: number;
  provider: AssetProvider;
  model: string;
  lineage: AssetLineage;
  recipeVersion: string;
  /** Summed across frames where the backend reported any. */
  costUsd: number;
  /** Union of job fields no backend could honour, deduped and stable-ordered.
   *  A sheet recorded as seeded when `'seed'` is in here would be a lie. */
  ignored: SpriteJobField[];
  /** Total backend calls, including re-rolls. The spend receipt. */
  attempts: number;
  /** Measured, always — including on the run that failed the gate. */
  shimmer: number;
  sourceShimmer: number;
  /** Per-frame silhouette agreement of the accepted attempt. */
  iou: number[];
}

/**
 * Everything that happens to a frame before a request is made. Returns a
 * refusal string instead of a prep when this frame cannot honestly be
 * generated — empty, or wearing the key colour.
 */
export function prepareFrame(frame: Raster): NpcFramePrep | string {
  const bb = opaqueBBox(frame);
  if (!bb) return 'the rig frame is empty — nothing to repaint';
  const mask = cropRaster(frame, bb);
  const collision = chromaCollisionFraction(mask);
  if (collision > 0) {
    return `${(collision * 100).toFixed(1)}% of the pose wears the chroma key colour, which the keyer would erase from the result`;
  }
  const factor = upscaleFactorFor(mask.w, mask.h);
  const up = nearestUpscale(mask, factor);
  const margin = Math.max(NPC_INIT_MARGIN_MIN_PX, Math.round(Math.max(up.w, up.h) * NPC_INIT_MARGIN_FRAC));
  const padded = padRaster(up, margin);
  return {
    bbox: bb,
    mask,
    init: { data: compositeOverChroma(padded.data), w: padded.w, h: padded.h },
    factor,
  };
}

/** One backend call, keyed and gated. Returns the registered sprite (still at
 *  mask size) or a refusal string the caller notes and re-rolls on. */
async function attemptFrame(
  prep: NpcFramePrep,
  initDataUri: string,
  job: NpcSheetJob,
  seed: number,
  deps: NpcSheetDeps,
  acc: { cost: number; ignored: Set<SpriteJobField>; attempts: number },
): Promise<{ sprite: Raster; iou: number } | string> {
  const req: SpriteJob = {
    prompt: job.prompt,
    negative: job.negative,
    seed,
    init: { pngDataUri: initDataUri, denoise01: job.denoise01 },
    width: prep.init.w,
    height: prep.init.h,
    meta: { kind: 'npc-sprite', lineage: NPC_SHEET_LINEAGE, tags: ['npc', job.clip] },
    signal: deps.signal,
  };
  acc.attempts++;
  const res = await deps.backend.generate(req);
  acc.cost += res.costUsd ?? 0;
  for (const f of res.ignored) acc.ignored.add(f);

  const raw = await deps.decodeImage(res.blob);
  // A result that will not decode is environmental, not a bad roll — re-rolling
  // would only spend again to fail the same way.
  if (!raw) throw new Error('generated NPC frame could not be decoded');

  chromaKeyMagenta(raw.data);
  const border = borderKeyedFraction(raw);
  if (border < NPC_MIN_BORDER_KEYED) {
    return `background did not key out (ring ${border.toFixed(2)} < ${NPC_MIN_BORDER_KEYED})`;
  }
  const reg = registerAlbedo(raw, prep.mask);
  if (!reg) return 'nothing survived chroma keying';
  if (reg.iou < NPC_MIN_SILHOUETTE_IOU) {
    return `silhouette IoU ${reg.iou.toFixed(3)} < ${NPC_MIN_SILHOUETTE_IOU}`;
  }
  return { sprite: reg.sprite, iou: reg.iou };
}

/**
 * Generate one sheet: every frame, or none.
 *
 * All-or-nothing is the point. A cycle missing its third frame is not a
 * degraded animation, it is a broken one — and a caller holding a partial sheet
 * would have to invent a policy for the hole. Returning null keeps that
 * decision where it belongs (fall back to the rig bake, which is already
 * perfectly good art).
 *
 * The shimmer gate is checked once at the end and NEVER re-rolled: it is a
 * property of the sheet, not a per-frame fluke, and re-rolling it costs a whole
 * sheet's spend on the hope that the model behaves differently for no reason.
 */
export async function generateNpcSheet(
  job: NpcSheetJob,
  deps: NpcSheetDeps,
): Promise<NpcSheetResult | null> {
  const note = (m: string) => deps.onNote?.(`[npc-sprite ${job.clip}] ${m}`);
  if (job.frames.length === 0) { note('no frames'); return null; }

  const cell = { w: job.frames[0].w, h: job.frames[0].h };
  const seed = npcSheetSeed(job.clip, job.layerSetHash);
  const acc = { cost: 0, ignored: new Set<SpriteJobField>(), attempts: 0 };
  const out: Raster[] = [];
  const iou: number[] = [];

  for (const [i, frame] of job.frames.entries()) {
    if (frame.w !== cell.w || frame.h !== cell.h) {
      note(`frame ${i} is ${frame.w}x${frame.h}, sheet is ${cell.w}x${cell.h}`);
      return null;
    }
    const prep = prepareFrame(frame);
    if (typeof prep === 'string') { note(`frame ${i} refused: ${prep}`); return null; }
    const initDataUri = await deps.encodeInit(prep.init);
    if (!initDataUri) throw new Error('no PNG encoder for the NPC init image');

    let got: { sprite: Raster; iou: number } | null = null;
    for (let n = 1; n <= NPC_MAX_FRAME_ATTEMPTS && !got; n++) {
      const r = await attemptFrame(prep, initDataUri, job, seed, deps, acc);
      if (typeof r === 'string') note(`frame ${i} attempt ${n}: ${r}`);
      else got = r;
    }
    if (!got) { note(`frame ${i} failed every attempt — sheet abandoned`); return null; }
    out.push(pasteInto(got.sprite, cell.w, cell.h, prep.bbox.x, prep.bbox.y));
    iou.push(got.iou);
  }

  // ONE palette for the whole sheet: quantize the assembled strip, then cut it
  // back up. Per-frame quantization picks a slightly different palette per
  // frame from slightly different pixels, and the sprite boils.
  const strip = quantizePaletteOklab(assembleStrip(out), NPC_QUANT_COLORS, { dither: 'bayer4' });
  const frames = sliceStrip(strip, out.length);

  const shimmer = sheetShimmer(frames);
  const sourceShimmer = sheetShimmer(job.frames);
  const ceiling = Math.max(NPC_SHIMMER_FLOOR, sourceShimmer * NPC_MAX_SHIMMER);
  // Reported either way — a passing number is the calibration the constant is
  // still waiting for.
  note(`shimmer ${shimmer.toFixed(4)} vs source ${sourceShimmer.toFixed(4)} (ceiling ${ceiling.toFixed(4)})`);
  if (shimmer > ceiling) { note('sheet rejected: frames disagree more than the animation does'); return null; }

  const ignored = ([...acc.ignored] as SpriteJobField[]).sort();
  if (ignored.includes('seed')) note('generated WITHOUT a seed — this sheet is not reproducible');

  return {
    frames,
    strip,
    seed,
    provider: deps.backend.provider,
    model: deps.backend.model,
    lineage: NPC_SHEET_LINEAGE,
    recipeVersion: NPC_ART_RECIPE_VERSION,
    costUsd: acc.cost,
    ignored,
    attempts: acc.attempts,
    shimmer,
    sourceShimmer,
    iou,
  };
}
