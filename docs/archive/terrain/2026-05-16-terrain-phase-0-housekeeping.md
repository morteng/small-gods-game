# Phase 0 — Housekeeping + Safety Nets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land regression tests for the parts of the terrain pipeline that subsequent phases will mutate, delete provably-unused code, and document what stays.

**Architecture:** No behavioural changes. Pure addition of tests + deletion of dead code + one doc comment update. Each commit is independently reversible.

**Tech Stack:** TypeScript, Vitest, existing `src/map/`, `src/world/`, `tests/unit/` structure.

---

## Pre-flight: branch + verify baseline

### Task 0: Set up branch and confirm baseline tests pass

**Files:** none (git + npm only)

- [ ] **Step 1: Confirm we're on main with no in-progress branch work**

```bash
git status
git branch --show-current
```

Expected: branch is `main`. Any uncommitted state should be either dist/* (build outputs — ignore) or untracked docs / sprite / .claude files (none of which we touch).

- [ ] **Step 2: Create the phase branch**

```bash
git checkout -b feature/terrain-phase-0-housekeeping
```

Expected: switched to a new branch.

- [ ] **Step 3: Verify baseline test count (191 per memory) and that all pass**

```bash
npm test 2>&1 | tail -20
```

Expected: all suites green. Record the actual test count from the output — we'll re-check at the end.

- [ ] **Step 4: Verify build is clean**

```bash
npm run build 2>&1 | tail -10
```

Expected: TypeScript check + Vite build complete without errors.

---

## Step group A: Add regression tests for `carveConnections`

The audit flagged that `carveConnections()` (the inter-POI road carver in `src/map/map-generator.ts:194`) is untested despite three recent rounds of bug-fix commits. Phase 2 will rewrite it; without tests we're flying blind.

### Task A1: Test that `carveConnections` writes a single-tile-wide path along waypoints

**Files:**
- Create: `tests/unit/carve-connections.test.ts`

`carveConnections` is not exported. We'll need to export it for testing (or use a re-export from a test-only entry point). Cleanest: add an `__test` export. Or simpler — call it indirectly via `generateWithNoise()` with a minimal world seed. We'll do the indirect path (no production surface change).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/carve-connections.test.ts
import { describe, it, expect } from 'vitest';
import { generateWithNoise } from '@/map/map-generator';
import type { WorldSeed } from '@/core/types';

const minimalSeed = (overrides: Partial<WorldSeed> = {}): WorldSeed => ({
  name: 'test',
  width: 32,
  height: 32,
  seed: 1,
  pois: [
    { id: 'a', type: 'village', name: 'A', position: { x: 5,  y: 16 } },
    { id: 'b', type: 'village', name: 'B', position: { x: 26, y: 16 } },
  ],
  connections: [
    { from: 'a', to: 'b', type: 'road', style: 'dirt' },
  ],
  ...overrides,
});

describe('carveConnections (via generateWithNoise)', () => {
  it('writes road tiles along a straight east-west connection', async () => {
    const { map } = await generateWithNoise(32, 32, 1, minimalSeed());

    // Count road tiles along the y=16 strip between x=5 and x=26
    let roadCount = 0;
    for (let x = 5; x <= 26; x++) {
      const t = map.tiles[16]?.[x];
      if (t && (t.type === 'dirt_road' || t.type === 'bridge')) roadCount++;
    }
    expect(roadCount).toBeGreaterThanOrEqual(18); // some tolerance for elbow-fill / Bresenham drift
  });
});
```

- [ ] **Step 2: Run the test — confirm it passes against current behaviour**

```bash
npx vitest run tests/unit/carve-connections.test.ts
```

Expected: PASS. This is a regression test pinning current behaviour, not a TDD red→green.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/carve-connections.test.ts
git commit -m "test: pin current carveConnections behaviour for terrain overhaul"
```

### Task A2: Test that `carveConnections` auto-bridges water and respects `autoBridge: false`

**Files:**
- Modify: `tests/unit/carve-connections.test.ts`

- [ ] **Step 1: Add tests for the bridge case and the no-bridge case**

```typescript
// Append to tests/unit/carve-connections.test.ts
import type { WorldSeed } from '@/core/types';
// (existing imports + minimalSeed above)

describe('carveConnections: water handling', () => {
  it('places bridge tiles when crossing water with autoBridge=true (default for non-river)', async () => {
    // We rely on the noise pipeline producing some water on a small map.
    // Pick a seed that yields water between two POIs, OR mutate the map post-gen.
    // Easiest: generate, find a water tile under the path, assert it became a bridge.
    const seed = minimalSeed();
    const { map } = await generateWithNoise(48, 32, 7, seed);

    // Scan the straight line y=16, x 5..42. If we find any tile under the path that
    // is *neither* water nor road, the test is inconclusive (no water in path).
    // We assert: no shallow_water / deep_water tiles remain along the carved strip.
    const lineTypes = new Set<string>();
    for (let x = 5; x <= 42; x++) lineTypes.add(map.tiles[16]?.[x]?.type ?? '');
    expect(lineTypes.has('shallow_water')).toBe(false);
    expect(lineTypes.has('deep_water')).toBe(false);
  });

  it('skips water (no overwrite, no bridge) when autoBridge is explicitly false', async () => {
    const seed = minimalSeed({
      connections: [
        { from: 'a', to: 'b', type: 'road', style: 'dirt', autoBridge: false },
      ],
    });
    const { map } = await generateWithNoise(48, 32, 7, seed);

    // Any water tile encountered along the line must remain water (not bridge / road)
    let waterEncounters = 0;
    let bridgeOverWater = 0;
    for (let x = 5; x <= 42; x++) {
      const t = map.tiles[16]?.[x];
      if (!t) continue;
      if (t.type === 'shallow_water' || t.type === 'deep_water') waterEncounters++;
      if (t.type === 'bridge') bridgeOverWater++;
    }
    // No bridges expected on this connection; water tiles can remain.
    expect(bridgeOverWater).toBe(0);
    void waterEncounters; // tolerated either way (depends on seed)
  });
});
```

- [ ] **Step 2: Run and verify**

```bash
npx vitest run tests/unit/carve-connections.test.ts
```

Expected: PASS. If a test is inconclusive due to no water under the path, change the seed (e.g. try 7, 13, 21) until water appears — then commit with the chosen seed.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/carve-connections.test.ts
git commit -m "test: pin carveConnections water bridging + skip behaviour"
```

### Task A3: Test that `carveConnections` widens to `width: N` paths

**Files:**
- Modify: `tests/unit/carve-connections.test.ts`

- [ ] **Step 1: Add a width test**

```typescript
// Append to tests/unit/carve-connections.test.ts
describe('carveConnections: width', () => {
  it('carves a 3-tile-wide road when width=3', async () => {
    const seed = minimalSeed({
      connections: [{ from: 'a', to: 'b', type: 'road', style: 'dirt', width: 3 }],
    });
    const { map } = await generateWithNoise(32, 32, 1, seed);

    // Sample three rows: y=15, 16, 17. All should have ≥10 road tiles each.
    for (const y of [15, 16, 17]) {
      let roads = 0;
      for (let x = 5; x <= 26; x++) {
        const t = map.tiles[y]?.[x];
        if (t && (t.type === 'dirt_road' || t.type === 'bridge')) roads++;
      }
      expect(roads).toBeGreaterThanOrEqual(10);
    }
  });
});
```

- [ ] **Step 2: Run and verify**

```bash
npx vitest run tests/unit/carve-connections.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/carve-connections.test.ts
git commit -m "test: pin carveConnections multi-tile width behaviour"
```

---

## Step group B: Add regression tests for `placeSettlement`

`placeSettlement` (in `src/world/building-placer.ts`) is what `generateWithNoise` calls for every POI. Audit confirmed no integration tests for it. Phase 5 will change how it interacts with biome data.

### Task B1: Smoke test — village placement produces buildings + roads

**Files:**
- Create: `tests/unit/place-settlement.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/unit/place-settlement.test.ts
import { describe, it, expect } from 'vitest';
import { generateWithNoise } from '@/map/map-generator';
import type { WorldSeed } from '@/core/types';

describe('placeSettlement: village', () => {
  it('produces at least one building and at least one road tile for a village POI', async () => {
    const seed: WorldSeed = {
      name: 'test',
      width: 32,
      height: 32,
      seed: 1,
      pois: [
        { id: 'v', type: 'village', name: 'V', position: { x: 16, y: 16 } },
      ],
      connections: [],
    };
    const { map } = await generateWithNoise(32, 32, 1, seed);

    expect(map.buildings.length).toBeGreaterThan(0);

    // At least one road tile somewhere on the map
    let roads = 0;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const t = map.tiles[y]?.[x];
      if (t && (t.type === 'dirt_road' || t.type === 'stone_road')) roads++;
    }
    expect(roads).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run and verify**

```bash
npx vitest run tests/unit/place-settlement.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/place-settlement.test.ts
git commit -m "test: pin placeSettlement village output (buildings + roads)"
```

### Task B2: Test farm and temple POIs produce distinguishable output

**Files:**
- Modify: `tests/unit/place-settlement.test.ts`

- [ ] **Step 1: Add tests for farm + temple**

```typescript
// Append to tests/unit/place-settlement.test.ts
describe('placeSettlement: per-type variation', () => {
  async function genWithPoi(type: string) {
    const seed: WorldSeed = {
      name: 'test',
      width: 32,
      height: 32,
      seed: 1,
      pois: [{ id: 'p', type, name: type, position: { x: 16, y: 16 } }],
      connections: [],
    };
    const { map } = await generateWithNoise(32, 32, 1, seed);
    return map;
  }

  it('produces buildings for a temple POI', async () => {
    const map = await genWithPoi('temple');
    expect(map.buildings.length).toBeGreaterThan(0);
    // Temple should produce at least one templeId-containing building
    const hasTempleBuilding = map.buildings.some(b => b.templateId.includes('temple'));
    expect(hasTempleBuilding).toBe(true);
  });

  it('produces farm tiles or farm buildings for a farm POI', async () => {
    const map = await genWithPoi('farm');
    // Either some farm_field tiles or a farm-flagged building must exist
    let farmTiles = 0;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      if (map.tiles[y]?.[x]?.type === 'farm_field') farmTiles++;
    }
    const farmBuildings = map.buildings.filter(b => b.templateId.includes('farm')).length;
    expect(farmTiles + farmBuildings).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run and verify**

```bash
npx vitest run tests/unit/place-settlement.test.ts
```

Expected: PASS. If temple/farm names don't match what `getBuildingTemplate` produces, read `src/map/building-templates.ts` and adjust the substring check — the goal is to pin current behaviour, not invent names.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/place-settlement.test.ts
git commit -m "test: pin placeSettlement temple + farm output shape"
```

---

## Step group C: Delete the unused ChunkManager

Audit confirmed `ChunkManager` is referenced only by its own test and the re-export in `src/map/index.ts`. Phase 5 (HSWFC) will not reuse it — its tile-level approach is incompatible with the meta-layer zone approach. Safe to delete.

### Task C1: Delete chunk-manager + its test + its exports

**Files:**
- Delete: `src/map/chunk-manager.ts`
- Delete: `tests/unit/chunk-manager.test.ts`
- Modify: `src/map/index.ts` (lines 5–6)

- [ ] **Step 1: Re-verify no other files reference ChunkManager**

```bash
grep -rn "chunk-manager\|ChunkManager" src/ tests/ docs/ 2>&1
```

Expected: only the three files we're about to touch. If anything else appears, stop and read it.

- [ ] **Step 2: Delete the files**

```bash
git rm src/map/chunk-manager.ts tests/unit/chunk-manager.test.ts
```

- [ ] **Step 3: Edit `src/map/index.ts` to remove the exports**

Remove these two lines:

```typescript
export { ChunkManager } from './chunk-manager';
export type { ChunkData, RegionData, ChunkStats, ChunkManagerOptions } from './chunk-manager';
```

- [ ] **Step 4: Run full test suite**

```bash
npm test 2>&1 | tail -20
```

Expected: all tests pass. Test count drops by however many `chunk-manager.test.ts` had.

- [ ] **Step 5: Run build to confirm no dangling type references**

```bash
npm run build 2>&1 | tail -10
```

Expected: clean build.

- [ ] **Step 6: Commit**

```bash
git add -u
git commit -m "chore: delete unused ChunkManager (superseded by Phase 5 HSWFC plan)"
```

---

## Step group D: Document WFC's reserved role

`src/wfc/` is bypassed by the primary noise path but cannot be deleted: `src/map/autotiler.ts` imports `TILES` from it. Phase 5 will reuse the WFC primitives (Cell, Grid, Propagator, Solver) for HSWFC. Document this so the next person reading the code knows.

### Task D1: Add a header comment to `src/wfc/index.ts` explaining its status

**Files:**
- Modify: `src/wfc/index.ts`

- [ ] **Step 1: Read the current file**

```bash
cat src/wfc/index.ts
```

- [ ] **Step 2: Prepend a status comment**

Add at the very top of the file (before the existing exports):

```typescript
/**
 * WFC (Wave Function Collapse) primitives.
 *
 * Status (2026-05): The classical-WFC code path (generateWithWFC) is bypassed
 * by the primary noise-based generator. These primitives are retained for two
 * reasons:
 *   1. autotiler.ts imports TILES (tile metadata) from here.
 *   2. The HSWFC meta-layer (Phase 5 of the terrain overhaul) will reuse the
 *      Cell / Grid / Propagator / Solver primitives at a coarser granularity
 *      (zone-WFC over POI zones, not tile-WFC).
 *
 * Do not delete this module without first relocating TILES and verifying the
 * Phase 5 plan no longer needs the primitives.
 *
 * See: docs/superpowers/plans/2026-05-16-terrain-overhaul-roadmap.md
 */
