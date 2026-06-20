// src/render/gpu/road-material-atlas.ts
//
// PLACEHOLDER tileable PBR road-surface materials — the zero-spend prototype of
// "run roads through the generative pipeline". The generative pipeline's end product
// for a building is a SpritePack (albedo + screen-space normal + material); a road's
// analogue is a SEAMLESS surface swatch (albedo + tangent-space normal) sampled by the
// ribbon shader, lit by the same banded sun. This module hand-authors that swatch
// procedurally so the SAMPLING + NORMAL-MAPPED LIGHTING path can be proven now; an
// img2img-generated swatch drops into the exact same texture slot later (freeze-safe).
//
// Output is a small TEXTURE ARRAY: one square, seamless (toroidal) layer per surface —
// DIRT, COBBLE, PLANK. Each layer carries:
//   * albedo  RGBA8 — the surface colour.
//   * normal  RGBA8 — a LOCAL-frame normal (base (0,0,1) = up), RG = the in-plane bump
//     from the surface heightfield, encoded n*0.5+0.5. The ribbon FS rotates it into
//     tile space (X across, Z along) by the road tangent and dots it with the sun, so
//     cobble domes catch the light. Deterministic (no Math.random) → replay-safe.

/** Surface layer indices in the material array (must match the shader's selection). */
export const ROAD_MAT = { dirt: 0, cobble: 1, plank: 2 } as const;
export const ROAD_MAT_LAYERS = 3;

export interface RoadMaterialAtlas {
  /** Edge length of each square layer in texels. */
  size: number;
  /** Layer count (= ROAD_MAT_LAYERS). */
  layers: number;
  /** RGBA8 albedo, layers stacked (size*size*4 per layer). */
  albedo: Uint8Array;
  /** RGBA8 local-frame normal (RG bump, B up), layers stacked. */
  normal: Uint8Array;
}

/** Deterministic 0..1 hash of an integer lattice cell (periodic via caller mod). */
function hashCell(ix: number, iy: number): number {
  let h = (Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h >>> 0) / 4294967295;
}

/** Periodic value noise on a grid of period `P` (seamless across the tile edges). */
function periodicNoise(x: number, y: number, P: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf);
  const sy = yf * yf * (3 - 2 * yf);
  const m = (v: number) => ((v % P) + P) % P;
  const a = hashCell(m(xi), m(yi));
  const b = hashCell(m(xi + 1), m(yi));
  const c = hashCell(m(xi), m(yi + 1));
  const d = hashCell(m(xi + 1), m(yi + 1));
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Toroidal wrap helper for sampling the heightfield at the tile edges. */
function wrap(i: number, n: number): number {
  return ((i % n) + n) % n;
}

interface LayerBuild {
  height: Float32Array; // 0..1 surface height for the normal
  albedo: Uint8Array;   // RGBA, premultiplied-irrelevant (opaque)
}

function buildDirt(size: number): LayerBuild {
  const height = new Float32Array(size * size);
  const albedo = new Uint8Array(size * size * 4);
  const F = 8 / size; // ~8 lumps across the tile
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = 0.6 * periodicNoise(x * F, y * F, 8) + 0.4 * periodicNoise(x * F * 2, y * F * 2, 16);
      const i = y * size + x;
      height[i] = n * 0.4; // low relief — packed earth, gentle
      // Brown, mottled by the same noise.
      const r = 0.30 + 0.12 * n, g = 0.24 + 0.10 * n, b = 0.16 + 0.07 * n;
      albedo[i * 4] = (r * 255) | 0;
      albedo[i * 4 + 1] = (g * 255) | 0;
      albedo[i * 4 + 2] = (b * 255) | 0;
      albedo[i * 4 + 3] = 255;
    }
  }
  return { height, albedo };
}

