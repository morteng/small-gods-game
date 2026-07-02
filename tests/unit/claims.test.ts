import { describe, it, expect } from 'vitest';
import {
  ClaimsLedger, classifyPair, conflictClasses, buildClaimsFromWorld,
  type ClaimKind,
} from '@/world/claims';
import { claimsUnresolvedRule } from '@/world/claims-diagnostics';
import { World } from '@/world/world';
import type { GameMap, Entity, Tile } from '@/core/types';

// ── Matrix ─────────────────────────────────────────────────────────────────────────

describe('claims — compatibility matrix', () => {
  it('is symmetric (order of the two kinds does not matter)', () => {
    const pairs: [ClaimKind, ClaimKind][] = [
      ['road', 'water'], ['barrier', 'water'], ['road', 'barrier'],
      ['building', 'water'], ['road', 'building'], ['barrier', 'building'],
      ['road', 'road'], ['crossing', 'water'], ['crossing', 'road'],
    ];
    for (const [a, b] of pairs) {
      expect(classifyPair(a, b)).toEqual(classifyPair(b, a));
    }
  });

  it('assigns the documented disposition to each rated pair', () => {
    expect(classifyPair('road', 'water').disposition).toBe('needs');
    expect(classifyPair('barrier', 'water').disposition).toBe('needs');
    expect(classifyPair('road', 'barrier').disposition).toBe('needs');
    expect(classifyPair('building', 'water').disposition).toBe('conflict');
    expect(classifyPair('road', 'building').disposition).toBe('conflict');
    expect(classifyPair('barrier', 'building').disposition).toBe('conflict');
    expect(classifyPair('building', 'building').disposition).toBe('conflict');
    expect(classifyPair('road', 'road').disposition).toBe('overlap');
  });

  it('treats crossings as compatible with water/road/barrier/building (they are the resolution)', () => {
    expect(classifyPair('crossing', 'water').disposition).toBe('ok');
    expect(classifyPair('crossing', 'road').disposition).toBe('ok');
    expect(classifyPair('crossing', 'barrier').disposition).toBe('ok');
    expect(classifyPair('crossing', 'building').disposition).toBe('ok');
  });

  it('defaults un-ruled pairs (and inert same-kind pairs) to ok', () => {
    expect(classifyPair('earthwork', 'stair').disposition).toBe('ok');
    expect(classifyPair('water', 'water').disposition).toBe('ok');
    expect(classifyPair('barrier', 'barrier').disposition).toBe('ok');
    expect(classifyPair('stair', 'road').disposition).toBe('ok');
  });

  it('exposes exactly the eight non-ok conflict classes', () => {
    expect(conflictClasses().map((r) => r.class)).toEqual([
      'barrier-x-building', 'barrier-x-water', 'building-x-building',
      'building-x-water', 'road-x-barrier', 'road-x-building',
      'road-x-water', 'road-x-road',
    ].sort());
  });
});

// ── Ledger — every conflict class from synthetic claims ──────────────────────────────

/** A synthetic ledger that exercises EVERY non-ok conflict class, one per cell column. */
function everyClassLedger(): ClaimsLedger {
  const led = new ClaimsLedger();
  led.claim('water', 'water', [[0, 0], [1, 0], [2, 0], [4, 0]]);
  led.claim('r1', 'road', [[0, 0]]);                 // road×water (unresolved)
  led.claim('r1b', 'road', [[1, 0]]);                // road×water (resolved below)
  led.claim('c1', 'crossing', [[1, 0]]);
  led.resolve('road-x-water', 'c1', 'water', 'c1', [[1, 0]]);
  led.claim('b1', 'barrier', [[2, 0]]);              // barrier×water
  led.claim('r2', 'road', [[3, 0]]);                 // road×barrier
  led.claim('b2', 'barrier', [[3, 0]]);
  led.claim('h1', 'building', [[4, 0]]);             // building×water
  led.claim('r3', 'road', [[5, 0]]);                 // road×building
  led.claim('h2', 'building', [[5, 0]]);
  led.claim('b3', 'barrier', [[6, 0]]);              // barrier×building
  led.claim('h3', 'building', [[6, 0]]);
  led.claim('h4', 'building', [[7, 0]]);             // building×building
  led.claim('h5', 'building', [[7, 0]]);
  led.claim('rA', 'road', [[8, 0]]);                 // road×road (info overlap)
  led.claim('rB', 'road', [[8, 0]]);
  return led;
}

