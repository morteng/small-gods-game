// src/world/coastal-landmarks.ts
//
// Coastal landmark props — sparse, dramatic MESH landforms on rocky shores. The
// first is the `sea_arch`: a rock ring the surf has bored through, a landform the
// single-valued terrain heightfield physically cannot represent, so it's placed as
// a generative mesh prop (see blueprint preset `sea_arch`) rather than carved.
//
// EMERGENT from the biome map, not authored: an arch appears only where the coast
// is genuinely steep and rocky (a `cliff`/`rocky_shore` cell at a headland whose
// neighbour is bare rock), sparse (min-spacing + a cap) so it stays a landmark, not
// clutter. Pure + deterministic from (biomes, seed): the same world re-places
// identically. The caller adds these after the biome brushes, before settlements.
import { defaultEntity } from '@/world/brush-helpers';
import type { Entity } from '@/core/types';

const BRUSH = 'coastal_landmark';
/** Tiles between two arches — keeps them rare landmarks, one per headland at most. */
const MIN_SPACING = 34;
/** Fraction of eligible headland cells that actually raise an arch (the rest are bare
 *  cliff). Low, so a long rocky coast gets one arch, not a colonnade. */
const PLACE_PROB = 0.5;
/** Hard cap per world — an arch is a wonder, not wallpaper. */
const MAX_ARCHES = 4;

/** Decorrelated [0,1) hash (same mix as the vegetation/riparian placers). */
function hash01(x: number, y: number, key: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(key | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const N8: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/**
 * Place sea-arch landmark entities on steep rocky coasts. `biomes` is the row-major
 * biome-name grid (as classified by {@link classifyBiomes}). Deterministic.
 */
export function buildCoastalLandmarks(
  biomes: string[], width: number, height: number, seed: number,
): Entity[] {
  const at = (x: number, y: number): string => biomes[y * width + x];
  const inB = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height;
  const isSea = (x: number, y: number): boolean => !inB(x, y) || at(x, y) === 'ocean' || at(x, y) === 'deep_ocean';
  const isRock = (x: number, y: number): boolean => inB(x, y) && (at(x, y) === 'mountain' || at(x, y) === 'peak' || at(x, y) === 'cliff');

  // Collect every eligible coastal-headland cell, then pick by a hash priority so the
  // arches SPREAD around the island's rocky coasts rather than clustering wherever a
  // row-major scan hits the cap first.
  const cands: Array<{ x: number; y: number; pri: number }> = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const b = at(x, y);
      if (b !== 'cliff' && b !== 'rocky_shore' && b !== 'mountain') continue;
      // Must be a coastal headland: border open sea AND have a bare-rock neighbour
      // (a real steep face, not gentle shingle) — that's where arches erode.
      let sea = false, rock = false;
      for (const [dx, dy] of N8) {
        if (isSea(x + dx, y + dy)) sea = true;
        if (isRock(x + dx, y + dy)) rock = true;
      }
      if (!sea || !rock) continue;
      const pri = hash01(x, y, seed);
      if (pri > PLACE_PROB) continue;                 // most headlands stay bare cliff
      cands.push({ x, y, pri });
    }
  }
  cands.sort((a, b) => a.pri - b.pri);                // deterministic pseudo-random order

  const out: Entity[] = [];
  const placed: Array<[number, number]> = [];
  for (const c of cands) {
    if (out.length >= MAX_ARCHES) break;
    if (placed.some(([px, py]) => Math.hypot(px - c.x, py - c.y) < MIN_SPACING)) continue;
    out.push(defaultEntity(BRUSH, 'sea_arch', c.x + 0.5, c.y + 0.5, { scale: 1, rotation: 0 }));
    placed.push([c.x, c.y]);
  }
  return out;
}
