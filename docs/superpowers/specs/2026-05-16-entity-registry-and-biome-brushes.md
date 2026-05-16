# Spec A — Entity registry and biome brushes

**Status:** drafted 2026-05-16
**Owner:** Morten
**Implementation plan:** to be generated via writing-plans skill

## Motivation

Today the world's visible content is split across parallel data paths:
buildings live in `EntityRegistry`, trees live in a separate
`DecorationInstance[]`, NPCs in `NpcInstance[]`, and most settlement props
(wells, fences, statues) exist only as static strings in `poi-zones.ts` that
are never placed. The render layer iterates each list independently.

The longer-term goal for Small Gods is a world that an LLM can author and
mutate while the sim runs — NPCs raycast their surroundings to feed the
language model that puppets them, divine actions and LLM authoring both
write into the same world state, and biomes become an authoring vocabulary
("paint this region as `sacred_grove`") rather than a passive tile tag.

That goal requires a single principle: **every visible object is a
semantic entity in one registry, and every change to the world goes
through a fixed set of deterministic mutation functions.** Spec A
establishes that principle with bootstrap (procgen) as the only mutation
caller. LLM authoring, persistence, and embedding-based search are
deferred to follow-on specs.

## Architectural principle

The world is a single mutable structure. Mutations happen via a fixed API
(`addEntity`, `removeEntity`, `setProperty`, `applyBrush`). In Spec A
only **bootstrap procgen** mutates entities; the render layer reads via
`world.query(...)` and never writes. Current divine actions act on NPC
sim state, not entities, so they don't appear here. The LLM becomes
the next mutation caller in Spec B and uses the *same* mutation
functions exposed as tool definitions — there are no LLM-only code paths.

```
                ┌─────────────────────────────────────┐
                │              World state             │
                │  ┌────────────┐   ┌──────────────┐  │
                │  │ TileGrid   │   │ EntityRegistry│  │
                │  └────────────┘   └──────────────┘  │
                │  ┌─────────────────────────────────┐│
                │  │  Spatial + tag + kind indexes   ││
                │  └─────────────────────────────────┘│
                └──┬──────────────┬───────────────────┘
                   │ query        │ mutate
            ┌──────▼──────┐  ┌────▼──────────────────┐
            │  Renderer   │  │  applyBrush(world,    │
            │  projects   │  │    brushName,         │
            │  entities   │  │    region, seed)      │
            │  → sprites  │  │  - calls brush fn     │
            └─────────────┘  │  - adds entities      │
                             └────▲──────────────────┘
                                  │ called by
                       ┌──────────┴─────────┐
                       │  Bootstrap procgen │
                       └────────────────────┘
```

## Scope

### In scope (Spec A)

- `Entity` type that subsumes existing `BuildingInstance` and
  `DecorationInstance`.
- `EntityKind` catalog of ~150 primitive entity kinds with sprite refs
  and default tags.
- Extended `EntityRegistry` with bulk insert, remove, property mutation.
- `World` facade combining tilegrid + registry + indexes, exposing the
  single mutation/query API.
- Spatial, kind, and tag indexes maintained on mutation.
- `BrushRegistry` + ~12 pure brush functions (biome and POI-zone).
- Bootstrap procgen calls brushes after building placement to populate
  the registry.
- Renderer projects `world.query(visibleRegion)` to sprites with
  fallback drawing for kinds whose sprite is missing.
- Unit and integration tests covering brush determinism, index
  invariants, and bootstrap entity counts.

### Out of scope (deferred to other specs)

- **Spec B — LLM authoring.** LLM tools that call `applyBrush`,
  `addEntity` etc. as mutations. LLM-named compounds (saved entity
  arrangements).
- **Spec C — Sprite generation pipeline.** Cheap automated sprite and
  animation generation (May 2026 cutting edge: Flux/Sana/etc.). Spec A
  uses existing LPC art plus colored-shape fallbacks.
- **Spec D — Event log, snapshots, save/load, time travel.** Spec A
  re-generates the world from seed each session.