describe('claims — ledger conflict detection', () => {
  it('detects every non-ok conflict class with the right severity', () => {
    const rep = everyClassLedger().report();
    const byClass = new Map(rep.conflicts.map((c) => [c.conflictClass, c]));
    // All eight classes present…
    for (const cls of [
      'road-x-water', 'barrier-x-water', 'road-x-barrier', 'building-x-water',
      'road-x-building', 'barrier-x-building', 'building-x-building', 'road-x-road',
    ]) {
      expect(byClass.has(cls), `missing ${cls}`).toBe(true);
    }
    // road×road is the only info-grade overlap; the rest are errors.
    expect(byClass.get('road-x-road')!.severity).toBe('info');
    for (const [cls, c] of byClass) {
      if (cls !== 'road-x-road') expect(c.severity).toBe('error');
    }
  });

  it('marks needs-classes resolvable and conflict-classes not', () => {
    const byClass = new Map(everyClassLedger().report().conflicts.map((c) => [c.conflictClass, c]));
    expect(byClass.get('road-x-water')!.resolvable).toBe(true);
    expect(byClass.get('barrier-x-water')!.resolvable).toBe(true);
    expect(byClass.get('road-x-barrier')!.resolvable).toBe(true);
    expect(byClass.get('building-x-building')!.resolvable).toBe(false);
    expect(byClass.get('road-x-building')!.resolvable).toBe(false);
  });

  it('names the resolving WP-C artifact on each conflict', () => {
    const byClass = new Map(everyClassLedger().report().conflicts.map((c) => [c.conflictClass, c]));
    expect(byClass.get('road-x-water')!.artifact).toContain('crossing');
    expect(byClass.get('road-x-road')!.artifact).toContain('RoadJunction');
  });

  it('ignores same-feature self-overlap', () => {
    const led = new ClaimsLedger();
    led.claim('r1', 'road', [[0, 0], [0, 0], [1, 0]]);   // same feature claims a cell twice
    led.claim('water', 'water', []);
    expect(led.conflicts()).toEqual([]);
  });
});

// ── Resolution accounting ────────────────────────────────────────────────────────────

describe('claims — resolution accounting', () => {
  it('does not report a resolved cell and counts it under resolved[class]', () => {
    const led = new ClaimsLedger();
    led.claim('water', 'water', [[0, 0], [1, 0]]);
    led.claim('r1', 'road', [[0, 0], [1, 0]]);           // two road×water cells
    led.claim('c1', 'crossing', [[1, 0]]);
    led.resolve('road-x-water', 'c1', 'water', 'c1', [[1, 0]]);   // resolve one of them
    const rep = led.report();
    const rw = rep.conflicts.filter((c) => c.conflictClass === 'road-x-water');
    expect(rw).toHaveLength(1);
    expect(rw[0].cells).toEqual([[0, 0]]);               // only the UN-resolved cell remains
    expect(rw[0].resolvedCells).toBe(1);
    expect(rep.resolved['road-x-water']).toBe(1);
  });

  it('drops a conflict entirely when every cell is resolved', () => {
    const led = new ClaimsLedger();
    led.claim('water', 'water', [[0, 0]]);
    led.claim('r1', 'road', [[0, 0]]);
    led.resolve('road-x-water', 'r1', 'water', 'c1', [[0, 0]]);
    expect(led.conflicts().filter((c) => c.conflictClass === 'road-x-water')).toEqual([]);
    expect(led.report().resolved['road-x-water']).toBe(1);
  });

  it('a resolution only applies to its own conflict class', () => {
    const led = new ClaimsLedger();
    led.claim('water', 'water', [[0, 0]]);
    led.claim('b1', 'barrier', [[0, 0]]);                // barrier×water at (0,0)
    led.resolve('road-x-water', 'x', 'y', 'z', [[0, 0]]); // wrong class → no effect
    expect(led.conflicts().some((c) => c.conflictClass === 'barrier-x-water')).toBe(true);
  });
});

