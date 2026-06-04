# Parametric Building System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hand-authored `BuildingTemplate`s with one parametric `BuildingDescriptor` that worldgen, Fate, and the editor all produce — rendered as a topdown silhouette today, carrying full 3D massing intent for later.

**Architecture:** A pure-data `BuildingDescriptor` is the single source of truth, stored in `entity.properties.descriptor` (rides snapshot/save, no version bump). Named **presets** seed it (the 9 existing buildings + room to grow). A **massing renderer** draws topdown silhouettes from `plan`/`levels`/`roof`/materials. Ground material is **derived at render time** (zero tile mutation). A `place_building` command verb lets Fate/editor emit descriptors on the existing channel. The old `BuildingTemplate` machinery stays as a compat layer behind greppable cleanup markers and is deleted in a follow-up.

**Tech Stack:** TypeScript ES modules, Vitest, Canvas 2D, seeded `Rng` (sfc32). `@/` → `src/`.

**Extensibility (explicit design goal):** every taxonomy axis is an **open registry or union with a safe default** — add a wall material / roof type / plan shape / preset by adding one entry, never by editing core logic. Colour lookups fall back to a neutral default for unknown materials rather than throwing, so a future Fate-invented material renders (greyly) instead of crashing.

---

## File Structure

**New files:**
- `src/world/building-descriptor.ts` — `BuildingDescriptor` interface + taxonomy unions + colour registries (`WALL_COLORS`/`ROOF_COLORS`/`GROUND_COLORS`) + pure helpers (`buildingPalette`, `buildingEntity`).
- `src/world/building-presets.ts` — `BUILDING_PRESETS` record, `getPreset`, `synthesizeFromPreset`, `presetForPoiType`.
- `src/render/building-massing.ts` — `drawBuildingPlaceholder` topdown silhouette renderer.
- `src/render/ground-material.ts` — `computeGroundMaterialField` (derived footprint+apron material map).
- `src/sim/command/building-verbs.ts` — `place_building` precondition/apply + `findBuildingPlacement`.
- Tests: `tests/unit/building-descriptor.test.ts`, `tests/unit/building-presets.test.ts`, `tests/unit/building-massing.test.ts`, `tests/unit/ground-material.test.ts`, `tests/unit/building-collision-door.test.ts`, `tests/unit/place-building-verb.test.ts`, `tests/unit/building-placer-descriptor.test.ts`.

**Modified files:**
- `src/world/entity-kinds.ts` — add generic `'building'` kind + `yurt`/`longhouse` preset kinds.
- `src/world/building-collision.ts` — `isFootprintCellPassable` honours the door cell; `isBuilding` tag fallback.
- `src/world/building-placer.ts` — `findPlacement` takes a footprint; `placeSettlement` builds descriptor entities.
- `src/render/renderer.ts` — `drawEntity` descriptor branch; new `drawGroundMaterialOverlay` pass.
- `src/sim/command/types.ts` — add `'place_building'` to `CommandVerb`.
- `src/sim/command/registry.ts` — register the `place_building` capability.
- `src/map/building-templates.ts` — `@deprecated` cleanup markers.
- `src/core/types.ts` — `@deprecated` marker on `BuildingInstance`.

---

## Task 1: BuildingDescriptor type + colour registries

**Files:**
- Create: `src/world/building-descriptor.ts`
- Test: `tests/unit/building-descriptor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/building-descriptor.test.ts
import { describe, it, expect } from 'vitest';
import {
  buildingPalette, buildingEntity, WALL_COLORS, ROOF_COLORS, GROUND_COLORS,
  type BuildingDescriptor,
} from '@/world/building-descriptor';

const cottage: BuildingDescriptor = {
  category: 'residential', era: 'medieval',
  footprint: { w: 3, h: 3 }, plan: 'rect', levels: 1, levelInset: 0, heightPerLevel: 1,
  roof: 'gable', walls: 'wattle', roofMat: 'thatch', door: { x: 1, y: 2 },
};

describe('building-descriptor', () => {
  it('derives a palette from materials', () => {
    const p = buildingPalette(cottage);
    expect(p.walls).toBe(WALL_COLORS.wattle);
    expect(p.roof).toBe(ROOF_COLORS.thatch);
    expect(typeof p.trim).toBe('string');
  });

  it('falls back to a neutral colour for an unknown material (extensible, no throw)', () => {
    const exotic = { ...cottage, walls: 'adamantium' as unknown as BuildingDescriptor['walls'] };
    expect(() => buildingPalette(exotic)).not.toThrow();
    expect(buildingPalette(exotic).walls).toBe('#8a8a8a');
  });

  it('lets palette overrides win', () => {
    const p = buildingPalette({ ...cottage, palette: { walls: '#123456' } });
    expect(p.walls).toBe('#123456');
  });

  it('builds an entity that mirrors footprint + descriptor into properties', () => {
    const e = buildingEntity('b1', cottage, 10, 20, { poiId: 'poi-x' });
    expect(e.kind).toBe('building');           // no preset → generic kind
    expect(e.x).toBe(10); expect(e.y).toBe(20);
    expect(e.tags).toEqual(['building', 'residential']);
    expect(e.properties?.category).toBe('building');
    expect(e.properties?.footprint).toEqual({ w: 3, h: 3 });
    expect(e.properties?.sortYOffset).toBe(3);   // = footprint.h
    expect(e.properties?.poiId).toBe('poi-x');
    expect((e.properties?.descriptor as BuildingDescriptor).plan).toBe('rect');
  });

  it('uses the preset name as kind when present', () => {
    const e = buildingEntity('b2', { ...cottage, preset: 'cottage' }, 0, 0);
    expect(e.kind).toBe('cottage');
  });

  it('has colour entries for every declared ground material', () => {
    for (const m of ['flagstone', 'dirt', 'packed_dirt', 'wood', 'tile', 'gravel'] as const) {
      expect(GROUND_COLORS[m]).toMatch(/^#/);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/building-descriptor.test.ts`
Expected: FAIL — cannot resolve `@/world/building-descriptor`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/world/building-descriptor.ts
/**
 * BuildingDescriptor — the single, parametric source of truth for every
 * building. Stored in `entity.properties.descriptor` (rides snapshot/save with
 * no version bump). Drives a topdown silhouette today; carries full 3D massing
 * intent (plan/levels/levelInset/heightPerLevel/roof) for the future renderer.
 *
 * Every taxonomy axis is open/extensible: unions extend by adding a member,
 * colour lookups fall back to a neutral grey for unknown materials (never throw).
 */
import type { Entity, Era } from '@/core/types';

export type BuildingCategory =
  | 'residential' | 'religious' | 'commercial' | 'military' | 'farm' | 'special';

/** Ground-outline shape. Extend by adding a member + a case in building-massing. */
export type Plan = 'rect' | 'round' | 'L' | 'cross' | 'stepped';
/** Roof silhouette. Extend by adding a member + a case in building-massing. */
export type Roof = 'flat' | 'gable' | 'hip' | 'conical' | 'domed' | 'stepped' | 'lean_to';
export type WallMat = 'mud' | 'wattle' | 'timber' | 'log' | 'brick' | 'stone' | 'marble' | 'hide';
export type RoofMat = 'thatch' | 'wood' | 'tile' | 'slate' | 'hide' | 'none';
export type GroundMat = 'flagstone' | 'dirt' | 'packed_dirt' | 'wood' | 'tile' | 'gravel';

