# Map UI Epic — Zoom-to-Fit, Complete Selection Outlining, POI + Biome Layers — Design

**Date:** 2026-06-03
**Status:** Approved (scope); building slice-by-slice
**Builds on:** the focus-camera fix + `selection-outline.ts` glow (merge `ff87a8d`) and the committed rendering direction A — harden a renderer-agnostic seam, stay Canvas2D (see memory `project-rendering-direction`).

## Goal

Move toward a fully functional map UI in three independently-shippable slices, each working in **both render modes** (iso default + topdown): (1) zoom-to-fit the whole map, (2) complete selection outlining, (3) toggleable POI + biome info layers with outlines and rendering-only blend zones. The NPC conversation/whisper UI is a separate later push, out of scope here.

## Decisions (from scoping)

- **Order:** 1 → 2 → 3, merge each slice as it lands.
- **Blend zones:** rendering-only. A translucent overlay; soft gradient bands where biomes meet. Does **not** alter terrain tiles, `state.biomeMap` contents, or the sim. Fully reversible / toggleable.
- **Render modes:** every slice works in iso and topdown.
- **Canvas2D**, per direction A. No renderer rewrite; these are overlay/camera features that the eventual `RenderViewModel` seam will inherit.

## Shared context (code reality)

- Camera transforms: topdown `worldToScreen(cam,wx,wy,TILE_SIZE)` in `render/camera.ts`; iso `worldToScreen(tx,ty,z,ox,oy)` in `render/iso/iso-projection.ts` (tiles drawn **centered** at the projection, ±`ISO_TILE_W/2`,±`ISO_TILE_H/2`). Overlays draw in **raw screen space** after the renderer restores its transform, so camera + zoom are applied manually (see `selection-outline.ts`).
- Zoom clamps: topdown `zoomAt` → `[0.25, 8]`; iso `clampIsoZoom` → `[0.5, 4]`. Floors are too high to fit a large map.
- Biome data: `classifyBiomes` produces a per-cell `BiomeMap` at gen time; it is used for brushes then dropped. `state.biomeMap` exists but is **never populated at runtime** — Slice 3 fixes this. `biomeRegions(biomeMap)` flood-fills connected components → bounding-box `BiomeRegion[]`.
- POIs: `state.worldSeed.pois[]` with optional `region {x_min,x_max,y_min,y_max}` and `position {x,y}`; `POI_ZONE_RULES[type].radius` gives a zone radius.
- Selection: `Inspector.getSelection()` is the unified source; `selection-outline.ts` already resolves tile/entity/decoration/spirit/POI → a tile-rect and draws a pulsing glow in both modes.

---

## Slice 1 — Zoom-to-fit + zoom controls

**What:** Fit the entire map in the viewport in one action, and loosen the zoom floor so the user can also reach that level manually.

**Architecture**
- New `src/render/fit-camera.ts`: `fitCameraToMap(camera, mapTilesW, mapTilesH, viewW, viewH, mode, marginFrac = 0.92)`.
  - **topdown:** world span = `mapTilesW*TILE_SIZE × mapTilesH*TILE_SIZE`. `zoom = min(viewW/spanW, viewH/spanH) * margin`, clamped to the (loosened) floor. Then center on the map's pixel center via `centerOn`.
  - **iso:** the map projects to a diamond. Span `W = (mapTilesW+mapTilesH)*ISO_TILE_W/2`, `H = (mapTilesW+mapTilesH)*ISO_TILE_H/2`. `zoom = min(viewW/W, viewH/H)*margin`, clamped. Center on the iso center = projection of tile (`mapTilesW/2`,`mapTilesH/2`) via `centerOnTile`.
