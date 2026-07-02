import { describe, it, expect } from 'vitest';
import { evaluateConnectome, DEFAULT_RULES, type DiagnosticContext } from '@/world/connectome-diagnostics';
import type { Entity } from '@/core/types';

/** Minimal fakes — the graph rules read only `map.roadGraph`; the footprint rules read
 *  `world.query({tag})`, which returns [] here (covered live + by spatial-invariants). */
function ctx(graph: unknown): DiagnosticContext {
  return {
    world: { query: () => [] } as unknown as DiagnosticContext['world'],
    map: { width: 8, height: 8, tiles: [], roadGraph: graph } as unknown as DiagnosticContext['map'],
  };
}

const node = (id: string, poiRef?: string) => ({ id, x: 0, y: 0, kind: poiRef ? 'poi' : 'waypoint', poiRef });
const edge = (id: string, a: string, b: string, feature = 'road') =>
  ({ id, a, b, feature, class: 'road', surface: 'dirt', polyline: [], bridgeCells: [] });

describe('connectome diagnostics', () => {
  it('flags parallel roads between the same two places', () => {
    const graph = {
      nodes: [node('n:church', 'poi:church'), node('n:tavern', 'poi:tavern'), node('w:1')],
      // two distinct edges church↔tavern (one direct, one via a waypoint that still
      // resolves to the same POI pair), plus an unrelated edge.
      edges: [
        edge('e:1', 'n:church', 'n:tavern'),
        edge('e:2', 'n:tavern', 'n:church'),
        edge('e:3', 'n:church', 'w:1'),
      ],
    };
    const rep = evaluateConnectome(ctx(graph));
    const parallel = rep.diagnostics.filter((d) => d.rule === 'road.redundant-parallel');
    expect(parallel).toHaveLength(1);
    expect(parallel[0].severity).toBe('warn');
    expect(parallel[0].metrics?.count).toBe(2);
    expect(parallel[0].locus.edges).toEqual(['e:1', 'e:2']);
    expect(parallel[0].suggestedFix?.verb).toBe('merge_roads');
  });

  it('does not flag a single road between two places', () => {
    const graph = { nodes: [node('a'), node('b')], edges: [edge('e', 'a', 'b')] };
    const rep = evaluateConnectome(ctx(graph));
    expect(rep.byRule['road.redundant-parallel'] ?? 0).toBe(0);
  });

  it('flags an oversubscribed junction (pressure point) above the degree budget', () => {
    const hub = node('hub');
    const spokes = ['a', 'b', 'c', 'd', 'e', 'f'].map((s) => node(s));
    const graph = {
      nodes: [hub, ...spokes],
      edges: spokes.map((s, i) => edge(`e:${i}`, 'hub', s.id)),
    };
    const rep = evaluateConnectome(ctx(graph));
    const press = rep.diagnostics.filter((d) => d.rule === 'junction.oversubscribed');
    expect(press).toHaveLength(1);
    expect(press[0].severity).toBe('info');
    expect(press[0].metrics?.degree).toBe(6);
    expect(press[0].locus.nodes).toEqual(['hub']);
  });

  it('ignores river/wall edges in road rules', () => {
    const graph = {
      nodes: [node('a'), node('b')],
      edges: [edge('r:1', 'a', 'b', 'river'), edge('r:2', 'a', 'b', 'river')],
    };
    const rep = evaluateConnectome(ctx(graph));
    expect(rep.byRule['road.redundant-parallel'] ?? 0).toBe(0);
  });

  it('grades the report by severity and rule', () => {
    const graph = {
      nodes: [node('a'), node('b')],
      edges: [edge('e:1', 'a', 'b'), edge('e:2', 'a', 'b')],
    };
    const rep = evaluateConnectome(ctx(graph));
    expect(rep.total).toBe(rep.diagnostics.length);
    expect(rep.counts.warn).toBe(1);
    expect(rep.byRule['road.redundant-parallel']).toBe(1);
  });

  it('a clean world produces an empty report', () => {
    const rep = evaluateConnectome(ctx({ nodes: [], edges: [] }));
    expect(rep.total).toBe(0);
    expect(rep.counts).toEqual({ error: 0, warn: 0, info: 0 });
  });

  it('flags a building standing on a water tile (and not one on land)', () => {
    const mkCtx = (wet: boolean): DiagnosticContext => {
      const e = {
        id: 'b1', kind: 'cottage', x: 3, y: 3, tags: ['building'],
        properties: { blueprint: { collision: { footprint: { w: 1, h: 1 }, blocked: ['0,0'], doorCells: [] } } },
      };
      const tiles = Array.from({ length: 8 }, (_, y) => Array.from({ length: 8 }, (_, x) =>
        ({ type: wet && x === 3 && y === 3 ? 'river' : 'grass' })));
      return {
        world: { query: (o: { tag?: string }) => (o?.tag === 'building' ? [e] : []) } as unknown as DiagnosticContext['world'],
        map: { width: 8, height: 8, tiles, roadGraph: { nodes: [], edges: [] } } as unknown as DiagnosticContext['map'],
      };
    };
    const wet = evaluateConnectome(mkCtx(true)).diagnostics.filter((d) => d.rule === 'building.on-water');
    expect(wet).toHaveLength(1);
    expect(wet[0].severity).toBe('error');
    expect(wet[0].locus.entities).toEqual(['b1']);
    expect(evaluateConnectome(mkCtx(false)).byRule['building.on-water'] ?? 0).toBe(0);
  });

  it('flags a road running alongside water, but not one away from it or one that just crosses', () => {
    // a 20-tile road; water sits ~1.5 tiles to its side along the whole run.
    const road = (id: string, bridgeCells: number[] = []) => ({
      id, a: 'a', b: 'b', feature: 'road', class: 'road', surface: 'dirt', bridgeCells,
      polyline: Array.from({ length: 21 }, (_, i) => ({ x: i, y: 10 })),
    });
    const W = 32;
    const tiles = Array.from({ length: 32 }, (_, y) => Array.from({ length: W }, (_, x) =>
      ({ type: y === 12 && x < 21 ? 'river' : 'grass' })));   // river 2 tiles south of the road
    const mk = (rd: ReturnType<typeof road>) => ({
      world: { query: () => [] } as unknown as DiagnosticContext['world'],
      map: { width: W, height: 32, tiles, roadGraph: { nodes: [], edges: [rd] } } as unknown as DiagnosticContext['map'],
    });
    const hits = (c: ReturnType<typeof mk>) => evaluateConnectome(c).diagnostics.filter((d) => d.rule === 'road.riverside-unbanked');
    expect(hits(mk(road('riverside')))).toHaveLength(1);
    // a road far from any water (no river tiles in range) is not flagged
    const dry = { world: { query: () => [] } as unknown as DiagnosticContext['world'],
      map: { width: W, height: 32, tiles: Array.from({ length: 32 }, () => Array.from({ length: W }, () => ({ type: 'grass' }))), roadGraph: { nodes: [], edges: [road('dry')] } } as unknown as DiagnosticContext['map'] };
    expect(evaluateConnectome(dry).byRule['road.riverside-unbanked'] ?? 0).toBe(0);
  });

  it('flags a barrier standing in water (and not one on land)', () => {
    const mkCtx = (wet: boolean): DiagnosticContext => {
      const e = {
        id: 'ring1', kind: 'barrier', x: 0, y: 0, tags: ['barrier'],
        properties: { footprintCells: [[2, 2], [3, 2], [4, 2]] },
      };
      const tiles = Array.from({ length: 8 }, (_, y) => Array.from({ length: 8 }, (_, x) =>
        ({ type: wet && x === 3 && y === 2 ? 'river' : 'grass' })));
      return {
        world: { query: (o: { tag?: string }) => (o?.tag === 'barrier' ? [e] : []) } as unknown as DiagnosticContext['world'],
        map: { width: 8, height: 8, tiles, roadGraph: { nodes: [], edges: [] } } as unknown as DiagnosticContext['map'],
      };
    };
    const wet = evaluateConnectome(mkCtx(true)).diagnostics.filter((d) => d.rule === 'barrier.over-water');
    expect(wet).toHaveLength(1);
    expect(wet[0].severity).toBe('error');
    expect(wet[0].locus.entities).toEqual(['ring1']);
    expect(wet[0].locus.tiles).toEqual([{ x: 3, y: 2 }]);
    expect(evaluateConnectome(mkCtx(false)).byRule['barrier.over-water'] ?? 0).toBe(0);
  });

  it('flags a bridgeless ford (road whose baseType is water), not a bridge or a causeway', () => {
    const mk = (mid: { type: string; baseType?: string }): DiagnosticContext => {
      const tiles = Array.from({ length: 8 }, (_, y) => Array.from({ length: 8 }, (_, x) =>
        (y === 4 && x === 4 ? { ...mid } : { type: y === 4 ? 'river' : 'grass' })));
      return {
        world: { query: () => [] } as unknown as DiagnosticContext['world'],
        map: { width: 8, height: 8, tiles, roadGraph: { nodes: [], edges: [] } } as unknown as DiagnosticContext['map'],
      };
    };
    // A road stamped OVER water (baseType preserved as river) is a ford.
    expect(evaluateConnectome(mk({ type: 'dirt_road', baseType: 'river' })).byRule['road.on-water']).toBe(1);
    // A bridge over the same water is the sanctioned crossing.
    expect(evaluateConnectome(mk({ type: 'bridge', baseType: 'river' })).byRule['road.on-water'] ?? 0).toBe(0);
    // A road on a dry spit between waters (baseType grass — a causeway) is legitimate.
    expect(evaluateConnectome(mk({ type: 'dirt_road', baseType: 'grass' })).byRule['road.on-water'] ?? 0).toBe(0);
  });

  it('exposes a stable default rule set', () => {
    expect(DEFAULT_RULES.map((r) => r.id)).toEqual([
      'building.overlap', 'barrier.through-building', 'barrier.over-water',
      'road.through-building', 'building.on-water', 'road.on-water',
      'bridge.seating', 'bridge.tiles-vs-deck',
      'road.redundant-parallel', 'road.parallel-corridor', 'road.riverside-unbanked',
      'carve.dry-pit',
      'junction.oversubscribed', 'fort.building-outside-enclosure', 'fort.gate-obstructed',
      'fort.ward-unreachable', 'fort.spoil-imbalance',
      'claims.unresolved',
    ]);
  });

  // ── A1: dense barrier-over-water polyline sampling ─────────────────────────────────
  it('flags a barrier POLYLINE crossing open water between two rasterized cells, honouring gate/gap spans', () => {
    // Path runs along y=2 from x=0..10; a single wet tile sits at x=5 (t=5), well inside
    // one 0.34-tile rasterizer cell but easily caught by 0.5-tile dense sampling too.
    const mkCtx = (gates: { t: number; width: number; kind?: 'gate' | 'gap' }[]): DiagnosticContext => {
      const run = { kind: 'wall' as const, path: [[0, 2], [10, 2]] as [number, number][], height: 1, thickness: 1, material: 'stone', gates };
      const tiles = Array.from({ length: 8 }, (_, y) => Array.from({ length: 12 }, (_, x) =>
        ({ type: x === 5 && y === 2 ? 'river' : 'grass' })));
      return {
        world: { query: () => [] } as unknown as DiagnosticContext['world'],
        map: { width: 12, height: 8, tiles, roadGraph: { nodes: [], edges: [] }, barrierRuns: [{ id: 'ring1', run }] } as unknown as DiagnosticContext['map'],
      };
    };
    const undeclared = evaluateConnectome(mkCtx([])).diagnostics.filter((d) => d.rule === 'barrier.over-water');
    expect(undeclared).toHaveLength(1);
    expect(undeclared[0].locus.entities).toEqual(['ring1']);
    expect(undeclared[0].locus.tiles).toEqual([{ x: 5, y: 2 }]);
    expect(undeclared[0].metrics?.tStart).toBeLessThanOrEqual(5);
    expect(undeclared[0].metrics?.tEnd).toBeGreaterThanOrEqual(5);
    // A declared gap at t=5 spanning the wet tile clears it.
    const gapped = evaluateConnectome(mkCtx([{ t: 5, width: 2, kind: 'gap' }])).byRule['barrier.over-water'] ?? 0;
    expect(gapped).toBe(0);
  });

  it('does not flag a dry barrier polyline', () => {
    const run = { kind: 'wall' as const, path: [[0, 2], [10, 2]] as [number, number][], height: 1, thickness: 1, material: 'stone', gates: [] };
    const tiles = Array.from({ length: 8 }, () => Array.from({ length: 12 }, () => ({ type: 'grass' })));
    const c: DiagnosticContext = {
      world: { query: () => [] } as unknown as DiagnosticContext['world'],
      map: { width: 12, height: 8, tiles, roadGraph: { nodes: [], edges: [] }, barrierRuns: [{ id: 'ring1', run }] } as unknown as DiagnosticContext['map'],
    };
    expect(evaluateConnectome(c).byRule['barrier.over-water'] ?? 0).toBe(0);
  });

  // ── A2: carve.dry-pit ────────────────────────────────────────────────────────────────
  // Real deformation-channel worlds (needs a real seed heightfield): a small flat map with
  // an earthwork DITCH (annulus carve) either isolated (dry pit) or beside water/road (fine).
  function dryPitMap(opts: { moat: boolean }): DiagnosticContext['map'] {
    const W = 24, H = 24;
    const cx = 12, cy = 12, r = 5, width = 3;
    const tiles = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => {
      // A "moat" fills the WHOLE carved annulus band with water (not just one point beside
      // it) — the realistic case a carved ring holds water instead of standing dry.
      if (opts.moat) {
        const d = Math.hypot(x - cx, y - cy);
        if (d >= r - width / 2 && d <= r + width / 2) return { type: 'river' };
      }
      return { type: 'grass' };
    }));
    return {
      seed: 1234, width: W, height: H, worldSeed: null, tiles,
      earthworks: [{ kind: 'ditch', ring: { cx, cy, r, width }, height: -6, volume: -400 }],
    } as unknown as DiagnosticContext['map'];
  }

  it('flags an isolated carved ditch as a dry pit', () => {
    const c: DiagnosticContext = { world: { query: () => [] } as unknown as DiagnosticContext['world'], map: dryPitMap({ moat: false }) };
    const hits = evaluateConnectome(c).diagnostics.filter((d) => d.rule === 'carve.dry-pit');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].severity).toBe('warn');
    expect(hits[0].metrics?.maxDepthM).toBeGreaterThan(1.2);
  });

  it('does not flag a carved ditch that holds water (a moat)', () => {
    const c: DiagnosticContext = { world: { query: () => [] } as unknown as DiagnosticContext['world'], map: dryPitMap({ moat: true }) };
    const hits = evaluateConnectome(c).diagnostics.filter((d) => d.rule === 'carve.dry-pit');
    expect(hits).toHaveLength(0);
  });

  it('a world with no earthworks/deformations has no dry-pit findings', () => {
    const W = 12, H = 12;
    const tiles = Array.from({ length: H }, () => Array.from({ length: W }, () => ({ type: 'grass' })));
    const map = { seed: 1, width: W, height: H, worldSeed: null, tiles } as unknown as DiagnosticContext['map'];
    const c: DiagnosticContext = { world: { query: () => [] } as unknown as DiagnosticContext['world'], map };
    expect(evaluateConnectome(c).byRule['carve.dry-pit'] ?? 0).toBe(0);
  });

  // ── A3/A4: bridge deck ↔ bridge tile agreement ──────────────────────────────────────
  /** A minimal `bridge_deck` entity shaped like `crossing-structures.ts` output: an
   *  axis-aligned 3×1 deck spanning x=4..6 at y=5 (yaw 0°, length 3 tiles = 6 m). */
  function deckEntity(id: string, ox: number, oy: number, w = 3, h = 1, yawDeg = 0): Entity {
    return {
      id, kind: 'bridge_deck', x: ox, y: oy, tags: ['prop', 'infrastructure'],
      properties: {
        blueprint: { rb: { footprint: { w, h }, parts: [{ type: 'deck', at: { x: 0, y: 0 }, params: { yawDeg, lengthM: w * 2 } }] } },
      },
    } as unknown as Entity;
  }
  function bridgeCtx(opts: { tiles: string[][]; decks: Entity[] }): DiagnosticContext {
    const tiles = opts.tiles.map((row) => row.map((type) => ({ type })));
    return {
      world: { query: (o: { kind?: string }) => (o?.kind === 'bridge_deck' ? opts.decks : []) } as unknown as DiagnosticContext['world'],
      map: { seed: 1, width: tiles[0].length, height: tiles.length, worldSeed: null, tiles, roadGraph: { nodes: [], edges: [] } } as unknown as DiagnosticContext['map'],
    };
  }
  const row = (w: number, wet: (x: number) => string) => Array.from({ length: w }, (_, x) => wet(x));
  const GRID_W = 10;

  it('flags a floating bridge deck (no water/channel beneath it)', () => {
    // Deck at x=4..6,y=5, but every tile is dry grass — nothing beneath the span.
    const tiles = Array.from({ length: 10 }, () => row(GRID_W, () => 'grass'));
    const ctx = bridgeCtx({ tiles, decks: [deckEntity('deck1', 4, 5)] });
    const hits = evaluateConnectome(ctx).diagnostics.filter((d) => d.rule === 'bridge.seating');
    expect(hits.some((d) => d.message.includes('floating span'))).toBe(true);
  });

  // With ox=4,oy=5,w=3,h=1,yawDeg=0 the deck is horizontal-dominant; its footprint-native
  // end EDGES are the leftmost column x=4 and rightmost column x=6 (each just one cell
  // tall since h=1): edgeA=[(4,5)], edgeB=[(6,5)].

  it('flags a bridge deck whose span end edge is ENTIRELY open water (unseated abutment)', () => {
    // Water beneath the footprint (x=5, satisfies the "beneath" seating check) AND at
    // BOTH end edges (x=4 and x=6) — so the deck never actually reaches a dry bank.
    const tiles = Array.from({ length: 10 }, () => row(GRID_W, () => 'grass'));
    tiles[5][4] = 'river'; tiles[5][5] = 'river'; tiles[5][6] = 'river';
    const ctx = bridgeCtx({ tiles, decks: [deckEntity('deck1', 4, 5)] });
    const hits = evaluateConnectome(ctx).diagnostics.filter((d) => d.rule === 'bridge.seating');
    expect(hits.some((d) => d.message.includes('unseated abutment'))).toBe(true);
  });

  it('a correctly seated deck (water beneath, dry banks at both ends) is clean', () => {
    // Water only at the centre tile beneath the footprint (x=5); the deck's own end
    // edges (x=4, x=6) stay dry grass — a proper bank-to-bank seating.
    const tiles = Array.from({ length: 10 }, () => row(GRID_W, () => 'grass'));
    tiles[5][5] = 'river';
    const ctx = bridgeCtx({ tiles, decks: [deckEntity('deck1', 4, 5)] });
    const hits = evaluateConnectome(ctx).diagnostics.filter((d) => d.rule === 'bridge.seating');
    expect(hits).toHaveLength(0);
  });

  it('a riverbank cutting through PART of an end edge (not the whole edge) is not flagged', () => {
    // A wider (2-tile) deck whose end edge has ONE wet cell and one dry cell — a real
    // diagonal riverbank crossing the edge obliquely, not an unseated abutment.
    const tiles = Array.from({ length: 10 }, () => row(GRID_W, () => 'grass'));
    tiles[5][5] = 'river';   // beneath the footprint
    tiles[5][4] = 'river';   // half of the left end edge (x=4, rows 5..6)
    const ctx = bridgeCtx({ tiles, decks: [deckEntity('deck1', 4, 5, 3, 2)] });
    const hits = evaluateConnectome(ctx).diagnostics.filter((d) => d.rule === 'bridge.seating');
    expect(hits.some((d) => d.message.includes('unseated abutment'))).toBe(false);
  });

  it('flags an un-bridged run of bridge tiles (no deck entity over it)', () => {
    const tiles = Array.from({ length: 10 }, (_, y) => row(GRID_W, (x) => (y === 5 && x >= 4 && x <= 6 ? 'bridge' : 'grass')));
    const ctx = bridgeCtx({ tiles, decks: [] }); // no deck entities at all
    const hits = evaluateConnectome(ctx).diagnostics.filter((d) => d.rule === 'bridge.tiles-vs-deck');
    expect(hits.some((d) => d.message.includes('has no bridge_deck entity over it'))).toBe(true);
  });

  it('flags a bridge_deck entity sitting over no bridge tile', () => {
    const tiles = Array.from({ length: 10 }, () => row(GRID_W, () => 'grass')); // no bridge tiles anywhere
    const ctx = bridgeCtx({ tiles, decks: [deckEntity('deck1', 4, 5)] });
    const hits = evaluateConnectome(ctx).diagnostics.filter((d) => d.rule === 'bridge.tiles-vs-deck');
    expect(hits.some((d) => d.message.includes('sits over no bridge tile'))).toBe(true);
  });

  it('agreeing bridge tiles and deck footprint are clean', () => {
    const tiles = Array.from({ length: 10 }, (_, y) => row(GRID_W, (x) => (y === 5 && x >= 4 && x <= 6 ? 'bridge' : 'grass')));
    const ctx = bridgeCtx({ tiles, decks: [deckEntity('deck1', 4, 5)] });
    const hits = evaluateConnectome(ctx).diagnostics.filter((d) => d.rule === 'bridge.tiles-vs-deck');
    expect(hits).toHaveLength(0);
  });
});
