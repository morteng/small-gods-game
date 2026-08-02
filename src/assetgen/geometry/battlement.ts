// src/assetgen/geometry/battlement.ts
// BATTLEMENTS — the one place merlon teeth are laid out, for every surface that carries them:
// the curtain wall (`geometry/linear.ts`), mural towers (`geometry/tower-spec.ts`), round keeps
// (`blueprint/parts/structural.ts`) and building roof parapets (`blueprint/parts/trim.ts`).
//
// The layout rule is SELF-TILING (WP-W2, first solved for the curtain): fit a WHOLE number of
// periods across the run and centre each tooth in its period, so the row is symmetric under
// d → from+to−d. The naive alternative — step a FIXED period from one end — leaves the far end
// with an arbitrary remainder, which on a closed rectangle put a flush double-thickness tooth at
// one corner and up to a full period of bare parapet at the opposite one (the "sticky-up parts
// wrong in corners" bug). Corners are placed EXPLICITLY here instead: a real battlement turns a
// corner with a solid corner merlon, and the runs tile between those.
import type { Part } from '@/assetgen/compose';
import type { Mat } from '@/assetgen/types';
import { mToTiles } from '@/render/scale-contract';

/** Merlon + crenel pitch (tiles), SHARED by curtain, mural towers and building parapets, so
 *  battlements read as ONE construction across a wall, its towers and a keep. 1.0 tile = 2 m. */
export const MERLON_PERIOD_TILES = mToTiles(2.0);
/** Merlon tooth width as a fraction of the pitch (a touch wider than the crenel gap). */
export const MERLON_WIDTH_FRAC = 0.56;

/** Height of the parapet standing on a crest at height `h` (both in tiles) — ONE derivation, so a
 *  curtain and the towers flanking it stand their teeth at the SAME height. Capped at 1.6 m:
 *  taller than that and a parapet stops being a breastwork and reads as another storey of wall. */
export function parapetHeight(h: number): number {
  return Math.min(mToTiles(1.6), h * 0.4);
}

/** The shortest crest a masonry curtain is actually BUILT to (1 m): a run authored shorter than
 *  this still gets a wall you can see, so the geometry floors it. Anything deriving a height FROM
 *  a run — the parapet, the wall-walk, the mural stair, the sim's garrison stations — must floor
 *  it the same way or it will compute a walk the stones do not have. */
export const MASONRY_MIN_CREST = mToTiles(1.0);

/** The crest a masonry run of authored height `h` is built to. See {@link MASONRY_MIN_CREST}. */
export function masonryCrestHeight(h: number): number {
  return Math.max(MASONRY_MIN_CREST, h);
}

/** The continuous base course (crenel sill) under the teeth, as a fraction of parapet height —
 *  the low breast they stand on. Without it teeth read as loose blocks scattered on a slab. */
export const PARAPET_BASE_COURSE_FRAC = 0.42;

/** One tooth of a laid-out run: `start` along the run axis, `width` along it. */
export interface Tooth { start: number; width: number }

/**
 * Lay teeth across `[from, to]` so the row is SYMMETRIC and self-tiling: a whole number of
 * periods, each tooth centred in its period. Returns [] for a run too short for one tooth.
 * This is the single source of truth for merlon spacing — never step a fixed period from an end.
 */
export function toothRun(
  from: number, to: number,
  period = MERLON_PERIOD_TILES, widthFrac = MERLON_WIDTH_FRAC, minCount = 0,
): Tooth[] {
  const len = to - from;
  if (!(len > 0) || !(period > 0)) return [];
  const n = Math.max(minCount, Math.round(len / period));
  if (n < 1) return [];                       // shorter than half a period — no room for a tooth
  const p = len / n, w = p * widthFrac;
  const out: Tooth[] = [];
  for (let k = 0; k < n; k++) out.push({ start: from + (k + 0.5) * p - w / 2, width: w });
  return out;
}

/** Measured properties of a laid-out run — what the geometry tests assert on. */
export interface ToothRunMetrics {
  count: number;
  /** Centre-to-centre spacing (0 for a single tooth). */
  pitch: number;
  /** Bare parapet before the first tooth / after the last. Equal ⇔ the run is centred. */
  leadGap: number;
  trailGap: number;
  /** max |tooth centre − its mirror about the run midpoint|. 0 ⇔ perfectly symmetric. */
  symmetryResidual: number;
}

