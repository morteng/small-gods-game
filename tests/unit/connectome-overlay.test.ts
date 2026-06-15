import { describe, it, expect } from 'vitest';
import { drawWorldConnectome } from '@/render/connectome-overlay';
import type { RenderContext, GameMap, Tile, Camera } from '@/core/types';

/** Minimal Canvas2D stub that records which drawing ops were issued. */
function mockCtx() {
  const calls: Record<string, number> = {};
  const bump = (k: string) => () => { calls[k] = (calls[k] ?? 0) + 1; };
  return {
    calls,
    ctx: {
      save: bump('save'), restore: bump('restore'),
      beginPath: bump('beginPath'), moveTo: bump('moveTo'), lineTo: bump('lineTo'),
      stroke: bump('stroke'), fill: bump('fill'), arc: bump('arc'),
      strokeText: bump('strokeText'), fillText: bump('fillText'),
      lineJoin: '', lineCap: '', lineWidth: 0, strokeStyle: '', fillStyle: '',
      font: '', textAlign: '', textBaseline: '',
    } as unknown as CanvasRenderingContext2D,
  };
}

function map(): GameMap {
  const w = 8, h = 8;
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return {
    tiles, width: w, height: h, villages: [], seed: 7, success: true,
    stats: { iterations: 0, backtracks: 0 }, buildings: [],
    worldSeed: {
      name: 'test', pois: [
        { id: 'a', type: 'village', name: 'Aville', position: { x: 1, y: 1 }, importance: 'high' },
        { id: 'b', type: 'castle', name: 'Bkeep', position: { x: 6, y: 6 }, importance: 'critical' },
      ],
      connections: [],
    },
    roadGraph: {
      nodes: [
        { id: 'n0', x: 1, y: 1, kind: 'poi', poiRef: 'a' },
        { id: 'n1', x: 6, y: 6, kind: 'poi', poiRef: 'b' },
        { id: 'n2', x: 3, y: 3, kind: 'junction' },
      ],
      edges: [{
        id: 'e0', a: 'n0', b: 'n1', feature: 'road', class: 'road', surface: 'dirt',
        bridgeCells: [], polyline: [{ x: 1, y: 1 }, { x: 3, y: 3 }, { x: 6, y: 6 }],
      }],
    },
  } as unknown as GameMap;
}

const camera: Camera = { x: 0, y: 0, zoom: 1, dragging: false, lastX: 0, lastY: 0 };

describe('drawWorldConnectome', () => {
  it('strokes edges and draws POI labels for a world with a road graph', () => {
    const { ctx, calls } = mockCtx();
    const rc = { map: map(), camera } as unknown as RenderContext;
    expect(() => drawWorldConnectome(ctx, rc)).not.toThrow();
    expect(calls.stroke).toBeGreaterThan(0);   // road edge polyline
    expect(calls.arc).toBeGreaterThan(0);       // POI + junction nodes
    expect(calls.fillText).toBeGreaterThan(0);  // POI labels
  });

  it('is a no-op (no throw) when the map has no graph or POIs', () => {
    const { ctx } = mockCtx();
    const bare = { ...map(), roadGraph: undefined, worldSeed: null } as unknown as GameMap;
    const rc = { map: bare, camera } as unknown as RenderContext;
    expect(() => drawWorldConnectome(ctx, rc)).not.toThrow();
  });
});
