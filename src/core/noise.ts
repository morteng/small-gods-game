export class Random {
  private seed: number;
  constructor(seed: number) { this.seed = seed; }
  next(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
}

export function noise(x: number, y: number, seed: number): number {
  const r = new Random(seed + x * 374761393 + y * 668265263);
  return r.next();
}

export function smoothNoise(x: number, y: number, seed: number, scale = 4): number {
  const xi = Math.floor(x / scale), yi = Math.floor(y / scale);
  const xf = (x / scale) - xi, yf = (y / scale) - yi;
  const n00 = noise(xi, yi, seed), n10 = noise(xi + 1, yi, seed);
  const n01 = noise(xi, yi + 1, seed), n11 = noise(xi + 1, yi + 1, seed);
  return (n00 * (1 - xf) + n10 * xf) * (1 - yf) + (n01 * (1 - xf) + n11 * xf) * yf;
}

export function fractalNoise(x: number, y: number, seed: number): number {
  let v = 0, a = 1, f = 1, m = 0;
  for (let i = 0; i < 4; i++) {
    v += smoothNoise(x * f, y * f, seed + i * 1000, 4) * a;
    m += a; a *= 0.5; f *= 2;
  }
  return v / m;
}

// ─── Gradient noise (Perlin-style) ────────────────────────────────────────────

/** 8-direction gradient table for 2D Perlin */
const GRAD2: ReadonlyArray<[number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [-1, 1], [1, -1], [-1, -1],
];

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// LRU-style cache for permutation tables (keyed by seed)
const permCache = new Map<number, Uint8Array>();

function getPerm(seed: number): Uint8Array {
  if (permCache.has(seed)) return permCache.get(seed)!;
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  const rng = new Random(seed);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  if (permCache.size > 64) permCache.delete(permCache.keys().next().value!);
  permCache.set(seed, perm);
  return perm;
}

/**
 * Gradient noise (Perlin-style) with seeded permutation table.
 * Returns value in [0, 1].
 */
export function gradientNoise(x: number, y: number, seed: number): number {
  const perm = getPerm(seed);
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = fade(xf);
  const v = fade(yf);

  const aa = perm[perm[xi] + yi];
  const ab = perm[perm[xi] + yi + 1];
  const ba = perm[perm[xi + 1] + yi];
  const bb = perm[perm[xi + 1] + yi + 1];

  const grad = (h: number, dx: number, dy: number): number => {
    const g = GRAD2[h & 7];
    return g[0] * dx + g[1] * dy;
  };

  const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
  const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
  return (lerp(x1, x2, v) + 1) / 2;
}

/**
 * Configurable fractional Brownian motion using gradient noise.
 * Returns value in approximately [0, 1].
 */
export function fbm(x: number, y: number, opts: {
  seed: number;
  octaves?: number;
  lacunarity?: number;
  gain?: number;
  scale?: number;
}): number {
  const { seed, octaves = 6, lacunarity = 2.0, gain = 0.5, scale = 1.0 } = opts;
  let value = 0;
  let amplitude = 1;
  let frequency = scale;
  let maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    value += gradientNoise(x * frequency, y * frequency, seed + i * 1000) * amplitude;
    maxValue += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return value / maxValue;
}

/**
 * Domain-warped noise for organic continent shapes.
 * Offsets sample coordinates using two noise fields.
 */
export function warpedNoise(x: number, y: number, seed: number, warpStrength = 4.0): number {
  const qx = fbm(x, y, { seed: seed + 7000, octaves: 4, scale: 0.01 });
  const qy = fbm(x, y, { seed: seed + 8000, octaves: 4, scale: 0.01 });
  return fbm(x + warpStrength * qx, y + warpStrength * qy, { seed, octaves: 6, scale: 0.01 });
}

/**
 * Ridge noise for mountain ranges.
 * Creates sharp peaks by inverting absolute gradient noise values.
 */
export function ridgeNoise(x: number, y: number, seed: number, octaves = 6): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let weight = 1;
  let maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    const n = gradientNoise(x * frequency, y * frequency, seed + i * 1000);
    const ridge = 1 - Math.abs(n * 2 - 1);
    const weighted = ridge * ridge * weight;
    value += weighted * amplitude;
    maxValue += amplitude;
    weight = ridge * ridge;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return maxValue > 0 ? value / maxValue : 0;
}