/** Measure a laid-out run against its span — pure, so tests read real emitted geometry. */
export function toothRunMetrics(teeth: Tooth[], from: number, to: number): ToothRunMetrics {
  if (teeth.length === 0) return { count: 0, pitch: 0, leadGap: to - from, trailGap: to - from, symmetryResidual: 0 };
  const first = teeth[0], last = teeth[teeth.length - 1];
  const mid = (from + to) / 2;
  const centres = teeth.map((t) => t.start + t.width / 2);
  let residual = 0;
  for (let i = 0; i < centres.length; i++) {
    const mirror = 2 * mid - centres[centres.length - 1 - i];
    residual = Math.max(residual, Math.abs(centres[i] - mirror));
  }
  return {
    count: teeth.length,
    pitch: teeth.length > 1 ? centres[1] - centres[0] : 0,
    leadGap: first.start - from,
    trailGap: to - (last.start + last.width),
    symmetryResidual: residual,
  };
}

/**
 * Battlements around a CLOSED rectangular parapet `[x0,x1] × [y0,y1]` of thickness `pt`:
 * a solid corner merlon at each of the four corners, with self-tiled runs between them. Used by
 * square mural towers and building roof parapets — both of which used to lay four independent
 * fixed-period edges and so met badly at every corner.
 */
export function merlonsAroundRect(
  x0: number, y0: number, x1: number, y1: number,
  pt: number, z: number, mh: number, mat: Mat,
): Part[] {
  const out: Part[] = [];
  const box = (x: number, y: number, w: number, d: number): Part =>
    ({ prim: 'box', at: [x, y, z], size: [w, d, mh], material: mat }) as Part;
  // Corner merlons: an L of two tooth-length arms meeting at the corner, so the turn is solid
  // from both approaches (that IS how a corner merlon is built).
  const cw = Math.min(MERLON_PERIOD_TILES * MERLON_WIDTH_FRAC, (x1 - x0) / 2, (y1 - y0) / 2);
  if (!(cw > 0)) return out;
  for (const sx of [0, 1] as const) {
    for (const sy of [0, 1] as const) {
      const cx = sx ? x1 - cw : x0, cy = sy ? y1 - pt : y0;
      out.push(box(cx, cy, cw, pt));                                            // arm along x
      out.push(box(sx ? x1 - pt : x0, sy ? y1 - cw : y0, pt, cw));              // arm along y
    }
  }
  // Runs BETWEEN the corner merlons, self-tiled so each edge is symmetric.
  for (const t of toothRun(x0 + cw, x1 - cw)) {
    out.push(box(t.start, y0, t.width, pt));
    out.push(box(t.start, y1 - pt, t.width, pt));
  }
  for (const t of toothRun(y0 + cw, y1 - cw)) {
    out.push(box(x0, t.start, pt, t.width));
    out.push(box(x1 - pt, t.start, pt, t.width));
  }
  return out;
}

/** Divisions of a parapet ring of radius `rp` at the merlon pitch — SHARED by the sill course and
 *  the teeth above it, so both are cut on the same joints. */
export function ringSegments(rp: number): number {
  return Math.max(6, Math.round((2 * Math.PI * rp) / MERLON_PERIOD_TILES));
}

/** A CONTINUOUS course around a parapet ring (the crenel sill under ring battlements), as abutting
 *  yawed boxes — there is no annulus prim, and a solid cylinder would fill the wall-walk and leave
 *  the crenels no depth. Each box overruns its chord slightly so the joints close. */
export function ringCourse(cx: number, cy: number, rp: number, z: number, h: number, pt: number, mat: Mat): Part[] {
  const out: Part[] = [];
  const n = ringSegments(rp), ringR = rp - pt / 2;
  const w = ((2 * Math.PI * ringR) / n) * 1.08;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    const ccx = cx + ringR * Math.cos(a), ccy = cy + ringR * Math.sin(a);
    out.push({ prim: 'box', at: [ccx - pt / 2, ccy - w / 2, z], size: [pt, w, h], material: mat, yaw: a * 180 / Math.PI });
  }
  return out;
}

/** Merlon teeth wrapped around a parapet RING of radius `rp`, each box yawed to face radially
 *  (yaw rotates a box about its own centre, so radial thickness `pt` × tangential width `mw`). */
export function merlonsAroundRing(cx: number, cy: number, rp: number, z: number, mh: number, pt: number, mat: Mat): Part[] {
  const out: Part[] = [];
  const n = ringSegments(rp);
  const mw = ((2 * Math.PI * rp) / n) * MERLON_WIDTH_FRAC;   // tangential chord, a touch under the pitch
  const ringR = rp - pt / 2;                                 // box centre sits on the ring mid-thickness
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    const ccx = cx + ringR * Math.cos(a), ccy = cy + ringR * Math.sin(a);
    out.push({ prim: 'box', at: [ccx - pt / 2, ccy - mw / 2, z], size: [pt, mw, mh], material: mat, yaw: a * 180 / Math.PI });
  }
  return out;
}
