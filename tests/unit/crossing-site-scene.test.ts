// Crossing Site studio — pure scene helpers (src/studio/crossing-site-scene.ts).
// The picker must be deterministic, land its endpoints on dry ground either side of the
// channel, and refuse patches with no crossable water; the POI/class mapping must drive
// buildRoadGraph's own classForConnection to the dialled class; the shown-tier resolver
// must obey the real span tables in road-use.ts.
import { describe, it, expect } from 'vitest';
import type { GameMap, Tile } from '@/core/types';
import {
  pickCrossingSite, poisForCrossing, shownCrossingTier, CLASS_POI_IMPORTANCE,
} from '@/studio/crossing-site-scene';
import { minViableTier, tierSpans, type CrossingTier } from '@/world/road-use';
import { terrainConfigFor } from '@/map/map-generator';
import type { WorldSeed } from '@/core/types';

/** A bare W×H grass map with an optional vertical river band x ∈ [x0..x1]. */
function mapWithBand(W: number, H: number, band?: { x0: number; x1: number }): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < H; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < W; x++) {
      const wet = !!band && x >= band.x0 && x <= band.x1;
      row.push({ type: wet ? 'river' : 'grass', x, y, walkable: !wet, state: 'realized' });
    }
    tiles.push(row);
  }
  return {
    tiles, width: W, height: H, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
}

describe('pickCrossingSite', () => {
  it('finds a perpendicular crossing over a vertical channel, endpoints dry on both banks', () => {
    const map = mapWithBand(48, 48, { x0: 22, x1: 24 });
    const pick = pickCrossingSite(map);
    expect(pick).not.toBeNull();
    expect(pick!.axis).toBe('ew');           // road runs E–W across the N–S channel
    expect(pick!.channelT).toBe(3);
    expect(pick!.a.x).toBeLessThan(22);      // near endpoint west of the water
    expect(pick!.b.x).toBeGreaterThan(24);   // far endpoint east of it
    expect(map.tiles[pick!.a.y][pick!.a.x].type).toBe('grass');
    expect(map.tiles[pick!.b.y][pick!.b.x].type).toBe('grass');
    // Both endpoints straddle the channel on the same row (perpendicular crossing).
    expect(pick!.a.y).toBe(pick!.b.y);
  });

  it('is deterministic — same map, same pick', () => {
    const map = mapWithBand(48, 48, { x0: 22, x1: 24 });
    expect(pickCrossingSite(map)).toEqual(pickCrossingSite(map));
  });

  it('returns null on a dry patch', () => {
    expect(pickCrossingSite(mapWithBand(48, 48))).toBeNull();
  });

  it('refuses a channel too wide for the ladder headroom', () => {
    const map = mapWithBand(48, 48, { x0: 16, x1: 31 });   // 16 tiles of water
    expect(pickCrossingSite(map)).toBeNull();
  });
});

describe('poisForCrossing', () => {
  it('maps every road class to an importance that classForConnection ranks back to it', () => {
    // classForConnection (road-graph.ts): low→path, medium→track, high→road, critical→highway.
    expect(CLASS_POI_IMPORTANCE).toEqual({ path: 'low', track: 'medium', road: 'high', highway: 'critical' });
  });

  it('returns two positioned endpoints and one road connection joining them', () => {
    const { pois, connections } = poisForCrossing('road', { x: 10, y: 20 }, { x: 30, y: 20 });
    expect(pois).toHaveLength(2);
    expect(pois[0].position).toEqual({ x: 10, y: 20 });
    expect(pois[1].position).toEqual({ x: 30, y: 20 });
    expect(pois.every((p) => p.importance === 'high')).toBe(true);
    expect(connections).toEqual([{ from: pois[0].id, to: pois[1].id, type: 'road' }]);
  });
});

describe('shownCrossingTier', () => {
  it('keeps the earned tier when it spans the channel', () => {
    expect(shownCrossingTier(6, 3)).toEqual({ shown: 6, downgraded: false, ferry: false });
    expect(shownCrossingTier(0, 2)).toEqual({ shown: 0, downgraded: false, ferry: false });
  });

  it('upgrades to the min-viable structure when the earned tier cannot span', () => {
    const span = 5;
    const earned: CrossingTier = 0;
    expect(tierSpans(earned, span)).toBe(false);
    const r = shownCrossingTier(earned, span);
    expect(r.downgraded).toBe(true);
    expect(r.ferry).toBe(false);
    expect(r.shown).toBe(minViableTier(span));
    expect(tierSpans(r.shown, span)).toBe(true);
  });

  it('flags a ferry when nothing on the ladder spans the water', () => {
    expect(minViableTier(20)).toBeNull();
    expect(shownCrossingTier(6, 20)).toEqual({ shown: 6, downgraded: false, ferry: true });
  });
});

describe('terrainConfigFor (the studio field-rebuild seam)', () => {
  it('reproduces the generator knobs and honours style overrides', () => {
    const ws = {
      name: 't', size: { width: 96, height: 96 }, biome: 'temperate',
      pois: [], connections: [], constraints: [],
      style: { overrides: { mountainRelief: 16 } },
    } as unknown as WorldSeed;
    const c = terrainConfigFor(7, 96, 96, ws);
    expect(c.seed).toBe(7);
    expect(c.width).toBe(96);
    expect(c.height).toBe(96);
    expect(c.seaLevel).toBe(0.35);
    expect(c.elevationScale).toBeCloseTo(6 / 96);
    expect(c.moistureScale).toBeCloseTo(8 / 96);
    expect(c.reliefM).toBe(16);
  });
});
