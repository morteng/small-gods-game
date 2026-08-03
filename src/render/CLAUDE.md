# Rendering (WebGPU-only)

**WebGPU is the only scene renderer.** Canvas2D 2D-ctx is kept only for overlays/compositing; `pixi.js` must never be imported (guard test). A device with no WebGPU gets an honest "WebGPU required" overlay.

- **Terrain** = buffer-driven GPU heightfield (`render/gpu/terrain-field.ts`; shader generates + lifts the grid). Height = `baseSeedHeight ⊕ deformations`. Roads/rivers carve through ONE analytic feature-SDF (`render/gpu/feature-geometry.ts`); earthworks/pads/walls write the shared deformation channel (`world/terrain-deformation.ts`). Mesh viewport-culled.
- **Entity pass** = y-sorted draw list (`render/iso/entity-draw-list.ts`) run by the WebGPU scene (`render/gpu/gpu-scene.ts`), instanced; foot-z terrain lift for placement parity.
- **Banded lighting**: building sprites are `SpritePack`s (albedo + co-registered normal/material from IDB cache / vendored library / `composeStructure`); ambient + one directional sun, diffuse quantized into bands, AO from material.G, projected cast shadows via stencil-union.
- **UI** = WebGPU-native immediate-mode (`render/ui/`) — the ONLY chrome. Legacy chrome retirement (UI v3 P6) deleted `Game.barebones`/`?legacyui`/`FrameRenderer.legacyChrome`/`GameUi.suppressLegacyChrome()`; `debugHud` and the dev hit-test tooltip are the only DOM surfaces left, both `?dev`-only.
- **Sky loading↔world transition** (UI v3): a translucent cloud-parting/billowing overlay drawn straight over the already-composited frame — own blend pipeline (`createSkyBackdropOverlayPipeline`, `gpu-pipelines.ts`) so it never disturbs the opaque idle-title `createSkyBackdropPipeline`; `GpuScene.passSkyOverlay` draws it when `Game` (via `src/game/sky-transition.ts`'s pure phase/coverage curves) passes a `{coverage, timeSec}` uniform, absent/null otherwise.
- **Camera**: pan (drag) + zoom ladder (integer / 1-over-integer rungs, pixel-snapped origin). **The camera pans in ISO-SCREEN space** — anything framing a tile must project via `render/iso/iso-projection.worldToScreen`, never the flat `tile*TILE_SIZE` mapping.

## Gotchas

- **Post-gen in-place `tile.type` writes MUST call `bumpTilesRev(map)`** (`src/core/tile-rev.ts`) — the terrain color memo (`packColorFieldMemo`) keys on `map.tilesRev`; without it the GPU paints the old ground until reload.
- **Sprites paint OVER terrain** — below-grade geometry is NOT buried, it hangs over the ground. Ground fit is the terraced footing's job (`barrier-deformation.ts`).
- **`GpuScene.uploadTexture` memoizes by CANVAS IDENTITY** (a `WeakMap` keyed on the canvas object). Pixels painted into an already-uploaded canvas NEVER reach the GPU — they just don't draw, with no error. Anything baked lazily must land on a **companion canvas whose identity first appears when it is complete** (`render/lpc/rig-rows.ts`), never appended to a published sheet.
- **WGSL comment backticks BREAK the build.**
- Zoom-LOD gates key on CAMERA zoom (`camZoom`), never `xform.sx`.
- `__renderProfile` OVERSTATES water cost (it runs camera-less) — use `__renderTrace`. Headless runs have no WebGPU at all.
