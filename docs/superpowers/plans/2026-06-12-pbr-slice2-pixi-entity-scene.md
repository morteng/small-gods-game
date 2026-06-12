# PBR Slice 2 — PixiJS entity scene (parity)

> Implementation plan for Slice 2 of the [PBR sprite stack epic](../specs/2026-06-09-pbr-sprite-stack-design.md).
> Scope decision (user, 2026-06-12): **migrate the whole y-sorted entity pass** to a
> PixiJS scene now — buildings, vegetation, decorations, barriers, AND NPCs (NPCs as
> plain unlit billboards; their generative 3D-to-sprite pipeline comes later). The
> original "buildings-only stacked layer" was rejected because the iso renderer
> y-sorts all entity kinds into ONE interleaved painter's pass — a buildings-only
> WebGL canvas would break NPC↔building occlusion until full migration.
> Long-term: every object kind (trees next) gets a parametric-3D → PBR-sprite
> generative pipeline feeding this scene.

## Architecture

**Neutral draw list, two executors — parity by construction.**

1. `buildEntityDrawList(rc, bounds)` (`src/render/iso/entity-draw-list.ts`) — pulls the
   entity query + y-sort + source-pick + ALL placement math (anchors, billboards,
   `worldToScreen`) out of `createIsoRenderMap`'s inline loop, returning screen-space
   draw commands:
   - `{ t: 'image', src, frame?, dx, dy, dw, dh }` — sprites/billboards (building art,
     NPC sheet frames, tree sheet columns, deco art). `frame` = source sub-rect.
   - `{ t: 'poly', points, color }` — barrier slabs, flat-block faces, canopy
     triangles/squares, trunks.
   - `{ t: 'circle', cx, cy, r, color }` — round canopies, NPC fallback dots.
2. `executeDrawListCanvas(ctx, items)` (`src/render/iso/draw-list-canvas.ts`) — the
   current behavior, relocated. `imageSmoothingEnabled = false`, integer positions
   already baked into items by the builder.
3. `PixiEntityLayer` (`src/render/pixi/pixi-entity-layer.ts`) — lazy
   `import('pixi.js')` (own Vite chunk; never loads if WebGL path inactive), offscreen
   WebGL canvas sized at device resolution, NEAREST scale mode, pooled sprites keyed
   by draw-list index, one shared `Graphics` for poly/circle items, texture cache
   `WeakMap<source, Map<frameKey, Texture>>`.
4. Composite: the iso renderer (when the layer is ready) executes the draw list on
   Pixi, then blits `layer.canvas` into the main Canvas2D context **between terrain
   and overlays** via one `drawImage` with an identity transform (same-task after
   `renderer.render()`, so the WebGL buffer is readable; `preserveDrawingBuffer: true`
   as belt-and-braces). One DOM canvas → input handling, overlays, HUD, divine
   effects, minimap all untouched. Z-order identical by construction.

**Camera parity.** The draw list is built in *world-screen* space (the same space the
current entity loop draws in, inside the `scale(z) ∘ translate(snap)` transform). The
Pixi stage applies exactly that transform: `stage.scale = dpr·z`,
`stage.position = dpr·round(-camera.x·z), dpr·round(-camera.y·z)` — mirroring
`iso-renderer.ts`'s pixel-snap math (kept in one shared pure helper,
`isoStageTransform()` in `entity-draw-list.ts`, unit-tested against the ctx math).

**Fallback & toggle.** If `import('pixi.js')` or WebGL init fails → permanent
session fallback to the Canvas2D executor (same draw list). Dev toggle
`devMode.entityRenderBackend: 'auto' | 'canvas'` (auto = Pixi when ready). No page
reload needed — the executor choice is per-frame.

## Steps

1. **Extract pure primitive generators** — `flatBlockQuads()`, `barrierQuads()`,
   vegetation-placeholder primitives → emit draw items instead of ctx fills. Golden
   tests pin the emitted geometry equals today's vertex math.
2. **`entity-draw-list.ts`** — move the entity loop (query/partition/y-sort/pick)
   from `iso-renderer.ts` into the builder; builder calls the placement math currently
   in `drawIsoBuildingSpriteCore` / `drawIsoNpc` / `drawIsoVegetation` /
   `drawIsoArtBillboard` (refactored to return items). Unit tests: placement of each
   kind matches the current functions' coordinates (reuse existing test fixtures).
3. **Canvas executor** — `draw-list-canvas.ts`; `createIsoRenderMap` switches to
   builder + executor. Full suite must stay green (behavioral no-op).
4. **`PixiEntityLayer`** — init/resize/destroy, stage transform, pooled executor,
   texture cache. Pixi-API surface kept thin behind small interfaces so pool/cache
   logic is unit-testable with fakes (no WebGL in jsdom).
5. **Wire-up** — `game.ts` constructs the layer (fire-and-forget init), threads it
   through `RenderContextDeps`/`RenderContext`; iso renderer composites when ready.
   Dev toggle in dev-mode panel. `resize()` keeps layer canvas at canvas size.
6. **Verify** — full suite + build; in-browser parity eyeball via dev loop
   (`__debug.grab()` Canvas2D vs Pixi on Verdant Vale + Render-Bench kinds), FPS
   check in the debug HUD.

## Tests & guards

- Golden geometry tests for the primitive generators (step 1).
- Placement-parity unit tests for the draw-list builder (step 2).
- `isoStageTransform` vs ctx-transform equivalence test.
- Texture-cache + sprite-pool unit tests with fake Pixi objects.
- `no-three-in-bundle` stays green (PixiJS ≠ three/gl; guard comment updated to name
  PixiJS as the sanctioned WebGL backend).
- New guard: `pixi.js` must only be imported dynamically (keeps it out of the main chunk).

## Non-goals (later slices)

- Lighting/shaders (Slice 3+) — this slice renders albedo only, pixel-identical.
- Moving terrain or overlays/UI off Canvas2D.
- NPC generative sprites ([[project-generative-npc-system]]).
