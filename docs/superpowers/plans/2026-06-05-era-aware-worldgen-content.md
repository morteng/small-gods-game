# Era-Aware Worldgen Content — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make worldgen pick building presets by era (yurts in a primordial camp, cottages/longhouses in a medieval village, a ruined shrine where an ancient temple stood), fix the accidental terrain-POI cottage, delete dead code, and flesh out the default recipe to show the range.

**Architecture:** A settlement's era resolves as `poi.era ?? worldSeed.era ?? 'medieval'`. Each `ZoneRule` keeps its `buildings` list as the default and gains an optional `buildingsByEra` overlay; a pure `presetsForEra(rule, era)` picks the variant or falls back. `placeSettlement` already takes an `era` param — only its source and roster lookup change. No runtime/sim/save changes.

**Tech Stack:** TypeScript ES modules, Vitest, seeded `Random` (sfc32) in `src/world`, JSON world seeds.

**Spec:** `docs/superpowers/specs/2026-06-05-era-aware-worldgen-content-design.md`

---

## File Structure

- **Create** `src/core/era.ts` — `ERAS`, `isEra(x)` type guard, `resolveSettlementEra(poi, worldSeed)`. The single home for era constants + resolution.
- **Create** `tests/unit/era.test.ts` — guard + resolution precedence.
- **Modify** `src/core/types.ts` — add optional `era?: Era` to `POI` and `WorldSeed`.
- **Modify** `src/core/schema.ts` — validate `era` (world + per-POI) against `ERAS`.
- **Create** `tests/unit/schema-era.test.ts` — era validation.
- **Modify** `src/map/poi-zones.ts` — `ZoneRule.buildingsByEra`, `presetsForEra`, authored era rosters, default-roster corrections, zero-building terrain fallback.
- **Create** `tests/unit/poi-zones-era.test.ts` — roster selection + fallback.
- **Modify** `src/world/building-placer.ts` — use `presetsForEra(zoneRule, era)`; guard empty roster.
- **Modify** `src/map/map-generator.ts` — resolve era per POI, pass to `placeSettlement`.
- **Modify** `tests/unit/building-placer-descriptor.test.ts` — add era-roster placement test.
- **Modify** `src/world/building-presets.ts` — delete `presetForPoiType` + `POI_PRESET`.
- **Modify** `tests/unit/building-presets.test.ts` — remove `presetForPoiType` import + assertions.
- **Modify** `public/data/worlds/default.json` — world era, ancient ruins, primordial yurt camp, a mine, NPCs, roads.
- **Create** `tests/unit/default-world-era.test.ts` — structural + roster-resolution checks on the recipe.

---

### Task 1: Era constants, guard, and resolution helper

**Files:**
- Create: `src/core/era.ts`
- Modify: `src/core/types.ts:53-63` (POI), `src/core/types.ts:86-97` (WorldSeed)
- Test: `tests/unit/era.test.ts`

- [ ] **Step 1: Add the optional `era` fields to the types**

In `src/core/types.ts`, add `era?: Era;` as the last field of `POI` (after `npcs?: NPC[];`):

```ts
export interface POI {
  id: string;
  type: string;
  name?: string;
  description?: string;
  position?: { x: number; y: number };
  region?: { x_min: number; x_max: number; y_min: number; y_max: number };
  size?: 'small' | 'medium' | 'large';
  importance?: 'low' | 'medium' | 'high' | 'critical';
  npcs?: NPC[];
  /** Overrides the world era for this settlement's buildings. */
  era?: Era;
}
```

In the same file, add `era?: Era;` to `WorldSeed` immediately after `visualTheme?: string;`:

```ts
  visualTheme?: string;
  /** Default era for every settlement; per-POI `era` overrides it. Defaults to 'medieval'. */
  era?: Era;
```

(`Era` is already declared at `types.ts:257`; type declarations are not order-dependent within a module.)

- [ ] **Step 2: Write the failing test**

