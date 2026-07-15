// src/world/genome.ts
//
// World GENOMES — programmatically generated `WorldSeed`s built to a stated need,
// run through the REAL engine (`Game.generateWorld(seed)` → `generateWithNoise` →
// the shipped renderer). The worldSeed IS the connectome graph the game already
// consumes; a "genome" is just one we author in code instead of hand-writing JSON,
// so a studio / test / dev harness can say WHAT terrain it needs and get a valid
// seed back — no bespoke render loop, no duplicate worldgen, no static fixture.
//
// A terrain genome carries NO POIs (empty `pois` → no settlements → no buildings),
// so it renders pure ground: the biome/water/road shaders on real generated terrain.
// Sized by default so a native 1:1 render (128 px/tile) fits a 4K img2img frame —
// 32 tiles × 128 = 4096 px — which is the point: a small island you can round-trip
// through img2img for a true pixel-for-pixel comparison.

import type { WorldSeed } from '@/core/types';
import type { ClimateSpec } from '@/terrain/climate';
import type { TerrainShapeSpec } from '@/terrain/terrain-shape';
import { validateWorldSeed } from '@/core/schema';

/** 128 px/tile at native zoom → this many tiles square lands a full render at ~4K. */
export const GENOME_4K_TILES = 32;

/** What a terrain genome must SHOW. Everything is optional — the caller states only
 *  what it cares about and the builder fills valid, gentle defaults for the rest. */
export interface TerrainGenomeSpec {
  /** Seed name (for logs / validation messages). */
  name?: string;
  /** Square map dimension in tiles. Default {@link GENOME_4K_TILES} (native ≈ 4K). */
  size?: number;
  /** Ocean margin around a central landmass. Default true (an actual island). */
  island?: boolean;
  /** Base biome band (schema `BIOMES`). Default 'temperate'. */
  biome?: WorldSeed['biome'];
  /** Temperature/lapse band — colder north, warmer south by default. */
  climate?: Partial<ClimateSpec>;
  /** Authored landform laid over the procedural noise (a gentle knoll by default so
   *  the shore→grass→upland gradient is visible on one small island). */
  terrainShape?: TerrainShapeSpec | null;
  /** WorldStyle overrides — MUST sit under `style.overrides` (a bare `style:{…}` is
   *  silently dropped). Default gentle relief + calm rivers for a legible ground. */
  styleOverrides?: Record<string, number>;
}

const clampSize = (n: number): number => Math.max(16, Math.min(512, Math.round(n)));

/**
 * Build a VALID terrain-only `WorldSeed` from a need. Empty POIs → buildings-free
 * ground. Validates and warns (never throws) so a malformed spec is loud but the
 * caller still gets a seed the engine can boot for inspection.
 */
export function terrainGenome(spec: TerrainGenomeSpec = {}): WorldSeed {
  const size = clampSize(spec.size ?? GENOME_4K_TILES);
  const seed = {
    name: spec.name ?? 'terrain-genome',
    size: { width: size, height: size },
    biome: spec.biome ?? 'temperate',
    era: 'medieval',
    island: spec.island ?? true,
    climate: spec.climate ?? { tempNorth: 0.6, tempSouth: 0.74, elevationLapse: 0.14 },
    pois: [],
    connections: [],
    constraints: [],
    // A gentle central knoll gives the beach → grass → upland gradient on one small
    // island; pass `terrainShape: null` for pure unshaped procedural noise.
    ...(spec.terrainShape === null ? {} : { terrainShape: spec.terrainShape ?? { kind: 'knoll', strength: 0.6 } }),
    style: { overrides: spec.styleOverrides ?? { mountainRelief: 14, coastDrama: 0.35, riverDensity: 0.4 } },
  } as unknown as WorldSeed;

  const v = validateWorldSeed(seed);
  if (v.errors.length) console.error(`[genome] "${seed.name}" invalid:`, v.errors);
  if (v.warnings.length) console.warn(`[genome] "${seed.name}" warnings:`, v.warnings);
  return seed;
}

/** Named genomes keyed by what they're FOR — the "generate based on what's needed"
 *  catalogue. Each is a thin spec over {@link terrainGenome}; add one per terrain
 *  study (grass tuning, snow line, marsh mud, dune sand…). */
export const TERRAIN_GENOMES: Record<string, TerrainGenomeSpec> = {
  // Grass-shader work: a warm, gentle temperate isle that reads as mostly meadow,
  // ringed by beach, with a soft central rise — no snow, no drama, all ground.
  'grass-island': {
    name: 'grass-island', size: GENOME_4K_TILES, island: true, biome: 'temperate',
    climate: { tempNorth: 0.62, tempSouth: 0.76, elevationLapse: 0.12 },
    terrainShape: { kind: 'knoll', strength: 0.55 },
    // Sparse flora — a grass STUDY: the ground is the subject, not a forest. A few
    // scattered trees/flowers for scale, but the meadow shader stays legible.
    styleOverrides: { mountainRelief: 12, coastDrama: 0.4, riverDensity: 0.35, floraDensity: 0.08 },
  },
  // Snow-line work: a colder, higher isle whose knoll pushes an upland into snow so
  // grass → rock → snow banding is visible on one frame.
  'snow-island': {
    name: 'snow-island', size: GENOME_4K_TILES, island: true, biome: 'alpine',
    climate: { tempNorth: 0.28, tempSouth: 0.4, elevationLapse: 0.5 },
    terrainShape: { kind: 'knoll', strength: 0.9 },
    styleOverrides: { mountainRelief: 34, coastDrama: 0.35, riverDensity: 0.4 },
  },
  // Mud/wetland work: a low, flat, wet isle (many rivers, no relief) so damp ground /
  // mud overlay dominates.
  'marsh': {
    name: 'marsh', size: GENOME_4K_TILES, island: true, biome: 'temperate',
    climate: { tempNorth: 0.55, tempSouth: 0.68, elevationLapse: 0.08 },
    terrainShape: { kind: 'plain', strength: 0.9 },
    styleOverrides: { mountainRelief: 6, coastDrama: 0.5, riverDensity: 0.85 },
  },
};

/** Resolve a named genome to a valid `WorldSeed`; unknown names fall back to a bare
 *  terrain genome carrying that name (still valid, just the gentle defaults). */
export function terrainGenomeByName(name: string): WorldSeed {
  return terrainGenome(TERRAIN_GENOMES[name] ?? { name });
}
