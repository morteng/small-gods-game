# Phase 3 — Hydraulic Erosion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a particle-based hydraulic erosion pre-pass to the elevation field, producing eroded continents (smoothed peaks, deposited valleys) before biome classification.

**Algorithm:** Standard particle erosion (Sebastian Lague / GPU Gems style). For each of ~2000 particles: spawn at random position, walk downhill via gradient, carry sediment, deposit when capacity exceeded, erode when capacity available. Mutates elevation array.

**Architecture:** New module `src/terrain/erosion.ts` consuming a `Float32Array` of elevation values. Returns a new eroded `Float32Array`. Wired into `generateWithNoise` between `generateTerrainFields()` and `classifyBiomes()`.

**Tech Stack:** TypeScript ES modules, Vitest. Pure function (returns new array, does not mutate input).

---

## Task 1: Module skeleton + types

**Files:**
- Create: `src/terrain/erosion.ts`

- [ ] **Step 1: Create the module**

```typescript
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
  void options;
  return new Float32Array(source);
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | grep "error TS" | grep -v "tests/e2e" | head
```

- [ ] **Step 3: Commit**

```bash
git add src/terrain/erosion.ts
git commit -m "feat(terrain): erosion module skeleton and types"
```

---

## Task 2: Implement particle simulation (TDD)

**Files:**
- Create: `tests/unit/erosion.test.ts`
- Modify: `src/terrain/erosion.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/erosion.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { erodeElevation } from '@/terrain/erosion';

describe('erodeElevation', () => {
  it('does not mutate the input array', () => {
    const source = new Float32Array(64 * 64);
    for (let i = 0; i < source.length; i++) source[i] = Math.random();
    const snapshot = new Float32Array(source);
    const result = erodeElevation(source, 64, 64, { numParticles: 100 });
    // Source unchanged
    for (let i = 0; i < source.length; i++) {
      expect(source[i]).toBe(snapshot[i]);
    }
    // Result is a different array
    expect(result).not.toBe(source);
    expect(result.length).toBe(source.length);
  });

  it('preserves overall elevation range roughly (no runaway values)', () => {
    // Start with a deterministic noise-like pattern
    const w = 64, h = 64;
    const source = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // simple sinusoidal "hills"
        source[y * w + x] = 0.5 + 0.3 * Math.sin(x * 0.2) * Math.cos(y * 0.2);
      }
    }
    const minBefore = Math.min(...source);
    const maxBefore = Math.max(...source);

    const result = erodeElevation(source, w, h, { numParticles: 500 });

    const minAfter = Math.min(...result);
    const maxAfter = Math.max(...result);

    // Result stays in [0, 1]
    expect(minAfter).toBeGreaterThanOrEqual(0);
    expect(maxAfter).toBeLessThanOrEqual(1);
    // Range shouldn't shift by more than ~0.2 in either direction
    expect(Math.abs(minAfter - minBefore)).toBeLessThan(0.2);
    expect(Math.abs(maxAfter - maxBefore)).toBeLessThan(0.2);
  });

  it('is deterministic given a seed', () => {
    const source = new Float32Array(32 * 32);
    for (let i = 0; i < source.length; i++) source[i] = (i % 17) / 17;

    const a = erodeElevation(source, 32, 32, { numParticles: 100, seed: 42 });
    const b = erodeElevation(source, 32, 32, { numParticles: 100, seed: 42 });

    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBe(b[i]);
    }
  });

  it('smooths sharp peaks (post-erosion max ≤ pre-erosion max)', () => {
    const w = 32, h = 32;
    const source = new Float32Array(w * h).fill(0.3);
    // Single very sharp peak at center
    source[16 * w + 16] = 0.95;
    source[15 * w + 16] = 0.7;
    source[17 * w + 16] = 0.7;
    source[16 * w + 15] = 0.7;
    source[16 * w + 17] = 0.7;

    const result = erodeElevation(source, w, h, {
      numParticles: 2000,
      seed: 1,
    });

    // Peak should be either eroded (lower) or unchanged; never higher.
    expect(result[16 * w + 16]).toBeLessThanOrEqual(0.95);
  });
});
```

- [ ] **Step 2: Run — confirm failures**

```bash
npx vitest run tests/unit/erosion.test.ts
```

