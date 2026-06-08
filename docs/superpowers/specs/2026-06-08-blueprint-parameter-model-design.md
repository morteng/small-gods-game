# Blueprint — Modular Structural Parameter Model — Design

**Status:** Design. Approved 2026-06-08.
**Parent vision:** [`2026-06-08-unified-art-scale-pipeline-vision.md`](2026-06-08-unified-art-scale-pipeline-vision.md). This is the parameter-model foundation that vision's slices (buildings now; vegetation/terrain/barriers later) all author through.
**Supersedes (for buildings):** the flat `BuildingDescriptor` (`src/world/building-descriptor.ts`) and `descriptorToSpec` (`src/render/iso/building-spec.ts`).

## One line

A single, class-neutral **`Blueprint`** document — composable **`Part`s** + attached **`Feature`s**, assembled from a **part/feature registry**, authored as **layered partial patches** (preset · era · agent) with a final **seeded resolve** — that **compiles to** geometry, collision, anchors, and the generative brief. It subsumes the flat accreting `BuildingDescriptor` fields, is **very LLM-agent-friendly** (the registry is the agent's self-describing capability catalogue), and is the shared structural vocabulary every entity class adopts.

## Why

`BuildingDescriptor` is a flat record that keeps accreting fields (`footprint`, `plan`, `levels`, `levelInset`, `heightPerLevel`, `roof`, `walls`, `roofMat`, `palette`, `groundMaterial`, `apron`, `door`, `structure`, `vents`…). Every new capability widens the record and touches `descriptorToSpec`, `building-collision`, `buildingAnchors`, and `buildingBrief` in parallel. Meanwhile assetgen already contains **two** better-shaped models — `Part`/`StructureSpec` (composable geometry primitives) and `Wing`/`BuildingFeatures` (an overrideable feature contract with a seeded default-resolution ruleset). The risk of "just adding more fields" is a fourth parallel model.

This design unifies on **one authoring model** that:
- stops the accretion (new knobs land on a *part type*, not the top-level record),
- is what presets / era / seed / agent all write,
- compiles down to the four consumers (geometry, collision, anchors, brief),
- shares a vocabulary across building / barrier / plant / terrain so later vision slices reuse it,
- folds in the deferred **door-sizing fix** as a registered feature sized by the scale contract.

## Decisions (locked during brainstorming)

1. **One unified authoring model**, not a refactor-in-place or an assetgen promotion. The existing assetgen `Part`/`Wing`/`Features` become the **compile target**, not the agent-facing surface.
2. **Semantic parts → primitives**, two-tier: agents compose semantic parts (`body`, `wing`, `roof`, `tower`, `porch`, `chimney`…) with named params; a `prim` escape-hatch part allows raw geometry for anything unregistered.
3. **Partial-patch layering**, parts keyed by stable id, deep-merge last-wins, `null` deletes a part; a final **seeded resolve** fills the gaps, sizes from the scale contract, and makes deterministic choices.

## Vocabulary (committed naming)

| Concept | Name | Rationale |
|---|---|---|
| Single-object authoring doc | **`Blueprint`** | Architectural sense = recipe for *one* object. |
| Arrangement of many objects | **`Layout`** (future, settlement G2) | Reserved; not yet in code, so no rename needed. |
| Semantic component | **`Part`** | The word an LLM reaches for. |
| Geometry primitive | **`Prim`** | Aliases assetgen's `Part` *inside* the blueprint layer → "Part = semantic, Prim = geometry". |
| Attached opening/fixture | **`Feature`** | door / vent / window / gate — class-neutral. |
| A layer's contribution | **`BlueprintPatch`** | a partial `Blueprint`. |
| Fully-resolved output | **`ResolvedBlueprint`** | every field concrete. |

**Home:** `src/blueprint/` — class-neutral; future plant/barrier/terrain part types live here too.

## The model

```ts
interface Blueprint {
  version: number;                       // schema version → snapshot migration seam
  class: 'building' | 'barrier' | 'plant' | 'terrain_feature';
  preset?: string;                       // becomes entity.kind for presets
  era?: Era;
  category?: string;                     // class-specific subtype (residential / conifer / …)

  parts: Record<string, Part>;           // keyed by stable id → a patch addresses one part

  materials?: Record<string, string>;    // inherited by parts unless a part overrides
  palette?: Partial<Palette>;

  footprint: { w: number; h: number };   // the plot reserved (placement / spacing / registry index)
  notes?: string;                        // free-form authoring intent → feeds the generative brief
}

interface Part {
  type: string;                          // registry key: body|wing|roof|tower|porch|chimney|prim|…
  at?:   { x: number; y: number };       // structure-local tile origin
  size?: { w: number; h: number };
  material?: string;                     // overrides blueprint material for this part
  params?: Record<string, unknown>;      // type-specific knobs, validated by the part type's schema
  features?: Record<string, Feature>;    // doors/vents/windows on this part, also keyed by id
}

interface Feature {
  type: string;                          // registry key: door|vent|window|…
  face?: WallFace;                       // which wall it sits on (where meaningful)
  params?: Record<string, unknown>;
}
```

**Field mapping from the old descriptor** (nothing lost):

| Old `BuildingDescriptor` | New `Blueprint` |
|---|---|
| `footprint` | `footprint` (the reserved plot) |
| `plan` / `levels` / `levelInset` / `heightPerLevel` / `roof` | a `body`/`wing`/`roof` part's `params` |
| `structure` (body within plot) | the parts' `at`/`size`; **lawn = footprint cells no part claims** |
| `walls` / `roofMat` | `materials` |
| `palette` | `palette` |
| `door` | a `door` feature on the wall part |
| `vents` | `vent` features |
| `groundMaterial` / `apron` | `category`-level params on a `ground`/`apron` part (or blueprint params) |

## The registries (modularity + LLM-friendliness engine)

Two self-describing registries. Adding a part or feature = **one registration**, no edits to consumers:

```ts
interface PartType {
  type: string;
  paramSchema: ParamSchema;                       // enums/ranges → validates AND auto-documents for agents
  resolve(part: Part, ctx: ResolveCtx): ResolvedPart;   // seed-fill defaults; size from scale-contract
  toPrims(p: ResolvedPart, ctx: CompileCtx): Prim[];    // → geometry (assetgen Part[])
  toCollision(p: ResolvedPart, ctx: CompileCtx): CellMask;  // footprint cells it blocks (rest = lawn)
  toAnchors(p: ResolvedPart, ctx: CompileCtx): Anchor[];    // world-space connection points
  toBrief(p: ResolvedPart, ctx: CompileCtx): string;        // phrase for the generative prompt
}

interface FeatureType {
  type: string;
  paramSchema: ParamSchema;
  resolve(f: Feature, ctx: ResolveCtx): ResolvedFeature;    // door size derives from scale-contract HERE
  toPrims(f: ResolvedFeature, host: ResolvedPart, ctx: CompileCtx): Prim[];
  toAnchors(f: ResolvedFeature, host: ResolvedPart, ctx: CompileCtx): Anchor[];
  toBrief(f: ResolvedFeature, host: ResolvedPart, ctx: CompileCtx): string;
}

registerPartType(roofPartType);    // body, wing, roof, tower, porch, chimney, prim (escape) …
registerFeatureType(doorFeature);  // door, vent, window …
```

This satisfies all four requirements at once: **modular** (parts are independent units), **flexible** (the `prim` escape-hatch covers anything unregistered), **evolvable** (register to extend), **LLM-friendly** (the `paramSchema` registry *is* the agent's capability catalogue — Fate reads "what can I compose" from the registry, not a hardcoded prompt).

**Door-sizing fix (the deferred item) lands in `doorFeature.resolve`:** default `width`/`height` derive from `src/render/scale-contract.ts` (`DOOR_WIDTH_TILES`, `DOOR_HEIGHT_UNITS` → roughly villager height + headroom) instead of the hardcoded `0.30`/`1.5`/`2.0` in `assetgen/geometry/building.ts`. Sized against the human reference by construction, fixed once for every building.

## Resolution pipeline (`src/blueprint/resolve.ts`)

```
resolveBlueprint(patches: BlueprintPatch[], seed): ResolvedBlueprint
  1. deep-merge patches in order  → preset · era · agent
       - scalars: last-wins
       - parts / features: keyed by id; a patch tweaks one part's params, adds a part,
         or removes one by setting it to null
  2. seeded resolve pass          → each PartType/FeatureType.resolve(seed):
       - fills unspecified params
       - sizes from scale-contract
       - makes deterministic choices (which front wall a default door takes, etc.)
  3. expand                       → ResolvedBlueprint (every field concrete; semantic structure intact)
```

**On the `preset→era→seed→agent` ordering:** *seed is not a static layer* — it is the final resolve pass (step 2). The declared override layers are **preset · era · agent**; seeded defaulting runs **last** so agent intent wins and any remaining gap still gets a deterministic value. This is exactly what `resolveFeatures(seed)` does today, generalized to the whole document.

## Compile targets

`ResolvedBlueprint` is consumed by four pure functions under `src/blueprint/compile/`, replacing today's scattered logic:

| Compiler | Output | Replaces |
|---|---|---|
| `toGeometry` | assetgen `StructureSpec` | `descriptorToSpec` (`src/render/iso/building-spec.ts`) |
| `toCollision` | footprint passability mask | the structure/lawn logic in `src/world/building-collision.ts` |
| `toAnchors` | `Anchor[]` | `buildingAnchors` (`src/world/anchors.ts`) |
| `toBrief` | assetgen brief | `buildingBrief` (`src/assetgen/producers/building-producer.ts`) |

Each compiler is a fold over the resolved parts/features, delegating to the registry's `toPrims`/`toCollision`/`toAnchors`/`toBrief`. **No consumer hardcodes a part type** — they iterate the registry.

## Migration

- The 11 presets in `src/world/building-presets.ts` are re-expressed as `Blueprint`s under `src/blueprint/presets/`.
- `entity.properties.descriptor` → `entity.properties.blueprint` (carrying `version`). The renderer/collision/anchor reads switch to `blueprint`.
- **Clean cut, no legacy reader:** IndexedDB autosave + the "New World" button already regenerate the world, and the user accepts "New World" to see preset changes. Saved worlds from before this change require a "New World"; no descriptor-compat shim is built.
- `BuildingDescriptor` and `descriptorToSpec` are **deleted** once `toGeometry` is green. `structureRect` and the `structure?` field fold into part placement. Snapshot/save tests update to the `blueprint` property.

## Scope (YAGNI)

**Build now:**
- `Blueprint`/`Part`/`Feature`/`ResolvedBlueprint` types + `version`.
- `PartType`/`FeatureType` registries + `registerPartType`/`registerFeatureType` + `paramSchema` validation.
- Resolution pipeline (patch merge + seeded resolve).
- Four compilers (`toGeometry`, `toCollision`, `toAnchors`, `toBrief`).
- Building part types: `body`, `wing`, `roof`, `tower`, `porch`, `chimney`, `prim` (escape).
- Feature types: `door`, `vent`, `window`.
- All 11 presets migrated; renderer/collision/anchor/brief repointed; old descriptor deleted.
- Door-sizing fix in `doorFeature.resolve`.

**Design-for, do NOT build (each has its seam above):**
- plant / barrier / terrain part types (their own vision slices).
- Fate tool-schema generator from the registry (own slice; `paramSchema` is the hook).
- size-budget `fit()` pass that centralizes the 384px PixelLab capping currently hand-smeared across presets (a later tidy; seam in the compiler).
- part nesting / interiors (additive — `toPrims` already returns a primitive list, so a part can internally compose later).
- damage/state layer (it's just another `BlueprintPatch` — `condition` — over the same model).

## Future expansion explicitly planned for

1. **Other entity classes** — `class` field + class-neutral parts. A tree = `trunk` + `canopy` parts; a wall = post/panel parts (or the existing linear barrier as a part type). Future slices register their part types only.
2. **Normals + feature tags** (Track-R lit renderer) — anchors are first-class and already feed the brief; door/window anchors ARE the feature tags the lit renderer and interaction layer consume.
3. **Damage / state** — a `condition` patch layer; parts read e.g. `params.collapsed`. No new concept.
4. **Self-describing → agent tool-schema** — `paramSchema` on every registry entry lets Fate's tool-spec be *generated* from the registry rather than hand-authored.
5. **Size-budget fit** — the compiler is the single owner of a future `fit()` pass; retire the per-preset `// capped` comments then.
6. **Part nesting** — additive escape valve via `toPrims`; no model change.
7. **`version` + migration** — present from day one so snapshots survive schema evolution.

Cross-class glue is the **shared vocabulary**: `Era`, materials, wall `Face`s, `Anchor`s, and `scale-contract` units are the *same tokens* across building / barrier / plant / terrain.

## Testing strategy

TDD throughout:
- **Registry unit tests** — `resolve` fills defaults + sizes from scale-contract; `paramSchema` rejects bad params; patch merge (scalar last-wins, part-by-id tweak/add/`null`-delete).
- **Golden regression** — the migrated `cottage` Blueprint compiles to the *same* `StructureSpec` / collision mask / anchors that the current cottage produces (proves the unification preserves behaviour). Repeat for `yurt` (round) and `castle_keep` (stepped) to cover the non-rect plans.
- **Walkable-lawn** — the existing `pathfinding-lawn` test carries over against the new `toCollision`.
- **Door size** — resolved `door.height` tracks `scale-contract` (`DOOR_HEIGHT_UNITS * HEIGHT_UNIT_PX`), proving the deferred fix.
- **Guard** — extend/replace `no-massing-renderer` guard so no file references the deleted `BuildingDescriptor`/`descriptorToSpec` after the cut.

## Non-goals

- Replacing the topdown debug renderer (`renderer.ts`).
- The Track-R lit shader layer itself (this *feeds* it).
- Building the non-building entity classes (this *enables* them).
- A live editor UI for blueprints (Fate/agent integration is a later slice).

## Related canon

- `[[project-unified-art-scale-pipeline]]` — parent vision.
- `[[project-parametric-building-features]]` — the agent-overrideable `BuildingFeatures` prior art this generalizes.
- `[[project-live-parametric-building-rendering]]` / `[[project-assetgen-manifold-geometry]]` — the geometry compile target.
- `[[project-door-sizing-followup]]` — the deferred fix folded in here.
- `[[project-prompt-generation-system]]` — the Brief→Compiler generative path `toBrief` feeds.
