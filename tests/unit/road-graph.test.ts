import { describe, it, expect } from 'vitest';
import type { Tile, TerrainField, POI, Connection } from '@/core/types';
import {
  buildRoadGraph,
  rasterizeRoadGraph,
  applyRoadMask,
  type RoadGraph,
} from '@/world/road-graph';

function makeTiles(w: number, h: number, fill = 'grass'): Tile[][] {
  const rows: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) {
      row.push({ type: fill, x, y, walkable: true, state: 'realized' });
    }
    rows.push(row);
  }
  return rows;
}

function flatField(w: number, h: number, elev = 0.5): TerrainField {
  return {
    elevation: new Float32Array(w * h).fill(elev),
    moisture: new Float32Array(w * h),
    temperature: new Float32Array(w * h),
  };
}

function poi(id: string, x: number, y: number): POI {
  return { id, type: 'village', position: { x, y } };
}

function sizedPoi(id: string, x: number, y: number, size: POI['size']): POI {
  return { id, type: 'village', position: { x, y }, size };
}

/** Snapshot just the carve-relevant tile fields for byte-identical comparison. */
function snapshot(tiles: Tile[][]): { type: string; walkable: boolean }[] {
  return tiles.flat().map(t => ({ type: t.type, walkable: t.walkable }));
}

