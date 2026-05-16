---
name: project-conventions
description: Architecture patterns and code style for Small Gods. Apply when writing or modifying code.
user-invocable: false
---

## Rendering Architecture
- Pass `RenderContext` (from `src/core/types.ts`) to render functions — never individual args
- `renderMap()` splits into `drawTerrain()` / `drawYSortedEntities()` / `drawOverlays()`
- Overlay functions return `OverlayHitAreas[]` for click handling in `game.ts`
- `TILE_SIZE = 32` — all positioning in tile coordinates, converted at render time

## Map Generation
- WFCEngine runs 3 phases: terrain -> buildings -> decorations
- Blob autotiler for LPC terrain (8-neighbor, 47 variants) in `src/map/blob-autotiler.ts`
- `GameMap.buildings: BuildingInstance[]` populated by WFCEngine Phase 2
- `computeBlobMap()` called after map gen in `game.ts`

## Sim Layer
- NPC state lives in `NpcSimState`, ticked by `src/sim/npc-sim.ts` loop at `SIM_TICK_MS` intervals
- Divine actions cost belief-power; regen computed by `computePowerRegen()` per tick
- All sim state changes go through `GameState`
- `clamp01()` for all 0-1 bounded values (faith, needs, mood)
- Recent events use a ring buffer (max 5)

## Type Patterns
- All types in `src/core/types.ts` — no inline type definitions in modules
- Use `NpcRole` union type for role-based lookups (Record<NpcRole, number>)
- `WorldSeed` validated by `src/core/schema.ts`

## Testing
- Vitest with `tests/unit/*.test.ts`
- `describe`/`it`/`expect` pattern
- `@/` path aliases for imports
- Determinism tests: same seed must produce same output

## File Organization
- `src/core/` — types, constants, state, noise, schema
- `src/sim/` — NPC simulation, divine actions
- `src/map/` — generation, autotiling, chunks, buildings
- `src/render/` — renderer, camera, minimap
- `src/wfc/` — Wave Function Collapse engine
- `src/embed/` — iframe embedding API
