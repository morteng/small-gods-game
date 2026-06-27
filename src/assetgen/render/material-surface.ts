// src/assetgen/render/material-surface.ts
//
// The Material+Finish SURFACE ENGINE — structural-parts-kit slice K0a.
//
// One pure, deterministic function turns a (material, finish) tag + a WORLD position +
// the facet normal into textured-pixel data: albedo, a surface-perturbed normal, a
// roughness and an ambient-occlusion scalar. It is the building/kit-part analogue of the
// terrain `material-exemplar` layer — but sampled ANALYTICALLY at the pixel's world
// position (not a baked toroidal swatch), so the texture is continuous ACROSS facets with
// no seam and no tiling, and stays at a consistent metre scale on every surface.
//
// WHY analytic-at-world-position (not a baked swatch like the terrain path): a building is
// a stack of small facets at arbitrary orientations; a swatch-per-facet would seam at every
// edge and pick an arbitrary UV origin. Evaluating noise at the shared world coordinate
// makes a stone course run unbroken across two adjacent wall facets, which is the whole
// point of "real surface texture, not flat grey massing".
//
// FREEZE-SAFE: this is procedural-$0 and on the CPU rasterize path (Node + browser, pure
// buffers). It is ALSO the grey-init an img2img reseed will later repaint into the same
// slot — so a funded upgrade is a quality lift, not a rewrite. No `Math.random`.
//
// Plugs into `rasterizeMaps` (K0b): for each opaque pixel, interpolate the facet's world
// xyz and call `sampleSurface`. Calibration of metre scale (the `unitsPerMetre` arg) and
// the default-on flag land in K0b/K0d; K0a is the engine + its tests only.

import type { Mat, RGB, Vec3 } from '@/assetgen/types';
import { MATERIAL_RGB } from '@/assetgen/types';
import { MATERIAL_PBR } from '@/assetgen/material-pbr';

// ── Finish / paint layer ────────────────────────────────────────────────────────────────
// A finish is an ORTHOGONAL recolour + roughness modifier laid OVER a material's
// micro-structure (the user's "all building materials and paints"). `bare` is identity.
export type FinishId =
  | 'bare'
  | 'limewash' | 'whitewash' | 'ochre' | 'redearth'
  | 'tar' | 'polychrome' | 'gilt' | 'mossed' | 'soot';

export const FINISH_IDS: readonly FinishId[] = [
  'bare', 'limewash', 'whitewash', 'ochre', 'redearth',
  'tar', 'polychrome', 'gilt', 'mossed', 'soot',
] as const;

// ── Surface work (bond / masonry pattern within a material family) ──────────────────────────
// A `family` (Mat) says WHAT the surface is made of; a `work` says HOW it's laid up — the bond
// or coursing. Stone alone spans a cut-ashlar keep, a rubble cottage and a cobbled yard; one
// pattern can't. `work` is optional: each family has a sensible default (DEFAULT_WORK).
export type SurfaceWork =
  // stone family
  | 'ashlar' | 'coursed_rubble' | 'random_rubble' | 'cobble' | 'dry_stone' | 'flint'
  // brick family
  | 'running' | 'flemish'
  // timber family
  | 'plank' | 'board_batten';

export const SURFACE_WORKS: readonly SurfaceWork[] = [
  'ashlar', 'coursed_rubble', 'random_rubble', 'cobble', 'dry_stone', 'flint',
  'running', 'flemish', 'plank', 'board_batten',
] as const;

/** Resolved surface tag for one facet (from `Blueprint.materials` + `Palette` in K0c). */
export interface SurfaceSpec {
  material: Mat;
  /** Bond / coursing within the family (ashlar vs rubble vs cobble …). Default per family. */
  work?: SurfaceWork;
  finish?: FinishId;
  /** Optional decorative tint (0..255 RGB) — used by `polychrome`; ignored otherwise. */
  tint?: RGB;
}