// ── Determinism ──────────────────────────────────────────────────────────────────────

describe('claims — determinism', () => {
  it('two builds of the same claim set produce deep-equal reports', () => {
    expect(everyClassLedger().report()).toEqual(everyClassLedger().report());
  });

  it('claim/resolve ORDER does not change the report', () => {
    const a = new ClaimsLedger();
    a.claim('water', 'water', [[0, 0]]);
    a.claim('r1', 'road', [[0, 0]]);
    a.claim('r2', 'road', [[0, 0]]);
    const b = new ClaimsLedger();
    b.claim('r2', 'road', [[0, 0]]);
    b.claim('r1', 'road', [[0, 0]]);
    b.claim('water', 'water', [[0, 0]]);
    expect(a.report()).toEqual(b.report());
  });
});

// ── buildClaimsFromWorld — a real (small) synthetic world ─────────────────────────────

function tile(type: string, baseType?: string): Tile {
  return { type, baseType, walkable: type !== 'river' } as unknown as Tile;
}
function grid(w: number, h: number): Tile[][] {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => tile('grass')));
}
function roadEdge(id: string, cells: [number, number][]) {
  return { id, a: '', b: '', feature: 'road', class: 'road', surface: 'dirt',
    polyline: cells.map(([x, y]) => ({ x, y })), bridgeCells: [] };
}
function buildingEntity(id: string, x: number, y: number, blocked: string[]): Entity {
  return {
    id, kind: 'cottage', x, y, tags: ['building', 'residential'],
    properties: {
      category: 'building',
      blueprint: { rb: {}, collision: { footprint: { w: 1, h: 1 }, blocked, doorCells: [] }, anchors: [] },
    },
  } as unknown as Entity;
}

/** A 10×3 world: a river column at x=4 with a bridge crossing (y=1), a bridgeless ford at
 *  (2,0), a road junction at (6,1), a wall wading the river at (4,2), and a dry cottage. */
function syntheticWorld(): { world: World; map: GameMap } {
  const W = 10, H = 3;
  const tiles = grid(W, H);
  tiles[0][4] = tile('river');
  tiles[2][4] = tile('river');
  tiles[1][4] = tile('bridge', 'river');   // the crossing (bridge tile)
  tiles[0][2] = tile('dirt_road', 'river'); // a bridgeless FORD (road over water, no bridge)

  const map = {
    width: W, height: H, tiles, villages: [], seed: 1, success: true, worldSeed: null,
    stats: { iterations: 0, backtracks: 0 }, buildings: [],
    roadGraph: {
      nodes: [],
      edges: [
        roadEdge('re0', [[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1], [8, 1]]),
        roadEdge('re1', [[1, 0], [2, 0]]),          // the ford edge (through (2,0))
        roadEdge('re2', [[6, 0], [6, 1], [6, 2]]),  // junction with re0 at (6,1)
      ],
    },
    barrierRuns: [
      { id: 'wall1', run: { kind: 'wall', path: [[3, 2], [5, 2]], height: 1, thickness: 1, material: 'stone', gates: [] } },
    ],
  } as unknown as GameMap;

  const world = new World(map);
  // a crossing entity co-located with the bridge tile, to exercise the entity path
  world.addEntity({ id: 'bridge_deck#1', kind: 'bridge_deck', x: 4, y: 1, tags: ['prop', 'infrastructure'],
    properties: { footprint: { w: 1, h: 1 } } } as unknown as Entity);
  world.addEntity(buildingEntity('cottage#1', 7, 2, ['0,0']));
  return { world, map };
}

