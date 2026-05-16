/**
 * WFC (Wave Function Collapse) primitives.
 *
 * Status (2026-05): The classical-WFC code path (generateWithWFC) is bypassed
 * by the primary noise-based generator. These primitives are retained for two
 * reasons:
 *   1. autotiler.ts imports TILES (tile metadata) from here.
 *   2. The HSWFC meta-layer (Phase 5 of the terrain overhaul) will reuse the
 *      Cell / Grid / Propagator / Solver primitives at a coarser granularity
 *      (zone-WFC over POI zones, not tile-WFC).
 *
 * Do not delete this module without first relocating TILES and verifying the
 * Phase 5 plan no longer needs the primitives.
 *
 * See: docs/superpowers/plans/2026-05-16-terrain-overhaul-roadmap.md
 */
export { Cell } from './cell';
export { TileSet, TILES, ADJACENCY, DIRECTIONS, BASE_TILES } from './tile';
export type { Direction } from './tile';
export { Grid } from './grid';
export { Propagator } from './propagator';
export { Solver, createRNG } from './solver';
export type { SolverOptions, SolveResult, StepResult } from './solver';
export { WFCEngine, TERRAIN_WEIGHTS } from './engine';