/** One sampled surface fragment, ready to write into the G-buffer. */
export interface SurfaceSample {
  albedo: RGB;       // 0..255
  normal: Vec3;      // unit world-space normal, perturbed by the micro-surface
  roughness: number; // 0..1
  ao: number;        // 0..1 (1 = unoccluded)
}

// ── Analytic, world-continuous noise (non-periodic; reuses the proven integer hash) ──────
// Deliberately NOT the toroidal `material-noise` primitives: those wrap modulo a period to
// bake a seamless swatch; here we want UNBOUNDED continuity at world coordinates. The
// integer-lattice hash is the same family (replay-safe, Node + browser), inlined so this
// module stays self-contained and free of a render-layer import.

function hash2(ix: number, iy: number): number {
  let h = (Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h >>> 0) / 4294967295;
}

/** Smooth value noise at (x,y), continuous everywhere (no period). */
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf);
  const sy = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Fractal value noise, normalised ~0..1. */
function fbm(x: number, y: number, octaves: number): number {
  let sum = 0, amp = 1, norm = 0, fx = x, fy = y;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise(fx, fy);
    norm += amp;
    amp *= 0.5; fx *= 2; fy *= 2;
  }
  return sum / (norm || 1);
}

/** Cellular (Worley) noise at world scale `cell` — nearest jittered point + its hash. */
function cellular(x: number, y: number, cell: number): { dist: number; hash: number } {
  const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
  let best = 1e18, bestHash = 0;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const cx = gx + ox, cy = gy + oy;
    const jx = hash2(cx, cy), jy = hash2(cx + 17, cy + 31);
    const px = (cx + 0.15 + 0.7 * jx) * cell;
    const py = (cy + 0.15 + 0.7 * jy) * cell;
    const dx = px - x, dy = py - y;
    const d = dx * dx + dy * dy;
    if (d < best) { best = d; bestHash = jx; }
  }
  return { dist: Math.sqrt(best), hash: bestHash };
}

/**
 * Voronoi cell-BORDER distance (Inigo Quilez, iquilezles.org/articles/voronoilines).
 * Two passes: (1) find the nearest feature point's cell, (2) over a 5×5 neighbourhood take
 * the min perpendicular distance to each bisector `dot(0.5(mr+r), normalize(r-mr))`. Unlike
 * F1 worley (distance to the POINT — which reads as a dot at each cell centre), this returns
 * an even-width distance to the JOINT between stones — the mortar line. `cellHash`/`cellId`
 * identify the owning stone for per-block colour. `jitter` (0..1) sets how irregular the
 * blocks are (1 = random rubble, low = squarer/coursed). Deterministic + world-continuous.
 */
function voronoiEdge(x: number, y: number, jitter = 1): { edge: number; cellHash: number } {
  const px = Math.floor(x), py = Math.floor(y);
  const fx = x - px, fy = y - py;
  const j = Math.max(0, Math.min(1, jitter));
  // pass 1 — nearest point's cell
  let mbx = 0, mby = 0, mrx = 0, mry = 0, best = 8, cellHash = 0;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const rx = di + 0.5 + j * (hash2(px + di, py + dj) - 0.5) - fx;
    const ry = dj + 0.5 + j * (hash2(px + di + 57, py + dj + 131) - 0.5) - fy;
    const d = rx * rx + ry * ry;
    if (d < best) { best = d; mrx = rx; mry = ry; mbx = di; mby = dj; cellHash = hash2(px + di, py + dj); }
  }
  // pass 2 — min distance to the bisector edges around that cell
  let edge = 8;
  for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
    const bx = mbx + di, by = mby + dj;
    const rx = bx + 0.5 + j * (hash2(px + bx, py + by) - 0.5) - fx;
    const ry = by + 0.5 + j * (hash2(px + bx + 57, py + by + 131) - 0.5) - fy;
    const ax = rx - mrx, ay = ry - mry;
    const al = Math.hypot(ax, ay);
    if (al < 1e-5) continue;                               // the owning cell itself
    const md = (0.5 * (mrx + rx) * ax + 0.5 * (mry + ry) * ay) / al;
    if (md < edge) edge = md;
  }
  return { edge, cellHash };
}

