/**
 * Parametric quadruped raster painter — the sheep's pixels are DRAWN IN CODE.
 *
 * No PixelLab, no img2img, no vendored sheet: `drawQuadrupedCell` composes one
 * 64px paper-doll rest cell out of analytic shapes (a lumpy barrel, a wedge
 * neck, a boxy head, four lane-aligned stick legs) parameterised entirely by
 * `QuadrupedParams`. A second species is a different params object, never new
 * code. Pure raster math — no DOM, no canvas, no GPU — so it runs identically
 * under `npx tsx` and in the motion studio, and it is deterministic: the fleece
 * "lumpiness" is value noise over a param seed, never `Math.random`.
 *
 * ── The root-clear contract (the killer from the humanoid round) ────────────
 * `rootChipRaster` clears EVERY non-root chip rect out of the root raster, so a
 * chip rect that scoops opaque body pixels leaves a hole the moment that chip
 * moves. The vendored humanoid had to dodge this with sliver rects; here we own
 * the art, so the layout is hazard-free BY CONSTRUCTION:
 *
 *   - the barrel occupies x∈[27,47] only; the neck chip's rect stops at x=26
 *     and the tail chip's starts at x=48, so neither rect can contain barrel
 *     pixels. The neck/tail bands are still DRAWN across the seam — the pixels
 *     that land on the body side simply stay with the root and read as the
 *     shoulder / rump, which is exactly what a shoulder should do (it does not
 *     move when the neck swings).
 *   - the belly is FLAT at a fixed y across the whole leg zone and every leg
 *     rect starts one row below it, in its own 3px lane with a transparent
 *     gutter on both sides. No leg rect can ever scoop the barrel.
 *   - head / ear / neck rects are pairwise disjoint (head x≤18, neck x≥19, ear
 *     y≤28 with head y≥29).
 *
 * `drawQuadrupedParts` returns a per-pixel chip-index map so the bake harness
 * can ASSERT that invariant instead of trusting the prose above.
 */
import type { Raster } from '../sprite-postprocess';
import type { QuadrupedBand, QuadrupedBox, QuadrupedParams } from './quadruped';

/** Sentinel in the parts map: this pixel belongs to no chip (transparent). */
export const QUAD_PART_NONE = 255;

type RGB = [number, number, number];

const hex = (s: string): RGB => [
  parseInt(s.slice(1, 3), 16),
  parseInt(s.slice(3, 5), 16),
  parseInt(s.slice(5, 7), 16),
];

// ── Deterministic value noise (no Math.random, ever) ────────────────────────

