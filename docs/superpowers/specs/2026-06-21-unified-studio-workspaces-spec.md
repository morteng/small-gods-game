# Unified Studio — Workspaces, Galleries & Professional Controls

**Status:** in progress (Shell + Gallery landed 2026-06-21). Spec for the larger surface.
**Owner:** studio epic ([[project-unified-studio]]).

## Thesis

The studio is not "Object mode" and "World mode" — it is **one navigator over the
content graph × a swappable center stage**. Object and World are two zoom levels of
the same thing (the world *contains* settlements *contain* buildings; the catalogue
*is* the set of things that can appear in a world). The galleries (arboretum / zoo /
building gallery) are a third archetype: a **contact sheet** that renders many
isolated subjects at once. Everything shares one chrome, one catalogue/selection
model, and the two existing render seams (`composeStructure` for an isolated subject,
the GPU render map for the live world).

Three center-stage archetypes:
1. **Inspect** — single subject on a turntable (the existing object editor).
2. **Gallery** — a grid of many subjects (NEW; arboretum/zoo/building-gallery are presets).
3. **World** — live terrain + drill-down (the existing world browser).

## Slice plan

### S1 — Shell → workspace registry ✅ (2026-06-21)
`mountStudio` (`src/studio/studio.ts`) generalized from a hardcoded 2-mode bar to a
data-driven `WORKSPACES` registry. Each workspace is `{ id, label, mount(host, ctx,
arg) → StudioHandle }`; the shell renders one button per entry and swaps the center
host with no page reload. A shared `ctx.open(id, arg)` lets workspaces hand off
(World "Edit in studio" → Object; a Gallery cell → Object). `?studio=` routing:
`world`→World, `gallery`→Gallery, `arboretum`→Gallery(plant), `buildings`→
Gallery(building), `<kind>`→Object(kind), bare→Object. New workspaces (Zoo) are one
registry entry.

### S2 — Gallery workspace ✅ (2026-06-21)
`src/studio/gallery-studio.ts`. Two display modes share one grid:
- **Sheet** — one thumbnail per matching catalogue entry at its default variant.
  Class chips (All/Buildings/Flora/Props/Terrain) + free-text search. Filter to
  plants → **arboretum**; to buildings → **building gallery**.
- **Matrix** — pick one building/prop subject + one variant axis (era / wealth /
  quality / condition / lifecycle stage) → render that subject swept across every
  value of the axis, side by side.

Thumbnails reuse the object editor's geometry path exactly: `synthesizeBlueprint`/
`resolveAsset` → `toGeometry` → `composeStructure` → `structureResultToPack`, then a
CPU 2D blit of the lit massing (no GPU scene per cell). Rendering is lazy
(`IntersectionObserver`, 300px rootMargin), concurrency-capped (3), and every composed
pack is cached by blueprint JSON so re-filtering is instant. Click a cell → `ctx.open
('object', type)`. Verified live: 26 flora + props + terrain bake at default; a
`parish-church` era sweep renders primordial→current with real material progression.

**Known v1 limits:** matrix sweeps are `resolveAsset`-backed (building/prop only);
flora/terrain show only the default thumbnail (their cultivars are already distinct
catalogue rows in the sheet). Thumbnails are unlit-massing grey/material — no img2img
painted overlay yet (RESEED FREEZE). 2-axis (row×col) matrix is single-axis for now.

### S3 — Zoo workspace ⬜
NPC viewer. NPCs are LPC **sprite sheets**, not `composeStructure` geometry, so the
Gallery's render adapter must branch: building/flora → compose a pack; NPC → draw LPC
frames. Natural matrix axes: `action (idle/walk/worship/combat/hurt) × direction (4)`.
Likely a sibling workspace reusing the grid/lazy-bake machinery with an LPC cell renderer.

### S4 — Layers panel + `RenderContext.layerMask` ⬜
World-stage layer toggles: terrain / water / roads / rivers / buildings / flora / npcs
/ connectome / labels. Today buildings/flora/npcs all flow through one y-sorted entity
draw list (`entity-draw-list.ts`) and terrain/water are fixed passes. Add a `layerMask`
to `RenderContext` honored by (a) the draw-list builder per entity-kind and (b) the
terrain/water passes. Benefits the live game dev loop too, not just the studio. The
`?connectome` flag is the proof-of-pattern.

### S5 — Terrain render modes ⬜
Terrain-field shader variants keyed by a uniform enum: `textured` (default) · `contour`
(iso-height lines) · `hypsometric` (elevation ramp) · `biome` (flat region colours) ·
`slope`/`normal` (debug) · `wireframe`. One enum in `src/render/gpu/terrain-field.ts` +
shader branch; a Display-popover control in the studio toolbar.

## Decisions

- **Studio chrome stays DOM.** It's a dev/pro tool, not shipped player UI — keep it out
  of the WebGPU-native UI epic. DOM gives free scrollbars, text inputs, resizable docks.
- **Galleries thumbnail; never live-GPU per cell.** Hundreds of lit turntables would
  tank the frame. Bake a 2D blit; open the focused subject in Inspect for full GPU.
- **Galleries are ONE feature.** Arboretum/zoo/building-gallery = the Gallery workspace
  with a preset filter, not three features.
