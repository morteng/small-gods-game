# Parametric Building System — Design

**Date:** 2026-06-05
**Status:** Approved (brainstorm) — ready for implementation plan
**Track:** Buildings / worldgen / Track 4 (Fate authoring) seam

## Summary

Introduce one unified, parametric **`BuildingDescriptor`** as the canonical
representation of every building. Fate, the editor, and worldgen all produce
descriptors. Rendering is a **topdown silhouette** in the current Canvas2D
renderer, but the descriptor carries full 3D **massing intent** (footprint
shape, levels, per-level inset, height-per-level, roof geometry) so the future
2.5D/3D renderer — and later AI-generated art — consume the *same struct* with
no data migration. An individual building can **order the ground material**
under it and a surrounding **apron** ring; this is resolved at render time
(no tile mutation) and so reverts for free on demolish/scrub/save.

The 9 hand-authored `BuildingTemplate`s are re-expressed as named descriptor
**presets**. The old `BuildingTemplate` machinery is **kept temporarily as a
compat layer and phased out** — new code routes through descriptors; the
template type/defs are marked deprecated with explicit cleanup notes and
removed in a follow-up slice.

## Scope decisions (from brainstorm)

| Decision | Choice |
|---|---|
| Scope vs the deferred 3D renderer | Design forward-compatible model; build the Canvas2D-feasible slice; **defer literal terrain flattening** to when 2.5D/3D lands |
| Descriptor vs existing templates | **Unified model** — descriptor is the source of truth; the 9 buildings become named presets |
| Placeholder rendering | **Topdown silhouette now**, descriptor carries full massing so 3D extrudes the same struct later (option C) |
| Doors / interiors | **Single passable door cell** now; no interiors |
| Ground material ordering | **Derived at render time**, zero tile mutation; promote to a baked `Tile.material` only when 3D flatten lands |
| Authoring surfaces this slice | Worldgen presets **+** a `place_building` command verb (Fate/editor seam). **No Create-panel UI yet** |
| Template deletion | **Phased** — build new system alongside, deprecate + leave cleanup notes, delete templates in a follow-up |

## Non-goals (deferred)

- Literal terrain **flattening / height stamping** (needs the 2.5D/3D terrain rewrite).
- Baking ground material onto tiles (`Tile.material`) — derived for now.
- Full **interiors** / multi-cell walkable floor plans.
- **Create-panel UI** for typing a building (forms + preview).
- AI-generated building art (the descriptor is the future gen prompt; art swap is a later hook).
- Extruded 2.5D massing blocks in the live renderer (silhouette only for now).

## Data model — `BuildingDescriptor`

New module `src/world/building-descriptor.ts`.

```ts
type Plan      = 'rect' | 'round' | 'L' | 'cross' | 'stepped';
type Roof      = 'flat' | 'gable' | 'hip' | 'conical' | 'domed' | 'stepped' | 'lean_to';
type WallMat   = 'mud' | 'wattle' | 'timber' | 'log' | 'brick' | 'stone' | 'marble' | 'hide';
type RoofMat   = 'thatch' | 'wood' | 'tile' | 'slate' | 'hide' | 'none';
type GroundMat = 'flagstone' | 'dirt' | 'packed_dirt' | 'wood' | 'tile' | 'gravel';

interface BuildingDescriptor {
  // identity / sim-facing
  preset?: string;                 // name of the seed preset, if any
  category: 'residential' | 'religious' | 'commercial' | 'military' | 'farm' | 'special';
  era: Era;

  // massing (drives silhouette now; 3D extrusion later)
  footprint: { w: number; h: number };
  plan: Plan;
  levels: number;                  // stacked stories (tower=3, ziggurat=4)
  levelInset: number;              // per-level shrink in tiles (ziggurat>0, tower=0)
  heightPerLevel: number;          // world units — DATA ONLY today

  // roof
  roof: Roof;

  // materials → colors
  walls: WallMat;
  roofMat: RoofMat;
  palette?: Partial<MaterialPalette>;   // optional override of derived colors

  // terrain ordering (derived at render time)
  groundMaterial?: GroundMat;      // tiles under the footprint
  apron?: { radius: number; material: GroundMat };  // surrounding ring

  // passability
  door: { x: number; y: number };  // relative cell; the one passable footprint cell
}
```

Colors derive from `walls` / `roofMat` / `groundMaterial` via a `MATERIAL_COLORS`
table (hex per material), `palette` overriding where present.

### Entity representation

A building entity is **one descriptor + a position**:

- `kind`: preset name (e.g. `'cottage'`) or `'building'` when descriptor-only.
- `tags: ['building', category]`.
- `properties: { category: 'building', descriptor, footprint }` — `footprint`
  is mirrored at the top of `properties` so `EntityRegistry.indexEntity` keeps
  registering **every footprint cell** in `byTile` (already correct today).

Because the descriptor lives in `entity.properties`, it rides
`captureSnapshot`/`restoreSnapshot` and the IndexedDB save with **no version
bump** — same pattern as persistent NPC memory.

## Presets — `src/world/building-presets.ts`

`BUILDING_PRESETS: Record<string, BuildingDescriptor>` re-expresses the existing
9 as descriptors, e.g.:

| Preset | plan | levels | inset | roof | walls |
|---|---|---|---|---|---|
| `cottage` | rect | 1 | 0 | gable | wattle |
| `tavern` | rect | 1 | 0 | gable | timber |
| `farm_barn` | rect | 1 | 0 | gable | timber |
| `market_stall` | rect | 1 | 0 | lean_to | timber |
| `tower` | rect | 3 | 0 | flat | stone |
| `temple_small` | cross | 1 | 0 | hip | stone |
| `castle_keep` | stepped | 4 | 1 | stepped | stone |
| `dock` | rect | 1 | 0 | flat | timber |