describe('buildRoadGraph', () => {
  it('produces one edge per connected POI pair', () => {
    const tiles = makeTiles(10, 1);
    const fields = flatField(10, 1);
    const pois = [poi('a', 0, 0), poi('b', 9, 0)];
    const conns: Connection[] = [{ from: 'a', to: 'b', type: 'road' }];

    const graph = buildRoadGraph(conns, pois, tiles, fields);

    expect(graph.edges).toHaveLength(1);
    const edge = graph.edges[0];
    expect(edge.feature).toBe('road');
    expect(edge.surface).toBe('dirt');
    expect(edge.polyline[0]).toEqual({ x: 0, y: 0 });
    expect(edge.polyline[edge.polyline.length - 1]).toEqual({ x: 9, y: 0 });

    // Endpoints are POI nodes that carry their poiRef.
    const a = graph.nodes.find(n => n.id === edge.a)!;
    const b = graph.nodes.find(n => n.id === edge.b)!;
    expect(a.kind).toBe('poi');
    expect(a.poiRef).toBe('a');
    expect(b.poiRef).toBe('b');
  });

  it('honours connection style (stone) and emits waypoint nodes', () => {
    const tiles = makeTiles(10, 1);
    const fields = flatField(10, 1);
    const pois = [poi('a', 0, 0), poi('b', 9, 0)];
    // Explicit waypoints → two segments, one interior waypoint node.
    const conns: Connection[] = [
      { from: 'a', to: 'b', type: 'road', style: 'stone',
        waypoints: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 9, y: 0 }] },
    ];

    const graph = buildRoadGraph(conns, pois, tiles, fields);

    expect(graph.edges).toHaveLength(2);
    expect(graph.edges.every(e => e.surface === 'stone')).toBe(true);
    expect(graph.nodes.some(n => n.kind === 'waypoint' && n.x === 4)).toBe(true);
  });

  it('records bridgeCells where the walker crosses water', () => {
    const tiles = makeTiles(7, 1);
    // A water band in the middle the road must bridge.
    tiles[0][3].type = 'shallow_water';
    tiles[0][3].walkable = false;
    const fields = flatField(7, 1);
    const pois = [poi('a', 0, 0), poi('b', 6, 0)];
    const conns: Connection[] = [{ from: 'a', to: 'b', type: 'road' }];

    const graph = buildRoadGraph(conns, pois, tiles, fields);
    const edge = graph.edges[0];

    expect(edge.bridgeCells.length).toBeGreaterThan(0);
    // The bridged cell index = y*width + x = 0*7 + 3.
    expect(edge.bridgeCells).toContain(3);
    expect(tiles[0][3].type).toBe('bridge');
    expect(tiles[0][3].walkable).toBe(true);
  });

  it('carves a river connection as water tiles', () => {
    const tiles = makeTiles(6, 1);
    const fields = flatField(6, 1);
    const pois = [poi('src', 0, 0), poi('sea', 5, 0)];
    const conns: Connection[] = [{ from: 'src', to: 'sea', type: 'river' }];

    const graph = buildRoadGraph(conns, pois, tiles, fields);

    expect(graph.edges[0].feature).toBe('river');
    expect(graph.edges[0].surface).toBe('water');
    // River tiles are not walkable.
    expect(tiles[0][2].type).toBe('river');
    expect(tiles[0][2].walkable).toBe(false);
  });

  it('returns an empty graph when there are no connections', () => {
    const graph = buildRoadGraph(undefined, [], makeTiles(3, 3), flatField(3, 3));
    expect(graph).toEqual({ nodes: [], edges: [] });
  });

  // ── C-4b: only a ROAD carries bridge cells (a river/wall must not stamp a stray bridge tile) ──
  it('records NO bridge cells on a non-road (river) edge — no stray bridge tile with no deck', () => {
    const tiles = makeTiles(6, 1);
    const fields = flatField(6, 1);
    // A foreign water cell the river routes through. `autoBridge:true` lets the walker cross it
    // (so `walkRoad` DOES log it as a water cell on the path) — the point is the river EDGE must
    // still record no bridge cell, so applyEdge never stamps a deckless `bridge` tile there.
    tiles[0][3].type = 'shallow_water';
    const pois = [poi('src', 0, 0), poi('sea', 5, 0)];
    const graph = buildRoadGraph([{ from: 'src', to: 'sea', type: 'river', autoBridge: true }], pois, tiles, fields);
    expect(graph.edges[0].feature).toBe('river');
    expect(graph.edges[0].bridgeCells).toEqual([]);          // never a bridge deck under a river
    expect(tiles[0][3].type).not.toBe('bridge');             // the cell stays water/river, not bridge
  });

  it('a ROAD over the same water band DOES record bridge cells (the contrast — deck follows)', () => {
    const tiles = makeTiles(6, 1);
    const fields = flatField(6, 1);
    tiles[0][3].type = 'shallow_water';
    const pois = [poi('a', 0, 0), poi('b', 5, 0)];
    const graph = buildRoadGraph([{ from: 'a', to: 'b', type: 'road' }], pois, tiles, fields);
    expect(graph.edges[0].feature).toBe('road');
    expect(graph.edges[0].bridgeCells).toContain(3);         // the road bridges → a deck is realized
  });

  it('tiers a road by the more significant endpoint (Slice 4)', () => {
    const tiles = makeTiles(8, 1);
    const fields = flatField(8, 1);
    // huge↔small ⇒ highway; large↔medium ⇒ road; medium↔small ⇒ track; small↔small ⇒ path.
    const cases: Array<[POI['size'], POI['size'], string]> = [
      ['huge', 'small', 'highway'],
      ['large', 'medium', 'road'],
      ['medium', 'small', 'track'],
      ['small', 'small', 'path'],
    ];
    for (const [sa, sb, expected] of cases) {
      const pois = [sizedPoi('a', 0, 0, sa), sizedPoi('b', 7, 0, sb)];
      const conns: Connection[] = [{ from: 'a', to: 'b', type: 'road' }];
      const graph = buildRoadGraph(conns, pois, makeTiles(8, 1), fields);
      expect(graph.edges[0].class, `${sa}↔${sb}`).toBe(expected);
    }
    void tiles;
  });

  it('leaves rivers on the neutral class label', () => {
    const tiles = makeTiles(6, 1);
    const fields = flatField(6, 1);
    const pois = [sizedPoi('hi', 0, 0, 'huge'), sizedPoi('lo', 5, 0, 'small')];
    const graph = buildRoadGraph([{ from: 'hi', to: 'lo', type: 'river' }], pois, tiles, fields);
    expect(graph.edges[0].class).toBe('road'); // class is meaningless for rivers
  });
});

describe('rasterizeRoadGraph (pure projection)', () => {
  it('is a pure function — same graph yields an equal mask', () => {
    const graph: RoadGraph = {
      nodes: [],
      edges: [{
        id: 're0', a: 'n0', b: 'n1', feature: 'road', class: 'road',
        surface: 'dirt', bridgeCells: [],
        polyline: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
      }],
    };
    const m1 = rasterizeRoadGraph(graph, 3, 1);
    const m2 = rasterizeRoadGraph(graph, 3, 1);
    expect(m1).toEqual(m2);
    expect(m1.writes).toHaveLength(3);
  });
});

