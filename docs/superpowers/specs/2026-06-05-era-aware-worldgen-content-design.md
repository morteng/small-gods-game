# Era-Aware Worldgen Content — Design

**Date:** 2026-06-05
**Status:** Approved (brainstorm) — ready for implementation plan
**Track:** Worldgen content / follow-on to the parametric BuildingDescriptor system

## Summary

The parametric building system shipped, but the **default world recipe never exercises
it**: only the 8 legacy presets spawn, the new `yurt`/`longhouse`/`shrine`/`guard_post`
presets are unreachable, `presetForPoiType` is dead code, and non-settlement POIs
(lake/swamp/mountain) trigger an accidental fallback cottage. This slice makes worldgen
**era-aware** so a settlement renders buildings appropriate to its era — yurts in a
primordial camp, cottages/longhouses in a medieval village, a ruined shrine where an
ancient temple stood — and fleshes out `default.json` enough to show that range.

**Scope is buildings only.** Decorations (wells, fences, statues) stay a future slice.

## Scope decisions (from brainstorm)

| Decision | Choice |
|---|---|
| Slice scope | **Buildings only** — enrich building variety; defer real decoration entities |
| Preset selection | **Era-aware** — zone rules pick presets matching the settlement's era |
| Era source | **World era + per-POI override** — `poi.era ?? worldSeed.era ?? 'medieval'` |
| Roster structure | **Approach A** — keep `buildings` as default; add optional `buildingsByEra` with fallback |
| Default recipe | **Modest hand-authored enrich** — add a primordial camp + a mine, era-flag the ruins |
| Recipe generation | **Hand-authored, deterministic** — LLM seed-authoring is a noted future project, not this slice |

## Non-goals (deferred)

- **Live D2 time-skip re-era-ing** — when the player skips 500 years, buildings do not
  re-render to the new era. That's the Track-4 "Fate authors the era" half. This slice is
  **worldgen-time only**.
- **Decoration entities** (well/fence/statue/banner/lamp/bench) — the `decorations` field
  on `ZoneRule` stays "future use".
- **LLM-generated world seed** — generating `default.json` from a prompt would build on the
  Create-panel `generateWithTools` capable client and is its own project. Captured under
  "Future direction" below; not built here.
- **Large recipe expansion** — only the modest enrich needed to exercise every new preset.

## Architecture

Four cooperating pieces, all at worldgen time; no runtime/sim changes.

### 1. Era on the seed — `src/core/types.ts` + `src/core/schema.ts`

- `WorldSeed` gains optional `era?: Era`.
- `POI` gains optional `era?: Era`.
- Schema validation accepts only the five `Era` union members
  (`primordial | ancient | classical | medieval | current`); an absent or invalid value
  is **defaulted**, never fatal:
  - world `era` missing/invalid → `'medieval'`.
  - poi `era` missing/invalid → falls through to the world era at resolution time.

`Era` already exists in `types.ts`; this only adds the two optional fields + their
validation/defaulting. No version bump to saves (worldgen-input only — buildings still
serialize via their descriptor exactly as today).

### 2. Era resolution — `src/map/map-generator.ts`

The single place that currently hardcodes `'medieval'` when calling `placeSettlement`
(map-generator.ts:191) resolves the era per POI:

```ts
const era: Era = poi.era ?? worldSeed?.era ?? 'medieval';
const result = placeSettlement(poi, zoneRule, tiles, world.registry, connectedDirs, rng, era, world);
```

`placeSettlement` already takes an `era` param (currently always `'medieval'`); only the
caller changes how it's sourced. Inside, `era` is passed to `presetsForEra` (below) and
stamped onto each `buildingEntity` exactly as now.

### 3. Era-aware rosters — `src/map/poi-zones.ts`

`ZoneRule` keeps `buildings: string[]` as the **default/fallback** roster and gains:

```ts
buildingsByEra?: Partial<Record<Era, string[]>>;
```

A pure helper resolves the roster:

```ts
export function presetsForEra(rule: ZoneRule, era: Era): string[] {
  return rule.buildingsByEra?.[era] ?? rule.buildings;
}
```

`placeSettlement` swaps its `zoneRule.buildings[...]` lookup for
`presetsForEra(zoneRule, era)[...]`. Backward-compatible: any rule without
`buildingsByEra` behaves exactly as today.

**Authored variants** (only where an era differs from the medieval default):

| POI type | default `buildings` (medieval) | `buildingsByEra` additions |
|---|---|---|
| `village` | `['cottage','cottage','longhouse','market_stall','tavern']` | `primordial: ['yurt','yurt','yurt','longhouse']`, `ancient: ['longhouse','longhouse','cottage','shrine']` |
| `temple` | `['temple_small','shrine']` | `primordial: ['shrine']`, `ancient: ['shrine','temple_small']` |
| `castle` | `['castle_keep','tower','guard_post']` | — (castles are medieval+) |
| `mine` | `['guard_post']` | — |
| `ruins` | `['shrine']` | `ancient: ['shrine','temple_small']` |
| `port` | `['dock','market_stall']` | `primordial: ['dock']` |