/** Smoothstep 0..1. */
function sstep(e: number): number { const t = Math.max(0, Math.min(1, e)); return t * t * (3 - 2 * t); }

// ── Per-material micro-surface ───────────────────────────────────────────────────────────
// Each material is `pattern(u, v) → { tone, tint, height, rough }` in a 2-D surface frame
// (u,v in metres). `tone` is a multiplicative albedo modulation around the material's base
// (±, ~0 mean), `tint` an additive RGB shift (0..255 space, small), `height` a 0..1 relief
// used for the normal perturbation, `rough` a multiplier on the base roughness. Wavelengths
// are authored in METRES so every surface reads at a physically consistent scale.

interface Micro { tone: number; tint: RGB; height: number; rough: number }
const ZERO_TINT: RGB = [0, 0, 0];

type Pattern = (u: number, v: number) => Micro;

// Running-bond masonry helper: course rows offset by half a unit each row; returns the
// in-brick coordinate, the unit hash and a 0..1 nearness-to-mortar (1 = deep in the joint).
function bond(u: number, v: number, unitU: number, unitV: number, mortar: number) {
  const row = Math.floor(v / unitV);
  const offset = (row & 1) * unitU * 0.5;
  const su = u + offset;
  const col = Math.floor(su / unitU);
  const fu = su / unitU - col, fv = v / unitV - row;
  // distance (0..0.5) to the nearest joint along each axis, normalised by the mortar width
  const edgeU = Math.min(fu, 1 - fu) * unitU;
  const edgeV = Math.min(fv, 1 - fv) * unitV;
  const joint = 1 - Math.min(1, Math.min(edgeU, edgeV) / mortar);
  return { col, row, joint, h: hash2(col, row * 2 + (row & 1)) };
}

// ── Stoneworks (family 'stone') ──────────────────────────────────────────────────────────
// All built from the shared primitives (IQ voronoiEdge mortar lines, `bond` coursing, fbm
// grain). Coursed rubble is the family default; the rest are selected via SurfaceSpec.work.

/** Coursed rubble: irregular stones in rough rows. IQ Voronoi-BORDER = even mortar lines
 *  (F1 worley reads as a polka grid of dots at cell centres); cells v-compressed = coursing. */
const coursedRubble: Pattern = (u, v) => {
  const S = 0.42;                                          // ~42 cm rubble stones
  const { edge, cellHash } = voronoiEdge(u / S, v / (S * 1.55), 0.82);
  const joint = 1 - sstep(edge / 0.13);                    // 1 in the mortar line → 0 on the face
  const grain = fbm(u * 3.0, v * 3.0, 3);
  const block = cellHash - 0.5;                            // per-stone lightness
  return {
    tone: 0.11 * block + 0.10 * (grain - 0.5) - 0.40 * joint,
    tint: ZERO_TINT,
    height: 0.62 * (1 - joint) + 0.12 * grain,             // raised stone face, recessed joint
    rough: 1 + 0.14 * joint,
  };
};

/** Random rubble: uncut field stones, full jitter, no coursing — thicker joints, more relief. */
const randomRubble: Pattern = (u, v) => {
  const S = 0.36;
  const { edge, cellHash } = voronoiEdge(u / S, v / S, 1.0);
  const joint = 1 - sstep(edge / 0.13);
  const grain = fbm(u * 3.3, v * 3.3, 3);
  const block = cellHash - 0.5;
  return {
    tone: 0.12 * block + 0.11 * (grain - 0.5) - 0.42 * joint,
    tint: ZERO_TINT,
    height: 0.6 * (1 - joint) + 0.14 * grain,
    rough: 1 + 0.15 * joint,
  };
};