- Loosen floors: topdown min `0.25 → 0.05`, iso min `0.5 → 0.1` (keep maxes). Fit result also clamped to the new floor.
- **UI:** a small camera-controls cluster (bottom-right of the canvas): `＋` zoom-in, `－` zoom-out, `⊡ Fit`. Buttons, not shortcuts (per the user's UX rule). The Fit button calls `fitCameraToMap` with the live viewport + render mode. **Do not** auto-fit on world load — the game opens cradle-style (zoomed on the small realized bubble); fit is on demand only.

**Testing**
- `fitCameraToMap` (pure): for a known map + viewport, the four map corners all fall within `[0,viewW]×[0,viewH]` after applying the resulting camera, in both modes; and the map center projects to the viewport center. Test at a map large enough to force `zoom < oldFloor` (proves the floor was loosened / fit isn't over-clamped).
- Zoom-clamp constants updated; existing camera tests still green.

---

## Slice 2 — Selection outlining, complete

**What:** Make the outline cover every selectable thing correctly, plus a faint hover outline distinct from the bright selection.

**Architecture (extends `selection-outline.ts`)**
- **Footprint-aware resolve:** when the selected entity is a building (or any entity whose kind/template declares a footprint > 1×1), `resolveOutlineRect` returns the full footprint rect, not 1×1. Source the footprint from the building template (`getBuildingTemplate`) / entity-kind def. Non-footprint entities (npc, vegetation, deco) stay 1×1.
- **All entity kinds:** verify npc / vegetation / decoration / animal / building all resolve; add any missing kinds to the resolver switch coverage (the `Selection` union is already exhaustive; this is about the entity→rect lookup).
- **Hover outline:** in dev mode, the frame loop already hit-tests the hovered tile for tooltips. Reuse that hit to draw a **faint, non-pulsing** outline (lower alpha, no/!low shadow) at the hovered target, skipped when it equals the current selection. Add `drawHoverOutline(ctx, hit, camera, mode)` (or a `variant: 'select'|'hover'` param on the existing drawer) so the two share the diamond/rect geometry (DRY).

**Testing**
- `resolveOutlineRect` returns the footprint rect for a building entity (mock template w×h) and 1×1 for an npc.
- The hover drawer skips when hover === selection; draws (stroke/rect call recorded) otherwise. Reuse the stub-ctx pattern from `selection-outline.test.ts`.

---

## Slice 3 — Map info layers: POI + biome, with outlines & blend zones

**What:** Two toggleable overlay layers that explain the map: POI zones-of-influence and biome regions, the latter with organic outlines and soft blend bands at borders.

**Architecture**
- **Plumbing (dependency):** persist the biome grid. Thread the generated `BiomeMap` out of `map-generator` (already computed) and set `state.biomeMap` in `bootstrap-world`. (Confirm both gen paths set it; null-safe everywhere downstream.)
- **Biome colors:** a `BIOME_COLORS: Record<string,string>` (new, in `core/constants.ts` or `map-layers.ts`) — one accent per biome enum value, with a sensible default.
- New `src/render/map-layers.ts`:
  - `drawPoiLayer(ctx, pois, camera, mode)` — for each POI: outline its `region` (rect→diamond like the selection drawer) or, lacking a region, a radius ring from `POI_ZONE_RULES[type].radius` around `position`; draw a small text label at the POI center. Distinct color (e.g. gold) + low alpha fill.
  - `drawBiomeLayer(ctx, biomeMap, camera, mode, opts)` — per **visible** tile (compute visible tile bounds from camera+viewport, reusing `visibleTileBounds` in iso / a topdown equivalent):
    - **Fill:** translucent `BIOME_COLORS[biome]` tint on each cell (organic, follows real shape).
    - **Outline:** for any cell whose 4-neighbour biome differs, stroke the shared edge — gives an organic biome border. (topdown: the cell's edge segment; iso: the corresponding diamond edge.)
    - **Blend zone:** border cells get a 2-stop gradient tint between their biome color and the differing neighbour's, over the shared edge band — the "soft transition." Rendering-only.
  - Both helpers draw in raw screen space (camera+zoom manual), mirroring `selection-outline.ts`.
- **Toggle + wiring:** add `showPoiLayer` / `showBiomeLayer` to `DevModeState` (alongside the existing overlay flags) and to the Debug-Overlay panel as checkboxes; `DevModeController.drawOverlays` calls the layer drawers when enabled. (These ride the existing dev-overlay system for now; promoting them to a player-facing map button is a later, trivial follow-up — note it, don't build it.)

**Performance:** the biome pass is O(visible tiles); cap by visible-bounds clamping (don't iterate the whole map). No per-frame allocation in the hot loop.

**Testing**
- `state.biomeMap` is populated after world bootstrap (non-null, correct length).
- `drawBiomeLayer` with a tiny 2-biome `BiomeMap` records: a fill per visible cell, and a border stroke only on cells adjacent to the other biome (assert border-cell count via the stub ctx). Off when the toggle is false.
- `drawPoiLayer` outlines a region POI and a radius for a position-only POI; label drawn at center.
- Toggle flags default false; `drawOverlays` invokes the layer only when its flag is set.

---

## Out of scope

- NPC conversation/whisper UI (separate Track-2 push).
- The `RenderViewModel` seam refactor (its own brainstorm/spec; these slices will migrate onto it later).
- Actually blending terrain tiles / changing world-gen (blend zones are rendering-only).
- Promoting the info layers from dev-overlay toggles to a player-facing map mode (trivial follow-up once the layers exist).
- Fixing the pre-existing iso mis-placement of the *other* debug overlays (belief heatmap/needs/mood use topdown projection unconditionally) — noted, separate.

## Cross-slice principles

- DRY the iso-diamond / topdown-rect geometry: selection outline, hover outline, POI outline, and biome borders should share small projection helpers rather than re-deriving the math.
- Every new drawer is a pure-ish function (ctx + data + camera + mode + nowMs), unit-tested with the stub-ctx pattern; no reliance on real canvas layout.
- Toggles are off by default; nothing changes the sim or terrain.
