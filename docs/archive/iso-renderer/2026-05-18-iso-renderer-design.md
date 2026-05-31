# Iso Renderer — Design Spec

**Status:** Design (2026-05-18) — pending plan + implementation
**Author:** brainstormed via Claude + Morten
**Related:** [TECH_SPEC.md](../../TECH_SPEC.md), [Terrain overhaul roadmap](../plans/2026-05-16-terrain-overhaul-roadmap.md)

## Summary

Add a second renderer, dimetric 2:1 isometric at 128×64 tile size, behind a `render.mode: 'topdown' | 'iso'` flag. Keep the existing top-down renderer fully intact and default. Iso renderer is a near-1:1 structural mirror of the top-down renderer: same `RenderContext` input, same three-phase pipeline (terrain → Y-sorted entities → overlays), only the projection math and asset atlases differ. Logical world data (square tile grid, sim, snapshots, save format) is unchanged. Ships dev-only first; flag-flip to user-visible only after the MVP iso asset set lands.

## Goals

- Iso renderer reaches visual parity with top-down on the same RenderContext.
- Top-down stays the default, fully functional, throughout — Spec C and Spec D continue on `main` unaffected.
- Iso asset pipeline reuses the existing PixelLab service + LPC palette anchor for color coherence during the transition.
- Logical/sim layer untouched. Snapshot/timeline (Spec B), event log, scheduler all renderer-agnostic.

## Non-goals

See "Out of scope" below for the full list. Key non-goals: no sim changes, no save format changes, no minimap iso, no LPC sprite migration, no shader/normal-map lighting, no WebGL/WebGPU.

## Architectural decisions (locked during brainstorm)

| Decision | Choice |
|---|---|
| Projection | Dimetric 2:1 (classic iso) |
| Tile pixel size | 128 × 64 (diamond) |
| Rollout | Flag-gated parallel renderer (`render.mode`) |
| Logical grid | Stays square; only render differs |
| Engineering approach | "Classic painter's iso" — Canvas 2D, no bake, no shaders |
| NPC directions | 4 (NE / SE / SW / NW) |
| NPC walk frames per direction | 4 (idle + 3) |
| MVP art scope before flag-flip | Terrain + buildings + NPCs + trees |
| Asset gen cadence | Trickle (progressive PRs), not one big batch |

## Architecture & module boundaries

```
src/render/
  renderer.ts            ← unchanged top-down (default flag value)
  iso/
    iso-renderer.ts      ← entrypoint, mirrors renderer.ts surface
    iso-projection.ts    ← (x,y,z) ↔ screen math; mouse picking
    iso-camera.ts        ← pan/zoom; same Camera type, iso-aware
    iso-terrain.ts       ← diamond terrain pass (47-blob variants in iso)
    iso-ysort.ts         ← Y-sort bucket + paint order
    iso-sprites.ts       ← 4-dir sheet lookup, building rooftop draw
    iso-overlay.ts       ← void veil, sim overlay, sigils in iso
    iso-atlas.ts         ← iso tile/sprite atlas loader
```

- `iso/` is the boundary. Nothing outside `iso/` learns iso math; nothing inside learns top-down.
- `game.ts` selects `renderMap` via dynamic import based on `settings.render.mode`. Both exports share the signature `(ctx: CanvasRenderingContext2D, rc: RenderContext) => void`.
- `RenderContext` shape is unchanged. iso reads the same `npcs`, `buildings`, `tileGrid` the top-down renderer reads today.
- `AssetManager` and `PixelLabService` each gain one new method (load iso atlas / generate iso asset); existing methods unchanged.

## Projection math

Logical world: square grid `(tx, ty)` in tile coords, `z` for entity height.

```
W = 128, H = 64
sx = (tx - ty) * W/2 + originX
sy = (tx + ty) * H/2 - z + originY
```

`originX` centers the diamond horizontally in canvas. World pixel bounds: `(MAP_W + MAP_H) * W/2` × `(MAP_W + MAP_H) * H/2`. For 128×96 → 14,336 × 7,168 px, within Canvas 2D limits.

**Inverse for tile picking** (foot of cursor, ignores z):

```
fx = (sx - originX) / (W/2)
fy = (sy - originY) / (H/2)
tx = floor((fx + fy) / 2)
ty = floor((fy - fx) / 2)
```

**Entity picking** uses a per-frame hit list of drawn sprite screen-bboxes maintained by `iso-ysort.ts`; picking walks in reverse paint order. Same dispatcher pattern `ui/overlay-dispatcher.ts` uses today, just with iso-bboxes.

