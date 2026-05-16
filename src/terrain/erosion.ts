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
  // Implementation in Task 2.
  void width; void height; void options;
  return new Float32Array(source);
}
