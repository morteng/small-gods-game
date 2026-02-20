# Small Gods - Development Notes

## Game Concept

A god game inspired by Terry Pratchett's *Small Gods*. The player is a minor deity who must cultivate genuine belief among NPCs through indirect influence (whispers, omens, dreams, miracles). Rival spirits compete for the same followers. NPCs run on a programmatic simulation layer; an LLM "backfills" rich narrative whenever the player pays attention.

**Two-layer architecture:**
- **Sim layer** (always running) — NPC state: beliefs, needs, mood, relationships. Belief propagates along social graphs. Events (droughts, festivals, rival actions) shift NPC needs and create opportunities for divine intervention.
- **Narration layer** (on-demand) — LLM generates dialogue, scene descriptions, and dramatic moments from compact sim state when the player focuses on anything. Returns structured state deltas that feed back into the sim.

## Project Documentation

**Primary References:**
- **[TECH_SPEC.md](docs/TECH_SPEC.md)** - Complete technical specification (gameplay systems, architecture, data models)
- **[IMPLEMENTATION.md](docs/IMPLEMENTATION.md)** - Implementation plan with phases and task breakdowns
- **[TS Migration Design](docs/plans/2026-02-20-ts-migration-design.md)** - TypeScript migration design doc
- **[TS Migration Plan](docs/plans/2026-02-20-ts-migration.md)** - Detailed migration implementation plan

**Current Status:** Map system migrated to TypeScript with simple top-down renderer. Gameplay (Phases 7-11) not started.

## Tech Stack

- **TypeScript** ES modules, bundled by **Vite**
- **Canvas 2D** top-down colored-rectangle renderer (placeholder art)
- **WFC** (Wave Function Collapse) procedural map generation
- **Vitest** for testing (97 tests)
- Embeddable as iframe via `Game` class + postMessage API

## Architecture

```
src/
  main.ts              — Entry point, mounts Game into #app
  game.ts              — Game class (embeddable component)

  core/
    state.ts           — GameState interface + factory
    types.ts           — All type definitions
    constants.ts       — Tile sizes, colors, POI icons
    noise.ts           — Seeded RNG + noise functions
    schema.ts          — World seed validation + defaults

  map/
    map-generator.ts   — Map generation (WFC + noise)
    autotiler.ts       — Semantic-to-visual tile mapping
    chunk-manager.ts   — Chunked infinite maps (LRU cache)
    world-manager.ts   — Save/load worlds

  wfc/
    index.ts           — Re-exports
    tile.ts            — Tile definitions + adjacency rules
    cell.ts            — WFC cell state
    grid.ts            — WFC grid
    propagator.ts      — AC-3 constraint propagation
    solver.ts          — WFC solver with backtracking
    engine.ts          — 3-phase generation engine

  render/
    renderer.ts        — Top-down colored-rectangle renderer
    camera.ts          — Pan/zoom state and transforms
    minimap.ts         — Minimap rendering

  ui/
    controls.ts        — Mouse/keyboard input handlers

  embed/
    api.ts             — PostMessage API for iframe host
    mount.ts           — Mount game into arbitrary DOM container
```

## Rendering

Simple top-down 2D grid (placeholder for future art):
- Each tile = colored rectangle (green=grass, blue=water, brown=road, etc.)
- POIs = geometric shapes (circle=village, triangle=mountain, etc.)
- Camera: pan (drag) + zoom (scroll wheel) on canvas
- Grid lines shown at zoom >= 2x
- Minimap with viewport indicator

## Iframe Embedding

The game is designed to be embeddable in a secure iframe (for MCP UI):

```ts
import { mount } from './embed/mount';
const game = mount('#container');
await game.generateWorld();
```

- `Game` class: `new Game(containerElement, options?)` — mounts into any DOM element
- No `document.body` assumptions — everything scoped to container
- No inline event handlers — all `addEventListener`
- CSP-compatible — no dynamic code execution, no inline scripts
- PostMessage API for host communication
- Responsive to container size changes via ResizeObserver

## Key File Locations

| Purpose | File |
|---------|------|
| Entry point | `src/main.ts` |
| Game class | `src/game.ts` |
| State management | `src/core/state.ts` |
| Type definitions | `src/core/types.ts` |
| Game constants | `src/core/constants.ts` |
| Map renderer | `src/render/renderer.ts` |
| Camera transforms | `src/render/camera.ts` |
| WFC engine | `src/wfc/engine.ts` |
| Map generation | `src/map/map-generator.ts` |
| Autotiler | `src/map/autotiler.ts` |
| World seeds | `public/data/worlds/default.json` |
| World seed schema | `src/core/schema.ts` |

## Development

```bash
npm run dev        # Start Vite dev server
npm run build      # TypeScript check + Vite production build
npm test           # Run all tests (vitest)
npm run test:watch # Watch mode
```

## Gameplay Architecture (Phases 7-10, not yet started)

- NPC sim: personality traits, belief per spirit (faith/understanding/devotion), needs (safety/prosperity/community/meaning), social graph, event ring buffer
- Divine actions: whisper, omen, answer prayer, dream, miracle — each costs belief-power
- LLM backfill: ~500 token prompt → narrative + JSON state delta, target <200ms via high-speed inference
- Rival spirits: personality-driven programmatic actions, LLM-narrated when intersecting with player
- DM agent: background LLM (larger model, infrequent) that manages pacing, plot threads, rival coaching, escalation, and player modeling