function buildCobble(size: number): LayerBuild {
  const height = new Float32Array(size * size);
  const albedo = new Uint8Array(size * size * 4);
  const cellsAcross = 4;            // 4 setts across the seamless tile
  const cell = size / cellsAcross;
  const R = cell * 0.46;            // dome radius (leaves a mortar gap)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Find the nearest jittered sett centre among the 3×3 neighbouring cells,
      // measuring toroidally so the pattern wraps seamlessly.
      let best = 1e9, bestHash = 0;
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const gx = cx + ox, gy = cy + oy;
          const hx = hashCell(wrap(gx, cellsAcross), wrap(gy, cellsAcross));
          const hy = hashCell(wrap(gx, cellsAcross) + 7, wrap(gy, cellsAcross) + 3);
          const px = (gx + 0.25 + 0.5 * hx) * cell;
          const py = (gy + 0.25 + 0.5 * hy) * cell;
          let dx = px - x, dy = py - y;
          // toroidal nearest image
          if (dx > size / 2) dx -= size; else if (dx < -size / 2) dx += size;
          if (dy > size / 2) dy -= size; else if (dy < -size / 2) dy += size;
          const d = Math.hypot(dx, dy);
          if (d < best) { best = d; bestHash = hx; }
        }
      }
      const i = y * size + x;
      const t = Math.min(1, best / R);
      const dome = best <= R ? Math.sqrt(1 - t * t) : 0; // rounded sett, 0 in the mortar
      const mortar = best > R ? 1 : 0;
      height[i] = dome;
      // Per-sett granite tone; mortar darker (the normal map adds the lit relief, so
      // the albedo stays mid-dark to avoid blowing out under the banded sun).
      const tone = 0.34 + 0.13 * bestHash;
      const lit = mortar ? 0.15 : tone * (0.85 + 0.15 * dome);
      albedo[i * 4] = (lit * 255) | 0;
      albedo[i * 4 + 1] = (lit * 252) | 0;
      albedo[i * 4 + 2] = (lit * 245) | 0;
      albedo[i * 4 + 3] = 255;
    }
  }
  return { height, albedo };
}

function buildPlank(size: number): LayerBuild {
  const height = new Float32Array(size * size);
  const albedo = new Uint8Array(size * size * 4);
  const planks = 5;                 // boards across the span
  const pw = size / planks;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Boards run along x (the road's `along`); seams between boards run across y.
      const pIdx = Math.floor(y / pw);
      const inBoard = (y - pIdx * pw) / pw;       // 0..1 within a board
      const seam = inBoard < 0.08 || inBoard > 0.92 ? 1 : 0;
      const grain = periodicNoise(x * (16 / size), pIdx * 3.1, 16);
      const i = y * size + x;
      // Boards crown slightly in the middle, drop at the seams.
      height[i] = seam ? 0.1 : 0.4 + 0.25 * Math.sin(inBoard * Math.PI);
      const wood = 0.40 + 0.16 * grain;
      const c = seam ? 0.16 : wood;
      albedo[i * 4] = (c * 255) | 0;
      albedo[i * 4 + 1] = (c * 0.72 * 255) | 0;
      albedo[i * 4 + 2] = (c * 0.45 * 255) | 0;
      albedo[i * 4 + 3] = 255;
    }
  }
  return { height, albedo };
}

/** Local-frame normal from a toroidal heightfield, encoded into RGBA8 (RG in-plane,
 *  B up). `bump` scales the in-plane slope (bigger = deeper relief). */
function encodeNormal(height: Float32Array, size: number, bump: number, out: Uint8Array, layerOffset: number): void {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hl = height[y * size + wrap(x - 1, size)];
      const hr = height[y * size + wrap(x + 1, size)];
      const hu = height[wrap(y - 1, size) * size + x];
      const hd = height[wrap(y + 1, size) * size + x];
      // n = normalize(-dH/dx, -dH/dy, 1/bump): x→along (texture x), y→across (texture y).
      let nx = -(hr - hl) * 0.5;
      let ny = -(hd - hu) * 0.5;
      let nz = 1 / Math.max(0.05, bump);
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const o = layerOffset + (y * size + x) * 4;
      out[o] = ((nx * 0.5 + 0.5) * 255) | 0;
      out[o + 1] = ((ny * 0.5 + 0.5) * 255) | 0;
      out[o + 2] = ((nz * 0.5 + 0.5) * 255) | 0;
      out[o + 3] = 255;
    }
  }
}

/**
 * Build the placeholder road-material atlas: a `size`-square seamless layer per surface
 * (dirt, cobble, plank), each with albedo + a local-frame normal. Pure + deterministic.
 */
export function buildRoadMaterialAtlas(size = 64): RoadMaterialAtlas {
  const per = size * size * 4;
  const albedo = new Uint8Array(per * ROAD_MAT_LAYERS);
  const normal = new Uint8Array(per * ROAD_MAT_LAYERS);

  const layers = [buildDirt(size), buildCobble(size), buildPlank(size)];
  const bumps = [0.18, 0.6, 0.4]; // dirt subtle, cobble pronounced, plank medium
  for (let l = 0; l < ROAD_MAT_LAYERS; l++) {
    albedo.set(layers[l].albedo, l * per);
    encodeNormal(layers[l].height, size, bumps[l], normal, l * per);
  }
  return { size, layers: ROAD_MAT_LAYERS, albedo, normal };
}

// Memoised — the atlas is content-static, built once per session.
let memo: RoadMaterialAtlas | null = null;
export function roadMaterialAtlas(): RoadMaterialAtlas {
  if (!memo) memo = buildRoadMaterialAtlas();
  return memo;
}
