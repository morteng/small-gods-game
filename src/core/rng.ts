export type RngState = readonly [number, number, number, number];

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, maxExclusive). */
  nextInt(maxExclusive: number): number;
  /** Uniform pick from a non-empty array. */
  pick<T>(arr: readonly T[]): T;
  /** Serializable state snapshot. */
  getState(): RngState;
}

/** Cheap hash mixing to seed sfc32's four u32 state words from one number. */
function expandSeed(seed: number): RngState {
  let z = (seed | 0) >>> 0;
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    z = ((z + 0x9e3779b9) | 0) >>> 0;
    let x = z;
    x = (Math.imul(x ^ (x >>> 16), 0x85ebca6b)) >>> 0;
    x = (Math.imul(x ^ (x >>> 13), 0xc2b2ae35)) >>> 0;
    x = (x ^ (x >>> 16)) >>> 0;
    out.push(x);
  }
  return [out[0], out[1], out[2], out[3]] as RngState;
}

class Sfc32 implements Rng {
  private a: number; private b: number; private c: number; private d: number;
  constructor(state: RngState) {
    this.a = state[0] >>> 0;
    this.b = state[1] >>> 0;
    this.c = state[2] >>> 0;
    this.d = state[3] >>> 0;
  }
  next(): number {
    const t = (this.a + this.b | 0) + this.d | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 0x1_0000_0000;
  }
  nextInt(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.nextInt(arr.length)];
  }
  getState(): RngState {
    return [this.a >>> 0, this.b >>> 0, this.c >>> 0, this.d >>> 0];
  }
}

export function createRng(seed: number): Rng {
  return new Sfc32(expandSeed(seed));
}

export function fromState(state: RngState): Rng {
  return new Sfc32(state);
}
