# Buildings — Parametric Standardization & Cottage Yards — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the parametric system the canonical in-game building foundation — collapse rendering to *generated asset → parametric fallback → flat block*, delete the Canvas2D massing renderer, complete round/stepped in the fallback, give cottages a walkable yard, and plant the scale-contract module.

**Architecture:** `footprint` stays the plot (placement/spacing/apron/registry index). A new optional `structure` sub-rect is the solid+drawn building; collision keys off it (lawn = walkable), and both the brief and the parametric spec are sized to it. Round/stepped emit existing manifold solid prims so nothing falls back to Canvas2D. A 2-way dev toggle (`auto`/`fallback`) replaces the old 3-way.

**Tech Stack:** TypeScript ES modules, Vitest, manifold-3d WASM CSG, Canvas2D iso renderer.

**Spec:** `docs/superpowers/specs/2026-06-08-buildings-parametric-standardization-design.md`
**Parent vision:** `docs/superpowers/specs/2026-06-08-unified-art-scale-pipeline-vision.md`

**Conventions for every task:** run `npx vitest run <file>` for the named test; the full suite is `npm test`; `npm run build` does tsc + vite. Commit with explicit paths (never `git add -A`). End commit bodies with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

**Key existing facts (so code below is accurate):**
- `STOREY = 2.1` (cube-units of height per storey) — `src/assetgen/geometry/building.ts:24`.
- `RoofStyle = 'gable' | 'hip'`; `RoofKind = 'gable' | 'hip' | 'pyramidal' | 'flat'` — `building.ts:6-7`.
- `Part` union (`src/assetgen/compose.ts:14-22`) includes `box{at,size,material}`, `cylinder{center,baseZ,radius,height,material}`, `cone{center,baseZ,radius,height,material}`, `ellipsoid{center,baseZ,radii,material}`, `building{wings,wallMat,roofMat,roofStyle,features,seed}`.
- `composeStructure` builds a `cone` as base-radius→point (`solidCone(center, baseZ, 0, radius, height)`).
- `ISO_TILE_W=128`, `ISO_TILE_H=64` (`src/render/iso/iso-constants.ts`); `H_UNIT_PX = ISO_TILE_H` duplicated in `iso-building.ts:24` and `iso-barrier.ts:20`.
- Collision today: `isFootprintCellPassable` (`src/world/building-collision.ts:44`) returns true only for the door cell.

---

### Task 1: Scale-contract module

**Files:**
- Create: `src/render/scale-contract.ts`
- Modify: `src/render/iso/iso-building.ts:24` (replace local `H_UNIT_PX`), `src/render/iso/iso-barrier.ts:20` (replace local `H_UNIT_PX`)
- Test: `tests/unit/scale-contract.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/scale-contract.test.ts
import { describe, it, expect } from 'vitest';
import {
  HEIGHT_UNIT_PX, HUMAN_HEIGHT_UNITS, HUMAN_PX, DOOR_HEIGHT_UNITS, DOOR_WIDTH_TILES,
  ISO_TILE_W, ISO_TILE_H,
} from '@/render/scale-contract';

describe('scale-contract', () => {
  it('anchors the canonical world metrics', () => {
    expect(ISO_TILE_W).toBe(128);
    expect(ISO_TILE_H).toBe(64);
    expect(HEIGHT_UNIT_PX).toBe(ISO_TILE_H);
  });

  it('derives a human ~46px tall, with a door taller than a human', () => {
    expect(HUMAN_PX).toBe(Math.round(HUMAN_HEIGHT_UNITS * HEIGHT_UNIT_PX));
    expect(HUMAN_PX).toBeGreaterThanOrEqual(40);
    expect(HUMAN_PX).toBeLessThanOrEqual(52);
    // a door clears a human's head
    expect(DOOR_HEIGHT_UNITS).toBeGreaterThan(HUMAN_HEIGHT_UNITS);
    expect(DOOR_WIDTH_TILES).toBeGreaterThan(0);
    expect(DOOR_WIDTH_TILES).toBeLessThan(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/scale-contract.test.ts`
Expected: FAIL — cannot resolve `@/render/scale-contract`.

- [ ] **Step 3: Create the module**

```ts
// src/render/scale-contract.ts
// Single source of truth for world scale. Every entity class derives its native
// sprite size from world units through these constants — no hardcoded pixel
// sizes. See docs/superpowers/specs/2026-06-08-unified-art-scale-pipeline-vision.md.
import { ISO_TILE_W, ISO_TILE_H } from './iso/iso-constants';

/** Vertical pixels per one building height-unit (one storey). */
export const HEIGHT_UNIT_PX = ISO_TILE_H;             // 64

/** Reference human, in height-units and pixels (matches the LPC visible body). */
export const HUMAN_HEIGHT_UNITS = 0.72;
export const HUMAN_PX = Math.round(HUMAN_HEIGHT_UNITS * HEIGHT_UNIT_PX);   // 46

/** A human-scaled door: human + headroom, ~0.4 tile wide. */
export const DOOR_HEIGHT_UNITS = 0.85;
export const DOOR_WIDTH_TILES = 0.4;

export { ISO_TILE_W, ISO_TILE_H };
```