const hash1 = (i: number, seed: number): number => {
  let h = (Math.imul(i | 0, 374761393) + Math.imul(seed | 0, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const hash2 = (x: number, y: number, seed: number): number => {
  let h = (Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** 1-D value noise in [0,1) — lattice hashes, smoothstep-interpolated. */
function vnoise1(x: number, freq: number, seed: number): number {
  const s = x * freq;
  const i = Math.floor(s);
  const u = smooth(s - i);
  return hash1(i, seed) + (hash1(i + 1, seed) - hash1(i, seed)) * u;
}

/** 2-D value noise in [0,1) — bilinear over smoothstepped cell coords. */
function vnoise2(x: number, y: number, freq: number, seed: number): number {
  const sx = x * freq;
  const sy = y * freq;
  const ix = Math.floor(sx);
  const iy = Math.floor(sy);
  const ux = smooth(sx - ix);
  const uy = smooth(sy - iy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}

// ── Shape predicates ────────────────────────────────────────────────────────

/**
 * Inside test for a tapered QUAD (square ends, never a capsule): a capsule's
 * round caps overshoot the endpoint by the half-width, and a 1px overshoot is
 * exactly what puts a neck pixel inside the head's rect. Square ends keep every
 * band provably inside the rect its endpoints imply.
 */
function inBand(b: QuadrupedBand, x: number, y: number): boolean {
  const ax = b.from[0];
  const ay = b.from[1];
  const dx = b.to[0] - ax;
  const dy = b.to[1] - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 0) return false;
  const t = ((x - ax) * dx + (y - ay) * dy) / len2;
  if (t < 0 || t > 1) return false;
  const px = ax + dx * t;
  const py = ay + dy * t;
  const half = b.fromHalf + (b.toHalf - b.fromHalf) * t;
  const ex = x - px;
  const ey = y - py;
  return ex * ex + ey * ey <= half * half;
}

const inBox = (r: QuadrupedBox, x: number, y: number): boolean =>
  x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];

/**
 * The barrel profile, exported so the bake harness can assert THE ROOT IS THE
 * BARREL AND NOTHING ELSE. That invariant is the real guard against the graze
 * spike: any pixel a limb band leaves behind in the root is, by definition, a
 * pixel the limb was covering at rest and will UNCOVER the moment it moves.
 */
export function inBarrel(p: QuadrupedParams, fx: number, fy: number): boolean {
  const b = p.body;
  const front = fx < b.cx;
  const u = (fx - b.cx) / (front ? b.rxFront : b.rx);
  if (u <= -1 || u >= 1) return false;
  const e = Math.pow(1 - u * u, front ? b.plumpFront : b.plump);
  const lump = (vnoise1(fx, b.lumpFreq, p.seed) - 0.5) * 2 * b.lump;
  const top = b.belly - b.rise * e + lump;
  let bot = b.belly;
  if (fx < b.flat[0]) bot = b.belly - (b.flat[0] - fx) * b.taperFront;
  else if (fx > b.flat[1]) bot = b.belly - (fx - b.flat[1]) * b.taper;
  return fy >= top && fy < bot;
}

// ── Materials ───────────────────────────────────────────────────────────────

const MAT_FLEECE = 0;
const MAT_FACE = 1;
const MAT_LEG_NEAR = 2;
const MAT_LEG_FAR = 3;
const MAT_HOOF = 4;
const MAT_MUZZLE = 5;

/** Chip indices — MUST match the template order in `quadruped.ts`. */
const C_BODY = 0;
const C_NECK = 1;
const C_HEAD = 2;
const C_EAR = 3;
const C_TAIL = 4;
/** Leg chips, per lane: [upper, lower] for foreNear, foreFar, hindNear, hindFar. */
const C_LEGS: readonly (readonly [number, number])[] = [
  [5, 6],
  [7, 8],
  [9, 10],
  [11, 12],
];

export interface QuadrupedCell {
  raster: Raster;
  /** Per-pixel owning chip index, or `QUAD_PART_NONE` where transparent. */
  parts: Uint8Array;
}

/**
 * Paint one rest cell plus the per-pixel chip-ownership map. Three passes:
 * geometry (who owns what), shading (per-column depth ramp + fleece noise),
 * then a silhouette ink pass.
 */
export function drawQuadrupedParts(p: QuadrupedParams): QuadrupedCell {
  const n = p.cell;
  const N = n * n;
  const parts = new Uint8Array(N).fill(QUAD_PART_NONE);
  const mats = new Uint8Array(N);
  const data = new Uint8ClampedArray(N * 4);

  const legs = p.legs;
  const set = (i: number, part: number, mat: number): void => {
    parts[i] = part;
    mats[i] = mat;
  };

  // ── Pass 1: geometry ──────────────────────────────────────────────────────
  for (let y = 0; y < n; y++) {
    const fy = y + 0.5;
    for (let x = 0; x < n; x++) {
      const fx = x + 0.5;
      const i = y * n + x;

      // Priority order IS the occlusion order, and it is what keeps the
      // head/neck seam legal: the neck wedge overlaps the skull by a couple of
      // columns, and the skull claims those pixels FIRST, so no neck pixel can
      // ever land inside the head's rect.
      // Muzzle outranks the skull so the snout stays a readable wedge instead
      // of being swallowed by the skull box; the skull outranks the ear so the
      // ear's root end can lap over the poll without leaving the ear's rect.
      if (inBand(p.muzzle, fx, fy)) set(i, C_HEAD, MAT_MUZZLE);
      else if (inBox(p.skull, fx, fy)) set(i, C_HEAD, MAT_FACE);
      else if (inBand(p.ear, fx, fy)) set(i, C_EAR, MAT_FACE);
      // Neck and tail are CLIPPED at their split — a limb band must never paint
      // into the ROOT. Letting the neck spill past the split looked right at
      // rest (it filled the shoulder) and then left a stationary pale SPIKE
      // standing over the withers the moment the neck swung down to graze:
      // root pixels the neck's own silhouette had been hiding. The body has to
      // be a closed form ON ITS OWN — which is what rxFront/plumpFront/
      // taperFront below are for. Same reasoning for the tail and the rump.
      else if (fx <= p.neckSplitX && inBand(p.neck, fx, fy)) set(i, C_NECK, MAT_FLEECE);
      else if (fx >= p.tailSplitX && inBand(p.tail, fx, fy)) set(i, C_TAIL, MAT_FLEECE);
      // Barrel: a flattened superellipse with a lumpy fleece back and a
      // DEAD-FLAT belly across the leg zone (the leg-rect contract needs it).
      // Front and rear carry their own radius / exponent / taper so the CHEST
      // can be a full closed lobe — it IS the silhouette once the neck swings
      // away — while the rump keeps its own line.
      else if (inBarrel(p, fx, fy)) set(i, C_BODY, MAT_FLEECE);
    }
  }

  // Legs — each in its own lane, starting one row below the flat belly.
  for (let li = 0; li < legs.laneX.length; li++) {
    const x0 = legs.laneX[li];
    const near = li === 0 || li === 2;
    const fore = li < 2;
    const bottom = near ? legs.nearBottom : legs.farBottom;
    const [cUp, cLow] = C_LEGS[li];
    // Lower leg is narrower and offset — forward on the fore legs, back on the
    // hind, so the stance reads as shoulders in front and hocks behind.
    // Far legs are drawn a column narrower and stop a row higher — cheap,
    // honest depth in a flat side view.
    const w = near ? legs.width : legs.farWidth;
    const lowW = Math.min(legs.lowerWidth, w);
    const lowX0 = fore ? x0 : x0 + w - lowW;
    for (let y = legs.top; y < bottom; y++) {
      const upper = y < legs.knee;
      const hoof = y >= bottom - legs.hoofRows;
      for (let x = x0; x < x0 + w; x++) {
        if (!upper && !hoof && (x < lowX0 || x >= lowX0 + lowW)) continue;
        const i = y * n + x;
        set(i, upper ? cUp : cLow, hoof ? MAT_HOOF : near ? MAT_LEG_NEAR : MAT_LEG_FAR);
      }
    }
  }

  // ── Pass 2: shading ───────────────────────────────────────────────────────
  // Per-column opaque extents give every fleece/face pixel a depth ratio, so
  // the ramp follows the silhouette instead of a hard horizontal band.
  const colTop = new Int16Array(n).fill(-1);
  const colBot = new Int16Array(n).fill(-1);
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      const m = mats[y * n + x];
      if (parts[y * n + x] === QUAD_PART_NONE || (m !== MAT_FLEECE && m !== MAT_FACE && m !== MAT_MUZZLE)) continue;
      if (colTop[x] < 0) colTop[x] = y;
      colBot[x] = y;
    }
  }

  const pal = p.palette;
  const fleece: RGB[] = [hex(pal.fleeceLight), hex(pal.fleeceMid), hex(pal.fleeceShade)];
  const face: RGB[] = [hex(pal.faceLight), hex(pal.faceMid), hex(pal.faceDark)];
  const legNear = hex(pal.legNear);
  const legFar = hex(pal.legFar);
  const hoofCol = hex(pal.hoof);
  const eyeCol = hex(pal.eye);

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      if (parts[i] === QUAD_PART_NONE) continue;
      let c: RGB;
      const m = mats[i];
      if (m === MAT_MUZZLE) c = face[0];
      else if (m === MAT_FLEECE || m === MAT_FACE) {
        const t = colTop[x];
        const bt = colBot[x];
        const span = Math.max(1, bt - t);
        let r = (y - t) / span;
        if (m === MAT_FLEECE) {
          // Lumpy fleece: perturb the depth ratio with blobby noise so the
          // light/mid/shade bands break into curls instead of stripes.
          r += (vnoise2(x, y, p.fleeceCurl, p.seed + 7) - 0.5) * p.fleeceContrast;
        }
        const ramp = m === MAT_FLEECE ? fleece : face;
        c = r < 0.3 ? ramp[0] : r < 0.72 ? ramp[1] : ramp[2];
      } else if (m === MAT_HOOF) c = hoofCol;
      else if (m === MAT_LEG_NEAR) c = legNear;
      else c = legFar;
      data[i * 4] = c[0];
      data[i * 4 + 1] = c[1];
      data[i * 4 + 2] = c[2];
      data[i * 4 + 3] = 255;
    }
  }

  // Belly shadow: the underside rows sitting directly above a leg never see the
  // ink pass (their neighbour is opaque), so state the shadow explicitly.
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      const i = y * n + x;
      if (parts[i] !== C_BODY || mats[i] !== MAT_FLEECE) continue;
      const below = y + 1 < n ? parts[(y + 1) * n + x] : QUAD_PART_NONE;
      if (below === QUAD_PART_NONE || below === C_BODY) continue;
      const c = fleece[2];
      data[i * 4] = c[0];
      data[i * 4 + 1] = c[1];
      data[i * 4 + 2] = c[2];
    }
  }

  // ── Pass 3: ink ───────────────────────────────────────────────────────────
  // Fleece and face get a 1px silhouette ink; the legs are dark enough that
  // inking them would eat 2 of their 3 columns, so their ink IS their fill.
  const fleeceInk = hex(pal.fleeceInk);
  const faceInk = hex(pal.faceInk);
  const inked = new Uint8ClampedArray(data);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      if (parts[i] === QUAD_PART_NONE) continue;
      const m = mats[i];
      if (m !== MAT_FLEECE && m !== MAT_FACE && m !== MAT_MUZZLE) continue;
      let edge = false;
      for (const [ox, oy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const) {
        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) {
          edge = true;
          break;
        }
        const j = ny * n + nx;
        if (parts[j] === QUAD_PART_NONE) {
          edge = true;
          break;
        }
        // Only the FACE side of a face/fleece seam is inked — that single line
        // is what separates the dark head from the fleece ruff behind it.
        if (m !== MAT_FLEECE && mats[j] === MAT_FLEECE) {
          edge = true;
          break;
        }
      }
      if (!edge) continue;
      const c = m === MAT_FLEECE ? fleeceInk : faceInk;
      inked[i * 4] = c[0];
      inked[i * 4 + 1] = c[1];
      inked[i * 4 + 2] = c[2];
    }
  }

  // Eye last so the ink pass can never overwrite it.
  const ex = Math.round(p.eye[0]);
  const ey = Math.round(p.eye[1]);
  if (ex >= 0 && ey >= 0 && ex < n && ey < n && parts[ey * n + ex] === C_HEAD) {
    const i = (ey * n + ex) * 4;
    inked[i] = eyeCol[0];
    inked[i + 1] = eyeCol[1];
    inked[i + 2] = eyeCol[2];
    inked[i + 3] = 255;
  }

  return { raster: { data: inked, w: n, h: n }, parts };
}

/** The rest cell alone — the paper-doll source every clip is posed from. */
export function drawQuadrupedCell(p: QuadrupedParams): Raster {
  return drawQuadrupedParts(p).raster;
}
