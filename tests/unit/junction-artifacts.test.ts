import { describe, it, expect } from 'vitest';
import { ClaimsLedger } from '@/world/claims';
import {
  reconcile, deriveBuiltJunctions, applyJunctions, reconcileWorld,
  type JunctionArtifact,
} from '@/world/junction-artifacts';
import { World } from '@/world/world';
import type { GameMap, Entity, Tile } from '@/core/types';

// ── A synthetic ledger exercising every conflict class ────────────────────────────────
//
// One conflict per cell column: road×water (ford), barrier×water, road×barrier, building×water,
// road×building, barrier×building, building×building, road×road. The `needs` classes (the first
// three) are what a reconciler can drive to zero; the `conflict` classes have no artifact type;
// road×road is an info overlap a RoadJunction documents.

function everyClassLedger(): ClaimsLedger {
  const led = new ClaimsLedger();
  led.claim('water', 'water', [[0, 0], [2, 0], [4, 0]]);
  led.claim('r1', 'road', [[0, 0]]);          // road×water
  led.claim('b1', 'barrier', [[2, 0]]);       // barrier×water
  led.claim('r2', 'road', [[3, 0]]);          // road×barrier
  led.claim('b2', 'barrier', [[3, 0]]);
  led.claim('h1', 'building', [[4, 0]]);      // building×water
  led.claim('r3', 'road', [[5, 0]]);          // road×building
  led.claim('h2', 'building', [[5, 0]]);
  led.claim('b3', 'barrier', [[6, 0]]);       // barrier×building
  led.claim('h3', 'building', [[6, 0]]);
  led.claim('h4', 'building', [[7, 0]]);      // building×building
  led.claim('h5', 'building', [[7, 0]]);
  led.claim('rA', 'road', [[8, 0]]);          // road×road (info)
  led.claim('rB', 'road', [[8, 0]]);
  return led;
}

describe('reconcile — artifact proposals per conflict class', () => {
  it('maps each reconcilable class to its artifact type', () => {
    const { artifacts } = reconcile(everyClassLedger());
    const byClass = new Map(artifacts.map((a) => [a.conflictClass, a.type]));
    expect(byClass.get('road-x-water')).toBe('Bridge');
    expect(byClass.get('barrier-x-water')).toBe('WaterGate');
    expect(byClass.get('road-x-barrier')).toBe('Gatehouse');
    expect(byClass.get('road-x-road')).toBe('RoadJunction');
  });

  it('proposes NO artifact for the displacement classes (they go to unresolved)', () => {
    const { artifacts, unresolved } = reconcile(everyClassLedger());
    const classes = new Set(artifacts.map((a) => a.conflictClass));
    expect(classes.has('building-x-building')).toBe(false);
    expect(classes.has('building-x-water')).toBe(false);
    expect(classes.has('road-x-building')).toBe(false);
    const un = new Set(unresolved.map((c) => c.conflictClass));
    expect(un.has('building-x-building')).toBe(true);
    expect(un.has('building-x-water')).toBe(true);
    expect(un.has('road-x-building')).toBe(true);
  });

  it('every proposed artifact owns the conflict cells and is marked proposed', () => {
    const { artifacts } = reconcile(everyClassLedger());
    const bridge = artifacts.find((a) => a.type === 'Bridge')!;
    expect(bridge.origin).toBe('proposed');
    expect(bridge.cells).toEqual([[0, 0]]);
    expect(bridge.features).toEqual(expect.arrayContaining(['r1', 'water']));
    const junction = artifacts.find((a) => a.type === 'RoadJunction');
    expect(junction && (junction as { degree: number }).degree).toBe(2);
  });
});

describe('reconcile — convergence', () => {
  it('drives the needs-class ERRORS to zero after re-report', () => {
    const led = everyClassLedger();
    const before = led.report();
    const needsBefore = before.conflicts.filter(
      (c) => c.severity === 'error' && c.resolvable,   // road×water, barrier×water, road×barrier
    );
    expect(needsBefore.length).toBe(3);

    reconcile(led);
    const after = led.report();
    // Every resolvable (needs) error is gone…
    expect(after.conflicts.filter((c) => c.severity === 'error' && c.resolvable)).toEqual([]);
    // …the total error count strictly dropped…
    expect(after.counts.error).toBeLessThan(before.counts.error);
    // …the road×road info overlap is still surfaced (RoadJunction documents, does not silence).
    expect(after.conflicts.some((c) => c.conflictClass === 'road-x-road')).toBe(true);
  });

  it('leaves the no-artifact conflict classes reported (they need a plan change, not an artifact)', () => {
    const led = everyClassLedger();
    reconcile(led);
    const remaining = new Set(led.conflicts().map((c) => c.conflictClass));
    for (const cls of ['building-x-building', 'building-x-water', 'road-x-building']) {
      expect(remaining.has(cls), `${cls} should remain`).toBe(true);
    }
    for (const cls of ['road-x-water', 'barrier-x-water', 'road-x-barrier']) {
      expect(remaining.has(cls), `${cls} should be resolved`).toBe(false);
    }
  });
});