Note the **default-roster corrections** folded in: `village` gains `longhouse`,
`temple` gains a side `shrine`, `castle` gains `guard_post`, `mine` switches `tower`→`guard_post`,
and `ruins` switches `cottage`→`shrine` (a ruined shrine reads better than a cottage in
ruins). Other zone rules (`city`, `farm`, `tavern`, `tower`) keep their current rosters;
they may gain variants but none are required to exercise the new presets.

### 4. Terrain-POI fallback fix — `src/map/poi-zones.ts`

`getZoneRule` currently returns a fallback rule with `buildings: ['cottage']`, so any
positioned non-settlement POI (lake/swamp/mountain) attempts a stray cottage. Fix: the
fallback rule places **zero** buildings —

```ts
buildings: [], buildingCount: { min: 0, max: 0 }, internalRoads: false, roadLayout: 'none'
```

`placeSettlement` already loops `placed < buildingCount`; with `buildingCount` 0 it places
nothing and returns no entities. (Settlement POI types all have explicit rules, so they're
unaffected.)

### 5. Delete dead code — `src/world/building-presets.ts`

Remove `presetForPoiType` and its `POI_PRESET` table (building-presets.ts:101-109). Zone
rules are now the single source of POI→preset mapping. Grep confirms no non-test importer.

### 6. Flesh out the recipe — `public/data/worlds/default.json`

Modest, deterministic enrich that makes every new preset render:

- Set top-level `"era": "medieval"`.
- Flag `forest_ruins` and `swamp_shrine` with `"era": "ancient"` → they yield shrines
  (and the larger ruins a `temple_small`) instead of cottages.
- **New POI — primordial yurt camp.** A `village`-type POI with `"era": "primordial"`
  (e.g. id `hollow_camp`, "The Hollow Camp"), positioned on open meadow away from the
  medieval core, with 2 NPCs (e.g. a `priest`/wisewoman + a `hunter`→nearest role) and a
  dirt road to the nearest settlement. Renders **yurts + a longhouse**.
- **New POI — a mine.** A `mine`-type POI (medieval) in the eastern highlands (e.g.
  `ironvein_mine`, "Ironvein"), 1 NPC (a `farmer`/laborer role), a road to the watchtower.
  Renders a **guard_post**.

Exact coordinates and names are pinned in the implementation plan; all positions must sit
on placeable land (the placement spiral rejects water/rock, so a poorly-chosen coordinate
simply yields fewer buildings — the plan verifies each new POI actually places).

## Data flow

```
default.json (era, poi.era)
  → schema validation (default missing/invalid → medieval / fall-through)
  → map-generator: era = poi.era ?? worldSeed.era ?? 'medieval'
  → placeSettlement(poi, rule, …, era)
       → presetsForEra(rule, era)  →  [preset names]
       → synthesizeFromPreset(name) → BuildingDescriptor
       → buildingEntity(...)        → entity (descriptor in properties)
  → renderer draws descriptor silhouette (unchanged)
```

No new runtime systems, no sim changes, no save-format change.

## Testing

- **`presetsForEra`** (unit): returns the era variant when present; falls back to
  `buildings` when the era key is absent; falls back when `buildingsByEra` is undefined.
- **Schema** (unit): valid world/poi era accepted; missing world era → `'medieval'`;
  invalid era string defaulted, not thrown; poi era absent → resolution uses world era.
- **Era resolution precedence** (unit): `poi.era` overrides `worldSeed.era` overrides
  `'medieval'`.
- **`placeSettlement` era selection** (unit): a `village` rule placed with `era:'primordial'`
  produces building entities whose `descriptor.preset` are drawn from the primordial roster
  (at least one `yurt`); with `era:'medieval'` they're drawn from the medieval roster.
- **Terrain-POI fallback** (unit): `getZoneRule('lake')` (unknown type) yields a zero-count
  rule; `placeSettlement` with it returns no building entities.
- **Dead-code removal**: `presetForPoiType` no longer exported; no non-test importer
  (grep-clean).
- **Default recipe** (integration): `default.json` loads + validates; running worldgen on
  it yields ≥1 `yurt` (the primordial camp), ≥1 `guard_post` (the mine), ≥1 `shrine`
  (an ancient ruin), and **no** building on the lake/mountain/swamp POIs.
- Full suite green; `no-random-in-sim` stays green (all new code is pure or uses the
  existing seeded `Random` in `building-placer`, which lives in `src/world`, not `src/sim`).

## Future direction (captured, not built)

- **Era-driven live time-skip** — when D2 skips eras, re-resolve and re-stamp settlement
  buildings to the new era. Needs a stored current-world-era and a re-placement pass;
  belongs to the Track-4 era-authoring work.
- **LLM world-seed authoring** — extend the Create-panel capable client (`generateWithTools`)
  to emit a full `WorldSeed` (POIs, eras, NPCs, connections) from a prompt, previewed and
  written to a seed file. A standalone project; this slice keeps the recipe hand-authored.

## Forward-compatibility notes

- `buildingsByEra` is an **open** partial map — add an era variant by adding one key; absent
  eras fall back silently. New eras (if the `Era` union grows) need no structural change.
- World/POI `era` are optional and defaulted, so existing seeds and saves load unchanged.
- The era param already threads through `placeSettlement`; only its source changed, so the
  Fate/editor `place_building` verb can later accept an era the same way.