- **Spec E — Entity affordances and sim behaviour.** Wells aren't water
  sources yet, fences don't block pathing. Properties + tags exist; no
  sim logic reads them.
- **Spec F — Embedding-based memory and semantic similarity.** Spec A's
  raycast is purely spatial + structured (kind/tag).
- **NPC unification.** NPCs stay in `NpcInstance` for Spec A. Folding
  them into `Entity` is a follow-on cleanup once animation + sim state
  are mapped through.

## Supporting types

```ts
interface Region {
  x: number;       // top-left tile x
  y: number;       // top-left tile y
  w: number;       // width in tiles
  h: number;
}

interface SpriteRef {
  atlas?: string;                  // atlas key e.g. 'lpc-terrain'
  region?: { sx: number; sy: number; sw: number; sh: number };
  // if atlas+region absent, renderer draws a fallback:
  fallbackColor?: string;          // e.g. '#7ab06e'
  fallbackShape?: 'circle' | 'square' | 'triangle';
}

interface BrushContext {
  world: WorldReadOnly;            // read-only view of current world state
  tiles: GameMap;                  // for biome/tile-type queries
}
```

`Region` is used for both brush input regions and `query` clipping;
`SpriteRef` lives on every `EntityKindDef` and powers the
sprite-or-fallback render path; `BrushContext` is what brushes use to
read existing entities (e.g. avoid stamping on buildings) without being
able to mutate.

## Components

### `Entity` (extended type, `src/core/types.ts`)

```ts
type EntityId = string;

interface Entity {
  id: EntityId;
  kind: string;
  x: number;                              // tile coords, sub-tile allowed
  y: number;
  properties?: Record<string, unknown>;
  tags?: ReadonlyArray<string>;
}
```

`BuildingInstance` and `DecorationInstance` fold into `Entity`. Building-
specific fields (templateId, poiId, state, doorCell) move into
`properties` until they have callers strong enough to deserve their own
typed shape.

### `EntityKindDef` catalog (`src/world/entity-kinds.ts`, new)

```ts
interface EntityKindDef {
  id: string;
  category: 'building' | 'vegetation' | 'prop' | 'terrain-feature';
  sprite: SpriteRef;            // atlas region or fallback shape + color
  defaultTags: ReadonlyArray<string>;
  yOffsetForSort?: number;
}
```

Single file, ~150 entries. Easy to scan end-to-end. New kinds are added
by appending. The LLM tooling in Spec B reads the same table.

### `EntityRegistry` (extended, `src/world/entity-registry.ts`)

Existing methods retained. Added:

- `addAll(entities: Entity[])` — bulk insert used by `applyBrush`.
- `remove(id: EntityId)` — primitive used by future mutators and undo.
- `setProperty(id: EntityId, key: string, value: unknown)` — primitive.
- Internal storage stays `Map<EntityId, Entity>`. Index updates happen
  in `World`, not here.

### Indexes (`src/world/indexes.ts`, new)

- `SpatialIndex`: grid-hash, cell size = 4 tiles. `query(x, y, radius)`.
- `KindIndex`: `Map<string, Set<EntityId>>`. `byKind(kind)`.
- `TagIndex`: `Map<string, Set<EntityId>>`. `byTag(tag)`.

Indexes are maintained as a side effect of `World.addEntity` /
`removeEntity` — no separate rebuild step.

### `World` facade (`src/world/world.ts`, new)

```ts
class World {
  readonly tiles: GameMap;
  readonly registry: EntityRegistry;

  // mutation
  addEntity(e: Entity): void;
  removeEntity(id: EntityId): void;
  setProperty(id: EntityId, key: string, value: unknown): void;

  // query
  query(opts: {region?: Region; kind?: string; tag?: string; limit?: number}): Entity[];

  // brush dispatcher
  applyBrush(brushName: string, region: Region, seed: number): EntityId[];
}
```

This is the LLM-facing surface in Spec B. Everything an NPC or LLM tool
does in the future routes through this object's methods.

### `BrushRegistry` (`src/world/brushes.ts`, new)

