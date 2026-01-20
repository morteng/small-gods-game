/**
 * Small Gods - Noise Functions
 */

class Random {
  constructor(seed) { this.seed = seed; }
  next() {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }
  int(min, max) { return Math.floor(this.next() * (max - min + 1)) + min; }
}

function noise(x, y, seed) {
  const r = new Random(seed + x * 374761393 + y * 668265263);
  return r.next();
}

function smoothNoise(x, y, seed, scale = 4) {
  const xi = Math.floor(x / scale), yi = Math.floor(y / scale);
  const xf = (x / scale) - xi, yf = (y / scale) - yi;
  const n00 = noise(xi, yi, seed), n10 = noise(xi + 1, yi, seed);
  const n01 = noise(xi, yi + 1, seed), n11 = noise(xi + 1, yi + 1, seed);
  return (n00 * (1-xf) + n10 * xf) * (1-yf) + (n01 * (1-xf) + n11 * xf) * yf;
}

function fractalNoise(x, y, seed) {
  let v = 0, a = 1, f = 1, m = 0;
  for (let i = 0; i < 4; i++) {
    v += smoothNoise(x * f, y * f, seed + i * 1000, 4) * a;
    m += a; a *= 0.5; f *= 2;
  }
  return v / m;
}