export interface BuildingPalette { walls: string; roof: string; trim: string }

export interface BuildingDescriptor {
  /** Name of the seed preset, if any. Becomes the entity `kind`. */
  preset?: string;
  category: BuildingCategory;
  era: Era;

  // massing (silhouette now; 3D extrusion later)
  footprint: { w: number; h: number };
  plan: Plan;
  levels: number;
  levelInset: number;
  heightPerLevel: number;

  roof: Roof;

  walls: WallMat;
  roofMat: RoofMat;
  palette?: Partial<BuildingPalette>;

  // terrain ordering (derived at render time — see render/ground-material.ts)
  groundMaterial?: GroundMat;
  apron?: { radius: number; material: GroundMat };

  /** The one passable footprint cell, relative to the footprint top-left. */
  door: { x: number; y: number };
}

const NEUTRAL = '#8a8a8a';

/** Open registry — add a material by adding a line. */
export const WALL_COLORS: Record<WallMat, string> = {
  mud: '#9c7a4f', wattle: '#b29162', timber: '#8B5A2B', log: '#7a5230',
  brick: '#9e4b34', stone: '#8a8a8a', marble: '#e8e6df', hide: '#b9a07a',
};
export const ROOF_COLORS: Record<RoofMat, string> = {
  thatch: '#c9a227', wood: '#6b4a2b', tile: '#8B2E2E', slate: '#4b5563',
  hide: '#a98c63', none: '#00000000',
};
export const GROUND_COLORS: Record<GroundMat, string> = {
  flagstone: '#9aa0a6', dirt: '#8a6a45', packed_dirt: '#7a5d3c',
  wood: '#7a5230', tile: '#b06a4a', gravel: '#9b9690',
};

function colour<K extends string>(table: Record<K, string>, key: K): string {
  return table[key] ?? NEUTRAL;
}

/** Derive wall/roof/trim colours from materials; `palette` overrides win. */
export function buildingPalette(d: BuildingDescriptor): BuildingPalette {
  const walls = colour(WALL_COLORS, d.walls);
  const roof = colour(ROOF_COLORS, d.roofMat);
  return {
    walls: d.palette?.walls ?? walls,
    roof: d.palette?.roof ?? roof,
    trim: d.palette?.trim ?? '#000000',
  };
}

/**
 * Build a building Entity from a descriptor. `kind` is the preset name (so the
 * existing entity-kind defs resolve) or the generic `'building'` kind. The
 * footprint is mirrored to `properties.footprint` so EntityRegistry indexes
 * every covered cell.
 */
