// src/terrain/terrain-shape.ts
//
// Authored terrain SHAPES — a deliberate base-elevation term layered over the
// procedural noise so a studio (or a scenario) can present PURPOSE-BUILT terrain
// that isolates the features a connectome interacts with, instead of a random
// noise patch. A motte-and-bailey wants a river to flank, buildable ground for the
// bailey, and a slope for the curtain wall; a ringwork wants a natural hill; a town
// wall wants a flat. Each `kind` paints exactly that landform.
//
// The shape is applied INSIDE `makeBaseElevationSampler` (the one elevation math
// both the biome/tile path and the render-height path funnel through), driven by an
// optional `TerrainConfig.shape` field that rides on `worldSeed` like `island` /
// `climate`. Absent ⇒ behaviour is byte-identical, so live worlds never change.
//
// Pure, dependency-light: only the shared noise helpers (deterministic, seeded).

import { fbm } from '@/core/noise';

/** An authored landform laid over the procedural base elevation. */
export interface TerrainShapeSpec {
  /**
   * `vale`  — a meandering valley: high dry flanks, a low central trough tilted
   *           downhill along its axis, so hydrology runs ONE river that grows from a
   *           thin headwater to a broad mouth, with buildable terraces either side.
   * `knoll` — a single soft dominant hill on otherwise gentle ground (the hill IS
   *           the motte → ringwork).
   * `plain` — near-flat buildable ground (pure earthwork / town wall).
   */
  kind: 'vale' | 'knoll' | 'plain';
  /** Long-axis / flow direction in radians (vale only). 0 = +x (drains east). */
  axis?: number;
  /** 0..1 blend of the authored shape over the noise. 1 = fully authored. Default 1. */
  strength?: number;
}

/** Pull the authored shape off a world seed (or anything carrying `terrainShape`). */
export function styledShapeSpec(
  seed?: { terrainShape?: TerrainShapeSpec } | null,
): TerrainShapeSpec | undefined {
  return seed?.terrainShape ?? undefined;
}

/** A stable signature for cache keys (heightfield/climate field memoisation). */
export function shapeSignature(shape?: TerrainShapeSpec | null): string {
  if (!shape) return '-';
  return `${shape.kind}:${(shape.axis ?? 0).toFixed(3)}:${(shape.strength ?? 1).toFixed(2)}`;
}

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }
function smooth(t: number): number { const c = clamp01(t); return c * c * (3 - 2 * c); }

// Buildable baselines (relative to seaLevel 0.35) — dry land sits comfortably above.
const PLAIN_BASE = 0.52;
const KNOLL_BASE = 0.46;
const KNOLL_PEAK = 0.50;   // added at the summit → ~0.96
const KNOLL_RADIUS = 0.17; // fraction of the map's min dimension
const VALE_TROUGH = 0.405; // just above seaLevel at the high end of the run
const VALE_FLANK = 0.62;   // dry buildable terraces
const VALE_HALFWIDTH = 0.30;
const VALE_DROP = 0.085;   // downhill fall along the flow axis (gives a clear outlet)
const VALE_MEANDER = 0.085;

/**
 * Apply the authored shape to a base-elevation sample at continuous tile coords.
 * `elev` is the procedural value; returns the shaped value in [0,1]. The flank/
 * trough texture keeps a little of the original noise so the landform never reads
 * as a smooth CAD surface.
 */
export function applyTerrainShape(
  elev: number,
  x: number, y: number,
  width: number, height: number,
  shape: TerrainShapeSpec,
  seed: number,
): number {
  const strength = shape.strength ?? 1;
  const nx = width > 1 ? x / (width - 1) : 0.5;
  const ny = height > 1 ? y / (height - 1) : 0.5;
  // A touch of low-frequency noise (in [-0.5,0.5]) to texture the authored surface.
  const tex = fbm(nx * 5, ny * 5, { seed: seed + 4242, octaves: 3 }) - 0.5;

  let target: number;
  if (shape.kind === 'plain') {
    target = PLAIN_BASE + tex * 0.05;
  } else if (shape.kind === 'knoll') {
    // Soft gaussian dome, offset off-centre so there is open bailey ground beside it.
    const ddx = nx - 0.40, ddy = ny - 0.46;
    const r = Math.hypot(ddx, ddy);
    const dome = KNOLL_PEAK * Math.exp(-(r * r) / (KNOLL_RADIUS * KNOLL_RADIUS));
    target = KNOLL_BASE + dome + tex * 0.05;
  } else {
    // vale — rotate coords by the flow axis so `u` runs downhill, `v` is cross-stream.
    const a = shape.axis ?? 0;
    const ca = Math.cos(a), sa = Math.sin(a);
    const cx = nx - 0.5, cy = ny - 0.5;
    const u = ca * cx + sa * cy + 0.5;          // along flow (0..1)
    const vRaw = -sa * cx + ca * cy;             // across flow (~-0.5..0.5)
    // Meander the trough centreline so the river is not a ruler line.
    const centre = VALE_MEANDER * Math.sin(u * Math.PI * 2.3 + seed * 0.013);
    const cross = Math.min(1, Math.abs(vRaw - centre) / VALE_HALFWIDTH);
    const flank = smooth(cross);                 // 0 in the trough → 1 on the flanks
    // Trough lowest, flanks high; whole vale tilts downhill along u for a clean outlet.
    target = (VALE_TROUGH + (VALE_FLANK - VALE_TROUGH) * flank) - VALE_DROP * u + tex * 0.06;
  }

  return clamp01(elev * (1 - strength) + target * strength);
}
