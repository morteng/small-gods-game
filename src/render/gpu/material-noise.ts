// src/render/gpu/material-noise.ts
//
// Shared, pure, DETERMINISTIC procedural-texture primitives for the tileable
// material-exemplar layer (terrain + road surfaces). Extracted so the exemplar
// generators (`material-exemplar.ts`) and the legacy road atlas can share one
// seamless-noise implementation. No `Math.random` → replay-safe; Node + browser.
//
// Everything here is built to be TOROIDAL (period == tile size) so a tile sampled
// edge-to-edge wraps with no seam — the prerequisite for repeating a material across
// the map AND for the img2img tileability gate (a 3×3 super-tile crop must wrap).

/** Deterministic 0..1 hash of an integer lattice cell (periodic via caller mod). */
export function hashCell(ix: number, iy: number): number {
  let h = (Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h >>> 0) / 4294967295;
}

/** Periodic value noise on a grid of period `P` (seamless across the tile edges). */
export function periodicNoise(x: number, y: number, P: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf);
  const sy = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % P) + P) % P, y0 = ((yi % P) + P) % P;
  const x1 = ((xi + 1) % P + P) % P, y1 = ((yi + 1) % P + P) % P;
  const a = hashCell(x0, y0);
  const b = hashCell(x1, y0);
  const c = hashCell(x0, y1);
  const d = hashCell(x1, y1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/**
 * Periodic fractal (fBm) value noise: `octaves` of `periodicNoise`, each at double
 * frequency / half amplitude, normalised to ~0..1. `baseP` is the period (in lattice
 * cells) of the lowest octave; it doubles per octave so every octave stays seamless.
 */
export function periodicFbm(x: number, y: number, baseP: number, octaves: number): number {
  let sum = 0, amp = 1, norm = 0, P = baseP;
  let fx = x, fy = y;
  for (let o = 0; o < octaves; o++) {
    sum += amp * periodicNoise(fx, fy, P);
    norm += amp;
    amp *= 0.5;
    P *= 2; fx *= 2; fy *= 2;
  }
  return sum / (norm || 1);
}

/** Toroidal wrap helper for sampling a heightfield/lattice at the tile edges. */
export function wrap(i: number, n: number): number {
  return ((i % n) + n) % n;
}

/**
 * Toroidal Worley/cellular noise on a `cellsAcross`×`cellsAcross` jittered grid.
 * Returns the distance (in texels) to the nearest jittered point and that point's
 * 0..1 hash, measured with toroidal nearest-image so the pattern wraps seamlessly.
 * The workhorse for cobble setts and gravel chips.
 */
export function worley(x: number, y: number, size: number, cellsAcross: number, jitter = 0.5):
  { dist: number; hash: number } {
  const cell = size / cellsAcross;
  const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
  let best = 1e9, bestHash = 0;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const gx = cx + ox, gy = cy + oy;
      const wx = wrap(gx, cellsAcross), wy = wrap(gy, cellsAcross);
      const hx = hashCell(wx, wy);
      const hy = hashCell(wx + 7, wy + 3);
      const px = (gx + (1 - jitter) * 0.5 + jitter * hx) * cell;
      const py = (gy + (1 - jitter) * 0.5 + jitter * hy) * cell;
      let dx = px - x, dy = py - y;
      if (dx > size / 2) dx -= size; else if (dx < -size / 2) dx += size;
      if (dy > size / 2) dy -= size; else if (dy < -size / 2) dy += size;
      const d = dx * dx + dy * dy;          // squared — compare in d², sqrt once at the end
      if (d < best) { best = d; bestHash = hx; }
    }
  }
  return { dist: Math.sqrt(best), hash: bestHash };
}

/**
 * Local-frame normal from a TOROIDAL heightfield, encoded into RGBA8 (RG in-plane bump,
 * B up), written into `out` at `layerOffset`. `bump` scales the in-plane slope (bigger =
 * deeper relief). Wraps at the edges so the normal map is seamless too.
 */
export function encodeNormal(
  height: Float32Array, size: number, bump: number, out: Uint8Array, layerOffset = 0,
): void {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hl = height[y * size + wrap(x - 1, size)];
      const hr = height[y * size + wrap(x + 1, size)];
      const hu = height[wrap(y - 1, size) * size + x];
      const hd = height[wrap(y + 1, size) * size + x];
      let nx = -(hr - hl) * 0.5;
      let ny = -(hd - hu) * 0.5;
      let nz = 1 / Math.max(0.05, bump);
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const o = layerOffset + (y * size + x) * 4;
      out[o] = ((nx * 0.5 + 0.5) * 255) | 0;
      out[o + 1] = ((ny * 0.5 + 0.5) * 255) | 0;
      out[o + 2] = ((nz * 0.5 + 0.5) * 255) | 0;
      out[o + 3] = 255;
    }
  }
}

/** Clamp + pack a 0..1 RGB triple (opaque) into an RGBA8 buffer at texel index `i`. */
export function packRgb(albedo: Uint8Array, i: number, r: number, g: number, b: number): void {
  albedo[i * 4] = Math.max(0, Math.min(255, (r * 255) | 0));
  albedo[i * 4 + 1] = Math.max(0, Math.min(255, (g * 255) | 0));
  albedo[i * 4 + 2] = Math.max(0, Math.min(255, (b * 255) | 0));
  albedo[i * 4 + 3] = 255;
}
