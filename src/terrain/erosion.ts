/**
 * Particle-based hydraulic erosion.
 *
 * Standard formulation (see Sebastian Lague's Coding Adventures):
 *   For each particle:
 *     spawn at random position
 *     while it has water and is on-map:
 *       compute gradient direction
 *       update velocity (with inertia)
 *       move to new position
 *       compute slope between old and new
 *       sediment capacity = max(slope * velocity * water * capacityFactor, minSlope)
 *       if sediment > capacity: deposit excess at old position
 *       else: erode (capacity - sediment) from old position, add to sediment
 *       update velocity from slope and gravity
 *       evaporate water
 *
 * Produces eroded peaks and deposited valleys. Pure function: returns new array,
 * does not mutate input.
 */

const DEFAULT_NUM_PARTICLES = 2000;
const DEFAULT_INERTIA = 0.1;
const DEFAULT_SEDIMENT_CAPACITY_FACTOR = 4;
const DEFAULT_MIN_SLOPE = 0.01;
const DEFAULT_ERODE_FACTOR = 0.3;
const DEFAULT_DEPOSIT_FACTOR = 0.3;
const DEFAULT_EVAPORATION = 0.01;
const DEFAULT_GRAVITY = 4;
const DEFAULT_MAX_STEPS = 64;
const DEFAULT_SEED = 1;

export interface ErosionOptions {
  /** Number of erosion particles to simulate. Default 2000. */
  numParticles?: number;
  /** Velocity inertia [0..1]. 0 = pure gradient descent, 1 = ballistic. Default 0.1. */
  inertia?: number;
  /** Sediment capacity multiplier. Default 4. Higher = more erosion. */
  sedimentCapacityFactor?: number;
  /** Minimum slope to treat as positive (numerical floor). Default 0.01. */
  minSlope?: number;
  /** Fraction of available capacity eroded per step. Default 0.3. */
  erodeFactor?: number;
  /** Fraction of excess sediment deposited per step. Default 0.3. */
  depositFactor?: number;
  /** Per-step water evaporation. Default 0.01. */
  evaporation?: number;
  /** Gravity coefficient for velocity update. Default 4. */
  gravity?: number;
  /** Max steps per particle. Default 64. */
  maxSteps?: number;
  /** RNG seed for particle spawn positions. Default 1. */
  seed?: number;
}

/**
 * Apply hydraulic erosion to an elevation field. Returns a new Float32Array;
 * the input is not mutated.
 */
export function erodeElevation(
  source: Float32Array,
  width: number,
  height: number,
  options: ErosionOptions = {},
): Float32Array {
  const numParticles            = options.numParticles            ?? DEFAULT_NUM_PARTICLES;
  const inertia                 = options.inertia                 ?? DEFAULT_INERTIA;
  const sedimentCapacityFactor  = options.sedimentCapacityFactor  ?? DEFAULT_SEDIMENT_CAPACITY_FACTOR;
  const minSlope                = options.minSlope                ?? DEFAULT_MIN_SLOPE;
  const erodeFactor             = options.erodeFactor             ?? DEFAULT_ERODE_FACTOR;
  const depositFactor           = options.depositFactor           ?? DEFAULT_DEPOSIT_FACTOR;
  const evaporation             = options.evaporation             ?? DEFAULT_EVAPORATION;
  const gravity                 = options.gravity                 ?? DEFAULT_GRAVITY;
  const maxSteps                = options.maxSteps                ?? DEFAULT_MAX_STEPS;
  const seed                    = options.seed                    ?? DEFAULT_SEED;

  const elev = new Float32Array(source);

  // Mulberry32 seeded RNG
  let rngState = seed | 0;
  const rand = (): number => {
    rngState = (rngState + 0x6D2B79F5) | 0;
    let t = rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const sampleElev = (x: number, y: number): number => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const x0 = Math.max(0, Math.min(width  - 1, xi));
    const y0 = Math.max(0, Math.min(height - 1, yi));
    const x1 = Math.min(width  - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const e00 = elev[y0 * width + x0];
    const e10 = elev[y0 * width + x1];
    const e01 = elev[y1 * width + x0];
    const e11 = elev[y1 * width + x1];
    return e00 * (1 - fx) * (1 - fy)
         + e10 * fx       * (1 - fy)
         + e01 * (1 - fx) * fy
         + e11 * fx       * fy;
  };

  const modElev = (x: number, y: number, amount: number): void => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const x0 = Math.max(0, Math.min(width  - 1, xi));
    const y0 = Math.max(0, Math.min(height - 1, yi));
    const x1 = Math.min(width  - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    elev[y0 * width + x0] += amount * (1 - fx) * (1 - fy);
    elev[y0 * width + x1] += amount * fx       * (1 - fy);
    elev[y1 * width + x0] += amount * (1 - fx) * fy;
    elev[y1 * width + x1] += amount * fx       * fy;
  };

  for (let p = 0; p < numParticles; p++) {
    let px = rand() * (width  - 1);
    let py = rand() * (height - 1);
    let dx = 0, dy = 0;
    let velocity = 1;
    let water = 1;
    let sediment = 0;

    for (let step = 0; step < maxSteps; step++) {
      const xi = Math.floor(px), yi = Math.floor(py);
      const x0 = Math.max(0, Math.min(width  - 1, xi));
      const y0 = Math.max(0, Math.min(height - 1, yi));
      const x1 = Math.min(width  - 1, x0 + 1);
      const y1 = Math.min(height - 1, y0 + 1);
      const fx = px - xi, fy = py - yi;
      const e00 = elev[y0 * width + x0];
      const e10 = elev[y0 * width + x1];
      const e01 = elev[y1 * width + x0];
      const e11 = elev[y1 * width + x1];
      const gx = (e10 - e00) * (1 - fy) + (e11 - e01) * fy;
      const gy = (e01 - e00) * (1 - fx) + (e11 - e10) * fx;

      dx = dx * inertia - gx * (1 - inertia);
      dy = dy * inertia - gy * (1 - inertia);
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 1e-8) { dx /= len; dy /= len; }

      const oldX = px, oldY = py;
      px += dx;
      py += dy;

      if (px < 0 || px >= width - 1 || py < 0 || py >= height - 1) break;

      const eOld = sampleElev(oldX, oldY);
      const eNew = sampleElev(px,   py);
      const slope = eOld - eNew;

      const capacity = Math.max(slope, minSlope) * velocity * water * sedimentCapacityFactor;

      if (sediment > capacity || slope < 0) {
        const deposit = (slope < 0) ? Math.min(-slope, sediment) : (sediment - capacity) * depositFactor;
        sediment -= deposit;
        modElev(oldX, oldY, deposit);
      } else {
        const erode = Math.min((capacity - sediment) * erodeFactor, slope);
        sediment += erode;
        modElev(oldX, oldY, -erode);
      }

      velocity = Math.sqrt(Math.max(0, velocity * velocity + slope * gravity));
      water *= (1 - evaporation);
      if (water < 1e-3) break;
    }
  }

  for (let i = 0; i < elev.length; i++) {
    if (elev[i] < 0) elev[i] = 0;
    else if (elev[i] > 1) elev[i] = 1;
  }

  return elev;
}
