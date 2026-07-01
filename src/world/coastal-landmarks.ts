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
/** Tiles between any two landmarks — keeps them rare, one per headland at most. */
const MIN_SPACING = 34;
/** Fraction of eligible cells that actually raise a landmark (rest stay bare coast).
 *  Low, so a long rocky coast gets one or two, not a colonnade. */
const PLACE_PROB = 0.5;
/** Hard caps per world — landmarks are wonders, not wallpaper. */
const MAX_ARCHES = 4;
const MAX_CLIFF_FACES = 4;
const MAX_CAVES = 3;
const MAX_HOODOOS = 6;

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
  const bordersSea = (x: number, y: number): boolean => N8.some(([dx, dy]) => isSea(x + dx, y + dy));

  const out: Entity[] = [];
  const placed: Array<[number, number]> = [];

  /** Collect eligible cells, pick by hash priority (SPREAD around the coast, not a
   *  row-major cluster) with a shared min-spacing, up to `cap`, emitting `kind`. */
  const scatter = (kind: string, cap: number, eligible: (x: number, y: number) => boolean, key: number): void => {
    const cands: Array<{ x: number; y: number; pri: number }> = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!eligible(x, y)) continue;
        const pri = hash01(x, y, seed + key);
        if (pri > PLACE_PROB) continue;              // most eligible cells stay bare coast
        cands.push({ x, y, pri });
      }
    }
    cands.sort((a, b) => a.pri - b.pri);             // deterministic pseudo-random order
    let n = 0;
    for (const c of cands) {
      if (n >= cap) break;
      if (placed.some(([px, py]) => Math.hypot(px - c.x, py - c.y) < MIN_SPACING)) continue;
      out.push(defaultEntity(BRUSH, kind, c.x + 0.5, c.y + 0.5, { scale: 1, rotation: 0 }));
      placed.push([c.x, c.y]);
      n++;
    }
  };

  // Sea arches: rocky HEADLANDS — a cliff/rocky_shore cell bordering sea with a bare-
  // rock neighbour (a real steep face where the surf bores through, not shingle).
  scatter('sea_arch', MAX_ARCHES,
    (x, y) => { const b = at(x, y); return (b === 'cliff' || b === 'rocky_shore') && bordersSea(x, y) && N8.some(([dx, dy]) => isRock(x + dx, y + dy)); },
    0);
  // Overhanging cliff faces: the STEEPEST coast — a `cliff`-biome cell at the water,
  // where a rock brow leans out over the surf.
  scatter('cliff_face', MAX_CLIFF_FACES,
    (x, y) => at(x, y) === 'cliff' && bordersSea(x, y),
    7919);
  // Sea caves: rocky shore at the water (a `mountain` or `rocky_shore` cell bordering
  // sea with a bare-rock neighbour) — where the surf hollows a dark mouth into the
  // rock. Placed after arches/faces, so it takes rocky spots they didn't claim.
  scatter('cave_mouth', MAX_CAVES,
    (x, y) => { const b = at(x, y); return (b === 'mountain' || b === 'rocky_shore') && bordersSea(x, y) && N8.some(([dx, dy]) => isRock(x + dx, y + dy)); },
    5273);
  // Hoodoos: the INLAND exception — balanced rocks dotting the rocky highlands (a
  // `mountain` cell NOT at the water), where weathering leaves a capped pedestal.
  scatter('hoodoo', MAX_HOODOOS,
    (x, y) => at(x, y) === 'mountain' && !bordersSea(x, y),
    3391);
  return out;
}