(Room to add `yurt` = round/1/0/domed/hide, `longhouse` = rect/1/0/gable/log, etc.)

`synthesizeFromPreset(name, overrides?): BuildingDescriptor`. POI zone
`buildings: string[]` continues to name presets — the strings are unchanged,
they just resolve to descriptors now.

## Rendering — `src/render/building-massing.ts`

`drawBuildingPlaceholder(ctx, descriptor, screenRect, camera)` replaces the
sprite/fallback branch for buildings in `renderer.ts` `drawEntity`:

- **footprint outline by `plan`** — `round` → circle, `stepped` → concentric
  rings (one per `levels`, shrunk by `levelInset`), `L`/`cross` → composed
  rectangles, `rect` → rectangle.
- **fill** = `walls` color.
- **roof indicator keyed to `roof`** — gable → ridge line, conical/domed →
  center dot, stepped → concentric steps, hip → inset polygon, flat → plain,
  lean_to → offset slope.
- **height** conveyed via shading / step depth driven by `levels` (no real
  extrusion).
- **door** drawn as a notch on the door cell.

The old `buildingSprites` / PixelLab sprite-offset path is bypassed for
descriptor buildings (and removed entirely in the cleanup slice). AI-art
override is a future hook keyed off the descriptor.

## Ground material — `src/render/ground-material.ts`

`resolveGroundMaterial(world, tx, ty): GroundMat | null` — **derived, no tile
mutation**:

1. If a building footprint covers `(tx,ty)` → that descriptor's `groundMaterial`.
2. Else if `(tx,ty)` falls within a nearby building's `apron.radius` ring (and
   is not under any footprint) → that building's `apron.material`.
3. Else `null`.

The terrain render pass overlays the resolved color. Pathfinding is untouched
(apron stays walkable; footprint is already solid except the door). Demolish /
scrub / save revert automatically because nothing was written. Apron lookups
query buildings in a small region around the tile (radius is 1–2; few buildings
per neighborhood), so cost is negligible.

> When the 2.5D flatten lands, this is the seam we promote to a baked
> `Tile.material` + height (flattening genuinely mutates terrain and needs
> persistence). Until then, derived only.

## Authoring — `place_building` command verb

New verb in `src/sim/command/` on the existing command channel, declared in the
capability registry, drift-guarded like the editor verbs.

- **Input:** a `BuildingDescriptor` (or `{ preset, overrides }`) + a target
  position/region. `source: 'author' | 'fate' | 'player'`.
- **Apply:** validate descriptor → `findPlacement` (reuse `building-placer`) →
  `clearFootprint` → create the building entity with the descriptor in
  `properties` → carve a door-path to the nearest road.
- **Replay-safe:** deterministic via `ctx.rng`; no `Math.random`.

This is the seam that makes "Fate specifies type/height/size/materials" real —
the natural escalation lever alongside `inject_npc`. The editor reuses the same
verb when its UI arrives.

## Migration — phased, with cleanup markers

New code routes through descriptors; the old machinery stays alive temporarily
to bound blast radius.

**This slice:**
- Build descriptor + presets + massing renderer + ground resolver + `place_building`.
- Route **worldgen** through presets → descriptors (POI placement creates
  descriptor-carrying entities).
- `renderer.ts` `drawEntity`: prefer the descriptor placeholder when a
  descriptor is present; fall back to the existing template/sprite path
  otherwise (compat).
- `building-collision.ts` `isFootprintCellPassable`: passable **only** for the
  descriptor's door cell; solid elsewhere.
- Mark `building-templates.ts` (`BuildingTemplate` / `FloorPlan` / `RoofSpec`
  and the 9 defs), the legacy `BuildingInstance` mirror, and the sprite-offset
  render path **`@deprecated`** with a uniform cleanup tag, e.g.
  `// TODO(building-descriptor-cleanup): remove once all buildings carry descriptors`.

**Follow-up cleanup slice (tracked, not in this slice):**
- Delete `building-templates.ts` types + defs and the sprite-offset path.
- Remove the `BuildingInstance` legacy mirror from `types.ts` / `GameMap.buildings`
  once nothing reads it.
- Drop the renderer's template fallback branch.
- **Done-when:** every building entity carries a descriptor and no symbol
  imports `BuildingTemplate`.

Cleanup is tracked via (a) the uniform `building-descriptor-cleanup` TODO tag
(greppable), (b) a checklist in the implementation plan, and (c) a project
memory note so it survives across sessions.

## Testing

- Preset descriptors are well-formed (footprint > 0, door within footprint,
  levels ≥ 1).
- Placeholder-draw smoke test against a mock canvas for each `plan` × `roof`
  combination (no throw; expected primitive calls).
- Ground resolver: material under footprint, apron material in the ring, `null`
  elsewhere, and reverts to `null` when the building is removed.
- Collision: door cell passable, all other footprint cells solid.
- `place_building`: places a valid descriptor, is capability-gated, and yields
  replay parity (same seed → same placement).
- Worldgen still populates settlements (POI presets resolve and place).
- `no-random-in-sim` stays green; full suite green.

## Forward-compatibility notes (explicit)

- `heightPerLevel` / `levelInset` / `plan` carry massing the 3D renderer will
  consume; stored and validated now, undrawn beyond shading.
- Ground material is derived now; baked onto tiles (with height) when flatten
  lands.
- AI art swaps the placeholder by reading the descriptor (future hook).
- Interiors (full floor plans) and the Create-panel building UI are deferred.
