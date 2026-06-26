import { describe, it, expect, beforeEach } from 'vitest';
import type { GameMap } from '@/core/types';
import type { RoadGraph, RoadEdge } from '@/world/road-graph';
import {
  buildRoadDeformations,
  getRoadDeformationStore,
  embankmentBatterTiles,
  clearRoadDeformationCache,
} from '@/world/road-deformation';
import { clearHeightfieldCache, heightMetresAt as baseHeightAt } from '@/world/heightfield';
import { heightAt } from '@/world/terrain-deformation';
import { deriveRoadState, roadCrossSection } from '@/world/road-state';

// ── G2: embankment fill — roads build UP, not only carve ────────────────────────────

describe('embankmentBatterTiles — the fill-side slope width', () => {
  const SF = 0.5; // a representative shoulder feather

  it('is just the shoulder feather on flat or cut ground (no fill ⇒ no extra bank)', () => {
    expect(embankmentBatterTiles(0, 0.8, SF)).toBe(SF);
    expect(embankmentBatterTiles(-3, 0.8, SF)).toBe(SF); // a cut never banks out
  });

  it('grows the bank with the fill height at the repose angle (0.75 tile / m × cutStrength)', () => {
    // 10 m fill, cutStrength 0.8 → 0.75·0.8·10 = 6 tiles, which dwarfs the feather.
    expect(embankmentBatterTiles(10, 0.8, SF)).toBeCloseTo(6, 6);
    // Monotonic in fill height.
    expect(embankmentBatterTiles(4, 0.8, SF)).toBeGreaterThan(embankmentBatterTiles(2, 0.8, SF));
  });

  it('scales with construction — an engineered road throws a wider causeway than a footpath', () => {
    expect(embankmentBatterTiles(8, 0.9, SF)).toBeGreaterThan(embankmentBatterTiles(8, 0.3, SF));
  });

  it('only widens once the fill bank would exceed the thin shoulder feather', () => {
    // A shallow fill the feather already covers leaves the footprint unchanged.
    expect(embankmentBatterTiles(0.3, 0.4, SF)).toBe(SF); // 0.75·0.4·0.3 = 0.09 < 0.5
  });
});

// A minimal GameMap; road-deformation reads seed/width/height/roadGraph/worldSeed.
function mapWith(roadGraph: RoadGraph, seed = 1234, width = 48, height = 48): GameMap {
  return { seed, width, height, roadGraph } as unknown as GameMap;
}

function roadEdge(id: string, polyline: { x: number; y: number }[], partial: Partial<RoadEdge> = {}): RoadEdge {
  return { id, a: `${id}-a`, b: `${id}-b`, polyline, feature: 'road', class: 'road', surface: 'dirt', bridgeCells: [], ...partial };
}

/** Build the single corridor deformation for one road edge over the valley seed. */
function corridorFor(partial: Partial<RoadEdge>) {
  const graph: RoadGraph = { nodes: [], edges: [roadEdge('e1', VALLEY_LINE, partial)] };
  return buildRoadDeformations(mapWith(graph), graph)[0];
}

// The carriageway+kerb+ditch+feather footprint a road would have with NO embankment batter.
function baselineReach(roadClass: 'highway' | 'road' | 'track' | 'path', surface: 'stone' | 'dirt'): number {
  const x = roadCrossSection(deriveRoadState({ roadClass, surface, era: 'medieval' }));
  const core = x.carriageHalf + (x.hasCurb ? x.curbWidthTiles : 0);
  const ditchReach = x.ditchDepthM > 0 ? x.ditchOffsetTiles + 0.5 : 0;
  return Math.max(core, ditchReach) + x.shoulderFeatherTiles;
}

// Max perpendicular corridor half-width (tiles) of a vertical road near a given row.
function corridorHalfWidth(def: { mask(x: number, y: number): number }, cx: number, cy: number): number {
  let best = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let off = 0; off <= 8; off += 0.1) {
      if (def.mask(cx + off, cy + dy) > 1e-6 && off > best) best = off;
    }
  }
  return best;
}

// Seed 1234 @ 48×48 has a clear N–S valley at x=27 (floor ≈ 6 m, walls ≈ 16 m) — a road run
// straight down it must carry itself across as a causeway.
const VALLEY_X = 27;
const VALLEY_LINE = Array.from({ length: 27 }, (_, i) => ({ x: VALLEY_X, y: 6 + i }));
const VALLEY_FLOOR_Y = 18; // an interior row well below the ramp line (deep fill)

beforeEach(() => {
  clearRoadDeformationCache();
  clearHeightfieldCache();
});

describe('a road crossing a valley builds an embankment (seed 1234 @ 48×48)', () => {
  it('the corridor widens FAR beyond the flat-road footprint where the road is on deep fill', () => {
    const def = corridorFor({ class: 'highway', surface: 'stone' });
    const banked = corridorHalfWidth(def, VALLEY_X, VALLEY_FLOOR_Y);
    // The valley crossing battered the bank out well past the carriageway+ditch+feather.
    expect(banked).toBeGreaterThan(baselineReach('highway', 'stone') + 1.5);
  });

  it('the bank actually RAISES the terrain above the valley floor (fill, not just a wider cut)', () => {
    const graph: RoadGraph = { nodes: [], edges: [roadEdge('e1', VALLEY_LINE, { class: 'highway', surface: 'stone' })] };
    const map = mapWith(graph);
    const store = getRoadDeformationStore(map);
    // A tile out on the bank (off the carriageway, inside the batter) sits above natural ground.
    const bx = VALLEY_X + 2, by = VALLEY_FLOOR_Y;
    const composed = heightAt(map, store, bx, by);
    expect(composed).toBeGreaterThan(baseHeightAt(map, bx, by) + 0.5);
  });

  it('a footpath banks LESS than a highway across the same valley (construction-scaled)', () => {
    const hw = corridorFor({ class: 'highway', surface: 'stone' });
    const pf = corridorFor({ class: 'path', surface: 'dirt' });
    expect(corridorHalfWidth(hw, VALLEY_X, VALLEY_FLOOR_Y)).toBeGreaterThan(corridorHalfWidth(pf, VALLEY_X, VALLEY_FLOOR_Y));
  });
});