/** Ashlar: finely cut blocks, coursed (bond), thin tight joints, smooth faces. Keeps/churches. */
const ashlar: Pattern = (u, v) => {
  const b = bond(u, v, 0.6, 0.30, 0.014);                  // ~60×30 cm blocks, ~1.4 cm joint
  const block = b.h - 0.5;
  const grain = fbm(u * 3.5, v * 3.5, 2);
  return {
    tone: 0.05 * block + 0.06 * (grain - 0.5) - 0.28 * b.joint,
    tint: ZERO_TINT,
    height: 0.5 * (1 - b.joint) + 0.06 * grain,            // shallow joint, near-flat face
    rough: 0.9 + 0.12 * b.joint,
  };
};

/** Cobble: small domed rounded stones — bright crowns, dark gaps. Yards, road shoulders. */
const cobble: Pattern = (u, v) => {
  const S = 0.11;                                          // ~11 cm setts
  const { edge, cellHash } = voronoiEdge(u / S, v / S, 1.0);
  const dome = sstep(edge / 0.34);                         // 0 at the gap → 1 at the crown
  const joint = 1 - sstep(edge / 0.07);
  const block = cellHash - 0.5;
  return {
    tone: 0.14 * block + 0.16 * (dome - 0.5) - 0.5 * joint,
    tint: ZERO_TINT,
    height: 0.7 * dome,
    rough: 0.95 + 0.1 * joint,
  };
};

/** Dry-stone: flat stacked stones, thin DARK gaps (no mortar colour), strong thin coursing. */
const dryStone: Pattern = (u, v) => {
  const b = bond(u, v, 0.5, 0.16, 0.008);
  const block = b.h - 0.5;
  const grain = fbm(u * 3.5, v * 5, 3);
  const brk = 1 - sstep(voronoiEdge(u / 0.5, v / 0.5, 0.6).edge / 0.06);  // break long stones
  const gap = Math.max(b.joint, brk);
  return {
    tone: 0.10 * block + 0.10 * (grain - 0.5) - 0.5 * gap,
    tint: ZERO_TINT,
    height: 0.5 * (1 - gap),
    rough: 1 + 0.1 * gap,
  };
};

/** Flint: small dark knapped nodules, glassy glints, irregular — cooler, lower roughness. */
const flint: Pattern = (u, v) => {
  const S = 0.14;
  const { edge, cellHash } = voronoiEdge(u / S, v / S, 1.0);
  const dome = sstep(edge / 0.3);
  const joint = 1 - sstep(edge / 0.08);
  const glint = fbm(u * 9, v * 9, 2);
  const block = cellHash - 0.5;
  return {
    tone: 0.10 * block + 0.14 * (glint - 0.5) - 0.22 * joint - 0.10,
    tint: [-6, -4, 2],
    height: 0.5 * dome,
    rough: 0.6 + 0.25 * joint,
  };
};

// ── Brick works (family 'brick') ─────────────────────────────────────────────────────────
/** Running bond: warm clay variance per brick, recessed mortar. Family default. */
const runningBond: Pattern = (u, v) => {
  const b = bond(u, v, 0.22, 0.075, 0.012);                // ~22×7.5 cm bricks, ~1.2 cm joint
  const clay = (b.h - 0.5);
  return {
    tone: 0.16 * clay - 0.42 * b.joint,
    tint: b.joint > 0.5 ? [-12, -10, -8] : [10 * clay, -4, -8] as RGB,
    height: 0.7 * (1 - b.joint),
    rough: 1 + 0.15 * b.joint,
  };
};

/** Flemish bond: alternating stretchers/headers — a half-unit vertical break splits alternate
 *  bricks into a short header, giving the busier decorative coursing of finer brickwork. */
