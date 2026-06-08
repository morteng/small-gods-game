# Buildings — Parametric Standardization & Cottage Yards — Design

**Status:** Approved design (2026-06-08). First child slice of `2026-06-08-unified-art-scale-pipeline-vision.md`.
**Next:** implementation plan.

## Goal

Make the parametric system the canonical building foundation in-game: collapse building rendering to a single priority chain (**generated asset → parametric fallback → flat block**), delete the Canvas2D massing renderer and its lone consumer, complete round/stepped in the parametric fallback so nothing depends on massing, give cottages a **walkable yard** (the building structure is smaller than its plot), and plant the **scale-contract** module the wider vision builds on.

## Decisions (locked during brainstorming)

1. **Render priority** = generated asset (`resolveBuildingArt`) → parametric fallback (`resolveParametricBuildingArt`) → minimal flat block. The 3-way dev `buildingRenderMode` collapses to `auto | fallback`.
2. **`footprint` stays the plot** (placement, spacing, apron/ground, registry tile index). A new optional `structure` sub-rect is the solid+drawn building; default = whole footprint (existing presets unchanged).
3. **Lawn is walkable** — collision keys off the structure, not the plot.
4. **Round/stepped render via the parametric fallback** (existing solids), so the Canvas2D massing renderer can be deleted.
5. **Topdown renderer (`renderer.ts`) is out of scope** — separate render mode; future standalone retirement.
6. **Building-info-panel guidance preview is dropped** (it depended on the deleted massing renderer; redundant with the in-game parametric view).

## Components

### A. Scale-contract module — `src/render/scale-contract.ts` (NEW)

Single source of truth for world metrics + reference human, so no sprite size is hardcoded again. Centralizes the `H_UNIT_PX` value currently duplicated in `iso-building.ts` and `iso-barrier.ts`.

```ts
import { ISO_TILE_W, ISO_TILE_H } from './iso/iso-constants';

/** Vertical pixels per 1 building height-unit (one storey). */
export const HEIGHT_UNIT_PX = ISO_TILE_H;            // 64

/** Reference human, in height-units and pixels (matches the LPC visible body). */
export const HUMAN_HEIGHT_UNITS = 0.72;
export const HUMAN_PX = Math.round(HUMAN_HEIGHT_UNITS * HEIGHT_UNIT_PX);   // 46

/** A human-scaled door: human + headroom, ~0.4 tile wide. */
export const DOOR_HEIGHT_UNITS = 0.85;
export const DOOR_WIDTH_TILES = 0.4;

export { ISO_TILE_W, ISO_TILE_H };
```

- `iso-building.ts` and `iso-barrier.ts` replace their local `const H_UNIT_PX = ISO_TILE_H` with `import { HEIGHT_UNIT_PX }` (DRY).
- `building-producer.ts` (`buildingBrief`) phrases the door as human-height in the prompt traits (e.g. a `human-height door` trait), so the generated sprite draws a door proportioned to villagers.
- A test asserts the cottage's structure + door read sensibly against `HUMAN_PX` (door taller than a human, building eave taller than the door).

### B. Structure ⊂ plot model — `src/world/building-descriptor.ts`, helpers, collision

**Descriptor field (optional, default = full footprint):**

```ts
// BuildingDescriptor
/** Solid + drawn building body within the plot footprint, in plot-local tiles.
 *  Cells of the footprint OUTSIDE this rect are walkable lawn. Default: whole footprint. */
structure?: { w: number; h: number; dx: number; dy: number };
```

**Resolver helper** (`src/world/building-descriptor.ts` or a small `building-structure.ts`):

```ts
export function structureRect(d: BuildingDescriptor): { w: number; h: number; dx: number; dy: number } {
  return d.structure ?? { w: d.footprint.w, h: d.footprint.h, dx: 0, dy: 0 };
}
```