Create `tests/unit/era.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ERAS, isEra, resolveSettlementEra } from '@/core/era';
import type { POI, WorldSeed } from '@/core/types';

const poi = (era?: string): POI => ({ id: 'p', type: 'village', era: era as POI['era'] });
const seed = (era?: string): WorldSeed =>
  ({ name: 'w', size: { width: 32, height: 24 }, biome: 'temperate',
     pois: [], connections: [], constraints: [], era: era as WorldSeed['era'] });

describe('isEra', () => {
  it('accepts every union member', () => {
    for (const e of ERAS) expect(isEra(e)).toBe(true);
  });
  it('rejects non-members and non-strings', () => {
    expect(isEra('stone_age')).toBe(false);
    expect(isEra(undefined)).toBe(false);
    expect(isEra(7)).toBe(false);
  });
});

describe('resolveSettlementEra', () => {
  it('prefers the POI era over the world era', () => {
    expect(resolveSettlementEra(poi('primordial'), seed('medieval'))).toBe('primordial');
  });
  it('falls back to the world era when the POI has none', () => {
    expect(resolveSettlementEra(poi(undefined), seed('ancient'))).toBe('ancient');
  });
  it('falls back to medieval when neither is set', () => {
    expect(resolveSettlementEra(poi(undefined), seed(undefined))).toBe('medieval');
    expect(resolveSettlementEra(poi(undefined), null)).toBe('medieval');
  });
  it('treats an invalid era as unset (coerces, never throws)', () => {
    expect(resolveSettlementEra(poi('bogus'), seed('ancient'))).toBe('ancient');
    expect(resolveSettlementEra(poi('bogus'), seed('also_bad'))).toBe('medieval');
  });
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `npx vitest run tests/unit/era.test.ts`
Expected: FAIL — `@/core/era` does not exist.

- [ ] **Step 4: Implement `src/core/era.ts`**

```ts
/**
 * Era constants + resolution. `Era` itself lives in core/types; this module owns
 * the runtime list, a type guard, and the per-settlement resolution rule used by
 * worldgen. Resolution is defensive: an unknown era coerces to undefined and
 * falls through, so a hand-edited seed never crashes generation.
 */
import type { Era, POI, WorldSeed } from '@/core/types';

export const ERAS = ['primordial', 'ancient', 'classical', 'medieval', 'current'] as const;

export function isEra(x: unknown): x is Era {
  return typeof x === 'string' && (ERAS as readonly string[]).includes(x);
}

function coerce(x: unknown): Era | undefined {
  return isEra(x) ? x : undefined;
}

/** poi.era ?? worldSeed.era ?? 'medieval', ignoring any unrecognized value. */
export function resolveSettlementEra(poi: POI, worldSeed?: WorldSeed | null): Era {
  return coerce(poi.era) ?? coerce(worldSeed?.era) ?? 'medieval';
}
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `npx vitest run tests/unit/era.test.ts`
Expected: PASS (8 assertions).

- [ ] **Step 6: Commit**

```bash
git add src/core/era.ts src/core/types.ts tests/unit/era.test.ts
git commit -m "feat(worldgen): era constants, guard, and per-settlement resolution"
```

---

### Task 2: Schema validates the era fields

**Files:**
- Modify: `src/core/schema.ts:1` (import), `src/core/schema.ts:83-140` (validateWorldSeed)
- Test: `tests/unit/schema-era.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/schema-era.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateWorldSeed } from '@/core/schema';
import type { WorldSeed } from '@/core/types';

function base(extra: Partial<WorldSeed> = {}): Partial<WorldSeed> {
  return { name: 'w', size: { width: 32, height: 24 }, biome: 'temperate',
           pois: [], connections: [], constraints: [], ...extra };
}

describe('world seed era validation', () => {
  it('accepts a valid world era', () => {
    expect(validateWorldSeed(base({ era: 'primordial' })).valid).toBe(true);
  });
  it('treats a missing world era as valid', () => {
    expect(validateWorldSeed(base()).valid).toBe(true);
  });
  it('rejects an invalid world era', () => {
    const r = validateWorldSeed(base({ era: 'stone_age' as WorldSeed['era'] }));
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes('era'))).toBe(true);
  });
  it('rejects an invalid POI era', () => {
    const r = validateWorldSeed(base({
      pois: [{ id: 'p', type: 'village', position: { x: 1, y: 1 }, era: 'bogus' as WorldSeed['era'] }],
    }));
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes('era'))).toBe(true);
  });
  it('accepts a valid POI era', () => {
    const r = validateWorldSeed(base({
      pois: [{ id: 'p', type: 'ruins', position: { x: 1, y: 1 }, era: 'ancient' }],
    }));
    expect(r.valid).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run tests/unit/schema-era.test.ts`
