/**
 * Keyframed pixel stamps — donor-harvested hand/face poses for the paper-doll.
 *
 * Rotation can move a limb but never change its pixels: a fist stays a fist.
 * A stamp swaps a small patch of the REST cell (e.g. the fist at the forearm
 * end) for a crop harvested from ANOTHER animation row of the SAME layer's
 * sheet family (spellcast = spread-open palms, thrust = extended point), and
 * it does so BEFORE the FK/skin path, so the chip rotation carries the new
 * hand and everything downstream (skinning, palette snap, outline re-ink) is
 * untouched.
 *
 * Stamps are REFERENCES, never baked pixels: each layer resolves the same
 * (anim, col, row, crop) against its OWN donor sheet, so wardrobe composes for
 * free — a gauntlet layer supplies its own armored palm from its own
 * spellcast.png. A layer with no donor sheet for the anim simply keeps its
 * rest pixels (the child body ships no spellcast sheet: whole-character
 * graceful degrade, no palm-over-fist mismatch).
 *
 * Switching is a STEP function (the latest key at or before t wins) — a
 * one-frame fist→palm pop mid-gesture reads as the hand opening.
 */
import type { Raster } from '../sprite-postprocess';
import type { ChipRect } from './rig';

/** One donor patch: crop from a sibling anim sheet, pasted into the rest cell. */
export interface StampRef {
  /**
   * Self-clone mode: crop from the layer's OWN rest cell instead of a donor
   * sheet (`anim`/`col`/`row` are ignored). Reads always come from the
   * PRE-STAMP original, so refs stay order-independent on the read side while
   * writes accumulate. This is how facial stamps stay wardrobe-independent
   * with no expression sheets vendored: a closed eyelid is the skin cloned
   * from just below the eye, a mouth is the eye-outline ink cloned under the
   * nose — each layer donates to itself, layers with nothing there no-op.
   */
  self?: boolean;
  /** Donor animation sheet name — sibling of walk in the layer's folder. Required unless `self`. */
  anim?: string;
  /** Donor cell column in that sheet. Required unless `self`. */
  col?: number;
  /** Donor cell row (LPC: row 2 = south). Required unless `self`. */
  row?: number;
  /** Crop rect within the donor cell (cell coordinates). */
  crop: ChipRect;
  /** Paste position (top-left) in the rest cell. */
  dest: [number, number];
  /**
   * Rects cleared to transparent before pasting — the rest pixels being
   * replaced (e.g. the fist). A list because the replaced shape is rarely a
   * clean box (the fist's bottom outline row is narrower than the fist, and
   * the adjacent pixel belongs to the leg). Defaults to a crop-sized rect at
   * `dest`.
   */
  clear?: readonly ChipRect[];
}

/** A stamp keyframe: from `t` onward these refs are active (step, no lerp). */
export interface StampKey {
  t: number;
  refs: readonly StampRef[];
}

/** Donor sheets by anim name — the FULL sheet raster, sliced per ref. */
export type DonorSheets = Readonly<Record<string, Raster>>;

/** Index of the active stamp key at time `t`, or -1 before the first key. */
export function activeStampIndex(track: readonly StampKey[] | undefined, t: number): number {
  if (!track) return -1;
  let idx = -1;
  for (let i = 0; i < track.length; i++) {
    if (track[i].t <= t) idx = i;
  }
  return idx;
}

/** Distinct donor anims referenced by a set of stamp tracks (loader shopping list). */
export function stampAnims(tracks: readonly (readonly StampKey[] | undefined)[]): string[] {
  const out = new Set<string>();
  for (const track of tracks) {
    for (const key of track ?? []) {
      for (const ref of key.refs) {
        if (!ref.self && ref.anim) out.add(ref.anim);
      }
    }
  }
  return [...out];
}

/**
 * Apply stamp refs to one layer's rest cell. Pure — the input is never
 * mutated; returns the input unchanged when nothing applies (no donors, no
 * refs, or every ref's anim missing from `donors`).
 */
export function applyStamps(
  cell: Raster,
  refs: readonly StampRef[],
  donors: DonorSheets | undefined,
  cellSize: number,
): Raster {
  if (refs.length === 0) return cell;
  let out: Uint8ClampedArray | null = null;
  const n = cell.w;
  for (const ref of refs) {
    // Self refs read the layer's own pre-stamp cell; donor refs need a sheet.
    const sheet = ref.self ? cell : ref.anim !== undefined ? donors?.[ref.anim] : undefined;
    if (!sheet) continue; // no donor for this layer → keep the rest pixels
    if (!out) out = new Uint8ClampedArray(cell.data);
    const clears = ref.clear ?? [{ x: ref.dest[0], y: ref.dest[1], w: ref.crop.w, h: ref.crop.h }];
    for (const clear of clears) {
      for (let y = clear.y; y < clear.y + clear.h; y++) {
        if (y < 0 || y >= cell.h) continue;
        for (let x = clear.x; x < clear.x + clear.w; x++) {
          if (x < 0 || x >= n) continue;
          out[(y * n + x) * 4 + 3] = 0;
        }
      }
    }
    const sx0 = (ref.self ? 0 : (ref.col ?? 0) * cellSize) + ref.crop.x;
    const sy0 = (ref.self ? 0 : (ref.row ?? 0) * cellSize) + ref.crop.y;
    for (let y = 0; y < ref.crop.h; y++) {
      const sy = sy0 + y;
      const dy = ref.dest[1] + y;
      if (sy < 0 || sy >= sheet.h || dy < 0 || dy >= cell.h) continue;
      for (let x = 0; x < ref.crop.w; x++) {
        const sx = sx0 + x;
        const dx = ref.dest[0] + x;
        if (sx < 0 || sx >= sheet.w || dx < 0 || dx >= n) continue;
        const si = (sy * sheet.w + sx) * 4;
        if (sheet.data[si + 3] === 0) continue; // transparent donor px keeps the cleared hole
        out.set(sheet.data.subarray(si, si + 4), (dy * n + dx) * 4);
      }
    }
  }
  return out ? { data: out, w: cell.w, h: cell.h } : cell;
}