describe('reconcile — determinism', () => {
  it('two reconciliations of identical ledgers produce deep-equal artifacts', () => {
    const a = reconcile(everyClassLedger()).artifacts;
    const b = reconcile(everyClassLedger()).artifacts;
    expect(a).toEqual(b);
  });

  it('artifact ids are stable and unique', () => {
    const { artifacts } = reconcile(everyClassLedger());
    const ids = artifacts.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ── deriveBuiltJunctions over a small committed world ─────────────────────────────────

function tile(type: string, baseType?: string): Tile {
  return { type, baseType, walkable: type !== 'river' } as unknown as Tile;
}
function grid(w: number, h: number): Tile[][] {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => tile('grass')));
}

/** A world with a bridge-tile crossing (+ a bridge_deck entity over it) and a barrier that
 *  carries one road GATE and one water GAP. */
function builtWorld(): { world: World; map: GameMap } {
  const W = 8, H = 4;
  const tiles = grid(W, H);
  tiles[1][3] = tile('bridge', 'river');
  tiles[2][3] = tile('bridge', 'river');
  const map = {
    width: W, height: H, tiles, villages: [], seed: 1, success: true, worldSeed: null,
    stats: { iterations: 0, backtracks: 0 }, buildings: [],
    barrierRuns: [
      { id: 'ring0', run: {
        kind: 'wall', path: [[0, 0], [6, 0]], height: 1, thickness: 1, material: 'stone',
        gates: [{ t: 2, width: 1.4, kind: 'gate' }, { t: 5, width: 1.4, kind: 'gap' }],
      } },
    ],
  } as unknown as GameMap;
  const world = new World(map);
  world.addEntity({ id: 'bridge_deck#1', kind: 'bridge_deck', x: 3, y: 1, tags: ['prop'],
    properties: { footprint: { w: 1, h: 2 } } } as unknown as Entity);
  return { world, map };
}

describe('deriveBuiltJunctions — committed world', () => {
  it('derives a Bridge over the bridge-tile crossing', () => {
    const { world, map } = builtWorld();
    const js = deriveBuiltJunctions(world, map);
    const bridges = js.filter((j) => j.type === 'Bridge');
    expect(bridges).toHaveLength(1);
    expect(bridges[0].conflictClass).toBe('road-x-water');
    expect(bridges[0].origin).toBe('built');
    // owns both bridge tiles (+ the deck entity's overlapping cells)
    expect(bridges[0].cells).toEqual(expect.arrayContaining([[3, 1], [3, 2]]));
  });

  it('derives a Gatehouse from the gate span and a WaterGate from the gap span', () => {
    const { world, map } = builtWorld();
    const js = deriveBuiltJunctions(world, map);
    const gate = js.find((j) => j.type === 'Gatehouse')!;
    const gap = js.find((j) => j.type === 'WaterGate')!;
    expect(gate.conflictClass).toBe('road-x-barrier');
    expect(gap.conflictClass).toBe('barrier-x-water');
    expect(gate.cells.length).toBeGreaterThan(0);
    expect(gap.cells.length).toBeGreaterThan(0);
  });

  it('is deterministic (two derivations deep-equal)', () => {
    const { world, map } = builtWorld();
    expect(deriveBuiltJunctions(world, map)).toEqual(deriveBuiltJunctions(world, map));
  });
});

describe('applyJunctions + reconcileWorld', () => {
  it('applying built junctions resolves the matching conflict cells', () => {
    const led = new ClaimsLedger();
    led.claim('water', 'water', [[3, 1]]);
    led.claim('road0', 'road', [[3, 1]]);        // a road×water overlap at the crossing cell
    expect(led.conflicts().some((c) => c.conflictClass === 'road-x-water')).toBe(true);
    const junctions: JunctionArtifact[] = [
      { type: 'Bridge', id: 'b0', conflictClass: 'road-x-water', features: ['crossing', 'water'], cells: [[3, 1]], origin: 'built' },
    ];
    applyJunctions(led, junctions);
    expect(led.conflicts().some((c) => c.conflictClass === 'road-x-water')).toBe(false);
  });

  it('reconcileWorld builds, applies map.junctions, and reconciles the residue', () => {
    const { world, map } = builtWorld();
    map.junctions = deriveBuiltJunctions(world, map);
    const { ledger, artifacts, unresolved } = reconcileWorld(world, map);
    expect(ledger).toBeInstanceOf(ClaimsLedger);
    // no needs-class error survives the built-junctions + reconcile pass
    expect(ledger.conflicts().filter((c) => c.severity === 'error' && c.resolvable)).toEqual([]);
    expect(Array.isArray(artifacts)).toBe(true);
    expect(Array.isArray(unresolved)).toBe(true);
  });
});