Expected: FAIL — invalid eras currently pass (no era validation yet).

- [ ] **Step 3: Implement the validation**

In `src/core/schema.ts`, change the import on line 1 to add the era helpers:

```ts
import type { WorldSeed, POI } from '@/core/types';
import { ERAS, isEra } from '@/core/era';
```

In `validateWorldSeed`, after the biome check (the `if (!seed.biome ...)` block ending near line 96), add the world-era check:

```ts
  if (seed.era !== undefined && !isEra(seed.era)) {
    errors.push(`Invalid era "${seed.era}". Use: ${ERAS.join(', ')}`);
  }
```

Inside the `for (const poi of seed.pois)` loop (after the `if (!poi.position && !poi.region)` check), add the per-POI era check:

```ts
      if (poi.era !== undefined && !isEra(poi.era)) {
        errors.push(`Invalid POI era "${poi.era}". Use: ${ERAS.join(', ')}`);
      }
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run tests/unit/schema-era.test.ts`
Expected: PASS (5 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/core/schema.ts tests/unit/schema-era.test.ts
git commit -m "feat(schema): validate world and POI era fields"
```

---

### Task 3: Era-aware roster helper (mechanism only)

**Files:**
- Modify: `src/map/poi-zones.ts:1-33` (imports + `ZoneRule`), append `presetsForEra`
- Test: `tests/unit/poi-zones-era.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/poi-zones-era.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { presetsForEra } from '@/map/poi-zones';
import type { ZoneRule } from '@/map/poi-zones';

const rule = (extra: Partial<ZoneRule> = {}): ZoneRule => ({
  radius: { min: 2, max: 3 },
  buildings: ['cottage', 'tavern'],
  buildingCount: { min: 1, max: 2 },
  decorations: [],
  internalRoads: false,
  internalRoadType: 'dirt_road',
  ...extra,
});

describe('presetsForEra', () => {
  it('returns the era variant when present', () => {
    const r = rule({ buildingsByEra: { primordial: ['yurt'] } });
    expect(presetsForEra(r, 'primordial')).toEqual(['yurt']);
  });
  it('falls back to buildings when the era key is absent', () => {
    const r = rule({ buildingsByEra: { primordial: ['yurt'] } });
    expect(presetsForEra(r, 'medieval')).toEqual(['cottage', 'tavern']);
  });
  it('falls back to buildings when buildingsByEra is undefined', () => {
    expect(presetsForEra(rule(), 'ancient')).toEqual(['cottage', 'tavern']);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run tests/unit/poi-zones-era.test.ts`
Expected: FAIL — `presetsForEra` and `ZoneRule.buildingsByEra` do not exist.

- [ ] **Step 3: Implement the mechanism**

In `src/map/poi-zones.ts`, add the `Era` import at the top of the file (after the file's opening doc comment, before `export interface ZoneRule`):

```ts
import type { Era } from '@/core/types';
```

Add the optional field to `ZoneRule` (after the `buildings: string[];` line):

```ts
  /** Per-era roster overlay; absent eras fall back to `buildings`. */
  buildingsByEra?: Partial<Record<Era, string[]>>;
```

At the end of `src/map/poi-zones.ts`, append the helper:

```ts
/** Building roster for a zone rule at a given era; falls back to `buildings`. */
export function presetsForEra(rule: ZoneRule, era: Era): string[] {
  return rule.buildingsByEra?.[era] ?? rule.buildings;
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run tests/unit/poi-zones-era.test.ts`
Expected: PASS (3 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/map/poi-zones.ts tests/unit/poi-zones-era.test.ts
git commit -m "feat(worldgen): presetsForEra roster overlay on ZoneRule"
```

---

### Task 4: Author era rosters, roster corrections, and terrain fallback fix

**Files:**
- Modify: `src/map/poi-zones.ts:36-160` (POI_ZONE_RULES entries + getZoneRule fallback)
- Test: `tests/unit/poi-zones-era.test.ts` (extend)

- [ ] **Step 1: Extend the test with the authored content + fallback**

Append to `tests/unit/poi-zones-era.test.ts`:

```ts
import { getZoneRule, POI_ZONE_RULES } from '@/map/poi-zones';

describe('authored era rosters', () => {
  it('village primordial roster is yurt-based', () => {
    const r = presetsForEra(POI_ZONE_RULES.village, 'primordial');
    expect(r).toContain('yurt');
    expect(r).not.toContain('cottage');
  });
  it('village medieval default includes a longhouse', () => {
    expect(presetsForEra(POI_ZONE_RULES.village, 'medieval')).toContain('longhouse');
  });
  it('temple default pairs a temple with a shrine', () => {
    expect(presetsForEra(POI_ZONE_RULES.temple, 'medieval')).toEqual(['temple_small', 'shrine']);
  });
  it('castle default includes a guard post', () => {
    expect(presetsForEra(POI_ZONE_RULES.castle, 'medieval')).toContain('guard_post');
  });
  it('mine places a guard post, not a tower', () => {
    expect(POI_ZONE_RULES.mine.buildings).toEqual(['guard_post']);
  });
  it('ruins default to a shrine; ancient ruins add a temple', () => {
    expect(presetsForEra(POI_ZONE_RULES.ruins, 'medieval')).toEqual(['shrine']);
    expect(presetsForEra(POI_ZONE_RULES.ruins, 'ancient')).toContain('temple_small');
  });
});

describe('non-settlement POI fallback', () => {
  it('places zero buildings for an unknown POI type', () => {
    const r = getZoneRule('lake');
    expect(r.buildingCount.max).toBe(0);
    expect(r.buildings).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run tests/unit/poi-zones-era.test.ts`
Expected: FAIL — rosters not yet authored; fallback still `['cottage']`.

- [ ] **Step 3: Author the rosters**

In `src/map/poi-zones.ts`, replace the `village` entry with:

```ts
  village: {
    radius: { min: 5, max: 8 },
    terrainFill: undefined,
    buildings: ['cottage', 'cottage', 'longhouse', 'market_stall', 'tavern'],
    buildingsByEra: {
      primordial: ['yurt', 'yurt', 'yurt', 'longhouse'],
      ancient: ['longhouse', 'longhouse', 'cottage', 'shrine'],
    },
    buildingCount: { min: 3, max: 8 },
    decorations: ['well', 'sign_post', 'bench', 'lamp'],
    internalRoads: true,
    internalRoadType: 'dirt_road',
    clearForest: true,
    roadLayout: 'branching',
  },
```

Replace the `temple` entry with:

```ts
  temple: {
    radius: { min: 4, max: 6 },
    terrainFill: 'sacred_grove',
    buildings: ['temple_small', 'shrine'],
    buildingsByEra: {
      primordial: ['shrine'],
      ancient: ['shrine', 'temple_small'],
    },
    buildingCount: { min: 1, max: 2 },
    decorations: ['flower_patch', 'statue'],
    internalRoads: false,
    internalRoadType: 'stone_road',
    clearForest: false,
    roadLayout: 'none',
  },
```

Replace the `castle` entry's `buildings` line so it reads:

```ts
    buildings: ['castle_keep', 'tower', 'guard_post'],
```

Replace the `mine` entry with (switch `tower`→`guard_post`):

```ts
  mine: {
    radius: { min: 3, max: 5 },
    terrainFill: 'quarry',
    buildings: ['guard_post'],
    buildingCount: { min: 1, max: 1 },
    decorations: ['rock_pile', 'cart'],
    internalRoads: false,
    internalRoadType: 'dirt_road',
    clearForest: false,
    roadLayout: 'none',
  },
```

Replace the `port` entry's `buildings` line and add an era overlay (keep all other fields of `port` unchanged):

```ts
    buildings: ['dock', 'market_stall'],
    buildingsByEra: { primordial: ['dock'] },
```

Replace the `ruins` entry with:

```ts
  ruins: {
    radius: { min: 3, max: 5 },
    terrainFill: undefined,
    buildings: ['shrine'],
    buildingsByEra: { ancient: ['shrine', 'temple_small'] },
    buildingCount: { min: 1, max: 3 },
    decorations: ['rubble', 'vine'],
    internalRoads: false,
    internalRoadType: 'dirt_road',
    clearForest: false,
    roadLayout: 'none',
  },
```

- [ ] **Step 4: Fix the terrain-POI fallback**

In `getZoneRule`, replace the fallback object so unknown POI types place nothing:

```ts
export function getZoneRule(poiType: string): ZoneRule {
  return POI_ZONE_RULES[poiType] ?? {
    radius: { min: 1, max: 2 },
    buildings: [],
    buildingCount: { min: 0, max: 0 },
    decorations: [],
    internalRoads: false,
    internalRoadType: 'dirt_road',
    roadLayout: 'none',
  };
}
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `npx vitest run tests/unit/poi-zones-era.test.ts`
Expected: PASS (all assertions).

- [ ] **Step 6: Commit**

```bash
git add src/map/poi-zones.ts tests/unit/poi-zones-era.test.ts
git commit -m "feat(worldgen): author era rosters, correct defaults, zero-building terrain fallback"
```

---

### Task 5: Wire era into placeSettlement + map-generator

**Files:**
- Modify: `src/world/building-placer.ts:23-24` (imports), `:232-289` (roster lookup + guard)
- Modify: `src/map/map-generator.ts:20-22` (imports), `:184-191` (era resolution)
- Test: `tests/unit/building-placer-descriptor.test.ts` (add an era test)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/building-placer-descriptor.test.ts` (inside the existing file; it already imports `placeSettlement`, `getZoneRule`, `World`, `Random`, `BuildingDescriptor`, and defines `gridTiles`/`emptyMap`). Add a new describe block at the end:

```ts
describe('placeSettlement selects presets by era', () => {
  it('places yurts for a primordial village', () => {
    const world = new World(emptyMap());
    const tiles = gridTiles(40, 40);
    const poi = { id: 'poi-camp', type: 'village', position: { x: 20, y: 20 } } as never;
    const { entities } = placeSettlement(
      poi, getZoneRule('village'), tiles, world.registry, [], new Random(2024), 'primordial', world,
    );
    expect(entities.length).toBeGreaterThan(0);
    const presets = entities.map(e => (e.properties?.descriptor as BuildingDescriptor).preset);
    expect(presets).toContain('yurt');
    expect(presets).not.toContain('cottage');
  });

  it('places nothing for a zero-count fallback rule', () => {
    const world = new World(emptyMap());
    const tiles = gridTiles(40, 40);
    const poi = { id: 'poi-lake', type: 'lake', position: { x: 20, y: 20 } } as never;
    const { entities } = placeSettlement(
      poi, getZoneRule('lake'), tiles, world.registry, [], new Random(3), 'medieval', world,
    );
    expect(entities).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run tests/unit/building-placer-descriptor.test.ts`
Expected: FAIL — `placeSettlement` still reads `zoneRule.buildings` (medieval), so a primordial village yields cottages, not yurts.

- [ ] **Step 3: Use `presetsForEra` in `placeSettlement`**

In `src/world/building-placer.ts`, update the imports near line 23 to add `presetsForEra`:

```ts
import { synthesizeFromPreset } from '@/world/building-presets';
import { buildingEntity } from '@/world/building-descriptor';
import { presetsForEra } from '@/map/poi-zones';
```

In `placeSettlement`, just before the placement loop (after the `constraint` object is declared, around line 240), resolve the roster once:

```ts
  const roster = presetsForEra(zoneRule, era);

  for (let attempt = 0; attempt < buildingCount * 4 && placed < buildingCount && roster.length > 0; attempt++) {
    const presetName = roster[placed % roster.length];
    const descriptor = synthesizeFromPreset(presetName);
    if (!descriptor) continue;
```

(That replaces the existing `for (...)` header and the `const presetName = zoneRule.buildings[placed % zoneRule.buildings.length];` line.)

- [ ] **Step 4: Resolve era per POI in map-generator**

In `src/map/map-generator.ts`, add the import (near the other `@/map`/`@/world` imports around line 20-22):

```ts
import { resolveSettlementEra } from '@/core/era';
```

Replace the `placeSettlement(...)` call (line 191) and the line above it so the era is sourced per POI:

```ts
      const era = resolveSettlementEra(poi, worldSeed);
      const result = placeSettlement(poi, zoneRule, tiles, world.registry, connectedDirs, rng, era, world);
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `npx vitest run tests/unit/building-placer-descriptor.test.ts`
Expected: PASS — primordial village yields yurts; lake POI yields no entities.

- [ ] **Step 6: Commit**

```bash
git add src/world/building-placer.ts src/map/map-generator.ts tests/unit/building-placer-descriptor.test.ts
git commit -m "feat(worldgen): place era-appropriate presets per settlement"
```

---

### Task 6: Delete dead `presetForPoiType`

**Files:**
- Modify: `src/world/building-presets.ts:100-109` (remove `POI_PRESET` + `presetForPoiType`)
- Modify: `tests/unit/building-presets.test.ts:3,43-44` (drop import + assertions)

- [ ] **Step 1: Remove the assertions from the test**

In `tests/unit/building-presets.test.ts`, remove `presetForPoiType` from the import on line 3:

```ts
  BUILDING_PRESETS, getPreset, synthesizeFromPreset,
```

Delete the two assertion lines (43-44):

```ts
    expect(presetForPoiType('temple')).toBe('temple_small');
    expect(presetForPoiType('unknown_type')).toBe('cottage');
```

If those two lines were the entire body of an `it(...)` block, delete that whole `it(...)` block.

- [ ] **Step 2: Delete the dead code**

In `src/world/building-presets.ts`, delete the `POI_PRESET` constant and the `presetForPoiType` function (the block starting at `const POI_PRESET: Record<string, string> = {` through the closing brace of `presetForPoiType`).

- [ ] **Step 3: Verify no other importer remains**

Run: `grep -rn "presetForPoiType" src tests`
Expected: no matches.

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run tests/unit/building-presets.test.ts`
Expected: PASS (the remaining preset tests still pass).

- [ ] **Step 5: Commit**

```bash
git add src/world/building-presets.ts tests/unit/building-presets.test.ts
git commit -m "refactor(worldgen): remove dead presetForPoiType (zone rules are the source)"
```

---

### Task 7: Flesh out the default recipe + integration test

**Files:**
- Modify: `public/data/worlds/default.json`
- Test: `tests/unit/default-world-era.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/default-world-era.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateWorldSeed } from '@/core/schema';
import { resolveSettlementEra } from '@/core/era';
import { getZoneRule, presetsForEra } from '@/map/poi-zones';
import type { WorldSeed, POI } from '@/core/types';

const seed = JSON.parse(
  readFileSync('public/data/worlds/default.json', 'utf-8'),
) as WorldSeed;

const poi = (id: string): POI => seed.pois.find(p => p.id === id)!;
const rosterFor = (id: string): string[] =>
  presetsForEra(getZoneRule(poi(id).type), resolveSettlementEra(poi(id), seed));

describe('default world recipe', () => {
  it('validates and declares a world era', () => {
    expect(validateWorldSeed(seed).valid).toBe(true);
    expect(seed.era).toBe('medieval');
  });

  it('has a primordial yurt camp that renders yurts', () => {
    const camp = poi('hollow_camp');
    expect(camp.type).toBe('village');
    expect(resolveSettlementEra(camp, seed)).toBe('primordial');
    expect(rosterFor('hollow_camp')).toContain('yurt');
  });

  it('has a mine that renders a guard post', () => {
    expect(poi('ironvein_mine').type).toBe('mine');
    expect(rosterFor('ironvein_mine')).toContain('guard_post');
  });

  it('flags the ancient ruins so they render a shrine', () => {
    for (const id of ['forest_ruins', 'swamp_shrine']) {
      expect(resolveSettlementEra(poi(id), seed)).toBe('ancient');
      expect(rosterFor(id)).toContain('shrine');
    }
  });

  it('places no buildings on terrain POIs', () => {
    for (const id of ['crystal_lake', 'murkmire_swamp', 'eastern_peaks']) {
      expect(getZoneRule(poi(id).type).buildingCount.max).toBe(0);
    }
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run tests/unit/default-world-era.test.ts`
Expected: FAIL — `hollow_camp`/`ironvein_mine` don't exist; no world era; ruins not era-flagged.

- [ ] **Step 3: Add the world era**

In `public/data/worlds/default.json`, add `"era": "medieval",` immediately after the `"biome": "temperate",` line (line 5).

- [ ] **Step 4: Era-flag the two ruins**

In the `forest_ruins` POI object, add `"era": "ancient"` (after its `"description"` field). Do the same for the `swamp_shrine` POI object. Example for `swamp_shrine`:

```json
    {
      "id": "swamp_shrine",
      "type": "ruins",
      "name": "The Sunken Shrine",
      "position": { "x": 14, "y": 75 },
      "size": "small",
      "era": "ancient",
      "description": "Ancient stones rising from the mire."
    },
```

- [ ] **Step 5: Add the primordial yurt camp and the mine**

Add these two POI objects to the `pois` array (e.g. after `ironkeep_castle`, before the array closes):

```json
    {
      "id": "hollow_camp",
      "type": "village",
      "name": "The Hollow Camp",
      "position": { "x": 40, "y": 30 },
      "size": "small",
      "era": "primordial",
      "description": "A cluster of hide tents in a meadow clearing — folk who kept the old ways while the valley turned to stone and timber.",
      "npcs": [
        { "name": "Old Mother Ash", "role": "elder" },
        { "name": "Bran the Forager", "role": "farmer" }
      ]
    },
    {
      "id": "ironvein_mine",
      "type": "mine",
      "name": "Ironvein",
      "position": { "x": 103, "y": 34 },
      "size": "small",
      "description": "A mineshaft at the foot of the Eastern Peaks, worked for iron and watched by a lone guard post.",
      "npcs": [
        { "name": "Durik Stonehand", "role": "farmer" }
      ]
    }
```

- [ ] **Step 6: Add roads connecting the new settlements**

Add these two connections to the `connections` array (before it closes):

```json
    {
      "from": "hollow_camp", "to": "oakshire", "type": "road", "style": "dirt",
      "waypoints": [{"x": 40, "y": 30}, {"x": 52, "y": 39}, {"x": 64, "y": 48}]
    },
    {
      "from": "ironvein_mine", "to": "old_watchtower", "type": "road", "style": "dirt",
      "waypoints": [{"x": 103, "y": 34}, {"x": 105, "y": 30}, {"x": 107, "y": 27}]
    }
```

- [ ] **Step 7: Run the test, verify it passes**

Run: `npx vitest run tests/unit/default-world-era.test.ts`
Expected: PASS (all assertions).

- [ ] **Step 8: Verify the buildings actually place in a real generation**

Run a quick generation sanity check in the dev server is not needed for tests, but confirm the placement won't silently drop the new POIs onto water/rock. Run:

```bash
npx vitest run tests/unit/default-world-era.test.ts tests/unit/building-placer-descriptor.test.ts
```

Expected: PASS. If a later manual playtest shows `hollow_camp` or `ironvein_mine` produced zero buildings (its position landed on unplaceable terrain), nudge that POI's `position` a few tiles toward open grass — the placement spiral needs an `allowedTerrain` tile (grass/dirt/hills/etc.) within its radius. (The roster-resolution test above is coordinate-independent, so it stays green either way.)

- [ ] **Step 9: Commit**

```bash
git add public/data/worlds/default.json tests/unit/default-world-era.test.ts
git commit -m "feat(worldgen): flesh out default recipe — primordial camp, mine, ancient ruins"
```

---

### Final verification

- [ ] **Run the full suite**

Run: `npm test`
Expected: all tests pass (the new files plus the existing 1296). If any pre-existing roster-snapshot test fails because a default roster changed (village/temple/castle/mine/ruins), update that test to the new roster — do not revert the content.

- [ ] **Type + build check**

Run: `npm run build`
Expected: TypeScript clean, Vite build succeeds.

- [ ] **Grep the cleanup is complete**

Run: `grep -rn "presetForPoiType" src tests`
Expected: no matches.

---

## Notes for the implementer

- All new code is pure or uses the existing seeded `Random` in `src/world` — do **not** introduce `Math.random` (the `no-random-in-sim` guard covers `src/sim`, but keep the discipline everywhere).
- `era` is worldgen-input only: it is **not** persisted on the building entity beyond what the descriptor already carries, and there is **no** save-format change. Do not add an era field to snapshots.
- Do **not** touch the uncommitted LLM/model-picker files in the working tree (`provider-factory.ts`, `llm-settings-new.ts`, `settings-unified.ts`, `tokens.css`, `welcome-modal.ts`, `model-picker.ts`, `openrouter-catalog.ts`, and their tests) — they are unrelated WIP.
