# Terrain System Overhaul — Roadmap

> **Master plan covering Phases 0–6.** Each phase has its own detailed plan doc, written just before that phase executes (so it benefits from what we learned in earlier phases).
>
> **Status (2026-05-16):** Phases 0, 1, 2a, 3 landed on `main`. Phases 2b, 4, 5, 6 deferred — see "Status & deferred work" section below.

**Goal:** Bring the terrain system to May-2026 best practice: simulation-driven rivers, agent-walker roads, hydraulic erosion, dual-grid overlay, offscreen baking, hierarchical WFC over POI zones, and tile-normal lighting — without rewriting the parts that already work (blob-47 main terrain, noise pipeline, POI placement).

**Architecture principle:** Each phase is additive. Each ends with `npm run build && npm test` green and the game runnable. No phase requires throwing away the next.

**Tech Stack:** TypeScript + Vite, Canvas 2D, Vitest, existing `src/terrain/`, `src/map/`, `src/render/` structure.

---

## Phase ordering (with rationale)

| # | Phase | Plan doc | Status |
|---|-------|----------|--------|
| 0 | Housekeeping + safety nets | `2026-05-16-terrain-phase-0-housekeeping.md` | ✅ Merged |
| 1 | Drainage-basin rivers | `2026-05-16-terrain-phase-1-drainage-rivers.md` | ✅ Merged (algorithm switched mid-phase to flow accumulation; rivers still scattered — see backlog) |
| 2a | Agent-walker roads | `2026-05-16-terrain-phase-2a-agent-walker-roads.md` | ✅ Merged |
| 2b | Dual-grid overlay | — | ⏸ Deferred — needs new authored road sprites for visual value |
| 3 | Hydraulic erosion pass | `2026-05-16-terrain-phase-3-erosion.md` | ✅ Merged (defaults tuned to preserve elevation extremes) |
| 4 | OffscreenCanvas terrain bake | — | ⏸ Deferred — premature optimization, current per-tile draw is fine until lighting/NPCs land |
| 5 | HSWFC meta-layer over POI zones | — | ⏸ Deferred — needs zone-semantic brainstorming first |
| 6 | Normal-map lighting pass | — | ⏸ Deferred — needs authored normal-map atlases per terrain group |

## Status & deferred work

**What shipped (25 commits, +600 production LOC, −180 deleted):**
- ChunkManager dead code removed
- Regression test safety net for `carveConnections` and `placeSettlement`
- Drainage-basin rivers via flow accumulation
- Agent-walker A* road carving with bridge detection
- Particle-based hydraulic erosion (mild, preserves elevation extremes)
- 276 tests passing (was 281 baseline)

**Backlog (in priority order):**

1. **River continuity** — current rivers are scattered fragments (max 3 contiguous tiles). Trace downstream connectivity so rivers form true obstacles requiring bridges. ~20 LOC. Best paired with Phase 5 (HSWFC) or as a Phase 3.1 follow-up.
2. **Phase 5 — HSWFC zones**: First brainstorm zone semantics (what does `sacred_grove` zone mean for tile distribution, NPC spawn, building templates, divine action affordances?). Then write the plan. This is where Small Gods' personality emerges; worth doing carefully.
3. **Phase 4 — OffscreenCanvas**: Implement when Phase 6 (lighting) or NPC rendering causes frame drops. Plan is straightforward; no design unknowns.
4. **Phase 2b — Dual-grid overlay**: Mostly code cleanup. Implement when authoring a road sprite atlas, otherwise no visible change.
5. **Phase 6 — Lighting**: Needs normal-map atlas authoring. Could use the PixelLab / Hunyuan3D pipeline discussed earlier in the project (image-blaster discussion) to generate normals from existing terrain tiles.

## Branching strategy

- One feature branch per phase: `feature/terrain-phase-N-<slug>`.
- Each phase branched from the previous phase's merged HEAD on `main`.
- Each phase ends with: tests green, `npm run build` clean, smoke-tested in browser, then PR / merge.