const flemishBond: Pattern = (u, v) => {
  const b = bond(u, v, 0.24, 0.075, 0.012);
  // header break: on alternate columns, add a perpend joint at the brick mid-point.
  const unitU = 0.24;
  const su = u + ((Math.floor(v / 0.075) & 1) * unitU * 0.5);
  const fu = su / unitU - Math.floor(su / unitU);
  const header = (b.col & 1) === 0 && Math.abs(fu - 0.5) < 0.04 ? 1 : 0;
  const joint = Math.max(b.joint, header);
  const clay = (b.h - 0.5);
  return {
    tone: 0.16 * clay - 0.42 * joint,
    tint: joint > 0.5 ? [-12, -10, -8] : [10 * clay, -4, -8] as RGB,
    height: 0.7 * (1 - joint),
    rough: 1 + 0.15 * joint,
  };
};

// ── Timber works (family 'timber') ───────────────────────────────────────────────────────
/** Plank: directional grain (stretched along u) + plank seams across v. Family default. */
const plankTimber: Pattern = (u, v) => {
  const grain = fbm(u * 1.2, v * 9, 3);                    // tight across-grain, loose along
  const ring = 0.5 + 0.5 * Math.sin((v * 7 + grain * 1.5) * Math.PI * 2);
  const plank = 1 - Math.min(1, (Math.abs((v / 0.18) % 1 - 0.5) * 0.18) / 0.01);
  return {
    tone: 0.14 * (grain - 0.5) + 0.08 * (ring - 0.5) - 0.35 * plank,
    tint: ZERO_TINT,
    height: 0.4 * ring + 0.4 * (1 - plank),
    rough: 1,
  };
};

/** Board-and-batten: wide vertical boards with a raised narrow batten over every seam. */
const boardBatten: Pattern = (u, v) => {
  const boardW = 0.26;
  const col = Math.floor(u / boardW);
  const fu = u / boardW - col;
  const onBatten = fu < 0.09 || fu > 0.91;                 // raised batten straddling the seam
  const grain = fbm(u * 1.4, v * 8, 3);
  return {
    tone: 0.12 * (grain - 0.5) + (onBatten ? 0.05 : -0.04),
    tint: ZERO_TINT,
    height: onBatten ? 0.75 : 0.3 * grain,
    rough: 1,
  };
};

/** Work patterns, indexed by `SurfaceWork`. Selected via SurfaceSpec.work (else DEFAULT_WORK). */
const WORK_PATTERNS: Record<SurfaceWork, Pattern> = {
  ashlar, coursed_rubble: coursedRubble, random_rubble: randomRubble,
  cobble, dry_stone: dryStone, flint,
  running: runningBond, flemish: flemishBond,
  plank: plankTimber, board_batten: boardBatten,
};

/** Default work per material family (used when SurfaceSpec.work is absent). */
const DEFAULT_WORK: Partial<Record<Mat, SurfaceWork>> = {
  stone: 'coursed_rubble', brick: 'running', timber: 'plank',
};