describe('graph is the truth — derived carve reproduces worldgen byte-for-byte', () => {
  function scenario() {
    // Mixed scenario: two roads sharing a POI, a bridged water band, a river,
    // and stone vs dirt surfaces — exercises ordering + water-skip + bridges.
    const w = 12, h = 3;
    const tiles = makeTiles(w, h);
    tiles[1][5].type = 'shallow_water';
    tiles[1][5].walkable = false;
    const fields = flatField(w, h);
    const pois = [
      poi('a', 0, 1), poi('b', 11, 1), poi('c', 6, 0), poi('d', 6, 2),
    ];
    const conns: Connection[] = [
      { from: 'a', to: 'b', type: 'road' },                 // crosses the water → bridge
      { from: 'c', to: 'd', type: 'road', style: 'stone' }, // stone crossroad
      { from: 'a', to: 'c', type: 'river' },                // river carves water
    ];
    return { tiles, fields, pois, conns, w, h };
  }

  it('applyRoadMask(rasterizeRoadGraph(graph)) on fresh tiles == worldgen carve', () => {
    const { tiles, fields, pois, conns, w, h } = scenario();
    const fresh = makeTiles(w, h);
    // Reproduce the same non-default terrain on the fresh grid.
    fresh[1][5].type = 'shallow_water';
    fresh[1][5].walkable = false;

    // Worldgen path: build carves `tiles` as it walks.
    const graph = buildRoadGraph(conns, pois, tiles, fields);

    // Derived path: rasterize the graph and replay onto the fresh grid.
    const mask = rasterizeRoadGraph(graph, w, h);
    applyRoadMask(fresh, mask);

    expect(snapshot(fresh)).toEqual(snapshot(tiles));
    // And it actually did something (roads + river carved).
    expect(snapshot(tiles).some(c => c.type === 'dirt_road')).toBe(true);
    expect(snapshot(tiles).some(c => c.type === 'river')).toBe(true);
  });

  it('preserves the overwritten biome in baseType so the ground under a road is recoverable', () => {
    const w = 8, h = 1;
    const tiles = makeTiles(w, h, 'grass');
    const fields = flatField(w, h);
    const pois = [poi('a', 0, 0), poi('b', 7, 0)];
    const conns: Connection[] = [{ from: 'a', to: 'b', type: 'road' }];

    const graph = buildRoadGraph(conns, pois, tiles, fields);
    const carriageway = tiles.flat().filter(t => t.type === 'dirt_road' || t.type === 'stone_road');
    expect(carriageway.length).toBeGreaterThan(0);
    // Every carved road cell remembers it was grass; off-road cells keep none.
    expect(carriageway.every(t => t.baseType === 'grass')).toBe(true);
    expect(tiles.flat().filter(t => t.type === 'grass').every(t => t.baseType === undefined)).toBe(true);

    // Re-deriving onto a fresh grid reproduces baseType too (save-safe).
    const fresh = makeTiles(w, h, 'grass');
    applyRoadMask(fresh, rasterizeRoadGraph(graph, w, h));
    expect(fresh.flat().map(t => t.baseType)).toEqual(tiles.flat().map(t => t.baseType));
  });

  it('reproduces bridges across a water wall through the rasterize round-trip', () => {
    // A full-height water column forces the road to bridge (no detour).
    const w = 7, h = 3;
    const tiles = makeTiles(w, h);
    const fresh = makeTiles(w, h);
    for (let y = 0; y < h; y++) {
      for (const grid of [tiles, fresh]) {
        grid[y][3].type = 'deep_water';
        grid[y][3].walkable = false;
      }
    }
    const fields = flatField(w, h);
    const pois = [poi('a', 0, 1), poi('b', 6, 1)];
    const conns: Connection[] = [{ from: 'a', to: 'b', type: 'road' }];

    const graph = buildRoadGraph(conns, pois, tiles, fields);
    applyRoadMask(fresh, rasterizeRoadGraph(graph, w, h));

    expect(snapshot(tiles).some(c => c.type === 'bridge')).toBe(true);
    expect(snapshot(fresh)).toEqual(snapshot(tiles));
  });

  it('survives a JSON persistence round-trip and re-derives identically', () => {
    const { tiles, fields, pois, conns, w, h } = scenario();
    const graph = buildRoadGraph(conns, pois, tiles, fields);

    const restored: RoadGraph = JSON.parse(JSON.stringify(graph));
    expect(restored).toEqual(graph);

    const fresh = makeTiles(w, h);
    fresh[1][5].type = 'shallow_water';
    fresh[1][5].walkable = false;
    applyRoadMask(fresh, rasterizeRoadGraph(restored, w, h));

    expect(snapshot(fresh)).toEqual(snapshot(tiles));
  });
});
