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

/** Resolved surface tag for one facet (from `Blueprint.materials` + `Palette` in K0c). */
export interface SurfaceSpec {
  material: Mat;
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

const PATTERNS: Record<Mat, Pattern> = {
  // Ashlar / rubble stone: blocky facets (worley) with grooved joints + fine grain.
  stone: (u, v) => {
    const { dist, hash } = cellular(u, v, 0.7);
    const seam = Math.min(1, dist / 0.22);                 // 0 at block centre → 1 at the joint
    const grain = fbm(u * 3.2, v * 3.2, 3);
    const joint = 1 - seam;                                // deep in the joint
    return {
      tone: 0.10 * (hash - 0.5) + 0.12 * (grain - 0.5) - 0.30 * joint,
      tint: ZERO_TINT,
      height: 0.25 + 0.6 * seam + 0.15 * grain,
      rough: 1 + 0.1 * joint,
    };
  },
  // Brick: running bond, warm clay variance per brick, recessed mortar.
  brick: (u, v) => {
    const b = bond(u, v, 0.22, 0.075, 0.012);              // ~22×7.5 cm bricks, ~1.2 cm joint
    const clay = (b.h - 0.5);
    return {
      tone: 0.16 * clay - 0.42 * b.joint,
      tint: b.joint > 0.5 ? [-12, -10, -8] : [10 * clay, -4, -8] as RGB,
      height: 0.7 * (1 - b.joint),
      rough: 1 + 0.15 * b.joint,
    };
  },
  // Timber: directional grain (stretched along u) + plank seams across v.
  timber: (u, v) => {
    const grain = fbm(u * 1.2, v * 9, 3);                  // tight across-grain, loose along
    const ring = 0.5 + 0.5 * Math.sin((v * 7 + grain * 1.5) * Math.PI * 2);
    const plank = 1 - Math.min(1, (Math.abs((v / 0.18) % 1 - 0.5) * 0.18) / 0.01);
    return {
      tone: 0.14 * (grain - 0.5) + 0.08 * (ring - 0.5) - 0.35 * plank,
      tint: ZERO_TINT,
      height: 0.4 * ring + 0.4 * (1 - plank),
      rough: 1,
    };
  },
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
interface Frame { uIdx: 0 | 1 | 2; vIdx: 0 | 1 | 2; uAxis: Vec3; vAxis: Vec3 }
function frameFor(n: Vec3): Frame {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  if (az >= ax && az >= ay) {                                          // horizontal (roof/floor/deck)
    return { uIdx: 0, vIdx: 1, uAxis: [1, 0, 0], vAxis: [0, 1, 0] };   // ground plane
  }
  if (ax >= ay) {                                                      // wall facing ±x
    return { uIdx: 1, vIdx: 2, uAxis: [0, 1, 0], vAxis: [0, 0, 1] };   // world-y × up
  }
  return { uIdx: 0, vIdx: 2, uAxis: [1, 0, 0], vAxis: [0, 0, 1] };     // wall facing ±y: world-x × up
}

const normalize3 = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

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
  const pattern = PATTERNS[spec.material];
  const finish = FINISHES[spec.finish ?? 'bare'];
  const tint = spec.tint;
  const fr = frameFor(normal);
  const inv = 1 / unitsPerMetre;
  const n0 = normal[0], n1 = normal[1], n2 = normal[2];
  const ua = fr.uAxis, va = fr.vAxis;

  return {
    at(pos: Vec3): SurfaceSample {
      const u = pos[fr.uIdx] * inv, v = pos[fr.vIdx] * inv;
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