const PATTERNS: Record<Mat, Pattern> = {
  stone: coursedRubble,
  brick: runningBond,
  timber: plankTimber,
  // Door: dark vertical boards with deep grooves between them.
  door: (u, _v) => {
    const board = 1 - Math.min(1, (Math.abs((u / 0.12) % 1 - 0.5) * 0.12) / 0.008);
    const grain = fbm(u * 2, _v * 8, 2);
    return { tone: 0.10 * (grain - 0.5) - 0.45 * board, tint: ZERO_TINT, height: 0.6 * (1 - board), rough: 1 };
  },
  // Plaster / daub: smooth low mottle with occasional hairline cracks.
  plaster: (u, v) => {
    const mottle = fbm(u * 2.2, v * 2.2, 3);
    const { dist } = cellular(u * 0.8, v * 0.8, 1.6);
    const crack = dist < 0.02 ? 1 : 0;
    return {
      tone: 0.06 * (mottle - 0.5) - 0.25 * crack,
      tint: ZERO_TINT,
      height: 0.12 * mottle - 0.4 * crack,
      rough: 1,
    };
  },
  // Thatch: directional reed bundles streaking down-slope (v), warm.
  thatch: (u, v) => {
    const bundle = fbm(u * 6, v * 0.9, 3);                 // fine across, long along the slope
    const streak = 0.5 + 0.5 * Math.sin((u * 9 + bundle) * Math.PI * 2);
    return {
      tone: 0.18 * (bundle - 0.5) + 0.10 * (streak - 0.5),
      tint: [6, 4, -4],
      height: 0.5 * streak + 0.2 * bundle,
      rough: 1,
    };
  },
  // Clay roof tile: overlapping pan rows, each row a shaded scallop, alternate offset.
  tile: (u, v) => {
    const rowH = 0.16, panW = 0.18;
    const row = Math.floor(v / rowH);
    const off = (row & 1) * panW * 0.5;
    const fu = ((u + off) / panW) % 1;
    const fv = v / rowH - row;
    const scallop = Math.sin(fu * Math.PI);                // bright crown, dark valley
    const lap = fv < 0.18 ? -0.3 : 0;                      // shadow line where the next row laps
    return {
      tone: 0.16 * (scallop - 0.5) + lap + 0.08 * (hash2(Math.floor((u + off) / panW), row) - 0.5),
      tint: ZERO_TINT,
      height: 0.5 * scallop + (fv < 0.18 ? -0.3 : 0),
      rough: 1,
    };
  },
  // Foliage: soft mottled clumps.
  foliage: (u, v) => {
    const clump = fbm(u * 3, v * 3, 3);
    return { tone: 0.22 * (clump - 0.5), tint: [(clump - 0.5) * 10, (clump - 0.5) * 14, 0], height: 0.3 * clump, rough: 1 };
  },
  // Bark: vertical ridged furrows.
  bark: (u, v) => {
    const ridge = Math.abs(Math.sin((u * 6 + fbm(u, v * 3, 2)) * Math.PI));
    return { tone: 0.20 * (ridge - 0.5), tint: ZERO_TINT, height: 0.6 * ridge, rough: 1 };
  },
  // Earth: clods.
  earth: (u, v) => {
    const n = fbm(u * 2.4, v * 2.4, 3);
    return { tone: 0.18 * (n - 0.5), tint: ZERO_TINT, height: 0.3 * n, rough: 1 };
  },
  // Metal: near-smooth with faint hammered dimples.
  metal: (u, v) => {
    const { dist, hash } = cellular(u, v, 0.12);
    const dimple = Math.min(1, dist / 0.06);
    return { tone: 0.06 * (hash - 0.5) - 0.04 * (1 - dimple), tint: ZERO_TINT, height: 0.2 * (1 - dimple), rough: 1 };
  },
  // Glass: flat (panes/glow handled by emissive elsewhere); only a faint sheen variance.
  glass: (u, v) => {
    const n = vnoise(u * 4, v * 4);
    return { tone: 0.03 * (n - 0.5), tint: ZERO_TINT, height: 0, rough: 1 };
  },
};

// ── Finish modifiers ─────────────────────────────────────────────────────────────────────
// Applied AFTER the material: each takes the post-material albedo (0..255), the relief
// height and base roughness, and returns the painted albedo + roughness. Kept as pure
// blends so finishes compose predictably and stay deterministic.

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const mixRgb = (a: RGB, b: RGB, t: number): RGB => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

interface FinishOut { albedo: RGB; rough: number }
type Finish = (albedo: RGB, height: number, rough: number, tint?: RGB) => FinishOut;

