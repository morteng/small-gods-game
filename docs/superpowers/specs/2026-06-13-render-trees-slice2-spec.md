# Slice 2 — parametric trees through the generative pipeline — spec

**Date:** 2026-06-13 · **Epic:** [world rendering](2026-06-13-world-prop-vegetation-rendering-design.md) · **Branch:** `feat/render-props-slice1` (continues; Slice 1 @ `5ef6673`)

## Goal

Trees currently draw as **flat, unlit 64px sprite-sheet billboards** (`tree-sheets.ts` → `vegetationItems`), beside normal-mapped, cast-shadowed, day/night-lit buildings — a visual mismatch. Make tree species render through the **same** generative blueprint→manifold-CSG→`composeStructure`→`SpritePack` pipeline buildings use, so they inherit PBR lighting, the sun's cast shadows, AO, and (later) day/night + img2img texture — for free. Mirrors Slice 1 (props), extended to the **`class:'plant'`** family.

## Why this is surgical (verified)

- `composeStructure` already defaults a `cone`/`ellipsoid` prim's material to **`'foliage'`** and `'bark'`/`'foliage'` are real `Mat`s with palette + PBR roughness entries (`assetgen/types.ts:18`, `material-pbr.ts:14`). A tree = trunk `cylinder` (`bark`) + canopy `ellipsoid`/`cone` (`foliage`) — **standalone prims, exactly the yurt/well shape**; zero changes to `toGeometry`/`composeStructure`.
- `EntityClass` already includes `'plant'`; `entity.ts`'s `CLASS_CATEGORY` already maps `plant → 'vegetation'`, so a plant blueprint entity keeps the `category:'vegetation'` the renderer + `nature-height-coverage` test expect.
- `buildingSpriteItemFromPack` already carries the normal/material maps on the draw item for the WebGL lit shader, and the Pixi layer already drops a cast shadow per image item. A foot-anchored variant gives trees both.

## The one real design constraint: trees are MANY

Buildings/props are few, so storing a resolved blueprint on each entity (`properties.blueprint`, `structuredClone`d into every snapshot) is cheap. A forested map has **hundreds–thousands** of trees — per-entity blueprints would bloat memory and every autosave. So **trees do NOT carry a blueprint**. Instead:

- Tree entities stay lean (kind + `scale`/`offset`, exactly as worldgen emits them today — **no worldgen/brush change, determinism untouched**).
- The render path recognises a vegetation entity whose **kind** has a `class:'plant'` preset and routes it to a **species-keyed** parametric source that synthesises the blueprint once and caches **one `SpritePack` per species** (oak, pine, …). Per-species, not per-instance — so 2000 oaks share one sprite (like identical buildings already do via the JSON cache key).
- Billboard stays the **keyless fallback** (sprite not yet warmed, or ground cover with no plant preset).

## Changes

1. **`src/blueprint/parts/flora.ts`** (new) — one `treePartType`, parameterised by `form` (`'broad' | 'conifer' | 'slender' | 'bare'`), `heightM`, `crownM`, `trunkR`:
   - **trunk** = `cylinder` (`bark`), height = `heightM × trunkFrac(form)`.
   - **broad** (oak/brown/pale/orange): 3 overlapping `foliage` ellipsoids (central + two seeded-jitter offsets) forming a rounded crown.
   - **conifer** (pine): 2 stacked point-topped `cone`s (`foliage`), decreasing radius up — Christmas-tree.
   - **slender** (birch): one tall narrow `foliage` ellipsoid.
   - **bare** (dead): trunk only + two stubby `bark` branch boxes near the top, no canopy.
   - Seeded jitter via `ctx.seed` (deterministic per species → stable sprite). `toCollision` = 1×1 footprint cell; `toAnchors` = none; `toBrief` = a per-form phrase ("a broad-crowned oak", …).
2. **`src/blueprint/presets/index.ts`** — a `plant()` helper (`class:'plant'`) + 7 presets keyed by the existing entity kinds so `kind` is preserved: `oak_tree` (broad 15 m), `pine_tree` (conifer 18 m), `birch_tree` (slender 12 m), `dead_tree` (bare 8 m), `orange_tree` (broad 6 m), `pale_tree` (broad 10 m), `brown_tree` (broad 11 m). Heights match `NATURE_HEIGHT_M`. Export `isPlantPreset(name)`.
3. **`src/blueprint/register-buildings.ts`** — register `treePartType`.
4. **`src/render/parametric-plant-source.ts`** (new) — `ParametricPlantSource`, the kind-keyed twin of `ParametricBuildingSource`: `peek(kind)` sync read, `warm(kind)` synthesises `synthesizeBlueprint(kind)` (once) → `toGeometry` → `composeStructure` → `structureResultToPack`, caches by kind. Non-plant / failed kinds cache `null`. Never throws on the frame path.
5. **`src/render/iso/iso-sprites.ts`** — `plantSpriteItemFromPack(ic, pack, x, y)`: foot-anchored upright billboard (bottom-centre at the tile point, like `vegetationItems`), maps riding along for the lit shader. Per-instance variety scale is dropped on this path (uniform per species keeps the blit pixel-crisp; variety comes from species + clumping).
6. **`src/render/iso/entity-draw-list.ts`** — in the vegetation branch: if `isPlantPreset(v.kind)` and `resolveParametricPlantArt(v.kind)` returns a pack, emit `plantSpriteItemFromPack`; else the existing billboard/fallback.
7. **`src/core/types.ts`** + **`src/game/render-context.ts`** + **`src/game.ts`** — add `resolveParametricPlantArt?(kind)` to `RenderContext`, a `ParametricPlantSource` instance wired through the render-context deps (peek→warm→null), cleared on world reset.

## Tests (`tests/unit/render-trees-slice2.test.ts`)

- each tree preset resolves as `class:'plant'`, footprint 1×1, `isPlantPreset` true.
- `toGeometry` yields standalone prims (no `'building'` prim): broad has ≥3 ellipsoids + a bark cylinder; conifer has cones; bare has no foliage prim.
- `blueprintEntity` of a plant preset → `category:'vegetation'` (renderer + `nature-height-coverage` keep working).
- `ParametricPlantSource.peek` is null before warm, returns a pack after (mock `compose`); a non-plant kind caches null.
- `plantSpriteItemFromPack` anchors bottom-centre at the tile and carries `maps` when the pack has them.

## Keep green

`nature-height-coverage.test.ts` (heights unchanged), `iso-vegetation.test.ts` (billboard fallback intact — trees only upgrade when a pack is warm), all brush placement tests (worldgen untouched).

## Out of scope

img2img texture seeding for trees (deferred, like props — keyless players get the parametric grey-foliage render, which already proves the slice + unifies lighting). Per-instance size variety on the generative path. Season palettes. Converting ground cover (shrub/fern/…) — they stay billboards (no plant preset).
