# TypeScript Migration + Simplified Renderer Design

**Date:** 2026-02-20
**Status:** Approved

## Goals

1. Migrate all JS to TypeScript ES modules bundled by Vite
2. Replace isometric AI-rendered tile system with simple top-down colored-rectangle renderer
3. Make the app embeddable in a secure iframe (for MCP UI)
4. Clean up all tech debt — no globals, no inline handlers, no dead code

## What Gets Deleted

~4,000+ lines of AI/tile rendering complexity:

- `public/js/ai-integration-v2.js` — fal.ai painting pipeline
- `public/js/ai-constants.js` — AI model configs, ADE20K colors
- `public/js/tile-renderer.js` — individual tile rendering for AI
- `public/js/tile-map-renderer.js` — Kenney tile composite rendering
- `public/js/decorations/DecorationRenderer.js` — procedural sprite drawing
- `public/js/decorations/DecorationPlacer.js` — biome-based placement
- `public/js/decorations/DecorationRegistry.js` — decoration definitions
- `public/data/decorations/*.json` — decoration data files
- `server.cjs` — Node.js API proxy for fal.ai
- `src/tilegen/` — tile generation pipeline
- `scripts/generate-*.cjs`, `scripts/render-*.cjs`, `scripts/test-*.cjs`
- `tiles/` directory — pre-rendered tile assets
- `public/tiles.html` — tile manager page
- Already-deleted files staged in git (prototypes/, public/src/, old scripts)

## What Gets Kept (migrated to TS)

- WFC engine (Tile, Cell, Grid, Propagator, Solver, WFCEngine) — ~1,077 lines
- State management (state.js) — cleaned up, typed
- Map generator (map-generator.js) — WFC + noise generation
- Autotiler (autotiler.js) — semantic-to-visual tile mapping
- ChunkManager — chunked infinite maps
- WorldManager — save/load worlds
- Editor (editor.js + editor-overlay.js) — merged into one module
- UI handlers (ui.js) — split into panels, controls, world-seed-modal
- Noise utilities (noise.js)
- World seed schema (Schema.js)

## New Module Structure

```
src/
  main.ts              — Entry point, mounts game into container
  game.ts              — Game class (embeddable component)

  core/
    state.ts           — Global state, typed
    types.ts           — All type definitions
    constants.ts       — Game constants (tile sizes, colors)
    noise.ts           — RNG + noise functions

  map/
    map-generator.ts   — Map generation (WFC + noise)
    autotiler.ts       — Semantic-to-visual tile mapping
    chunk-manager.ts   — Chunked infinite maps
    world-manager.ts   — Save/load worlds

  wfc/
    index.ts           — Re-exports
    tile.ts            — Tile definitions + adjacency
    cell.ts            — WFC cell
    grid.ts            — WFC grid
    propagator.ts      — Constraint propagation
    solver.ts          — WFC solver
    engine.ts          — 3-phase generation engine

  render/
    renderer.ts        — Simple top-down colored-rectangle renderer
    camera.ts          — Pan/zoom state and transforms
    minimap.ts         — Minimap rendering

  ui/
    panels.ts          — UI panel updates (stats, info)
    controls.ts        — Input handlers (mouse, keyboard, zoom)
    editor.ts          — Map editor (merged editor + overlay)
    world-seed-modal.ts — World seed editor modal

  embed/
    api.ts             — PostMessage API for iframe host
    mount.ts           — Mount/unmount into arbitrary DOM container

public/
  index.html           — Slim shell: div#game + script type=module
  css/                  — Modular CSS (kept as-is for now)
```

## Renderer Design

Simple top-down 2D grid:
- Each tile = colored rectangle (green=grass, blue=water, brown=road, etc.)
- NPCs = colored dots with name labels
- POIs = simple geometric icons (circle=village, triangle=mountain, etc.)
- Camera: pan + zoom on canvas
- ~200 lines total vs ~2,800 lines of isometric + AI rendering

## Iframe/Embed Design

- `Game` class: `new Game(containerElement, options?)` — mounts into any DOM element
- No `document.body` assumptions — everything scoped to container
- No inline event handlers — all `addEventListener`
- CSP-compatible — no dynamic code execution, no inline scripts
- PostMessage API for host communication (game state, commands)
- Responsive to container size changes via ResizeObserver

## Migration Strategy

Incremental, file-by-file, app stays runnable throughout:
1. Set up Vite + TS entry point, get blank app loading
2. Migrate leaf modules first (noise, types, constants — no dependencies)
3. Migrate WFC engine (self-contained cluster)
4. Build new top-down renderer
5. Migrate state, map-generator, autotiler
6. Migrate UI layer (panels, controls, editor)
7. Build embed/iframe shell
8. Delete all old files, update HTML
9. Update tests