```ts
type BrushFn = (region: Region, seed: number, ctx: BrushContext) => Entity[];

const brushes = new Map<string, BrushFn>();

function registerBrush(name: string, fn: BrushFn): void;
function getBrush(name: string): BrushFn;
```

`BrushContext` provides read-only access to `World` (so brushes can see
where buildings already sit and avoid stamping on them). Brushes do not
mutate.

### Brush functions (`src/world/brushes/*.ts`, new)

Initial set (~12):

- **Biome brushes** — `forest`, `dense_forest`, `pine_forest`,
  `scrubland`, `sacred_grove`, `coastal`, `hills`, `quarry`. Handle
  trees, undergrowth, flowers, rocks, mushrooms.
- **POI-zone brushes** — `village`, `temple`, `farm`, `castle`, `dock`,
  `wilderness`. Handle wells, fences, statues, banners, crates, market
  awnings. Read context to keep clear of building footprints.

The existing `placeDecorations` (forest tree placer) folds into the
`forest` brush — same logic, different output shape.

### Bootstrap integration (`src/map/map-generator.ts`, modified)

After tile classification + WFC building placement, add a brush pass:

```ts
for (const region of biomeRegions(tiles)) {
  world.applyBrush(brushForBiome(region.biome), region, seed);
}
for (const poi of worldSeed.pois) {
  world.applyBrush(brushForZone(poi.type), poiRegion(poi), seed);
}
```

Existing tree-decoration logic moves into the `forest` brush body.

### Renderer projection (`src/render/renderer.ts`, modified)

Render loop iterates `world.query({region: visibleRegion})`, sorts by
`(y + kindDef.yOffsetForSort)`, projects each entity via
`EntityKindDef.sprite`. Missing sprites fall back to a colored shape +
label (matches existing un-sprited-building behaviour). Separate
building / decoration loops collapse into this one.

NPCs continue to render via their existing path for Spec A; folding them
into the entity pass is a follow-up that needs animation + sim state to
plumb through first.

## Data flow

### Map generation (bootstrap, once per world)

```
generateWithNoise(seed, worldSeed)
  → tiles + biomeMap                              (existing terrain pass)
  → place buildings per POI zone                  (existing WFC + placer)
  → world.addEntity(building) for each
  → for each biome region:
      world.applyBrush(biomeName, region, seed)
        → brush returns Entity[]
        → world.addEntity(e) for each
  → for each POI zone:
      world.applyBrush(zoneName, poiRegion, seed)
        → brush reads context to skip buildings
        → world.addEntity(e) for each
  → return { tiles, world }
```

Deterministic from `seed`. Replayable.

### Render frame

```
visibleRegion = camera.computeVisibleRegion()
entities = world.query({region: visibleRegion})
ySort(entities)
for each entity:
  kindDef = entityKinds.get(entity.kind)
  drawSprite(ctx, kindDef.sprite, entity.x, entity.y, entity.properties)
```

One loop, one entity stream, one sort.

### NPC context query (the LLM-feeding raycast)

```ts
function npcContextSlice(npcId: EntityId): ContextEntity[] {
  const npc = world.registry.get(npcId);
  const nearby = world.query({
    region: circleAround(npc.x, npc.y, 12),
    limit: 30,
  });
  return nearby.map(e => ({
    kind: e.kind,
    distance: dist(npc, e),
    tags: e.tags,
    properties: pickRelevant(e.properties),
  }));
}
```

Pure structured lookup. No embeddings. Returns a compact list suitable
for an LLM prompt: "8 tiles NE: oak_tree; 3 tiles E: well (water-source);
2 tiles S: cottage (residential)...". The API exists in Spec A; no caller
in Spec A uses it (NPC sim doesn't run an LLM yet — that's Spec B).

### Determinism

Brushes use `noise(x, y, seed)` for all stochastic choices. Same seed +
same brush args → bit-identical entity list. The bootstrap path is
replayable; Spec D's event sourcing can record the brush call instead of
each generated entity.

## Error handling

**Throw on contract violations:**
- `applyBrush('unknown_brush', …)`.
- `addEntity` with duplicate `id`.
- `entityKinds.get(unknownKind)` from non-render code.
- Non-finite or negative coordinates from a brush.

