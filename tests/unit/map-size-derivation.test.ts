import { describe, it, expect } from 'vitest';
import { deriveMapSize } from '@/world/map-size-derivation';
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

describe('deriveMapSize', () => {
  it('is a no-op for a well-authored world where all content fits (default.json shape)', () => {
    // POIs and regions all inside the authored 128×96 grid.
    const ws = seed({
      size: { width: 128, height: 96 },
      pois: [
        { id: 'a', type: 'village', position: { x: 64, y: 48 } },
        { id: 'b', type: 'lake', position: { x: 100, y: 75 } },
        {
          id: 'c',
          type: 'mountain',
          region: { x_min: 107, x_max: 127, y_min: 0, y_max: 41 },
        },
      ],
    });
    expect(deriveMapSize(ws)).toEqual({ width: 128, height: 96 });
  });

  it('grows the authored size to contain a POI that sits outside the grid (no clip)', () => {
    const ws = seed({
      size: { width: 64, height: 48 },
      pois: [{ id: 'far', type: 'tower', position: { x: 80, y: 90 } }],
    });
    // Grid bounds are exclusive → a tile at (80,90) needs 81×91.
    expect(deriveMapSize(ws)).toEqual({ width: 81, height: 91 });
  });

  it('never adds margin when an authored size is present', () => {
    const ws = seed({
      size: { width: 50, height: 50 },
      pois: [{ id: 'edge', type: 'village', position: { x: 60, y: 40 } }],
    });
    // Only grows on the axis that overflows; the other stays authored, no margin.
    expect(deriveMapSize(ws)).toEqual({ width: 61, height: 50 });
  });

  it('respects a POI region bbox upper bound', () => {
    const ws = seed({
      size: { width: 20, height: 20 },
      pois: [
        { id: 'forest', type: 'forest', region: { x_min: 0, x_max: 40, y_min: 0, y_max: 30 } },
      ],
    });
    expect(deriveMapSize(ws)).toEqual({ width: 41, height: 31 });
  });

  it('accounts for connection waypoints', () => {
    const ws = seed({
      size: { width: 30, height: 30 },
      pois: [
        { id: 'a', type: 'village', position: { x: 5, y: 5 } },
        { id: 'b', type: 'city', position: { x: 10, y: 10 } },
      ],
      connections: [
        { from: 'a', to: 'b', type: 'road', waypoints: [{ x: 45, y: 7 }, { x: 8, y: 50 }] },
      ],
    });
    expect(deriveMapSize(ws)).toEqual({ width: 46, height: 51 });
  });

  it('derives content bbox + margin (snapped) when no authored size is present', () => {
    const ws = seed({
      size: undefined as unknown as WorldSeed['size'],
      pois: [{ id: 'a', type: 'village', position: { x: 40, y: 30 } }],
    });
    // content = 41×31, +margin 16 = 57×47, snap up to /8 → 64×48.
    expect(deriveMapSize(ws, { margin: 16, snap: 8 })).toEqual({ width: 64, height: 48 });
  });

  it('falls back to the minDim floor for an empty content-defined world', () => {
    const ws = seed({ size: undefined as unknown as WorldSeed['size'], pois: [] });
    expect(deriveMapSize(ws, { minDim: 16 })).toEqual({ width: 16, height: 16 });
  });

  it('keeps an authored size for an empty world (no content to fit)', () => {
    const ws = seed({ size: { width: 32, height: 24 }, pois: [] });
    expect(deriveMapSize(ws)).toEqual({ width: 32, height: 24 });
  });

  it('clamps derived dimensions to maxDim', () => {
    const ws = seed({
      size: { width: 100, height: 100 },
      pois: [{ id: 'huge', type: 'mountain', position: { x: 999, y: 5 } }],
    });
    expect(deriveMapSize(ws, { maxDim: 512 })).toEqual({ width: 512, height: 100 });
  });

  it('treats a sub-minimum authored size as absent (content-defined path)', () => {
    const ws = seed({
      size: { width: 8, height: 8 },
      pois: [{ id: 'a', type: 'village', position: { x: 20, y: 20 } }],
    });
    // 8 < minDim(16) → not "authored" → margin path: content 21×21 +16 = 37 → snap 40.
    expect(deriveMapSize(ws, { margin: 16, snap: 8, minDim: 16 })).toEqual({ width: 40, height: 40 });
  });
});