- [ ] **Step 4: Repoint the duplicated `H_UNIT_PX`**

In `src/render/iso/iso-building.ts`, replace line 24 `const H_UNIT_PX = ISO_TILE_H;` with an import at the top and use `HEIGHT_UNIT_PX` everywhere `H_UNIT_PX` appears in the file:

```ts
import { HEIGHT_UNIT_PX } from '@/render/scale-contract';
// ...delete `const H_UNIT_PX = ISO_TILE_H;`
// replace every `H_UNIT_PX` usage with `HEIGHT_UNIT_PX`
```

Do the same in `src/render/iso/iso-barrier.ts` (line 20). (Use Grep for `H_UNIT_PX` in each file to catch every usage.)

- [ ] **Step 5: Run tests + tsc**

Run: `npx vitest run tests/unit/scale-contract.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/render/scale-contract.ts src/render/iso/iso-building.ts src/render/iso/iso-barrier.ts tests/unit/scale-contract.test.ts
git commit -m "feat(render): scale-contract module (canonical world metrics + reference human)"
```

---

### Task 2: `structure` field + `structureRect` helper

**Files:**
- Modify: `src/world/building-descriptor.ts` (add `structure?` to the interface near `door`, line ~63; add the `structureRect` helper + export `StructureRect` type)
- Test: `tests/unit/building-structure-rect.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/building-structure-rect.test.ts
import { describe, it, expect } from 'vitest';
import { structureRect } from '@/world/building-descriptor';
import { synthesizeFromPreset } from '@/world/building-presets';

describe('structureRect', () => {
  it('defaults to the whole footprint when no structure is set', () => {
    const d = synthesizeFromPreset('tavern')!;          // no structure field
    const s = structureRect(d);
    expect(s).toEqual({ w: d.footprint.w, h: d.footprint.h, dx: 0, dy: 0 });
  });

  it('returns the explicit structure rect when present', () => {
    const d = { ...synthesizeFromPreset('tavern')!, structure: { w: 2, h: 2, dx: 1, dy: 0 } };
    expect(structureRect(d)).toEqual({ w: 2, h: 2, dx: 1, dy: 0 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/building-structure-rect.test.ts`
Expected: FAIL — `structureRect` is not exported.

- [ ] **Step 3: Add the field + helper**

In `src/world/building-descriptor.ts`, inside `interface BuildingDescriptor` just after the `door` field (~line 64):

```ts
  /** Solid + drawn building body within the plot footprint, in plot-local tiles.
   *  Footprint cells OUTSIDE this rect are walkable lawn. Default: whole footprint. */
  structure?: { w: number; h: number; dx: number; dy: number };
```

At the end of the file add:

```ts
export interface StructureRect { w: number; h: number; dx: number; dy: number }

/** The building body within its plot. Defaults to the whole footprint. */
export function structureRect(d: BuildingDescriptor): StructureRect {
  return d.structure ?? { w: d.footprint.w, h: d.footprint.h, dx: 0, dy: 0 };
}
```

Confirm `structure` is carried onto the entity: `building-descriptor.ts` mirrors `footprint` to `properties.footprint` (~line 118). Mirror `structure` the same way so collision can read `properties.descriptor.structure` (the descriptor is already mirrored whole — verify it is; if only select fields are mirrored, add `structure`).

- [ ] **Step 4: Run tests + tsc**

Run: `npx vitest run tests/unit/building-structure-rect.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/world/building-descriptor.ts tests/unit/building-structure-rect.test.ts
git commit -m "feat(world): BuildingDescriptor.structure sub-rect + structureRect() helper"
```

---

### Task 3: Walkable-lawn collision

**Files:**
- Modify: `src/world/building-collision.ts:44-57` (`isFootprintCellPassable`)
- Test: `tests/unit/building-collision-lawn.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/building-collision-lawn.test.ts
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { buildingEntity } from '@/world/building-descriptor';
import { synthesizeFromPreset } from '@/world/building-presets';
import { tileBlockedByBuilding } from '@/world/building-collision';

describe('building collision with a structure sub-rect (lawn)', () => {
  it('keeps full-footprint buildings solid except the door (default)', () => {
    const w = new World({ width: 32, height: 32 });
    const d = synthesizeFromPreset('tavern')!;        // no structure → full footprint
    w.addEntity(buildingEntity('t1', d, 5, 5));
    expect(tileBlockedByBuilding(w, 5, 5)).toBe(true);                 // a wall cell
    expect(tileBlockedByBuilding(w, 5 + d.door.x, 5 + d.door.y)).toBe(false); // door
  });

  it('makes lawn (outside the structure) walkable, structure solid, door open', () => {
    const w = new World({ width: 32, height: 32 });
    const d = { ...synthesizeFromPreset('tavern')!, footprint: { w: 3, h: 3 },
                structure: { w: 2, h: 2, dx: 0, dy: 0 }, door: { x: 1, y: 1 } };
    w.addEntity(buildingEntity('c1', d, 10, 10));
    // structure cell (0,0) → solid
    expect(tileBlockedByBuilding(w, 10, 10)).toBe(true);
    // lawn cells (2,*) and (*,2) → walkable
    expect(tileBlockedByBuilding(w, 12, 10)).toBe(false);
    expect(tileBlockedByBuilding(w, 10, 12)).toBe(false);
    expect(tileBlockedByBuilding(w, 12, 12)).toBe(false);
    // door cell inside structure → open
    expect(tileBlockedByBuilding(w, 11, 11)).toBe(false);
  });
});
```