describe('buildClaimsFromWorld — synthetic world', () => {
  it('resolves the bridged crossing but flags the bridgeless ford', () => {
    const { world, map } = syntheticWorld();
    const rep = buildClaimsFromWorld(world, map).report();
    const rw = rep.conflicts.filter((c) => c.conflictClass === 'road-x-water');
    expect(rw).toHaveLength(1);
    expect(rw[0].featureA).toBe('re1');
    expect(rw[0].featureB).toBe('water');
    expect(rw[0].cells).toEqual([[2, 0]]);            // the ford, unresolved
    expect(rep.resolved['road-x-water']).toBeGreaterThanOrEqual(1); // the bridge cell (4,1)
  });

  it('surfaces the road junction as an info overlap', () => {
    const { world, map } = syntheticWorld();
    const rep = buildClaimsFromWorld(world, map).report();
    const rr = rep.conflicts.filter((c) => c.conflictClass === 'road-x-road');
    expect(rr).toHaveLength(1);
    expect(rr[0].severity).toBe('info');
    expect(rr[0].cells).toEqual([[6, 1]]);
    expect([rr[0].featureA, rr[0].featureB].sort()).toEqual(['re0', 're2']);
  });

  it('flags the wall wading the river', () => {
    const { world, map } = syntheticWorld();
    const rep = buildClaimsFromWorld(world, map).report();
    const bw = rep.conflicts.filter((c) => c.conflictClass === 'barrier-x-water');
    expect(bw).toHaveLength(1);
    expect(bw[0].cells).toEqual([[4, 2]]);
    expect(bw[0].featureA).toBe('wall1');
  });

  it('does not flag the dry cottage', () => {
    const { world, map } = syntheticWorld();
    const rep = buildClaimsFromWorld(world, map).report();
    expect(rep.conflicts.some((c) => c.conflictClass.startsWith('building'))).toBe(false);
    expect(rep.conflicts.some((c) => c.conflictClass === 'road-x-building')).toBe(false);
  });

  it('is deterministic across two builds of the same world', () => {
    const { world, map } = syntheticWorld();
    expect(buildClaimsFromWorld(world, map).report()).toEqual(buildClaimsFromWorld(world, map).report());
  });
});

// ── Diagnostic rule ──────────────────────────────────────────────────────────────────

describe('claims.unresolved diagnostic rule', () => {
  it('emits error diagnostics for un-resolved conflicts and info for junctions', () => {
    const { world, map } = syntheticWorld();
    const diags = claimsUnresolvedRule.evaluate({ world, map });
    expect(diags.length).toBeGreaterThan(0);
    for (const d of diags) expect(d.rule).toBe('claims.unresolved');

    const errs = diags.filter((d) => d.severity === 'error');
    const infos = diags.filter((d) => d.severity === 'info');
    expect(errs.some((d) => d.message.startsWith('road-x-water'))).toBe(true);
    expect(errs.some((d) => d.message.startsWith('barrier-x-water'))).toBe(true);
    expect(infos.some((d) => d.message.startsWith('road-x-road'))).toBe(true);

    const ford = errs.find((d) => d.message.startsWith('road-x-water'))!;
    expect(ford.metrics?.cells).toBe(1);
    expect(ford.locus.entities).toContain('re1');
    expect(ford.locus.tiles).toContainEqual({ x: 2, y: 0 });
  });

  it('is registered into DEFAULT_RULES (wired at integration)', async () => {
    const { DEFAULT_RULES } = await import('@/world/connectome-diagnostics');
    expect(DEFAULT_RULES.some((r) => r.id === 'claims.unresolved')).toBe(true);
  });
});