Expected: tests 1 and 3 PASS (they accept the stub's "return a copy" behaviour); tests 2 and 4 may also PASS trivially (no erosion = no change). All tests should pass against the stub since it just returns a copy. That's fine — TDD here means we'll write the tests, then add behaviour, then verify the *interesting* invariants (range, smoothing).

Actually, re-evaluate: the test "smooths sharp peaks" asserts `<= 0.95`. The stub returns the input unchanged, so it passes too. We need a *non-trivial* test that the stub fails on.

Add this test that requires erosion to be happening:

```typescript
  it('actually changes some cells (proves erosion is happening, not a pass-through)', () => {
    const w = 32, h = 32;
    const source = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        source[y * w + x] = 0.5 + 0.3 * Math.sin(x * 0.5) * Math.cos(y * 0.5);
      }
    }
    const result = erodeElevation(source, w, h, { numParticles: 500, seed: 1 });
    let differences = 0;
    for (let i = 0; i < source.length; i++) {
      if (Math.abs(result[i] - source[i]) > 1e-6) differences++;
    }
    expect(differences).toBeGreaterThan(50); // at least ~5% of cells changed
  });
```

Run tests again — this one should FAIL against the stub.

- [ ] **Step 3: Implement `erodeElevation` in `src/terrain/erosion.ts`**

Replace the stub body with:

```typescript
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

  // Working copy — we mutate this and return it.
  const elev = new Float32Array(source);

  // Simple seeded RNG (Mulberry32) — keeps determinism without pulling in core/noise.
  let rngState = seed | 0;
  const rand = (): number => {
    rngState = (rngState + 0x6D2B79F5) | 0;
    let t = rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Bilinear sample of elevation at fractional position (x, y).
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

  // Bilinear add (deposit/erode) at fractional position.
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
      // Compute gradient via finite differences on the integer grid corner
      const x0 = Math.max(0, Math.min(width  - 1, xi));
      const y0 = Math.max(0, Math.min(height - 1, yi));
      const x1 = Math.min(width  - 1, x0 + 1);
      const y1 = Math.min(height - 1, y0 + 1);
      const fx = px - xi, fy = py - yi;
      const e00 = elev[y0 * width + x0];
      const e10 = elev[y0 * width + x1];
      const e01 = elev[y1 * width + x0];
      const e11 = elev[y1 * width + x1];
      // Negative gradient = downhill direction
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

      // Sediment capacity
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

      // Update velocity from slope (gravity), evaporate water
      velocity = Math.sqrt(Math.max(0, velocity * velocity + slope * gravity));
      water *= (1 - evaporation);
      if (water < 1e-3) break;
    }
  }

  // Clamp to [0, 1]
  for (let i = 0; i < elev.length; i++) {
    if (elev[i] < 0) elev[i] = 0;
    else if (elev[i] > 1) elev[i] = 1;
  }

  return elev;
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/unit/erosion.test.ts
```

Expected: 5/5 PASS (4 from spec + the "actually changes" probe).

```bash
npm test 2>&1 | tail -5
```

Expected: 276 tests (271 + 5).

- [ ] **Step 5: Commit**

```bash
git add src/terrain/erosion.ts tests/unit/erosion.test.ts
git commit -m "feat(terrain): particle-based hydraulic erosion"
```

---

## Task 3: Wire into `generateWithNoise`

**Files:**
- Modify: `src/map/map-generator.ts`

- [ ] **Step 1: Edit `src/map/map-generator.ts`**

(a) Add import:

```typescript
import { erodeElevation } from '@/terrain/erosion';
```

(b) Inside `generateWithNoise`, find the line:

```typescript
  const fields = generateTerrainFields(config);
```

(currently around line 107). Immediately after it, insert:

```typescript
  // Apply hydraulic erosion to soften peaks and deposit valleys.
  report('Eroding terrain...');
  const erodedElevation = erodeElevation(fields.elevation, width, height, { seed });
  fields.elevation = erodedElevation;
```

Wait — `fields.elevation` is a property of the `TerrainField` interface. Check whether it's mutable. Looking at `src/core/types.ts:205`:

```typescript
export interface TerrainField {
  elevation: Float32Array;
  moisture: Float32Array;
  temperature: Float32Array;
}
```

It is a regular property, not readonly. The assignment will work.

(c) Verify:

```bash
npm test 2>&1 | tail -5
```

All 276 tests should still pass (existing tests don't depend on un-eroded elevation specifically).

Run hydrology + carve-connections regression tests in particular:

```bash
npx vitest run tests/unit/hydrology-integration.test.ts tests/unit/carve-connections.test.ts
```

Expected: PASS. If hydrology's river-count assertion now falls outside the [35, 142] window because erosion changed the elevation distribution, widen the window or report.

- [ ] **Step 2: Commit**

```bash
git add src/map/map-generator.ts
git commit -m "feat(terrain): erode elevation field before biome classification"
```

---

## Task 4: Visual smoke + tuning

- [ ] **Step 1: Probe river counts post-erosion**

Create `tests/unit/_probe-erosion.test.ts`:

```typescript
import { describe, it } from 'vitest';
import { generateWithNoise } from '@/map/map-generator';
import type { WorldSeed } from '@/core/types';

describe('probe: post-erosion at 128×96', () => {
  it('reports counts for seeds 1..5', async () => {
    const seed: WorldSeed = {
      name: 'probe',
      size: { width: 128, height: 96 },
      biome: 'temperate',
      pois: [],
      connections: [],
      constraints: [],
    };
    for (let s = 1; s <= 5; s++) {
      const { map } = await generateWithNoise(128, 96, s, seed);
      let rivers = 0, water = 0, mountains = 0;
      for (let y = 0; y < 96; y++) {
        for (let x = 0; x < 128; x++) {
          const t = map.tiles[y]?.[x]?.type ?? '';
          if (t === 'river') rivers++;
          else if (['shallow_water','deep_water','ocean'].includes(t)) water++;
          else if (['mountain','peak'].includes(t)) mountains++;
        }
      }
      console.log(`seed=${s}: rivers=${rivers} water=${water} mountains=${mountains}`);
    }
  });
});
```

Run:

```bash
npx vitest run tests/unit/_probe-erosion.test.ts 2>&1 | grep -E "seed=|PASS|FAIL"
```

Compare against pre-erosion (Phase 1 reported rivers 59–71). Post-erosion:
- Rivers should stay in similar ballpark — erosion smooths but doesn't eliminate elevation.
- Mountain/peak count may decrease (erosion smooths peaks).
- Water count similar (sea level unchanged, but eroded coastlines may shift slightly).

- [ ] **Step 2: Delete probe**

```bash
rm tests/unit/_probe-erosion.test.ts
```

- [ ] **Step 3: Final full-suite check**

```bash
npm test 2>&1 | tail -5
npm run build 2>&1 | grep "error TS" | grep -v "tests/e2e" | head
```

Expected: 276 tests, no production TS errors.

---

## Done

Phase 3 ships when:
- 5 erosion unit tests pass.
- Full suite green.
- Probe shows reasonable terrain distribution post-erosion.
- No regressions in Phase 0/1/2a tests.