## Dependency notes

- Phase 1 (rivers) writes hydrology data that Phase 2 (roads) wants as input.
- Phase 5 (HSWFC) depends on Phase 1's hydrology only if we want zones to know about water; we'll relax that if the dependency turns out painful.
- Phase 6 (lighting) is the only phase that touches `render/renderer.ts` heavily; landing Phase 4 first means we have a clean place to add the composite pass.

## What we are explicitly *not* doing

- Not replacing blob-47 main terrain (works).
- Not migrating to WebGPU (overkill at 128×96).
- Not running diffusion at runtime (not mature enough; reserved for offline atlas extension).
- Not introducing infinite-world chunking (Phase 0 deletes the abandoned ChunkManager).
- Not changing TILE_SIZE or atlas layout.

## Verification at each phase

Every phase has, at minimum:
- Vitest unit tests for new functions (TDD).
- One screenshot diff or visual smoke-test step described in the plan doc.
- `npm test` and `npm run build` must pass.
- The dev server must load without console errors on a default world seed.

## Phase summaries (for context)

### Phase 0 — Housekeeping
Delete `src/map/chunk-manager.ts` + its test + its exports from `src/map/index.ts`. Add regression tests for `carveConnections` and `placeSettlement`. Document that `src/wfc/` stays (reserved for Phase 5). One commit per logical change.

### Phase 1 — Drainage-basin rivers
New `src/terrain/hydrology.ts`. Find peaks above an elevation threshold; walk downhill on the existing elevation field; merge tributaries into a tree; write `river` tiles to the tile grid; record an `EXISTS_AS_RIVER` mask Phase 2 will read. Insertion point: between `classifyBiomes()` and `placeSettlement()` in `generateWithNoise()`.

### Phase 2 — Agent-walker roads + dual-grid overlay
Rewrite `carveConnections()` as a cost-based agent walker using `(slope + waterPenalty + existingRoadBonus + biomeCost)`. Then migrate `dirt_road / stone_road / bridge / river` rendering from the variant-string scheme in `renderer.ts:31–148` to a 16-tile dual-grid overlay layer. Adds `src/map/dual-grid-overlay.ts`, removes most of `parseRoadVariant` + `drawRoadOverlay`.

### Phase 3 — Hydraulic erosion pass
New `src/terrain/erosion.ts`. ~2k particles, each carries water + sediment, deposits/erodes based on slope. Single pre-pass on the elevation Float32Array before `classifyBiomes()`. Configurable iteration count; default tuned for sub-50ms on 128×96.

### Phase 4 — OffscreenCanvas terrain bake
New `src/render/terrain-cache.ts`. On map generation, render the static terrain + overlay layer into 256×256 OffscreenCanvas chunks. `drawTerrain()` becomes a blit from the cache. Invalidate per-chunk on tile mutation (omens, miracles).

### Phase 5 — HSWFC meta-layer over POI zones
New `src/terrain/zone-wfc.ts` using existing `src/wfc/` primitives. Coarse grid (e.g., 16×16 cells per zone) collapses POI zone types (sacred_grove, urban, wilderness, coast, agricultural) with adjacency rules. Output feeds into `classifyBiomes()` as a biome bias / constraint. `poi-zones.ts` becomes data-driven input to this layer.

### Phase 6 — Normal-map lighting pass
New `public/sprites/terrain/lpc-normals.png` per terrain group (authored or auto-derived from height-bake). New `src/render/lighting.ts` composes a per-frame lighting buffer (sun direction + point lights for miracles/omens), multiplies over the terrain bake. Single full-screen composite pass after `drawYSortedEntities`.

---

## Execution

For each phase, the workflow is:

1. Write the detailed plan doc for that phase.
2. Branch from `main`: `git checkout -b feature/terrain-phase-N-<slug>`.
3. Execute via `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` (inline).
4. Verify: tests, build, smoke-test in browser.
5. PR or fast-forward merge to `main`.
6. Update this roadmap doc with lessons learned.
7. Move to next phase.
