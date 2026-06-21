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

### S3 — Zoo workspace ✅ (2026-06-21)
`src/studio/zoo-studio.ts`. A sibling of the Gallery with an LPC cell adapter:
- **Sheet** — a menagerie of every role (8) × N seeds, each a LIVING thumbnail
  (walk cycle facing the viewer). Click a cell → matrix for that role+seed.
- **Matrix** — pick a role + seed → that character across every action (walk /
  spellcast / thrust / slash / shoot / hurt) × 4 facings (hurt is non-directional).

Reuses the live renderer's exact path: `buildCharacterSpec(role, seed)` →
`getOrGenerateSheet` (async, globally cached by spec hash) → blit one 64px frame
(`LPC_ANIMATIONS`/`LPC_DIR_OFFSET` for the source rect). A single shared rAF (~8fps)
advances every ready cell, so the zoo breathes; an Animate toggle pauses it. Lazy
(IntersectionObserver) + concurrency-capped (3). Verified live: 32 menagerie cells
(8 roles × 4 seeds) bake to distinct characters; a soldier matrix renders all 21
action×facing poses, animating.

### S4 — World view renders buildings & trees + Layers panel ✅ (2026-06-21)
Two parts:
1. **Entity rendering.** The World workspace previously discarded the populated world
   from `generateWithNoise` (`{ map }`, then a fresh empty `new World(map)`) — so it
   only drew terrain + the connectome graph. Now it keeps `{ map, world }` (the world
   already carries building / flora / barrier entities from `placeSettlement` + biome
   brushes) and provides the two parametric art resolvers (`ParametricBuildingSource`/
   `ParametricPlantSource`) on the render context. Buildings render as grey lit massing
   (img2img is the funded-reseed path, OFF — same as the live game), trees as lit
   parametric flora. Verified: drilling into a settlement shows grey building massing +
   vegetation on textured terrain.
2. **Layers panel.** The whole layer-visibility system already existed
   (`src/render/layer-visibility.ts`; every pass checks `isLayerHidden(layer,
   rc.devMode)`; `DevModeState` carries `show*` flags) — the live game's Debug Overlays
   uses it. The World workspace just never passed a `devMode`. Added a Layers panel
   (Terrain / Roads / Rivers / Buildings / Trees & flora / Connectome) backed by a
   `Partial<DevModeState>` threaded into `rc.devMode`; the connectome overlay (a 2D
   pass) is gated by a local `showConnectome`. The frame loop reads both by reference,
   so toggles apply next frame with no invalidate. Verified causally: connectome toggle
   (overlay 20417→1782 px); buildings/trees toggles hide the grey massing.

NPCs aren't seeded in this view (no sim), so no NPC toggle yet — a follow-up if the
world view ever materialises a founder band.

### S5 — Terrain render modes ✅ (2026-06-22)
Terrain-field shader variants keyed by a uniform enum (the former `uPad0.x` slot,
now `uMode.x` — no buffer-size change). `TERRAIN_MODES` in
`src/render/gpu/terrain-field.ts` is the single catalogue: `textured` (0, default —
the shipped material-blend look) · `contour` (1 — the "vector" topographic map:
hypsometric fill + screen-constant iso-elevation lines, bold index contour every
5th) · `hypsometric` (2 — elevation ramp) · `biome` (3 — flat region colour) ·
`slope` (4 — flat→steep ramp) · `normal` (5 — geometry debug). The mode is
threaded `dev.terrainMode → buildTerrainField → terrainGlobalsFor →
packTerrainGlobals(b[2])` and branched in the terrain fragment (`terrain-wgsl.ts`);
the detail-patch pass shares that fragment, so the mode applies to the fine
patches identically. A **Terrain style** `<select>` in the World workspace's left
panel drives it (also exposed game-wide via `DevModeState.terrainMode`). Verified
live: normals show the per-cell surface + road/river incision, slope reads
flat-green→steep-red (Emberpeak crater bright red), contour rings the calderas.
Wireframe deferred (needs a line-topology pipeline or barycentric pass — the five
fragment modes cover the "vector / professional controls" ask).

**Detail-patch overlay (S4 companion).** A "Detail patches" toggle in the same
panel draws the adaptive sub-tile patch blocks (`computeDetailMask` →
`coalescePatches`, the SAME importance map the GPU detail pass instances) as green
iso quads over the terrain — so it's visible exactly where the renderer spends a
finer mesh (coasts / rivers / roads / steep slopes), at any zoom (the GPU patches
themselves only draw at zoom ≥ 2). Memoised per world; correctly absent over open
ocean.

### Dev/prod build separation ✅ (2026-06-21)
Dev tooling must not ship in distribution builds (user: "dev builds with dev
features and regular builds for just the game, for distribution"). A build-time
`__DEV_TOOLS__` flag (Vite `define` in `vite.config.ts`) is `true` in the dev server
(`command === 'serve'`) and in `--mode devtools` builds, `false` in a plain `vite
build`. `main.ts` guards both dev entry points behind it — the Studio (`?studio`) and
the `__game/__debug/__bus/__perf` window surface (extracted to `src/dev/expose.ts`) —
via DYNAMIC import, so the constant folds to `false` and Rollup drops the studio +
expose chunks from the distribution bundle. Scripts: `npm run build` → distribution
(clean game), `npm run build:dev` → with dev tools. Verified empirically: `vite build`
emits no studio/gallery/zoo/expose chunks; `--mode devtools` emits `studio-*.js` +
`expose-*.js`. The shipping game uses `game.bus` IN-PROCESS, so hiding the globals
costs it nothing. Future dev surfaces (in-`Game` dev panels, the bus-bridge) adopt the
same `__DEV_TOOLS__` gate.

## Decisions

- **Studio chrome stays DOM.** It's a dev/pro tool, not shipped player UI — keep it out
  of the WebGPU-native UI epic. DOM gives free scrollbars, text inputs, resizable docks.
- **Galleries thumbnail; never live-GPU per cell.** Hundreds of lit turntables would
  tank the frame. Bake a 2D blit; open the focused subject in Inspect for full GPU.
- **Galleries are ONE feature.** Arboretum/zoo/building-gallery = the Gallery workspace
  with a preset filter, not three features.