```

- [ ] **Step 3: Verify the file still compiles**

```bash
npm run build 2>&1 | tail -5
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add src/wfc/index.ts
git commit -m "docs: document WFC module's reserved role for Phase 5 HSWFC"
```

---

## Step group E: Final verification

### Task E1: Run the full test suite and build, confirm green

**Files:** none

- [ ] **Step 1: Run all tests**

```bash
npm test 2>&1 | tail -10
```

Expected: all green. Test count = (baseline) + (carve-connections tests) + (place-settlement tests) − (chunk-manager tests).

- [ ] **Step 2: Run the production build**

```bash
npm run build 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 3: Smoke-test in the browser**

```bash
npm run dev
```

Then open the dev server URL in a browser, load the default world, and confirm:
- The map renders.
- No console errors.
- POIs are visible, roads connect them.
- Browser console: no warnings about missing exports.

If anything is broken, the most likely culprits are (a) a missed reference to `ChunkManager` somewhere we didn't grep, or (b) a typo in the new test files breaking the test runner.

- [ ] **Step 4: Final status check**

```bash
git log --oneline main..HEAD
```

Expected: 7 commits, in this order (approximately):
1. test: pin current carveConnections behaviour
2. test: pin carveConnections water bridging
3. test: pin carveConnections multi-tile width behaviour
4. test: pin placeSettlement village output
5. test: pin placeSettlement temple + farm output
6. chore: delete unused ChunkManager
7. docs: document WFC module's reserved role

---

## Done

Phase 0 is complete. The codebase now has:
- Regression tests covering the two terrain functions we will mutate or replace in Phases 1–2.
- One less file of dead code.
- A clear status note on the WFC module.

Ready to write the Phase 1 (drainage-basin rivers) plan and start.
