import { describe, it, expect } from 'vitest';
import { planWorldLayout } from '@/world/poi-layout';
import { DEFAULT_ISLAND } from '@/terrain/island-mask';
import type { WorldSeed } from '@/core/types';

function seed(partial: Partial<WorldSeed>): WorldSeed {
  return {
    name: 'test',
    size: { width: 128, height: 96 },
    biome: 'temperate',
    pois: [],
    connections: [],
    constraints: [],
    ...partial,
  };
}

describe('planWorldLayout — non-island (W0 behaviour)', () => {
  it('keeps positions untouched and uses the derived size', () => {
    const ws = seed({
      size: { width: 128, height: 96 },
      pois: [
        { id: 'a', type: 'village', position: { x: 64, y: 48 } },
        { id: 'b', type: 'mountain', region: { x_min: 107, x_max: 127, y_min: 0, y_max: 41 } },
      ],
    });
    const out = planWorldLayout(ws);
    expect(out.size).toEqual({ width: 128, height: 96 }); // no-op derive
    expect(out.pois[0].position).toEqual({ x: 64, y: 48 }); // unmoved
    expect(out.pois).toBe(ws.pois); // same reference (no copy when not island)
  });
});

describe('planWorldLayout — island (W3 recenter + ocean margin)', () => {
  const ws = seed({
    island: true,
    size: { width: 128, height: 96 },
    pois: [
      { id: 'corner', type: 'forest', region: { x_min: 0, x_max: 43, y_min: 0, y_max: 34 } },
      { id: 'far', type: 'mountain', region: { x_min: 107, x_max: 127, y_min: 0, y_max: 41 } },
      { id: 'centre', type: 'village', position: { x: 64, y: 48 } },
    ],
    connections: [
      { from: 'centre', to: 'corner', type: 'road', waypoints: [{ x: 50, y: 30 }, { x: 20, y: 17 }] },
    ],
  });
  const out = planWorldLayout(ws);

  it('grows the map well beyond the content extent', () => {
    expect(out.size.width).toBeGreaterThan(128);
    expect(out.size.height).toBeGreaterThan(96);
  });

  it('does not mutate the input seed', () => {
    expect(ws.pois[2].position).toEqual({ x: 64, y: 48 });
  });

  it('translates every POI by the same offset (relative layout preserved)', () => {
    // The village at (64,48) and the forest corner at (0,0) keep their delta.
    const village = out.pois[2].position!;
    const forest = out.pois[0].region!;
    expect(village.x - forest.x_min).toBe(64 - 0);
    expect(village.y - forest.y_min).toBe(48 - 0);
  });

  it('centres the content bbox in the new map (integer-rounded)', () => {
    // Content x spans [0,127] (width 127); centred → minX ≈ (W-127)/2, rounded
    // to a whole tile (coords must stay integral for settlement placement).
    const minX = Math.min(...out.pois.flatMap(p =>
      p.region ? [p.region.x_min] : [p.position!.x]));
    expect(Number.isInteger(minX)).toBe(true);
    expect(Math.abs(minX - (out.size.width - 127) / 2)).toBeLessThanOrEqual(0.5);
  });

  it('keeps all translated coordinates integral', () => {
    for (const p of out.pois) {
      if (p.position) {
        expect(Number.isInteger(p.position.x)).toBe(true);
        expect(Number.isInteger(p.position.y)).toBe(true);
      }
      if (p.region) {
        expect(Number.isInteger(p.region.x_min)).toBe(true);
        expect(Number.isInteger(p.region.y_max)).toBe(true);
      }
    }
  });

  it('keeps all content strictly inside the grid (no clipping at edges)', () => {
    for (const p of out.pois) {
      const x = p.region ? p.region.x_max : p.position!.x;
      const y = p.region ? p.region.y_max : p.position!.y;
      expect(x).toBeLessThan(out.size.width);
      expect(y).toBeLessThan(out.size.height);
      const x0 = p.region ? p.region.x_min : p.position!.x;
      const y0 = p.region ? p.region.y_min : p.position!.y;
      expect(x0).toBeGreaterThanOrEqual(0);
      expect(y0).toBeGreaterThanOrEqual(0);
    }
  });

  it('sizes the map so the content bbox corner lands within the island safe radius', () => {
    // After centring, the bbox corner normalised euclidean distance must be <= target.
    const xs = out.pois.flatMap(p => p.region ? [p.region.x_min, p.region.x_max] : [p.position!.x]);
    const ys = out.pois.flatMap(p => p.region ? [p.region.y_min, p.region.y_max] : [p.position!.y]);
    const W = out.size.width, H = out.size.height;
    const corner = (x: number, y: number) =>
      Math.hypot((x / (W - 1)) * 2 - 1, (y / (H - 1)) * 2 - 1);
    const maxD = Math.max(
      corner(Math.min(...xs), Math.min(...ys)),
      corner(Math.max(...xs), Math.max(...ys)),
    );
    expect(maxD).toBeLessThanOrEqual(0.72); // target 0.7 + snap slack
    // Mask at that radius must be partial (content fringe survives, not fully sunk).
    expect(maxD).toBeLessThan(DEFAULT_ISLAND.end);
  });

  it('translates connection waypoints alongside POIs', () => {
    const wp = out.connections[0].waypoints!;
    // delta from the centre POI to the first waypoint is preserved.
    const village = out.pois[2].position!;
    expect(village.x - wp[0].x).toBe(64 - 50);
    expect(village.y - wp[0].y).toBe(48 - 30);
  });

  it('is deterministic', () => {
    const a = planWorldLayout(ws);
    const b = planWorldLayout(ws);
    expect(a.size).toEqual(b.size);
    expect(a.pois[2].position).toEqual(b.pois[2].position);
  });
});

describe('planWorldLayout — island edge cases', () => {
  it('square island shape leaves a wider interior (smaller map than euclidean)', () => {
    const base = seed({
      size: { width: 16, height: 16 }, // small authored floor so derived sizing shows through
      pois: [{ id: 'a', type: 'forest', region: { x_min: 0, x_max: 60, y_min: 0, y_max: 60 } }],
    });
    const euc = planWorldLayout({ ...base, island: { shape: 'euclidean', start: 0.62, end: 1.0 } });
    const sq = planWorldLayout({ ...base, island: { shape: 'square', start: 0.62, end: 1.0 } });
    expect(sq.size.width).toBeLessThan(euc.size.width);
  });

  it('an empty island world just returns a derived size without crashing', () => {
    const ws = seed({ island: true, pois: [], size: { width: 64, height: 64 } });
    const out = planWorldLayout(ws);
    expect(out.size.width).toBeGreaterThanOrEqual(64);
    expect(out.pois).toEqual([]);
  });
});