const FINISHES: Record<FinishId, Finish> = {
  bare: (a, _h, r) => ({ albedo: a, rough: r }),
  // Limewash: warm near-white wash; material courses read faintly through; chalk-matte.
  limewash: (a, _h, r) => ({ albedo: mixRgb(a, [238, 233, 222], 0.72), rough: Math.min(1, r * 1.05 + 0.05) }),
  whitewash: (a, _h, r) => ({ albedo: mixRgb(a, [244, 246, 247], 0.8), rough: Math.min(1, r * 1.05 + 0.05) }),
  ochre: (a, _h, r) => ({ albedo: mixRgb(a, [196, 146, 64], 0.62), rough: r }),
  redearth: (a, _h, r) => ({ albedo: mixRgb(a, [150, 62, 46], 0.6), rough: r }),
  // Tar/pitch: dark, sealed, glossier (lower roughness).
  tar: (a, _h, r) => ({ albedo: mixRgb(a, [34, 30, 32], 0.78), rough: Math.max(0.05, r * 0.5) }),
  // Polychrome: saturate toward the decorative tint (defaults to a temple blue if none given).
  polychrome: (a, _h, r, tint) => ({ albedo: mixRgb(a, tint ?? [70, 96, 150], 0.55), rough: r }),
  // Gilt: gold leaf — bright metallic albedo, low roughness; relief highs catch more.
  gilt: (_a, h, r) => ({ albedo: mixRgb([196, 158, 70], [230, 196, 120], h), rough: Math.max(0.08, r * 0.4) }),
  // Mossed: green build-up in the relief LOWS (crevices), unchanged on the highs.
  mossed: (a, h, r) => ({ albedo: mixRgb(a, [78, 96, 58], (1 - h) * 0.5), rough: Math.min(1, r * 1.1) }),
  // Soot: overall darkening + a touch rougher.
  soot: (a, _h, r) => ({ albedo: mixRgb(a, [24, 22, 22], 0.42), rough: Math.min(1, r * 1.05) }),
};

// ── Triplanar surface frame ──────────────────────────────────────────────────────────────
// Map a facet normal to a 2-D (u,v) surface frame: which two WORLD components feed (u,v) and
// the world directions of those axes (so a height gradient can perturb the world normal).
// The projection plane is chosen by the dominant normal axis (classic single-plane triplanar
// — no blend seam, because a facet has ONE constant normal). Because this depends only on the
// normal, it is resolved ONCE per facet (in `prepareSurface`), never per pixel.
const normalize3 = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

interface Frame { uAxis: Vec3; vAxis: Vec3 }
/**
 * A true tangent basis IN the facet plane, derived from the normal alone. (u,v) are then real
 * in-surface arc-length coordinates — so a pitched roof's texture advances at the genuine
 * surface rate up the slope (no top-down foreshortening), the metre scale stays isotropic, and
 * the basis is continuous + identical across all coplanar facets (courses run unbroken). Depends
 * only on the normal ⇒ resolved ONCE per facet. Reduces EXACTLY to the old world-axis pick on
 * axis-aligned walls/roofs (v = world-up projected into the plane; u = N × v).
 */
function frameFor(n: Vec3): Frame {
  const N = normalize3(n);
  // World up as the "v" reference, unless the facet is near-horizontal (roof apex/floor/deck) —
  // then up ∥ N degenerates, so fall back to world +y.
  const ref: Vec3 = Math.abs(N[2]) < 0.985 ? [0, 0, 1] : [0, 1, 0];
  const d = N[0] * ref[0] + N[1] * ref[1] + N[2] * ref[2];
  const vAxis = normalize3([ref[0] - N[0] * d, ref[1] - N[1] * d, ref[2] - N[2] * d]); // up the surface
  const uAxis: Vec3 = [                                                                // N × v: across it
    N[1] * vAxis[2] - N[2] * vAxis[1],
    N[2] * vAxis[0] - N[0] * vAxis[2],
    N[0] * vAxis[1] - N[1] * vAxis[0],
  ];
  return { uAxis, vAxis };
}

const NORMAL_BUMP = 0.6;   // how strongly micro-relief tilts the facet normal
const EPS = 0.01;          // finite-difference step (metres) for the relief gradient

/** A surface sampler bound to one facet (material + finish + normal frame resolved once). */
export interface SurfaceSampler {
  /** Sample at a world position. The ONLY per-pixel work: the analytic pattern evals. */
  at(worldPos: Vec3): SurfaceSample;
}