export function buildingEntity(
  id: string, d: BuildingDescriptor, x: number, y: number,
  extra: { poiId?: string; religiousSignificance?: string; state?: string } = {},
): Entity {
  return {
    id,
    kind: d.preset ?? 'building',
    x, y,
    tags: ['building', d.category],
    properties: {
      category: 'building',
      descriptor: d,
      footprint: { ...d.footprint },
      door: { ...d.door },
      sortYOffset: d.footprint.h,
      era: d.era,
      poiId: extra.poiId,
      religiousSignificance:
        extra.religiousSignificance ?? (d.category === 'religious' ? 'sacred' : 'neutral'),
      state: extra.state ?? 'intact',
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/building-descriptor.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/world/building-descriptor.ts tests/unit/building-descriptor.test.ts
git commit -m "feat(buildings): BuildingDescriptor type + extensible colour registries"
```

---

## Task 2: Building presets

**Files:**
- Create: `src/world/building-presets.ts`
- Test: `tests/unit/building-presets.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/building-presets.test.ts
import { describe, it, expect } from 'vitest';
import {
  BUILDING_PRESETS, getPreset, synthesizeFromPreset, presetForPoiType,
} from '@/world/building-presets';

describe('building-presets', () => {
  it('every preset is well-formed (footprint > 0, door inside footprint, levels >= 1)', () => {
    for (const [name, d] of Object.entries(BUILDING_PRESETS)) {
      expect(d.footprint.w, name).toBeGreaterThan(0);
      expect(d.footprint.h, name).toBeGreaterThan(0);
      expect(d.levels, name).toBeGreaterThanOrEqual(1);
      expect(d.door.x, name).toBeGreaterThanOrEqual(0);
      expect(d.door.x, name).toBeLessThan(d.footprint.w);
      expect(d.door.y, name).toBeGreaterThanOrEqual(0);
      expect(d.door.y, name).toBeLessThan(d.footprint.h);
    }
  });

  it('re-expresses the nine legacy buildings', () => {
    for (const name of ['cottage', 'tavern', 'market_stall', 'temple_small',
                         'farm_barn', 'tower', 'castle_keep', 'dock']) {
      expect(getPreset(name), name).toBeDefined();
    }
  });

  it('models a ziggurat-shaped keep and a round yurt', () => {
    expect(getPreset('castle_keep')!.plan).toBe('stepped');
    expect(getPreset('castle_keep')!.levelInset).toBeGreaterThan(0);
    expect(getPreset('yurt')!.plan).toBe('round');
    expect(getPreset('yurt')!.roof).toBe('domed');
  });

  it('synthesize clones (no shared mutable footprint) and applies overrides', () => {
    const a = synthesizeFromPreset('cottage')!;
    const b = synthesizeFromPreset('cottage', { footprint: { w: 5, h: 5 } })!;
    a.footprint.w = 99;
    expect(getPreset('cottage')!.footprint.w).toBe(3); // preset untouched
    expect(b.footprint.w).toBe(5);
    expect(b.preset).toBe('cottage');
  });

  it('maps poi types to preset names', () => {
    expect(presetForPoiType('temple')).toBe('temple_small');
    expect(presetForPoiType('unknown_type')).toBe('cottage');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/building-presets.test.ts`
Expected: FAIL — cannot resolve `@/world/building-presets`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/world/building-presets.ts
/**
 * Named descriptor presets — the open catalogue Fate, worldgen, and the editor
 * draw from. Add a building by adding one entry (and, if it needs its own
 * `kind`, an entity-kind def). The nine legacy templates are re-expressed here.
 */
import type { BuildingDescriptor } from './building-descriptor';

export const BUILDING_PRESETS: Record<string, BuildingDescriptor> = {
  cottage: {
    category: 'residential', era: 'medieval', footprint: { w: 3, h: 3 },
    plan: 'rect', levels: 1, levelInset: 0, heightPerLevel: 1,
    roof: 'gable', walls: 'wattle', roofMat: 'thatch',
    groundMaterial: 'packed_dirt', apron: { radius: 1, material: 'packed_dirt' },
    door: { x: 1, y: 2 },
  },
  tavern: {
    category: 'commercial', era: 'medieval', footprint: { w: 3, h: 3 },
    plan: 'rect', levels: 2, levelInset: 0, heightPerLevel: 1,
    roof: 'hip', walls: 'timber', roofMat: 'tile',
    groundMaterial: 'packed_dirt', apron: { radius: 1, material: 'packed_dirt' },
    door: { x: 1, y: 2 },
  },
  market_stall: {
    category: 'commercial', era: 'medieval', footprint: { w: 2, h: 2 },
    plan: 'rect', levels: 1, levelInset: 0, heightPerLevel: 1,
    roof: 'lean_to', walls: 'timber', roofMat: 'thatch',
    door: { x: 0, y: 1 },
  },
  temple_small: {
    category: 'religious', era: 'classical', footprint: { w: 4, h: 4 },
    plan: 'cross', levels: 1, levelInset: 0, heightPerLevel: 1.5,
    roof: 'hip', walls: 'stone', roofMat: 'tile',
    groundMaterial: 'flagstone', apron: { radius: 2, material: 'flagstone' },
    door: { x: 1, y: 3 },
  },
  farm_barn: {
    category: 'farm', era: 'medieval', footprint: { w: 3, h: 2 },
    plan: 'rect', levels: 1, levelInset: 0, heightPerLevel: 1.2,
    roof: 'gable', walls: 'timber', roofMat: 'wood',
    groundMaterial: 'dirt', door: { x: 1, y: 1 },
  },
  tower: {
    category: 'military', era: 'medieval', footprint: { w: 2, h: 3 },
    plan: 'rect', levels: 3, levelInset: 0, heightPerLevel: 1.5,
    roof: 'flat', walls: 'stone', roofMat: 'slate',
    groundMaterial: 'flagstone', door: { x: 0, y: 2 },
  },
  castle_keep: {
    category: 'military', era: 'medieval', footprint: { w: 4, h: 4 },
    plan: 'stepped', levels: 4, levelInset: 1, heightPerLevel: 1.5,
    roof: 'stepped', walls: 'stone', roofMat: 'slate',
    groundMaterial: 'flagstone', apron: { radius: 2, material: 'gravel' },
    door: { x: 1, y: 3 },
  },
  dock: {
    category: 'special', era: 'medieval', footprint: { w: 2, h: 3 },
    plan: 'rect', levels: 1, levelInset: 0, heightPerLevel: 0.2,
    roof: 'flat', walls: 'timber', roofMat: 'wood',
    groundMaterial: 'wood', door: { x: 0, y: 0 },
  },
  shrine: {
    category: 'religious', era: 'classical', footprint: { w: 2, h: 2 },
    plan: 'rect', levels: 1, levelInset: 0, heightPerLevel: 1,
    roof: 'gable', walls: 'stone', roofMat: 'tile',
    groundMaterial: 'flagstone', door: { x: 0, y: 1 },
  },
  guard_post: {
    category: 'military', era: 'medieval', footprint: { w: 2, h: 2 },
    plan: 'rect', levels: 1, levelInset: 0, heightPerLevel: 1.2,
    roof: 'hip', walls: 'timber', roofMat: 'wood',
    door: { x: 0, y: 1 },
  },
  // ── New archetypes the parametric system unlocks ──
  yurt: {
    category: 'residential', era: 'stone_age', footprint: { w: 2, h: 2 },
    plan: 'round', levels: 1, levelInset: 0, heightPerLevel: 0.9,
    roof: 'domed', walls: 'hide', roofMat: 'hide',
    groundMaterial: 'dirt', door: { x: 0, y: 1 },
  },
  longhouse: {
    category: 'residential', era: 'medieval', footprint: { w: 5, h: 2 },
    plan: 'rect', levels: 1, levelInset: 0, heightPerLevel: 1.2,
    roof: 'gable', walls: 'log', roofMat: 'thatch',
    groundMaterial: 'packed_dirt', door: { x: 2, y: 1 },
  },
};

export function getPreset(name: string): BuildingDescriptor | undefined {
  return BUILDING_PRESETS[name];
}

/** Deep-cloned descriptor with overrides applied and `preset` stamped. */
export function synthesizeFromPreset(
  name: string, overrides: Partial<BuildingDescriptor> = {},
): BuildingDescriptor | undefined {
  const base = BUILDING_PRESETS[name];
  if (!base) return undefined;
  return { ...structuredClone(base), ...structuredClone(overrides), preset: name };
}

const POI_PRESET: Record<string, string> = {
  village: 'cottage', city: 'tavern', temple: 'temple_small', farm: 'farm_barn',
  castle: 'castle_keep', tower: 'tower', port: 'dock', tavern: 'tavern',
  market: 'market_stall', mine: 'tower', ruins: 'cottage',
};

export function presetForPoiType(poiType: string): string {
  return POI_PRESET[poiType] ?? 'cottage';
}
```

> Note: `Era` includes `'stone_age'` — verify against `src/core/types.ts`. If the
> union differs, use an existing era value for `yurt` (e.g. `'medieval'`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/building-presets.test.ts`
Expected: PASS (5 tests). If the `Era` type rejects `'stone_age'`, change `yurt.era` to a valid era and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/world/building-presets.ts tests/unit/building-presets.test.ts
git commit -m "feat(buildings): descriptor presets (9 legacy + yurt/longhouse)"
```

---

## Task 3: Register building entity kinds

**Files:**
- Modify: `src/world/entity-kinds.ts:40-41` (after the `guard_post` line, inside the buildings block)
- Test: covered by Task 4 (`buildingEntity` + indexing) and existing `isBuilding`.

- [ ] **Step 1: Add the generic + new building kinds**

In `src/world/entity-kinds.ts`, after the `['guard_post', …]` line (currently line 40), add:

```ts
  ['building',      def('building',      'building',         '#C4956A', 'square', ['building'], 1)],
  ['yurt',          def('yurt',          'building',         '#b9a07a', 'square', ['building', 'residential', 'shelter'], 1)],
  ['longhouse',     def('longhouse',     'building',         '#7a5230', 'square', ['building', 'residential', 'shelter'], 1)],
```

- [ ] **Step 2: Write the failing test**

```ts
// add to tests/unit/building-descriptor.test.ts
import { tryGetEntityKindDef } from '@/world/entity-kinds';

it('generic and new preset kinds are registered as buildings', () => {
  for (const k of ['building', 'yurt', 'longhouse']) {
    expect(tryGetEntityKindDef(k)?.category, k).toBe('building');
  }
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run tests/unit/building-descriptor.test.ts`
Expected: PASS (now 7 tests). (Step 1 already implemented it; this is a guard.)

- [ ] **Step 4: Commit**

```bash
git add src/world/entity-kinds.ts tests/unit/building-descriptor.test.ts
git commit -m "feat(buildings): register generic 'building' + yurt/longhouse kinds"
```

---

## Task 4: Descriptor entity indexes every footprint cell

**Files:**
- Test: `tests/unit/building-placer-descriptor.test.ts` (new — extended in Task 9)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/building-placer-descriptor.test.ts
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { buildingEntity } from '@/world/building-descriptor';
import { synthesizeFromPreset } from '@/world/building-presets';

describe('descriptor building indexing', () => {
  it('registers every footprint cell in the registry tile index', () => {
    const world = new World(32, 32);
    const d = synthesizeFromPreset('cottage')!;       // 3x3
    world.addEntity(buildingEntity('b1', d, 5, 5));
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        const at = world.registry.getAtTile(5 + dx, 5 + dy).map(e => e.id);
        expect(at, `cell ${5 + dx},${5 + dy}`).toContain('b1');
      }
    }
    expect(world.registry.getAtTile(8, 8).map(e => e.id)).not.toContain('b1');
  });
});
```

- [ ] **Step 2: Run test to verify it passes (or surfaces the World constructor signature)**

Run: `npx vitest run tests/unit/building-placer-descriptor.test.ts`
Expected: PASS. If `new World(32, 32)` is wrong, check an existing test (e.g. `tests/unit/building-collision*.test.ts` or `grep -rn "new World(" tests`) for the correct constructor and mirror it. The assertion behaviour is what matters; `buildingEntity` already mirrors `footprint` into `properties` so `indexEntity` registers all cells.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/building-placer-descriptor.test.ts
git commit -m "test(buildings): descriptor entity indexes every footprint cell"
```

---

## Task 5: Door cell passability

**Files:**
- Modify: `src/world/building-collision.ts:28-49`
- Test: `tests/unit/building-collision-door.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/building-collision-door.test.ts
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { buildingEntity } from '@/world/building-descriptor';
import { synthesizeFromPreset } from '@/world/building-presets';
import { tileBlockedByBuilding } from '@/world/building-collision';

describe('building door passability', () => {
  it('door cell is walkable, every other footprint cell is solid', () => {
    const world = new World(32, 32);
    const d = synthesizeFromPreset('cottage')!;        // 3x3, door {1,2}
    world.addEntity(buildingEntity('b1', d, 5, 5));    // door at world (6, 7)
    expect(tileBlockedByBuilding(world, 6, 7)).toBe(false); // door
    expect(tileBlockedByBuilding(world, 5, 5)).toBe(true);  // corner
    expect(tileBlockedByBuilding(world, 6, 6)).toBe(true);  // centre
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/building-collision-door.test.ts`
Expected: FAIL — door cell returns `true` (v1 is all-solid).

- [ ] **Step 3: Modify the implementation**

Replace `isFootprintCellPassable` and extend `isBuilding` in `src/world/building-collision.ts`:

```ts
/** True when this entity is a building (its footprint forms a collider). */
export function isBuilding(e: Entity): boolean {
  if (tryGetEntityKindDef(e.kind)?.category === 'building') return true;
  // Extensibility fallback: a descriptor-tagged building with an unregistered
  // kind still collides.
  return Array.isArray(e.tags) && e.tags.includes('building');
}

/**
 * Whether a single footprint cell of `building` can be walked through.
 *
 * The descriptor's `door` cell (relative to the footprint top-left) is the one
 * passable cell; every other covered cell is solid.
 */
export function isFootprintCellPassable(
  building: Entity,
  tileX: number,
  tileY: number,
): boolean {
  const door = (building.properties?.door ?? building.properties?.descriptor) as
    | { x: number; y: number } | { door?: { x: number; y: number } } | undefined;
  const d = (door && 'x' in door) ? door : (door as { door?: { x: number; y: number } })?.door;
  if (!d) return false;
  const localX = tileX - Math.floor(building.x);
  const localY = tileY - Math.floor(building.y);
  return localX === d.x && localY === d.y;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/building-collision-door.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/world/building-collision.ts tests/unit/building-collision-door.test.ts
git commit -m "feat(buildings): door cell is the one passable footprint cell"
```

---

## Task 6: Derived ground-material field

**Files:**
- Create: `src/render/ground-material.ts`
- Test: `tests/unit/ground-material.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/ground-material.test.ts
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { buildingEntity } from '@/world/building-descriptor';
import { synthesizeFromPreset } from '@/world/building-presets';
import { computeGroundMaterialField } from '@/render/ground-material';

describe('computeGroundMaterialField', () => {
  it('stamps footprint material under the building and apron material around it', () => {
    const world = new World(40, 40);
    const d = synthesizeFromPreset('cottage')!;   // ground packed_dirt, apron r1 packed_dirt
    world.addEntity(buildingEntity('b1', d, 10, 10)); // 3x3 footprint
    const field = computeGroundMaterialField(world);
    expect(field.get('11,11')).toBe('packed_dirt');  // under footprint (centre)
    expect(field.get('9,10')).toBe('packed_dirt');   // apron ring (left of footprint)
    expect(field.get('20,20')).toBeUndefined();      // far away
  });

  it('footprint material wins over a neighbour apron', () => {
    const world = new World(40, 40);
    const temple = synthesizeFromPreset('temple_small')!; // flagstone footprint + apron r2
    world.addEntity(buildingEntity('t', temple, 10, 10)); // 4x4
    const field = computeGroundMaterialField(world);
    expect(field.get('11,11')).toBe('flagstone');    // footprint, not apron
  });

  it('reverts (no entries) when the building is removed', () => {
    const world = new World(40, 40);
    const d = synthesizeFromPreset('cottage')!;
    world.addEntity(buildingEntity('b1', d, 10, 10));
    world.removeEntity('b1');
    const field = computeGroundMaterialField(world);
    expect(field.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ground-material.test.ts`
Expected: FAIL — cannot resolve `@/render/ground-material`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/render/ground-material.ts
/**
 * Ground material an individual building "orders" for the tiles under it and a
 * surrounding apron ring. DERIVED, never written to tiles: deleting/moving a
 * building reverts the ground for free, and nothing new is serialized. When the
 * 2.5D flatten lands, this is the seam to promote to a baked Tile.material.
 *
 * Footprint material wins over any neighbour's apron material.
 */
import type { World } from '@/world/world';
import { isBuilding } from '@/world/building-collision';
import type { BuildingDescriptor, GroundMat } from '@/world/building-descriptor';

const key = (x: number, y: number): string => `${x},${y}`;

function descriptorOf(props: Record<string, unknown> | undefined): BuildingDescriptor | undefined {
  return props?.descriptor as BuildingDescriptor | undefined;
}

/** Build the per-frame map of tile → ordered ground material. */
export function computeGroundMaterialField(world: World): Map<string, GroundMat> {
  const buildings = world.query({}).filter(isBuilding);
  const field = new Map<string, GroundMat>();

  // Pass 1: footprints (these win).
  for (const b of buildings) {
    const d = descriptorOf(b.properties);
    if (!d?.groundMaterial) continue;
    const ox = Math.floor(b.x), oy = Math.floor(b.y);
    for (let dy = 0; dy < d.footprint.h; dy++) {
      for (let dx = 0; dx < d.footprint.w; dx++) {
        field.set(key(ox + dx, oy + dy), d.groundMaterial);
      }
    }
  }

  // Pass 2: aprons (only where a footprint hasn't already claimed the cell).
  for (const b of buildings) {
    const d = descriptorOf(b.properties);
    if (!d?.apron) continue;
    const ox = Math.floor(b.x), oy = Math.floor(b.y);
    const r = d.apron.radius;
    for (let dy = -r; dy < d.footprint.h + r; dy++) {
      for (let dx = -r; dx < d.footprint.w + r; dx++) {
        const inFootprint = dx >= 0 && dx < d.footprint.w && dy >= 0 && dy < d.footprint.h;
        if (inFootprint) continue;
        const k = key(ox + dx, oy + dy);
        if (!field.has(k)) field.set(k, d.apron.material);
      }
    }
  }

  return field;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/ground-material.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/ground-material.ts tests/unit/ground-material.test.ts
git commit -m "feat(buildings): derived ground-material field (footprint + apron)"
```

---

## Task 7: Massing placeholder renderer

**Files:**
- Create: `src/render/building-massing.ts`
- Test: `tests/unit/building-massing.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/building-massing.test.ts
import { describe, it, expect } from 'vitest';
import { drawBuildingPlaceholder } from '@/render/building-massing';
import { buildingPalette } from '@/world/building-descriptor';
import { BUILDING_PRESETS, synthesizeFromPreset } from '@/world/building-presets';

/** Minimal canvas-context spy recording the calls the renderer makes. */
function spyCtx() {
  const calls: string[] = [];
  const fillStyles: string[] = [];
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_t, prop: string) {
      if (prop === '__calls') return calls;
      if (prop === '__fillStyles') return fillStyles;
      if (prop === 'fillStyle' || prop === 'strokeStyle') return '';
      return (...args: unknown[]) => { calls.push(prop); void args; };
    },
    set(_t, prop: string, value: unknown) {
      if (prop === 'fillStyle') fillStyles.push(String(value));
      return true;
    },
  };
  return new Proxy({}, handler) as unknown as CanvasRenderingContext2D & {
    __calls: string[]; __fillStyles: string[];
  };
}

describe('drawBuildingPlaceholder', () => {
  it('draws something for every preset without throwing', () => {
    for (const name of Object.keys(BUILDING_PRESETS)) {
      const ctx = spyCtx();
      const d = synthesizeFromPreset(name)!;
      expect(() => drawBuildingPlaceholder(ctx, d, 4, 4), name).not.toThrow();
      expect(ctx.__calls.some(c => c === 'fill' || c === 'fillRect'), name).toBe(true);
    }
  });

  it('uses the wall colour as a fill', () => {
    const ctx = spyCtx();
    const d = synthesizeFromPreset('cottage')!;
    drawBuildingPlaceholder(ctx, d, 0, 0);
    expect(ctx.__fillStyles).toContain(buildingPalette(d).walls);
  });

  it('draws concentric steps for a stepped ziggurat (one fill per level)', () => {
    const ctx = spyCtx();
    const d = synthesizeFromPreset('castle_keep')!; // stepped, levels 4
    drawBuildingPlaceholder(ctx, d, 0, 0);
    const fills = ctx.__calls.filter(c => c === 'fill' || c === 'fillRect').length;
    expect(fills).toBeGreaterThanOrEqual(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/building-massing.test.ts`
Expected: FAIL — cannot resolve `@/render/building-massing`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/render/building-massing.ts
/**
 * Topdown silhouette renderer for a BuildingDescriptor — the placeholder until
 * AI-generated art lands. Reads the descriptor's massing (plan / levels /
 * levelInset / roof) and materials. Drawn in world-pixel space (TILE_SIZE
 * units), matching renderer.ts which draws entities at `e.x * TILE_SIZE`.
 *
 * Extend by adding a `case` to drawPlan() / drawRoof(); the `default` keeps an
 * unknown shape rendering (as a rectangle) instead of throwing.
 */
import { TILE_SIZE } from '@/core/constants';
import { buildingPalette, type BuildingDescriptor } from '@/world/building-descriptor';

function shade(hex: string, factor: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export function drawBuildingPlaceholder(
  ctx: CanvasRenderingContext2D,
  d: BuildingDescriptor,
  originTileX: number,
  originTileY: number,
): void {
  const pal = buildingPalette(d);
  const x = originTileX * TILE_SIZE;
  const y = originTileY * TILE_SIZE;
  const w = d.footprint.w * TILE_SIZE;
  const h = d.footprint.h * TILE_SIZE;

  if (d.plan === 'stepped') {
    drawStepped(ctx, d, x, y, w, h, pal.walls);
  } else {
    ctx.fillStyle = pal.walls;
    drawPlan(ctx, d.plan, x, y, w, h);
    drawRoof(ctx, d.roof, x, y, w, h, pal.roof);
  }
  drawDoor(ctx, d, x, y);
}

function drawPlan(
  ctx: CanvasRenderingContext2D, plan: BuildingDescriptor['plan'],
  x: number, y: number, w: number, h: number,
): void {
  switch (plan) {
    case 'round': {
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'L': {
      ctx.fillRect(x, y, w, h * 0.5);
      ctx.fillRect(x, y, w * 0.5, h);
      break;
    }
    case 'cross': {
      ctx.fillRect(x + w * 0.25, y, w * 0.5, h);
      ctx.fillRect(x, y + h * 0.25, w, h * 0.5);
      break;
    }
    case 'rect':
    default:
      ctx.fillRect(x, y, w, h);
      break;
  }
}

function drawStepped(
  ctx: CanvasRenderingContext2D, d: BuildingDescriptor,
  x: number, y: number, w: number, h: number, wallColor: string,
): void {
  const levels = Math.max(1, d.levels);
  const insetPx = Math.max(1, d.levelInset) * TILE_SIZE * 0.5;
  for (let i = 0; i < levels; i++) {
    const o = i * insetPx;
    const lw = w - o * 2, lh = h - o * 2;
    if (lw <= 0 || lh <= 0) break;
    ctx.fillStyle = shade(wallColor, 1 - i * 0.12);
    ctx.fillRect(x + o, y + o, lw, lh);
  }
}

function drawRoof(
  ctx: CanvasRenderingContext2D, roof: BuildingDescriptor['roof'],
  x: number, y: number, w: number, h: number, roofColor: string,
): void {
  if (roof === 'none') return;
  ctx.fillStyle = roofColor;
  ctx.strokeStyle = roofColor;
  const cx = x + w / 2, cy = y + h / 2;
  switch (roof) {
    case 'conical':
    case 'domed': {
      ctx.beginPath();
      ctx.ellipse(cx, cy, w * 0.18, h * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'gable': {            // ridge line down the long axis
      const r = Math.max(1, TILE_SIZE * 0.12);
      ctx.fillRect(cx - r / 2, y + h * 0.15, r, h * 0.7);
      break;
    }
    case 'hip': {              // inset roof rectangle
      ctx.fillRect(x + w * 0.2, y + h * 0.2, w * 0.6, h * 0.6);
      break;
    }
    case 'lean_to': {          // offset slope band
      ctx.fillRect(x, y, w, h * 0.35);
      break;
    }
    case 'flat':
    default: {                 // thin border to read as a parapet
      const b = Math.max(1, TILE_SIZE * 0.1);
      ctx.fillRect(x, y, w, b);
      ctx.fillRect(x, y + h - b, w, b);
      break;
    }
  }
}

function drawDoor(
  ctx: CanvasRenderingContext2D, d: BuildingDescriptor, x: number, y: number,
): void {
  ctx.fillStyle = '#3a2a1a';
  const dx = x + d.door.x * TILE_SIZE + TILE_SIZE * 0.3;
  const dy = y + d.door.y * TILE_SIZE + TILE_SIZE * 0.3;
  ctx.fillRect(dx, dy, TILE_SIZE * 0.4, TILE_SIZE * 0.4);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/building-massing.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/building-massing.ts tests/unit/building-massing.test.ts
git commit -m "feat(buildings): topdown massing placeholder renderer"
```

---

## Task 8: Wire the renderer (placeholder branch + ground overlay)

**Files:**
- Modify: `src/render/renderer.ts:354-401` (`drawEntity`) and `src/render/renderer.ts:11-24` (`renderMap`)
- Test: manual + full suite (the renderer integration is exercised by the build and existing render tests).

- [ ] **Step 1: Add the descriptor branch to `drawEntity`**

In `src/render/renderer.ts`, add imports near the top (with the other `@/` imports):

```ts
import { drawBuildingPlaceholder } from './building-massing';
import { computeGroundMaterialField } from './ground-material';
import { GROUND_COLORS, type BuildingDescriptor } from '@/world/building-descriptor';
```

Then in `drawEntity`, immediately after the `remains` block (right before the `// 1. Building sprite path` comment at line ~375) insert:

```ts
  // 1. Parametric building — topdown silhouette from the descriptor.
  const descriptor = e.properties?.descriptor as BuildingDescriptor | undefined;
  if (descriptor) {
    drawBuildingPlaceholder(ctx, descriptor, Math.floor(e.x), Math.floor(e.y));
    return;
  }
```

(The existing sprite/template path below stays as the compat fallback for any
entity that has no descriptor.)

- [ ] **Step 2: Add the ground-material overlay pass**

Add this function near `drawTerrain` in `src/render/renderer.ts`:

```ts
// Pass 0b: Building-ordered ground material (derived; translucent overlay).
function drawGroundMaterialOverlay(ctx: CanvasRenderingContext2D, rc: RenderContext): void {
  const field = computeGroundMaterialField(rc.world);
  if (field.size === 0) return;
  const { camera, canvasWidth, canvasHeight, map } = rc;
  const startX = Math.max(0, Math.floor(camera.x / TILE_SIZE) - 1);
  const startY = Math.max(0, Math.floor(camera.y / TILE_SIZE) - 1);
  const endX = Math.min(map.width, Math.ceil((camera.x + canvasWidth / camera.zoom) / TILE_SIZE) + 1);
  const endY = Math.min(map.height, Math.ceil((camera.y + canvasHeight / camera.zoom) / TILE_SIZE) + 1);

  ctx.globalAlpha = 0.55;
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const tile = map.tiles[y]?.[x];
      if (!tile || tile.state === 'void') continue;
      const mat = field.get(`${x},${y}`);
      if (!mat) continue;
      ctx.fillStyle = GROUND_COLORS[mat] ?? '#8a8a8a';
      ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }
  ctx.globalAlpha = 1;
}
```

Then in `renderMap` (line ~22) call it right after `drawTerrain(ctx, rc);`:

```ts
  drawTerrain(ctx, rc);
  drawGroundMaterialOverlay(ctx, rc);
```

- [ ] **Step 3: Verify build + types**

Run: `npm run build`
Expected: PASS — TypeScript clean. If `rc.world` is absent on `RenderContext`, use the world the entity pass uses (`drawYSortedEntities` destructures `world` from `rc`, so `rc.world` exists). If `RenderContext` lacks a typed `world`, check `src/game/render-context.ts` and use the same accessor.

- [ ] **Step 4: Visual smoke (manual, optional but recommended)**

Run: `npm run dev`, generate a world, confirm settlements render as silhouettes with packed-dirt/flagstone aprons and no crash. (No automated assertion — the unit tests cover the drawing primitives.)

- [ ] **Step 5: Commit**

```bash
git add src/render/renderer.ts
git commit -m "feat(buildings): render descriptor silhouettes + ground overlay"
```

---

## Task 9: Worldgen builds descriptor entities

**Files:**
- Modify: `src/world/building-placer.ts` (`findPlacement` signature line 111-148; `placeSettlement` body line 241-315; `clearFootprint` callsite)
- Test: extend `tests/unit/building-placer-descriptor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/building-placer-descriptor.test.ts
import { placeSettlement } from '@/world/building-placer';
import { getZoneRule } from '@/map/poi-zones';
import { Random } from '@/core/noise';
import type { BuildingDescriptor } from '@/world/building-descriptor';

function gridTiles(w: number, h: number) {
  const tiles = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) {
      row.push({ type: 'grass', x, y, walkable: true, state: 'realized' as const });
    }
    tiles.push(row);
  }
  return tiles;
}

describe('placeSettlement produces descriptor entities', () => {
  it('every placed building carries a descriptor and is tagged building', () => {
    const world = new World(40, 40);
    const tiles = gridTiles(40, 40);
    const poi = { id: 'poi-v', type: 'village', position: { x: 20, y: 20 } } as never;
    const { entities } = placeSettlement(
      poi, getZoneRule('village'), tiles, world.registry, [], new Random(1234), 'medieval', world,
    );
    expect(entities.length).toBeGreaterThan(0);
    for (const e of entities) {
      expect(e.tags).toContain('building');
      const d = e.properties?.descriptor as BuildingDescriptor | undefined;
      expect(d, e.id).toBeDefined();
      expect(d!.footprint.w).toBeGreaterThan(0);
    }
  });

  it('is deterministic for a fixed seed (replay parity)', () => {
    const run = () => {
      const world = new World(40, 40);
      const tiles = gridTiles(40, 40);
      const poi = { id: 'poi-v', type: 'village', position: { x: 20, y: 20 } } as never;
      return placeSettlement(poi, getZoneRule('village'), tiles, world.registry, [],
        new Random(99), 'medieval', world).entities.map(e => `${e.kind}@${e.x},${e.y}`);
    };
    expect(run()).toEqual(run());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/building-placer-descriptor.test.ts`
Expected: FAIL — placed entities have `properties.templateId` but no `properties.descriptor`.

- [ ] **Step 3: Modify `building-placer.ts`**

3a. Change `findPlacement` to take a footprint instead of a template. Replace its signature + first line:

```ts
export function findPlacement(
  center:     { x: number; y: number },
  footprint:  { w: number; h: number },
  constraint: PlacementConstraint,
  tiles:      Tile[][],
  registry:   EntityRegistry,
  maxRadius = 20,
): PlacementResult | null {
  const { w, h } = footprint;
```

3b. Replace the imports at the top:

```ts
import { synthesizeFromPreset } from '@/world/building-presets';
import { buildingEntity } from '@/world/building-descriptor';
```
(Remove `import type { BuildingTemplate } …` and `import { getBuildingTemplate } …`.)

3c. In `placeSettlement`, replace the building-creation block (the body of the
`for (let attempt …)` loop, lines ~242-314) with:

```ts
    const presetName = zoneRule.buildings[placed % zoneRule.buildings.length];
    const descriptor = synthesizeFromPreset(presetName);
    if (!descriptor) continue;

    const along = (rng.next() * 2 - 1) * radius * 0.8;
    const perp  = (rng.next() * 2 - 1) * 3;
    const perpDir = { dx: -mainDir.dy, dy: mainDir.dx };
    const targetX = Math.round(cx + mainDir.dx * along + perpDir.dx * perp);
    const targetY = Math.round(cy + mainDir.dy * along + perpDir.dy * perp);

    const result = findPlacement(
      { x: targetX, y: targetY }, descriptor.footprint, constraint, tiles, registry, radius,
    );
    if (!result) continue;

    const entity = buildingEntity(
      `${poi.id}_bld_${placed}`, descriptor, result.tileX, result.tileY, { poiId: poi.id },
    );

    clearFootprint(
      result.tileX, result.tileY, descriptor.footprint.w, descriptor.footprint.h,
      registry, world, tiles,
    );

    registry.add(entity);
    entities.push(entity);

    if (zoneRule.internalRoads) {
      const doorX = result.tileX + descriptor.door.x;
      const doorY = result.tileY + descriptor.door.y;
      const roadPositions = new Set(roadTiles.map(rt => `${rt.x},${rt.y}`));
      const path = bresenhamLine(doorX, doorY, cx, cy);
      for (let pi = 0; pi < Math.min(6, path.length); pi++) {
        const pt = path[pi];
        const tileType = tiles[pt.y]?.[pt.x]?.type;
        if (WATER_TYPES.has(tileType)) break;
        roadTiles.push({ x: pt.x, y: pt.y, type: roadType });
        if (roadPositions.has(`${pt.x},${pt.y}`) || ROAD_TYPES.has(tileType)) break;
      }
    }

    placed++;
```

- [ ] **Step 4: Run test + suite to verify it passes**

Run: `npx vitest run tests/unit/building-placer-descriptor.test.ts`
Expected: PASS.

Run: `npx vitest run src/world tests/unit/building-placer* tests/dom`
Expected: PASS. If any existing test called `findPlacement(center, template, …)`, update it to pass `template.footprint` (or a `{w,h}`). Grep first: `grep -rn "findPlacement(" src tests | grep -v editor-verbs | grep -v command`.

- [ ] **Step 5: Commit**

```bash
git add src/world/building-placer.ts tests/unit/building-placer-descriptor.test.ts
git commit -m "feat(buildings): worldgen places descriptor entities via presets"
```

---

## Task 10: `place_building` command verb

**Files:**
- Create: `src/sim/command/building-verbs.ts`
- Modify: `src/sim/command/types.ts:15-22`, `src/sim/command/registry.ts:26,60-152`
- Test: `tests/unit/place-building-verb.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/place-building-verb.test.ts
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { EventLog } from '@/core/events';
import { Rng } from '@/core/rng';
import { CAPABILITY_REGISTRY } from '@/sim/command/registry';
import type { Command, ApplyCtx } from '@/sim/command/types';
import type { BuildingDescriptor } from '@/world/building-descriptor';

function realizedWorld(w = 40, h = 40): World {
  const world = new World(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      world.tiles.tiles[y][x] = { type: 'grass', x, y, walkable: true, state: 'realized' };
  return world;
}

function applyCtx(world: World): ApplyCtx {
  return { world, spirits: new Map(), log: new EventLog(), rng: new Rng(7), now: 100 };
}

const cmd = (payload: Record<string, unknown>): Command => ({
  verb: 'place_building', source: 'fate', target: { kind: 'none' }, payload, seq: 1,
});

describe('place_building', () => {
  const cap = CAPABILITY_REGISTRY.place_building;

  it('is registered, implemented, authoring tier', () => {
    expect(cap).toBeDefined();
    expect(cap.implemented).toBe(true);
    expect(cap.tier).toBe('authoring');
  });

  it('rejects an unknown preset and a missing location', () => {
    const ctx = applyCtx(realizedWorld());
    expect(cap.precondition!(cmd({ preset: 'nope', at: { x: 5, y: 5 } }), ctx)).toBe('invalid_payload');
    expect(cap.precondition!(cmd({ preset: 'cottage' }), ctx)).toBe('invalid_target');
  });

  it('places a descriptor-carrying building near the target', () => {
    const ctx = applyCtx(realizedWorld());
    expect(cap.precondition!(cmd({ preset: 'cottage', at: { x: 10, y: 10 } }), ctx)).toBeNull();
    expect(cap.apply!(cmd({ preset: 'cottage', at: { x: 10, y: 10 } }), ctx)).toBe(true);
    const placed = ctx.world.query({}).filter(e => e.tags?.includes('building'));
    expect(placed.length).toBe(1);
    const d = placed[0].properties?.descriptor as BuildingDescriptor;
    expect(d.preset).toBe('cottage');
  });

  it('is deterministic for a fixed seed', () => {
    const run = () => {
      const ctx = applyCtx(realizedWorld());
      cap.apply!(cmd({ preset: 'cottage', at: { x: 10, y: 10 } }), ctx);
      const b = ctx.world.query({}).filter(e => e.tags?.includes('building'))[0];
      return `${b.x},${b.y}`;
    };
    expect(run()).toEqual(run());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/place-building-verb.test.ts`
Expected: FAIL — `CAPABILITY_REGISTRY.place_building` is undefined.

- [ ] **Step 3: Implement the verb**

3a. Create `src/sim/command/building-verbs.ts`:

```ts
/**
 * building-verbs.ts — the `place_building` authoring verb. Fate (or the editor)
 * names a preset (with optional overrides) or supplies a full descriptor and a
 * location; the verb finds a clear footprint, stamps the building, and carves a
 * door path. All randomness flows through ctx.rng (seeded) — never Math.random.
 */
import type { Command, ApplyCtx, CommandCtx, RejectionReason } from './types';
import { synthesizeFromPreset } from '@/world/building-presets';
import { buildingEntity, type BuildingDescriptor } from '@/world/building-descriptor';
import { resolveCenter } from './editor-verbs';

const P = (cmd: Command): Record<string, unknown> => cmd.payload ?? {};

/** Resolve a descriptor from `{ preset, overrides }` or a raw `{ descriptor }`. */
function resolveDescriptor(p: Record<string, unknown>): BuildingDescriptor | undefined {
  if (p.descriptor && typeof p.descriptor === 'object') return p.descriptor as BuildingDescriptor;
  if (typeof p.preset === 'string') {
    return synthesizeFromPreset(p.preset, (p.overrides as Partial<BuildingDescriptor>) ?? {});
  }
  return undefined;
}

/** The location to place near: a settlement poiId, or a `{x,y}` `at`. */
function resolveTarget(cmd: Command, ctx: CommandCtx): { x: number; y: number } | null {
  if (cmd.target.kind === 'settlement') return resolveCenter(cmd.target.poiId, ctx);
  const at = P(cmd).at as { x: number; y: number } | undefined;
  return at ? resolveCenter(at, ctx) : null;
}

/** Spiral for a footprint where every cell is in-bounds, realized and unoccupied. */
export function findBuildingPlacement(
  world: CommandCtx['world'], cx: number, cy: number,
  footprint: { w: number; h: number }, maxRadius = 8,
): { x: number; y: number } | null {
  const map = world.tiles;
  const fits = (x0: number, y0: number): boolean => {
    if (x0 < 0 || y0 < 0 || x0 + footprint.w > map.width || y0 + footprint.h > map.height) return false;
    for (let dy = 0; dy < footprint.h; dy++) {
      for (let dx = 0; dx < footprint.w; dx++) {
        const t = map.tiles[y0 + dy]?.[x0 + dx];
        if (!t || t.state !== 'realized') return false;
      }
    }
    return world.registry.canPlace(x0, y0, footprint.w, footprint.h, 0);
  };
  for (let r = 0; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx, y = cy + dy;
        if (fits(x, y)) return { x, y };
      }
    }
  }
  return null;
}

export function placeBuildingPrecondition(cmd: Command, ctx: CommandCtx): RejectionReason | null {
  if (!resolveDescriptor(P(cmd))) return 'invalid_payload';
  if (resolveTarget(cmd, ctx) === null) return 'invalid_target';
  return null;
}

export function placeBuildingApply(cmd: Command, ctx: ApplyCtx): boolean {
  const d = resolveDescriptor(P(cmd))!;            // validated in precondition
  const center = resolveTarget(cmd, ctx)!;
  const spot = findBuildingPlacement(ctx.world, center.x, center.y, d.footprint);
  if (!spot) return false;                          // no room → decline cleanly

  let id = '';
  do { id = `bld-f${ctx.now}-${ctx.rng.nextInt(0x7fffffff)}`; } while (ctx.world.registry.get(id));
  ctx.world.addEntity(
    buildingEntity(id, d, spot.x, spot.y) as unknown as Parameters<typeof ctx.world.addEntity>[0],
  );

  // Footprint is solid (collision handles the door); mark tiles non-walkable.
  for (let dy = 0; dy < d.footprint.h; dy++) {
    for (let dx = 0; dx < d.footprint.w; dx++) {
      const t = ctx.world.tiles.tiles[spot.y + dy]?.[spot.x + dx];
      if (t && !(dx === d.door.x && dy === d.door.y)) t.walkable = false;
    }
  }

  ctx.log.append({ type: 'authored_place', entityIds: [id], kind: d.preset ?? 'building', count: 1 });
  return true;
}
```

3b. Add `'place_building'` to the `CommandVerb` union in `src/sim/command/types.ts` (in the authoring-tier line):

```ts
  | 'bias_event' | 'inject_npc' | 'nudge_severity' | 'place_building'
```

3c. Register it in `src/sim/command/registry.ts`. Add the import after the
`authoring-verbs` import (line 26):

```ts
import { placeBuildingPrecondition, placeBuildingApply } from './building-verbs';
```

And add this entry inside `CAPABILITY_REGISTRY`, after the `nudge_severity` block (line ~152):

```ts
  place_building: {
    verb: 'place_building', tier: 'authoring', cost: 0, targetKind: 'settlement', implemented: true,
    precondition: placeBuildingPrecondition,
    apply: placeBuildingApply,
    describe: (cmd) => `raise a ${cmd.payload?.preset ?? 'building'} at ${targetLabel(cmd)}`,
  },
```

- [ ] **Step 4: Run test + suite to verify it passes**

Run: `npx vitest run tests/unit/place-building-verb.test.ts`
Expected: PASS (4 tests).

Run: `npx vitest run src/sim/command tests/unit/*command* tests/unit/*capab*`
Expected: PASS. (`CommandVerb` is now exhaustive again — any `switch`/`Record<CommandVerb,…>` that the compiler guards will need the new key; `npm run build` surfaces these.)

Run: `npm run build`
Expected: PASS — TypeScript clean.

- [ ] **Step 5: Commit**

```bash
git add src/sim/command/building-verbs.ts src/sim/command/types.ts src/sim/command/registry.ts tests/unit/place-building-verb.test.ts
git commit -m "feat(buildings): place_building authoring verb (Fate/editor seam)"
```

---

## Task 11: Deprecation markers + cleanup tracking + memory

**Files:**
- Modify: `src/map/building-templates.ts:64,105` and `src/core/types.ts` (`BuildingInstance`)
- Create: `docs/superpowers/plans/2026-06-05-parametric-building-CLEANUP.md`
- Memory: `/Users/Morten/.claude/projects/-Users-Morten-mcpui-small-gods-game/memory/`

- [ ] **Step 1: Add greppable deprecation markers**

At the top of `BuildingTemplate` (above line 64) in `src/map/building-templates.ts`:

```ts
/**
 * @deprecated Superseded by BuildingDescriptor (src/world/building-descriptor.ts).
 * TODO(building-descriptor-cleanup): delete this file + BUILDING_TEMPLATES once
 * nothing imports BuildingTemplate. See docs/.../2026-06-05-parametric-building-CLEANUP.md.
 */
```

Add the same one-line `// TODO(building-descriptor-cleanup): …` above the
`buildingSprites`/template fallback branch in `src/render/renderer.ts` (the
`// 1. Building sprite path` block) and above `BuildingInstance` in `src/core/types.ts`.

- [ ] **Step 2: Write the cleanup checklist doc**

```markdown
<!-- docs/superpowers/plans/2026-06-05-parametric-building-CLEANUP.md -->
# Parametric Building — deferred cleanup

The descriptor system (2026-06-05) replaced BuildingTemplate but kept the old
machinery as a compat layer. Delete it once **every building entity carries a
descriptor and no symbol imports `BuildingTemplate`**.

Find remaining work: `grep -rn "building-descriptor-cleanup\|BuildingTemplate\|BuildingInstance" src`

- [ ] Delete `src/map/building-templates.ts` (types + `BUILDING_TEMPLATES` + helpers).
- [ ] Remove the template/sprite fallback branch in `src/render/renderer.ts` `drawEntity`.
- [ ] Remove `BuildingInstance` from `src/core/types.ts` and `GameMap.buildings` once nothing reads it
      (check `src/map/map-generator.ts` legacy mirror).
- [ ] Remove `properties.templateId` writes/reads (descriptor is authoritative).
- **Done-when:** `grep -rn "BuildingTemplate" src` returns nothing.
```

- [ ] **Step 3: Write the memory note**

Create `/Users/Morten/.claude/projects/-Users-Morten-mcpui-small-gods-game/memory/project-parametric-buildings.md` with frontmatter (`type: project`) recording: descriptor is the canonical building model; presets in `building-presets.ts`; ground material derived (not baked) until 3D; `place_building` verb is the Fate/editor seam; **the `building-descriptor-cleanup` TODO tag tracks the deferred template deletion**; 3D flatten + Create-panel UI + interiors deferred. Then add a one-line pointer to `MEMORY.md`.

- [ ] **Step 4: Run the full suite + build**

Run: `npm test`
Expected: PASS — all tests green (prior count + the new building tests).

Run: `npm run build`
Expected: PASS — TypeScript + Vite clean.

- [ ] **Step 5: Commit**

```bash
git add src/map/building-templates.ts src/core/types.ts src/render/renderer.ts docs/superpowers/plans/2026-06-05-parametric-building-CLEANUP.md
git commit -m "chore(buildings): deprecation markers + deferred-cleanup tracking"
```

---

## Self-Review

**Spec coverage:**
- §Data model → Task 1. §Presets → Task 2 (+ kinds Task 3). §Entity representation/indexing → Tasks 1, 4. §Doors → Task 5. §Ground material (derived) → Tasks 6, 8. §Rendering silhouette → Tasks 7, 8. §`place_building` verb → Task 10. §Worldgen via presets → Task 9. §Migration (phased + cleanup markers) → Task 11. §Forward-compat (height/inset/plan stored, undrawn) → carried by Task 1 fields + Task 7 (`heightPerLevel` unused by design). All spec sections map to a task.

**Placeholder scan:** No TBD/TODO-in-code-as-spec; every code step shows real code; every test step shows real assertions. The `building-descriptor-cleanup` TODO tags are intentional tracking markers, not plan placeholders.

**Type consistency:** `BuildingDescriptor`, `buildingEntity`, `buildingPalette`, `synthesizeFromPreset`, `getPreset`, `presetForPoiType`, `computeGroundMaterialField`, `drawBuildingPlaceholder`, `findBuildingPlacement`, `placeBuildingApply` are named identically across tasks. `findPlacement` (building-placer) gains a `footprint` param consistently in Task 9. Entity shape (`properties.descriptor`/`.footprint`/`.door`/`.sortYOffset`) is written in Task 1 and read in Tasks 5, 6, 8.

**Open verification (flagged inline, not blocking):** the `Era` union (`yurt.era`), the `World` test constructor, and `RenderContext.world`/`map` accessors are verified against the codebase in the steps where they're first used.