**Collision rule** (`src/world/building-collision.ts`, at its documented "designed to grow" seam): a footprint cell `(lx, ly)` (plot-local) is **solid iff it is inside the structure rect AND it is not the door cell**. Everything else — lawn outside the structure, plus the door — is passable. Default structure (= full footprint) reproduces today's "all solid except door". Pathfinding already reads this module, so the lawn becomes walkable with **no registry-index change** (the registry still indexes the whole footprint for "which building covers this tile"; collision narrows passability).

**Placement & sort:** the building **sprite represents the structure**, placed at plot origin + `(dx, dy)`:
- y-sort key uses the structure rect (the building's real cells), not the plot.
- `apron`/ground-material still fills the **full plot** (the yard gets its ground material).
- the placer's footprint-on-terrain + spacing checks keep using the full **plot** footprint (unchanged).

### C. Sprite generation from the structure — `src/render/iso/building-spec.ts`

`descriptorToSpec` builds the spec from the **structure** dims, not the raw footprint:
- wings / parts are sized to `structureRect(d).{w,h}` (the building body),
- `isoNativeSize` (via the brief's `footprint`) likewise uses the structure dims, so the sprite is tight to the building.

The renderer places that sprite at `(floor(e.x) + dx, floor(e.y) + dy)`.

**Brief / asset-cache interaction:** `buildingBrief` sets `brief.footprint` to the **structure** dims (so the *generated* asset is also sized to the body, and placed at the same structure offset — generated and parametric stay interchangeable). Since the brief feeds the generation cache key, a preset that gains a `structure` (only `cottage` in this slice) gets a **new key**: its old full-footprint baked asset no longer matches and the parametric fallback renders the correct smaller cottage until the paid gen script reseeds it. Presets without `structure` keep the default (= full footprint) → identical brief, identical key, existing baked assets still match. This is intended: the old baked cottage filled the whole 3×3 and we *want* it superseded.

### D. Round & stepped in the parametric fallback — `src/render/iso/building-spec.ts`

`descriptorToSpec` stops returning `null` for `round`/`stepped`; it emits the existing solid prims (`src/assetgen/geometry/solids.ts` + `compose.ts` Part union):
- **round** → `cylinder` wall part + a `cone` (spire/conical) or low `ellipsoid` (dome/onion) roof part, radius from `structure.w/2`, height from `levels * heightPerLevel`.
- **stepped** → `levels` stacked `box` parts, each inset `levelInset` per side per level, base size = structure dims; flat tops.

Material mapping reuses the existing `WALL_MAT`/`ROOF_MAT` tables. After this, no building falls back to Canvas2D — the massing renderer is dead.

### E. Render dispatch collapse — `src/render/iso/iso-renderer.ts`, `src/core/types.ts`, `src/dev/DebugOverlayPanel.ts`

- **`types.ts`:** `export type BuildingRenderMode = 'auto' | 'fallback';` (`'generator'` and `'massing'` removed). `auto` = asset → parametric fallback → flat block; `fallback` = parametric → flat block (skip assets, for inspecting the generator even when assets exist).
- **`iso-renderer.ts`:** building branch resolves the structure rect, picks the source by mode, draws the sprite at the structure offset via `drawIsoBuildingSpriteGenerated`, and on a null source draws the flat-block fallback. No `drawIsoBuildingMassing` reference remains.
- **`DebugOverlayPanel.ts`:** the Building Render select becomes 2 options — **Auto** / **Force fallback**; reset → `'auto'`.

### F. Flat-block safety net — `src/render/iso/iso-building.ts`

A minimal, **non-wasm** `drawIsoFlatBlock(dc, structRect, tileX, tileY, color)` — four walls + a flat top extruded `HEIGHT_UNIT_PX`, no roof silhouette — drawn only when both the generated asset and the parametric sprite are null (e.g. manifold wasm failed to load). Guarantees a building never vanishes.

### G. Deletions (tech debt)

| Delete | Reason |
|---|---|
| `drawIsoBuildingMassing` + its roof/box helpers in `iso-building.ts` | replaced by the parametric fallback; only the minimal `drawIsoFlatBlock` survives |
| `src/assetgen/massing-guidance.ts` (whole file) | its only live consumer (the guidance preview) is dropped |
| building-info-panel guidance preview + guidance/sprite toggle | depended on the deleted massing renderer; redundant with the in-game parametric view — panel shows the resolved sprite only |
| `buildingRenderMode` values `'generator'`, `'massing'` + the massing dev-select option | folded into `auto`/`fallback` |
| local `const H_UNIT_PX = ISO_TILE_H` in `iso-building.ts`, `iso-barrier.ts` | centralized in `scale-contract.ts` |

**Kept:** `building-massing-model.ts` (the *model* — `buildingMassing`, `roofRise`, `ROOF_PROFILES`, `Massing`; used by the brief, y-sort, fallback sizing). **Out of scope (kept):** topdown `renderer.ts` + `building-massing.ts` `drawBuildingPlaceholder`.

### H. Cottage preset — `src/world/building-presets.ts`

Give `cottage` a yard: `structure: { w: 2, h: 2, dx: 0, dy: 0 }` on the 3×3 plot, with `door` on the structure's front edge so NPCs path across the lawn to it. Other presets keep the default (full-footprint structure); any can opt into a yard later by adding `structure`.

## Error handling

- Manifold wasm fails → parametric sprite is null → flat block draws. Never blocks the frame.
- `descriptorToSpec` always returns a spec now (round/stepped included); a genuinely unmappable descriptor → null → flat block.
- Default `structure` (full footprint) keeps all existing presets and tests behaving identically.

## Testing

- **scale-contract** — constants present; `HUMAN_PX` ≈ 46; door taller than human, eave taller than door.
- **building-spec** — round emits cylinder+roof parts; stepped emits `levels` inset boxes; structure dims drive wing/part sizing; existing rect/L/cross still map.
- **building-collision** — full-footprint default still "solid except door"; a cottage-style structure makes lawn cells passable, structure cells solid, door passable.
- **pathfinding** — a route crosses a cottage's lawn ring (previously blocked).
- **render dispatch** — `auto` prefers asset then parametric; `fallback` skips asset; null source → flat block. (jsdom: inject fakes; canvas may be null.)
- **massing removal guard** — a test asserting no source file imports `drawIsoBuildingMassing` / `massing-guidance`.
- **full suite green**, tsc clean, no-three guard green.

## Out of scope (later slices, per the vision)

- Vegetation/tree, terrain-feature, and barrier migration to asset→fallback.
- NPC sizing/fidelity (the scale contract is planted here; NPCs consume it later).
- Topdown renderer retirement.
- Track-R normal-lit rendering.

## File structure

| File | Change |
|---|---|
| `src/render/scale-contract.ts` | NEW — canonical metrics + reference human/door |
| `src/world/building-descriptor.ts` | + `structure?` field; + `structureRect()` helper |
| `src/world/building-collision.ts` | structure-aware passability (lawn walkable) |
| `src/render/iso/building-spec.ts` | spec from structure dims; round/stepped emit solid parts |
| `src/render/iso/iso-renderer.ts` | collapsed dispatch; place sprite at structure offset; flat-block fallback |
| `src/render/iso/iso-building.ts` | delete `drawIsoBuildingMassing` + roof helpers; add `drawIsoFlatBlock`; use `HEIGHT_UNIT_PX` |
| `src/render/iso/iso-barrier.ts` | use `HEIGHT_UNIT_PX` from scale-contract |
| `src/core/types.ts` | `BuildingRenderMode = 'auto' \| 'fallback'` |
| `src/dev/DebugOverlayPanel.ts` | 2-option Building Render select |
| `src/assetgen/producers/building-producer.ts` | human-height door trait in the brief |
| `src/assetgen/massing-guidance.ts` | DELETE |
| `src/game/frame-renderer.ts` | drop guidance-preview wiring |
| `src/ui/building-info-panel.ts` | sprite-only (drop guidance toggle) |
| `src/world/building-presets.ts` | cottage `structure` (2×2 yard) |