**Warn and skip on stochastic procgen edge cases:**
- Entity coords outside the map → drop, log once per brush per gen.
- Entity overlapping an existing non-walkable entity → drop. Brushes are
  expected to read context and avoid this; one slip-through doesn't
  fail map gen.
- Brush requested for a region with zero matching tiles → produces zero
  entities, no error.

**Silent fallback in rendering:**
- Entity kind has no sprite → colored shape + label.
- Entity missing properties → use defaults from `EntityKindDef`.
- Query over `limit` → trim quietly.

**Dev-mode asserts (gated on `import.meta.env.DEV`):**
- After each brush call: no duplicate `id`s, no coords outside
  `[0, width) × [0, height)`.

No try/catch around brush calls. A throw is a bug and map gen should
fail visibly.

## Testing

### Per-brush snapshot tests (`tests/unit/brushes/*.test.ts`)

```ts
it('forest brush produces deterministic output', () => {
  const region = { x: 0, y: 0, w: 16, h: 16 };
  const entities = forestBrush(region, 42, EMPTY_CONTEXT);
  expect(entities).toMatchSnapshot();
});
```

Snapshots cover kind + position + properties. Updates are explicit via
`vitest -u`.

### Determinism property test (one per brush)

```ts
it('same seed produces identical output', () => {
  expect(brush(region, 1, ctx)).toEqual(brush(region, 1, ctx));
});
```

### Index invariants (`tests/unit/world/indexes.test.ts`)

- `addEntity` then `query({region: containing})` returns it.
- `addEntity` then `removeEntity` then `query` doesn't return it.
- `byKind` / `byTag` consistent after adds and removes.
- Spatial-index edge cases at grid-cell boundaries.

### World facade (`tests/unit/world/world.test.ts`)

- `applyBrush` adds all returned entities.
- `applyBrush` updates indexes (verified by subsequent queries).
- Unknown brush throws.

### Integration (`tests/unit/world/bootstrap.test.ts`)

```ts
it('bootstrap produces expected entity counts on default seed', async () => {
  const { world } = await generateWithNoise(128, 96, 1, defaultSeed);
  expect(world.query({ kind: 'cottage' }).length).toBeGreaterThan(0);
  expect(world.query({ kind: 'oak_tree' }).length).toBeGreaterThan(50);
  expect(world.query({ tag: 'water-source' }).length).toBeGreaterThan(0);
});
```

Loose bounds, matching the hydrology integration test's tolerance.

### Not tested in Spec A

- LLM mutation flow (Spec B).
- Save/load and time travel (Spec D).
- Render correctness — visual, manual via dev server.
- Entity affordances and sim behaviour (Spec E).

## File list

**New:**
- `src/world/world.ts`
- `src/world/entity-kinds.ts`
- `src/world/indexes.ts`
- `src/world/brushes.ts`
- `src/world/brushes/forest.ts` (+ 11 other brush files)
- `tests/unit/world/world.test.ts`
- `tests/unit/world/indexes.test.ts`
- `tests/unit/world/bootstrap.test.ts`
- `tests/unit/brushes/*.test.ts` (one per brush)

**Modified:**
- `src/core/types.ts` — `Entity` type, fold `BuildingInstance` and
  `DecorationInstance`.
- `src/world/entity-registry.ts` — `addAll`, `remove`, `setProperty`.
- `src/render/renderer.ts` — single entity render loop, sprite fallback.
- `src/map/map-generator.ts` — call brushes after building placement.
- `src/map/decoration-placer.ts` — body moves into `src/world/brushes/forest.ts`,
  file deleted.

## Open questions

None blocking. Likely to come up during implementation:

- Sprite-fallback styling for the ~120 kinds we don't have art for yet —
  needs to be visually distinct enough to debug placements but not
  visually noisy. Settle during implementation.
- Whether biome regions should be one rectangular brush call per biome
  patch or per-tile brush calls. Implementation-detail; start with
  rectangular patches and tune if brushes feel awkward.