/**
 * Resolve the per-facet surface constants (material LUTs, finish fn, triplanar frame) ONCE,
 * returning a tight per-pixel sampler. This hoists every map/LUT lookup and the frame trig
 * out of the inner loop — the rasterizer calls this once per facet, then `.at()` per opaque
 * pixel. PURE + deterministic.
 *
 * @param unitsPerMetre world units per metre (geometry-scale calibration; default 1).
 *                      Feature wavelengths are authored in metres, so (u,v) is divided by
 *                      this to land them at the right size. K0b passes `mToTiles(1)` (=0.5).
 */
export function prepareSurface(spec: SurfaceSpec, normal: Vec3, unitsPerMetre = 1): SurfaceSampler {
  const base = MATERIAL_RGB[spec.material];
  const baseRough = MATERIAL_PBR[spec.material].roughness;
  // Pick the bond/coursing pattern: explicit work → family default work → family pattern.
  const work = spec.work ?? DEFAULT_WORK[spec.material];
  const pattern = work ? WORK_PATTERNS[work] : PATTERNS[spec.material];
  const finish = FINISHES[spec.finish ?? 'bare'];
  const tint = spec.tint;
  const fr = frameFor(normal);
  const inv = 1 / unitsPerMetre;
  const n0 = normal[0], n1 = normal[1], n2 = normal[2];
  const ua = fr.uAxis, va = fr.vAxis;

  return {
    at(pos: Vec3): SurfaceSample {
      // (u,v) = world position projected onto the in-plane tangent basis → true 1:1 metric
      // surface coordinates (isotropic, slope-correct, continuous across coplanar facets).
      const u = (pos[0] * ua[0] + pos[1] * ua[1] + pos[2] * ua[2]) * inv;
      const v = (pos[0] * va[0] + pos[1] * va[1] + pos[2] * va[2]) * inv;
      const m = pattern(u, v);
      const tone = 1 + m.tone;
      // Material albedo: base modulated by tone + small tint.
      let r = base[0] * tone + m.tint[0];
      let g = base[1] * tone + m.tint[1];
      let b = base[2] * tone + m.tint[2];
      let rough = baseRough * m.rough;
      if (rough < 0) rough = 0; else if (rough > 1) rough = 1;
      // Finish/paint layer over the material.
      const painted = finish([r, g, b], m.height, rough, tint);
      r = painted.albedo[0]; g = painted.albedo[1]; b = painted.albedo[2]; rough = painted.rough;
      const out: RGB = [
        r < 0 ? 0 : r > 255 ? 255 : Math.round(r),
        g < 0 ? 0 : g > 255 ? 255 : Math.round(g),
        b < 0 ? 0 : b > 255 ? 255 : Math.round(b),
      ];
      // Normal perturbation: relief gradient (forward difference on `height`) tilts the facet
      // normal along the surface axes. Two extra pattern evals — the irreducible cost of bump.
      const hC = m.height;
      const dU = (pattern(u + EPS, v).height - hC) / EPS;
      const dV = (pattern(u, v + EPS).height - hC) / EPS;
      const perturbed: Vec3 = [
        n0 - NORMAL_BUMP * (dU * ua[0] + dV * va[0]),
        n1 - NORMAL_BUMP * (dU * ua[1] + dV * va[1]),
        n2 - NORMAL_BUMP * (dU * ua[2] + dV * va[2]),
      ];
      const ao = 0.85 + 0.15 * (hC < 0 ? 0 : hC > 1 ? 1 : hC);
      return { albedo: out, normal: normalize3(perturbed), roughness: rough, ao };
    },
  };
}

/**
 * Convenience single-sample form (tests / one-off lookups). For per-pixel rasterization use
 * `prepareSurface` once per facet then `.at()` per pixel — this re-resolves the facet
 * constants every call.
 */
export function sampleSurface(
  spec: SurfaceSpec, worldPos: Vec3, normal: Vec3, unitsPerMetre = 1,
): SurfaceSample {
  return prepareSurface(spec, normal, unitsPerMetre).at(worldPos);
}