**Visible-tile culling.** Inverse-project the four canvas corners → bounding tile quad → iterate only that quad. Same culling shape as top-down's bbox cull, rotated.

## Camera

`iso-camera.ts` exposes the same `Camera { x, y, zoom }` shape as `render/camera.ts`. `x,y` are in iso-screen pixels. Pan/zoom handlers in `ui/controls.ts` need no changes. Zoom range: **0.5×–4×** (lower minimum than top-down's 1× because the iso world is physically wider). Camera state is namespaced per render mode in localStorage so a mode switch doesn't apply a topdown camera to iso (or vice versa).

## Render pipeline

Three phases, same structure as `render/renderer.ts`:

### Phase 1 — Terrain (`iso-terrain.ts`)

Iterate visible tiles in iso paint order: outer loop `i = 0..(MAP_W+MAP_H-2)`, inner walks the anti-diagonal `tx+ty == i`. For each tile, look up the 47-blob variant (same `blob-autotiler.ts` output, unchanged) and stamp the corresponding iso diamond. Realized / realizing / void state still gates draw: void tiles skipped; realizing tiles fade as today, just on diamond stamps.

### Phase 2 — Y-sorted entities (`iso-ysort.ts`)

Single bucket: NPCs, buildings, trees, decorations, river fragments, road overlays. Sort key: `(tx + ty, z, kindPriority)` ascending. Paint back-to-front. For a multi-tile building, `tx + ty` is taken from its back-most footprint tile so things in front of the building paint over it correctly.

### Phase 3 — Overlays (`iso-overlay.ts`)

Past-veil (Spec B), sim overlay (belief heatmap), spirit sigils, selection ring (iso diamond ring under picked tile). Screen-space over world, semantics unchanged.

### Sprite anchor convention

Each sprite declares an anchor pixel that lines up with its tile center.

- Terrain: diamond center
- NPCs: bottom-center
- Buildings: front-corner of footprint at ground level

`iso-sprites.ts` owns anchor lookup + `drawSprite(ctx, sprite, tx, ty, z)`.

### Perf budget item (flagged)

At full zoom-out on a dense world (~500 entities + thousands of trees), the Y-sort bucket sort + paint is the likely bottleneck. Target: 60fps on the reference machine. If we miss, that triggers the deferred Approach B (OffscreenCanvas terrain bake) as a follow-up spec, not as part of this one.

## Asset pipeline

### Directory layout

```
public/sprites/iso/
  terrain/<type>-blob47.png      ← 47-variant blob atlas per terrain type
  buildings/<template>.png       ← one file per BUILDING_TEMPLATE, footprint + roof
  characters/<class>.png         ← 4 dirs × 4 frames = 16-cell sheet per character class
  trees/<variant>.png            ← static, 1 cell each
  decorations/                   ← procedural via PixelLab, cached in IndexedDB
```

Atlas coordinates live in `iso-atlas.ts`, sibling to today's `terrain-atlas.ts`.

### PixelLab integration

`src/services/pixellab.ts` gains one method: `generateIsoAsset(query)`. The existing `STYLE_RECIPE` extends with a view-angle parameter (PixelLab's named view-angle option; confirm exact field name against current API at call-site). Palette anchor stays `lpc-anchor.png` so iso assets are color-coherent with leftover LPC art during transition. PixelLab's rotation feature emits all 4 directions per character in a single call. IndexedDB cache (`smallgods.pixellab` DB, existing) keys assets by hash of `(prompt + style)` — no schema change needed; iso assets just hash differently.

### MVP asset budget (rough order-of-magnitude)

| Asset | Count | Notes |
|---|---|---|
| Terrain blob variants | 6 × 47 = 282 | Largest cost. Batched, hand-touched. |
| Buildings | 8 | One per `BUILDING_TEMPLATE`. |
| Characters | ~8 | One sheet (4-dir × 4-frame) per class. |
| Trees | 5 | One per existing tree variant. |
| Decorations | procedural | On-demand via existing flow. |

### Fallback

Until `public/sprites/iso/*` files exist, iso renderer falls back to:
- Flat-color diamond stamps from `TILE_COLORS` for terrain
- Extruded colored boxes for buildings
- Colored circles with iso shadow for NPCs

This keeps the iso flag functional from day one — ugly but functional.

## Flag & mounting

### Setting

`render.mode: 'topdown' | 'iso'` lives in the existing settings store (`ui/settings-panel.ts`). Default `'topdown'`. **Until flag-flip PR**, the setting is hidden from the settings panel — togglable only via `localStorage.setItem('smallgods.render.mode', 'iso')` or a hidden dev panel entry. After flag-flip, exposed as a normal setting.

### Mounting

`game.ts` selects the renderer at construction time:

```ts
const renderMap = settings.render.mode === 'iso'
  ? (await import('@/render/iso/iso-renderer')).renderMap
  : (await import('@/render/renderer')).renderMap;
```

Dynamic import keeps iso code out of the topdown bundle until flag flips. Renderer switch requires page reload — no per-frame hot-swap.

### HUD / controls

Unchanged. `ui/controls.ts`, `ui/chrome.ts`, time chip/bar, overlay dispatcher are mode-agnostic. Minimap (`render/minimap.ts`) stays top-down regardless of main renderer mode.

## Testing strategy

| Module | Coverage |
|---|---|
| `iso-projection.ts` | ~30 tests — round-trip projection on a grid, anchor alignment per sprite type, edge tiles at all 4 corners |
| `iso-ysort.ts` | ~15 tests — paint order: NPC behind building, multi-tile building with NPC walking through, tree/decoration/NPC interleave. Snapshot the sort key sequence for fixed scenes |
| `iso-terrain.ts` | ~10 tests — visible-tile culling, blob-variant lookup reuses top-down fixtures |
| `iso-renderer.ts` integration | ~5 tests — render canned RenderContext to OffscreenCanvas, assert no throws + expected `drawImage` call count (not pixels) |
| `iso-camera.ts` + picking | ~10 tests — click → tile, entity picking with overlapping bboxes returns front-most |

Pixel-perfect output not tested in this spec (too brittle; separate concern). PixelLab gen flows already covered in `tests/unit/pixellab.test.ts`; iso reuses code paths.

**Regression safety net.** Existing 576 tests stay green throughout — none depend on top-down renderer specifics beyond the unchanged `RenderContext` shape. Iso adds ~70 tests; target ~640+ at flag-flip.

**Manual smoke per PR.** Dev server with iso flag, default world seed, walk camera, pick an NPC, walk an NPC behind a building. Documented in each PR description.

## Out of scope (explicitly)

- **Approach B — OffscreenCanvas terrain bake.** Fold in only if Y-sort + terrain pass drops below 60fps at full zoom-out. Separate spec.
- **Approach C — WebGL/WebGPU iso pass.** Reserved as the bridge to the icegame compute-shader terrain dream. Out of this spec entirely; revisit only if a "reactive terrain" spec gets written.
- **Iso re-art of LPC character sheets.** LPC sprites remain top-down-only. Iso character set is generated fresh; no migration pipeline.
- **Sprite-studio iso authoring mode.** Iso assets via the existing PixelLab service flow + library, manually triaged.
- **Normal-map iso lighting / shader effects.** Iso ships flat-shaded. Phase 6 of terrain roadmap (normals) stays deferred.
- **Alternate projections.** Hex, oblique 3/4, true 30° rejected during brainstorm. Not revisited.
- **Sim / save format changes.** None. Logical grid stays square; snapshots, scheduler, event log, world.query untouched.
- **Spec C (Branching) coupling.** Spec C continues on `main` against top-down. No changes to Spec C from this work.
- **Spec D (Cinematic + void) iso treatment.** Out. When iso becomes the default, Spec D's iso void treatment needs its own design pass — flagged here but not pre-designed.
- **Minimap iso treatment.** Minimap stays top-down regardless of main renderer mode.
- **Touch / mobile iso UX.** Desktop-first. Mobile parity is a separate spec if needed.

## Rollout plan (sketch — formal plan to be written by writing-plans skill)

1. PR 1 — scaffold `src/render/iso/` modules with fallback (flat-color diamonds, colored boxes, colored circles). Dev-only flag. Tests for projection + camera + Y-sort.
2. PR 2 — iso terrain art (PixelLab batch for 6 base types × 47 variants).
3. PR 3 — iso buildings.
4. PR 4 — iso characters (NPC 4-dir × 4-frame sheets).
5. PR 5 — iso trees + decorations.
6. PR 6 — overlay treatments in iso (past-veil, sim heatmap, sigils, selection).
7. PR 7 — flag-flip: expose `render.mode` in settings panel; switch default if desired (separate decision).

Each PR: green tests, green `npm run build`, manual smoke per testing strategy above.

## Open questions deferred to plan

- PixelLab API exact field name for the view-angle / rotation parameter — confirm at PR 2 call-site against the live API.
- Iso void treatment specifics — explicitly deferred to a Spec D revision.