(If `buildingEntity`/`World` constructor signatures differ, mirror the exact usage in `tests/unit/building-placer-descriptor.test.ts` — it already builds a world + cottage and checks `registry.getAtTile`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/building-collision-lawn.test.ts`
Expected: FAIL — lawn cells report blocked (current code: only the door is passable).

- [ ] **Step 3: Implement structure-aware passability**

Replace `isFootprintCellPassable` (`src/world/building-collision.ts:44-57`) with:

```ts
export function isFootprintCellPassable(
  building: Entity,
  tileX: number,
  tileY: number,
): boolean {
  const props = building.properties;
  const desc = props?.descriptor as
    | { door?: { x: number; y: number }; structure?: { w: number; h: number; dx: number; dy: number } }
    | undefined;
  const door = (props?.door as { x: number; y: number } | undefined) ?? desc?.door;
  const localX = tileX - Math.floor(building.x);
  const localY = tileY - Math.floor(building.y);

  // Cells outside the structure rect are walkable lawn (the building's yard).
  const s = desc?.structure;
  if (s) {
    const inStructure =
      localX >= s.dx && localX < s.dx + s.w && localY >= s.dy && localY < s.dy + s.h;
    if (!inStructure) return true;
  }

  if (!door) return false;
  return localX === door.x && localY === door.y;
}
```

- [ ] **Step 4: Run tests + tsc**

Run: `npx vitest run tests/unit/building-collision-lawn.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/world/building-collision.ts tests/unit/building-collision-lawn.test.ts
git commit -m "feat(world): lawn outside a building's structure rect is walkable"
```

---

### Task 4: Pathfinding routes across a lawn

**Files:**
- Test only: `tests/unit/pathfinding-lawn.test.ts`

**Context:** `src/sim/pathfinding.ts` already consults `tileBlockedByBuilding`. This task is a behavioral guard that a path can now cross a cottage yard. Inspect `pathfinding.ts` for the exact pathfinder entry point (e.g. `findPath(world, start, goal)`); mirror its signature from an existing pathfinding test under `tests/`.

- [ ] **Step 1: Write the failing-then-passing test**

```ts
// tests/unit/pathfinding-lawn.test.ts
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { buildingEntity } from '@/world/building-descriptor';
import { synthesizeFromPreset } from '@/world/building-presets';
import { findPath } from '@/sim/pathfinding';   // adjust to the real export

describe('pathfinding across a cottage yard', () => {
  it('routes a mortal through the walkable lawn ring', () => {
    const w = new World({ width: 20, height: 20 });
    const d = { ...synthesizeFromPreset('cottage')!, footprint: { w: 3, h: 3 },
                structure: { w: 2, h: 2, dx: 0, dy: 0 }, door: { x: 1, y: 1 } };
    w.addEntity(buildingEntity('c1', d, 8, 8));
    // start north of the plot, goal at the SE lawn corner (10,10 == plot-local 2,2)
    const path = findPath(w, { x: 8, y: 6 }, { x: 10, y: 10 });
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/unit/pathfinding-lawn.test.ts`
Expected: PASS (Task 3 already made the lawn walkable). If the pathfinder signature differs, fix the import/call to match `pathfinding.ts`; do not change production code.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/pathfinding-lawn.test.ts
git commit -m "test(sim): pathfinding crosses a building's walkable lawn"
```

---

### Task 5: `descriptorToSpec` from the structure + round/stepped

**Files:**
- Modify: `src/render/iso/building-spec.ts` (whole `descriptorToSpec` + helpers)
- Test: `tests/unit/building-spec.test.ts` (extend the existing file)

- [ ] **Step 1: Write the failing tests** (append to `tests/unit/building-spec.test.ts`)

```ts
import { synthesizeFromPreset } from '@/world/building-presets';

describe('descriptorToSpec — structure + round/stepped', () => {
  it('sizes rect wings to the structure rect, not the plot', () => {
    const d = { ...synthesizeFromPreset('cottage')!, footprint: { w: 3, h: 3 },
                structure: { w: 2, h: 2, dx: 0, dy: 0 } };
    const spec = descriptorToSpec(d)!;
    const part = spec.parts[0] as Extract<typeof spec.parts[number], { prim: 'building' }>;
    expect(part.prim).toBe('building');
    expect(part.wings[0]).toMatchObject({ x: 0, y: 0, w: 2, h: 2 });
  });

  it('emits a cylinder wall + a roof cap for a round plan (no longer null)', () => {
    const d = synthesizeFromPreset('yurt')!;            // plan: 'round'
    const spec = descriptorToSpec(d)!;
    expect(spec).not.toBeNull();
    expect(spec.parts.some(p => p.prim === 'cylinder')).toBe(true);
    expect(spec.parts.some(p => p.prim === 'cone' || p.prim === 'ellipsoid')).toBe(true);
  });

  it('emits inset stacked boxes for a stepped plan (no longer null)', () => {
    const d = synthesizeFromPreset('castle_keep')!;     // plan: 'stepped', levels 4
    const spec = descriptorToSpec(d)!;
    expect(spec).not.toBeNull();
    const boxes = spec.parts.filter(p => p.prim === 'box');
    expect(boxes.length).toBe(Math.max(1, d.levels));
  });

  it('still maps rect/L/cross', () => {
    for (const preset of ['cottage', 'tavern']) {
      expect(descriptorToSpec(synthesizeFromPreset(preset)!)).not.toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/building-spec.test.ts`
Expected: FAIL — round/stepped return null; rect wings use footprint (3×3) not structure (2×2).

- [ ] **Step 3: Rewrite `descriptorToSpec` + add solid builders**

Replace the body of `src/render/iso/building-spec.ts` from `planWings` downward with the following (keep the `WALL_MAT`/`ROOF_MAT`/`ROOF_KIND` tables and imports; add `structureRect` + `STOREY` imports):

```ts
import { structureRect, type StructureRect } from '@/world/building-descriptor';
import { STOREY } from '@/assetgen/geometry/building';
import type { Part } from '@/assetgen/compose';

// planWings now operates on the STRUCTURE dims (the building body), local origin (0,0).
function planWings(plan: Plan, s: StructureRect): Array<{ x: number; y: number; w: number; h: number }> {
  const { w, h } = s;
  switch (plan) {
    case 'rect':
      return [{ x: 0, y: 0, w, h }];
    case 'cross': {
      const naveH = Math.max(1, Math.round(h / 2));
      const transW = Math.max(1, Math.round(w / 2));
      return [
        { x: 0, y: Math.floor((h - naveH) / 2), w, h: naveH },
        { x: Math.floor((w - transW) / 2), y: 0, w: transW, h },
      ];
    }
    case 'L': {
      const barH = Math.max(1, Math.round(h / 2));
      const armW = Math.max(1, Math.round(w / 2));
      return [
        { x: 0, y: 0, w, h: barH },
        { x: 0, y: 0, w: armW, h },
      ];
    }
    default:
      return [{ x: 0, y: 0, w, h }];   // round/stepped handled separately; never reached
  }
}

// door face in STRUCTURE-local coordinates.
function doorFace(localDoor: { x: number; y: number }, s: StructureRect): WallFace {
  if (localDoor.y >= s.h - 1) return 'south';
  if (localDoor.x >= s.w - 1) return 'east';
  if (localDoor.y <= 0) return 'north';
  if (localDoor.x <= 0) return 'west';
  return 'south';
}

function ventFeatures(vents: Vent[] | undefined): BuildingFeatures['vents'] {
  if (!vents || vents.length === 0) return undefined;
  const n = vents.length;
  return vents.map((v, i) => ({ wing: 0, t: (i + 1) / (n + 1), kind: v.kind, placement: 'ridge' as const }));
}

// Round: a cylinder wall + a cone (spire/conical) or ellipsoid (dome/onion) cap.
function roundParts(d: BuildingDescriptor, s: StructureRect): Part[] {
  const r = Math.min(s.w, s.h) / 2;
  const cx = s.w / 2, cy = s.h / 2;
  const wallH = Math.max(1, d.levels) * STOREY;
  const wallMat = WALL_MAT[d.walls] ?? 'plaster';
  const roofMat = ROOF_MAT[d.roofMat] ?? 'tile';
  const parts: Part[] = [
    { prim: 'cylinder', center: [cx, cy], baseZ: 0, radius: r, height: wallH, material: wallMat },
  ];
  if (d.roof === 'flat') return parts;
  if (d.roof === 'domed' || d.roof === 'onion') {
    parts.push({ prim: 'ellipsoid', center: [cx, cy], baseZ: wallH, radii: [r, r, r * 0.8], material: roofMat });
  } else {
    parts.push({ prim: 'cone', center: [cx, cy], baseZ: wallH, radius: r, height: r * 1.2, material: roofMat });
  }
  return parts;
}

// Stepped: `levels` stacked boxes, each inset `levelInset` per side per level.
function steppedParts(d: BuildingDescriptor, s: StructureRect): Part[] {
  const levels = Math.max(1, d.levels);
  const inset = Math.max(0, d.levelInset);
  const wallMat = WALL_MAT[d.walls] ?? 'plaster';
  const parts: Part[] = [];
  for (let lvl = 0; lvl < levels; lvl++) {
    const off = inset * lvl;
    const w = s.w - 2 * off, h = s.h - 2 * off;
    if (w <= 0 || h <= 0) break;
    parts.push({ prim: 'box', at: [off, off, lvl * STOREY], size: [w, h, STOREY], material: wallMat });
  }
  return parts;
}

/** Map a descriptor to a StructureSpec. Never null for known plans (round/stepped use solids). */
export function descriptorToSpec(d: BuildingDescriptor): StructureSpec | null {
  const s = structureRect(d);
  const size = Math.min(640, Math.max(128, Math.round((s.w + s.h) * ISO_TILE_W * 0.65)));

  if (d.plan === 'round')   return { size, parts: roundParts(d, s) };
  if (d.plan === 'stepped') return { size, parts: steppedParts(d, s) };

  const layout = planWings(d.plan, s);
  const storeys = Math.max(1, d.levels);
  const roof = ROOF_KIND[d.roof] ?? 'gable';
  const wings: Wing[] = layout.map(r => ({ ...r, storeys, roof }));

  const localDoor = { x: d.door.x - s.dx, y: d.door.y - s.dy };
  const features: BuildingFeatures = { doors: [{ face: doorFace(localDoor, s), main: true }] };
  const vents = ventFeatures(d.vents);
  if (vents) features.vents = vents;

  return {
    size,
    parts: [{
      prim: 'building',
      wings,
      wallMat: WALL_MAT[d.walls] ?? 'plaster',
      roofMat: ROOF_MAT[d.roofMat] ?? 'tile',
      roofStyle: 'gable',
      features,
      seed: 0,
    }],
  };
}
```

Remove the now-unused `BuildingDescriptor`-footprint references; keep the file's existing top imports for `Plan, Roof, WallMat, RoofMat, Vent`, `Mat`, `Wing, RoofKind, WallFace, BuildingFeatures`, `StructureSpec`, `ISO_TILE_W`.

- [ ] **Step 4: Run tests + tsc**

Run: `npx vitest run tests/unit/building-spec.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean. (`yurt` roof maps to a cone/ellipsoid; `castle_keep` → 4 boxes inset by 1.)

- [ ] **Step 5: Commit**

```bash
git add src/render/iso/building-spec.ts tests/unit/building-spec.test.ts
git commit -m "feat(render): descriptorToSpec sizes to structure + emits round/stepped solids"
```

---

### Task 6: Brief sized to the structure + human-height door

**Files:**
- Modify: `src/assetgen/producers/building-producer.ts` (the `buildingBrief` return — `footprint` and `traits`)
- Test: `tests/unit/building-producer.test.ts` (extend, or create if absent)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/building-producer.test.ts  (add a describe block)
import { describe, it, expect } from 'vitest';
import { buildingBrief } from '@/assetgen/producers/building-producer';
import { synthesizeFromPreset } from '@/world/building-presets';
import { structureRect } from '@/world/building-descriptor';

describe('buildingBrief — structure + human-scale door', () => {
  it('sizes the brief footprint to the structure rect', () => {
    const d = { ...synthesizeFromPreset('cottage')!, footprint: { w: 3, h: 3 },
                structure: { w: 2, h: 2, dx: 0, dy: 0 } };
    const brief = buildingBrief(d, 0);
    expect(brief.footprint).toEqual({ w: 2, h: 2 });
  });

  it('phrases a human-height door so the model draws it to scale', () => {
    const brief = buildingBrief(synthesizeFromPreset('cottage')!, 0);
    expect(brief.traits.some(t => /human-height door/i.test(t))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/building-producer.test.ts`
Expected: FAIL — `footprint` is the plot `{3,3}`; no human-height-door trait.

- [ ] **Step 3: Implement**

In `buildingBrief` (`src/assetgen/producers/building-producer.ts`): import `structureRect`, compute `const s = structureRect(d);`, change the returned `footprint` (currently `{ ...d.footprint }`, ~line 93) to `{ w: s.w, h: s.h }`, and add `'human-height door'` to the `traits` array (built ~line 79). Leave `door.face` derivation as-is (footprint-based face is fine for v1).

- [ ] **Step 4: Run tests + tsc**

Run: `npx vitest run tests/unit/building-producer.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/assetgen/producers/building-producer.ts tests/unit/building-producer.test.ts
git commit -m "feat(assetgen): brief sized to structure + human-height door trait"
```

---

### Task 7: Delete `massing-guidance` + drop the guidance preview

**Files:**
- Delete: `src/assetgen/massing-guidance.ts`
- Modify: `src/game/frame-renderer.ts` (drop `renderMassingToImage` import + `cachedGuidanceUrl` plumbing, ~lines 19, 233, 248, 254-255, 264), `src/ui/building-info-panel.ts` (drop the `guidanceUrl` field + guidance/sprite mode toggle; render the resolved sprite only)
- Test: `tests/unit/building-info-panel.test.ts` if present (adjust), else rely on tsc + the Task 9 guard.

**Context:** This runs *before* deleting `drawIsoBuildingMassing` (Task 8) because `massing-guidance.ts` imports it — removing the consumer first keeps tsc green between tasks.

- [ ] **Step 1: Delete the guidance module**

```bash
git rm src/assetgen/massing-guidance.ts
```

- [ ] **Step 2: Strip the guidance preview from frame-renderer**

In `src/game/frame-renderer.ts`: remove the `import { renderMassingToImage } from '@/assetgen/massing-guidance';` line; remove the `private cachedGuidanceUrl` field; in `updateBuildingPanel` delete the `cachedGuidanceUrl` assignment block (the `try { ... renderMassingToImage ... }`), and change the `buildingInfoPanel.render({ info, guidanceUrl: ..., spriteUrl })` call to `render({ info, spriteUrl })`. Also drop now-unused imports (`VIEW_RECIPES`/`buildingBrief`/`BuildingDescriptor`) only if nothing else in the file uses them (check with Grep before removing).

- [ ] **Step 3: Simplify building-info-panel to sprite-only**

In `src/ui/building-info-panel.ts`: remove `guidanceUrl` from the view type (line ~15), remove the `mode === 'guidance' ? guidanceUrl : spriteUrl` branch (~line 62) and any guidance/sprite mode toggle UI, and always show `spriteUrl`. If `spriteUrl` is null, show the existing placeholder/empty state.

- [ ] **Step 4: tsc + the panel test**

Run: `npx tsc --noEmit && npx vitest run tests/unit/building-info-panel.test.ts 2>/dev/null || true`
Expected: tsc clean; panel test (if it exists) passes after adjusting any `guidanceUrl` references.

- [ ] **Step 5: Commit**

```bash
git add -u src/assetgen/massing-guidance.ts src/game/frame-renderer.ts src/ui/building-info-panel.ts
git commit -m "refactor: drop massing-guidance preview (superseded by in-game parametric view)"
```

---

### Task 8: Collapse render dispatch + structure-offset placement + flat-block; delete `drawIsoBuildingMassing`

**Files:**
- Modify: `src/core/types.ts:648` (`BuildingRenderMode`) + the `buildingRenderMode` doc comment (~line 670)
- Modify: `src/render/iso/iso-renderer.ts` (entity-collection sort key ~90-104 + the building draw branch ~141-155)
- Modify: `src/render/iso/iso-building.ts` (delete `drawIsoBuildingMassing` + its roof/box helpers; add `drawIsoFlatBlock`)
- Modify: `src/dev/DebugOverlayPanel.ts` (2-option select + reset)
- Test: `tests/unit/iso-building-dispatch.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/iso-building-dispatch.test.ts
import { describe, it, expect } from 'vitest';
import type { BuildingRenderMode } from '@/core/types';

// Pure decision function extracted from the renderer so dispatch is unit-testable
// without a canvas. It returns which source to draw: 'asset' | 'parametric' | 'flat'.
import { pickBuildingSource } from '@/render/iso/iso-building';

describe('building render dispatch', () => {
  const has = () => ({} as unknown as CanvasImageSource);
  const none = () => null;

  it('auto: asset → else parametric → else flat', () => {
    expect(pickBuildingSource('auto', has, has)).toBe('asset');
    expect(pickBuildingSource('auto', none, has)).toBe('parametric');
    expect(pickBuildingSource('auto', none, none)).toBe('flat');
  });

  it('fallback: skips the asset, parametric → else flat', () => {
    expect(pickBuildingSource('fallback', has, has)).toBe('parametric');
    expect(pickBuildingSource('fallback', has, none)).toBe('flat');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/iso-building-dispatch.test.ts`
Expected: FAIL — `pickBuildingSource` not exported; `BuildingRenderMode` lacks `'fallback'`.

- [ ] **Step 3: Update the enum**

`src/core/types.ts`: replace `export type BuildingRenderMode = 'auto' | 'generator' | 'massing';` with `export type BuildingRenderMode = 'auto' | 'fallback';` and update the `buildingRenderMode?` doc comment to: `// 'auto' = generated asset → parametric fallback → flat block; 'fallback' = always the parametric fallback (skip assets). Default 'auto'.`

- [ ] **Step 4: Add `pickBuildingSource` + `drawIsoFlatBlock`, delete massing**

In `src/render/iso/iso-building.ts`:
- Delete `drawIsoBuildingMassing` and its private helpers used *only* by it (`drawRoof`, `groundCorners`/`raise`, the roof-silhouette code). Keep `drawIsoBuildingSprite`, `drawIsoBuildingSpriteCore`, `drawIsoBuildingSpriteGenerated`. Use Grep to confirm each helper you delete has no other caller (e.g. `drawIsoBarrier` may share `groundCorners` — if so, keep it).
- Add the pure dispatch decision:

```ts
export function pickBuildingSource(
  mode: BuildingRenderMode,
  asset: () => CanvasImageSource | null,
  parametric: () => CanvasImageSource | null,
): 'asset' | 'parametric' | 'flat' {
  if (mode !== 'fallback' && asset()) return 'asset';
  if (parametric()) return 'parametric';
  return 'flat';
}
```

- Add a minimal non-wasm flat block (reuse the box-drawing math you keep; this is the only Canvas2D building primitive that survives):

```ts
/** Last-resort flat block (no roof) when neither a generated nor a parametric sprite
 *  is available — e.g. manifold wasm failed to load. Drawn from the structure rect. */
export function drawIsoFlatBlock(
  dc: IsoDrawCtx, struct: { w: number; h: number },
  tileX: number, tileY: number, color = '#6b6b78',
): void {
  // four walls + flat top, extruded HEIGHT_UNIT_PX, using groundCorners(tileX,tileY,w,h)
  // and the box edges. (Port the minimal box body from the old drawIsoBuildingMassing.)
}
```

(Implement `drawIsoFlatBlock` with the box-drawing portion of the old massing code — walls + top quad, no roof.)

- [ ] **Step 5: Rewrite the renderer building branch**

In `src/render/iso/iso-renderer.ts`:
- Import `structureRect` and `drawIsoFlatBlock`, `pickBuildingSource`. Remove the `drawIsoBuildingMassing` import.
- Where the building entry is collected (~90-104), compute the structure rect and use it for the sort key and stored placement:

```ts
const descriptor = e.properties?.descriptor as BuildingDescriptor | undefined;
if (descriptor) {
  if (hideBuildings) continue;
  const s = structureRect(descriptor);
  const tx = Math.floor(e.x) + s.dx, ty = Math.floor(e.y) + s.dy;
  const key = buildingSortKey({ tx, ty, footprintW: s.w, footprintH: s.h });
  buildingById.set(e.id, { e, massing: buildingMassing(descriptor), s });
  entries.push({ id: e.id, kind: 'building', tx, ty, z: 0,
                 sortTx: key.sortTx, sortTy: key.sortTy, kindPriority: KIND_PRIORITY.building });
  continue;
}
```

(Extend the `buildingById` value type to include `s: StructureRect`.)

- Replace the draw branch (~141-155):

```ts
if (e.kind === 'building') {
  const b = buildingById.get(e.id);
  if (b) {
    const bx = Math.floor(b.e.x) + b.s.dx, by = Math.floor(b.e.y) + b.s.dy;
    const mode = rc.devMode?.buildingRenderMode ?? 'auto';
    const asset = () => rc.resolveBuildingArt?.(b.e) ?? null;
    const parametric = () => rc.resolveParametricBuildingArt?.(b.e) ?? null;
    switch (pickBuildingSource(mode, asset, parametric)) {
      case 'asset':      drawIsoBuildingSprite(drawCtx, asset() as HTMLImageElement, bx, by, b.massing.footprint); break;
      case 'parametric': drawIsoBuildingSpriteGenerated(drawCtx, parametric() as HTMLCanvasElement, bx, by, b.massing.footprint); break;
      case 'flat':       drawIsoFlatBlock(drawCtx, { w: b.s.w, h: b.s.h }, bx, by); break;
    }
  }
}
```

(Note: `asset()`/`parametric()` are called again inside the switch — acceptable since both are cheap `peek`-backed reads; or hoist into locals to call once.)

- [ ] **Step 6: Update the dev select to 2 options**

In `src/dev/DebugOverlayPanel.ts` (Building Render section ~140-160): change the options array to `[['auto', 'Auto (asset → parametric)'], ['fallback', 'Force parametric fallback']]`, change the `change` handler cast to `'auto' | 'fallback'`, and the reset (`currentDevMode.buildingRenderMode = 'auto'`) stays. Update the section comment.

- [ ] **Step 7: Run tests + tsc + build**

Run: `npx vitest run tests/unit/iso-building-dispatch.test.ts && npx tsc --noEmit && npm run build`
Expected: PASS; tsc clean; build emits `manifold.wasm`; no reference to `drawIsoBuildingMassing` remains.

- [ ] **Step 8: Commit**

```bash
git add src/core/types.ts src/render/iso/iso-renderer.ts src/render/iso/iso-building.ts src/dev/DebugOverlayPanel.ts tests/unit/iso-building-dispatch.test.ts
git commit -m "feat(render): collapse building dispatch to asset→parametric→flat; delete massing renderer"
```

---

### Task 9: Cottage yard + massing-removal guard

**Files:**
- Modify: `src/world/building-presets.ts` (cottage `structure` + `door`)
- Test: `tests/unit/no-massing-renderer.test.ts` (NEW guard), `tests/unit/building-presets.test.ts` (cottage assertion, if the file exists)

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/no-massing-renderer.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('massing renderer is fully retired', () => {
  it('no source file references drawIsoBuildingMassing or massing-guidance', () => {
    const offenders = walk('src').filter(p => {
      const src = readFileSync(p, 'utf8');
      return src.includes('drawIsoBuildingMassing') || src.includes('massing-guidance');
    });
    expect(offenders).toEqual([]);
  });
});
```

```ts
// add to tests/unit/building-presets.test.ts (or a new cottage test)
import { describe, it, expect } from 'vitest';
import { BUILDING_PRESETS } from '@/world/building-presets';

describe('cottage yard', () => {
  it('has a 2×2 structure inside its 3×3 plot with the door on the structure', () => {
    const c = BUILDING_PRESETS.cottage;
    expect(c.footprint).toEqual({ w: 3, h: 3 });
    expect(c.structure).toEqual({ w: 2, h: 2, dx: 0, dy: 0 });
    const s = c.structure!;
    expect(c.door.x).toBeGreaterThanOrEqual(s.dx);
    expect(c.door.x).toBeLessThan(s.dx + s.w);
    expect(c.door.y).toBeGreaterThanOrEqual(s.dy);
    expect(c.door.y).toBeLessThan(s.dy + s.h);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/no-massing-renderer.test.ts tests/unit/building-presets.test.ts`
Expected: guard passes only if Task 8 fully removed references; cottage test FAILS (no `structure`, door `{1,2}` is outside a 2×2 at origin).

- [ ] **Step 3: Give the cottage a yard**

In `src/world/building-presets.ts`, update the `cottage` entry: add `structure: { w: 2, h: 2, dx: 0, dy: 0 },` and change `door: { x: 1, y: 2 }` → `door: { x: 1, y: 1 }` (front-right corner of the 2×2 body, facing the south/east lawn). Move the chimney vent if needed so it sits on the structure (`vents: [{ x: 1, y: 0, height: 0.8, kind: 'chimney', emit: 'smoke' }]`).

- [ ] **Step 4: Run tests + tsc**

Run: `npx vitest run tests/unit/no-massing-renderer.test.ts tests/unit/building-presets.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/world/building-presets.ts tests/unit/no-massing-renderer.test.ts tests/unit/building-presets.test.ts
git commit -m "feat(world): cottage gets a 2×2 body on a 3×3 plot (walkable yard) + massing guard"
```

---

### Task 10: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: all green (≈1566 + the new tests). Investigate any failure; `replay-speed`/`game-ui` lone failures that pass on re-run are known flakes.

- [ ] **Step 2: tsc + production build + no-three guard**

Run: `npm run build`
Expected: tsc clean, vite build succeeds, emits `manifold.wasm`; `no-three-in-bundle` test stays green.

- [ ] **Step 3: Manual in-game (user)**

`npm run dev` (port 3000) → dev mode → 🎨 Debug Overlays → Building Render → **Force parametric fallback**. Confirm: cottages now sit on a visible yard (smaller body, lawn around), NPCs can walk across the yard, round (yurt) and stepped (castle keep) render as solids (no missing buildings), doors read at roughly villager height. Report anything visually off for a follow-up.

---

## Self-Review

**Spec coverage:** A scale-contract → Task 1; B structure field + walkable lawn → Tasks 2,3,4; C sprite from structure → Tasks 5 (parametric) + 6 (brief); D round/stepped → Task 5; E dispatch collapse → Task 8; F flat block → Task 8; G deletions → Tasks 7 (massing-guidance/guidance preview) + 8 (drawIsoBuildingMassing, enum values, H_UNIT_PX dup in Task 1) + 9 (guard); H cottage preset → Task 9. All spec sections covered.

**Type consistency:** `structureRect`/`StructureRect` defined in Task 2, consumed in Tasks 5/6/8. `BuildingRenderMode = 'auto' | 'fallback'` defined Task 8, used by `pickBuildingSource` (Task 8) + DebugOverlayPanel (Task 8). `Part` shapes match `compose.ts:14-22`. `STOREY=2.1` used for round/stepped heights. `drawIsoFlatBlock(dc, {w,h}, x, y)` signature consistent between Task 8 definition and renderer call.

**Ordering safety:** Task 7 (remove `massing-guidance` consumer) precedes Task 8 (delete `drawIsoBuildingMassing`) so tsc stays green between tasks. The enum change, renderer, iso-building, and panel all move together in Task 8 (atomic). The guard test (Task 9) runs after both deletions.

**Placeholder scan:** `drawIsoFlatBlock`'s body says "port the minimal box body from the old massing" — this is a concrete instruction (reuse the kept box-draw math), not a TODO; the surrounding signature + intent are fully specified.
