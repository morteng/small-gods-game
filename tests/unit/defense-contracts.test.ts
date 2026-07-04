import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { placeBarrier } from '@/world/place-barrier';
import { evaluateContracts } from '@/world/connectome-contracts';
import { defenseRingContracts } from '@/world/connectome/defense-contracts';
import type { GameMap, Tile } from '@/core/types';
import type { BarrierRun } from '@/world/barrier';

/** Build a small all-walkable, all-realized grass map + a World over it. */
function makeWorld(w: number, h: number): { world: World; map: GameMap } {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  const map: GameMap = {
    tiles, width: w, height: h, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as unknown as GameMap;
  const world = new World(map);
  return { world, map };
}

// A 20x20 square ring (thickness 1) centred at (30,30) on a 60x60 map — a generous margin
// (20 tiles) on every side so the ~14-tile outward gate-approach probe always lands in bounds.
// One gate at the top edge's midpoint (segment 0, t=10 of 20) → world point (30,20).
const RING_PATH: [number, number][] = [[20, 20], [40, 20], [40, 40], [20, 40], [20, 20]];
function makeRing(gates: BarrierRun['gates'] = [{ t: 10, width: 2, kind: 'gate' }]): BarrierRun {
  return {
    kind: 'wall', path: RING_PATH, height: 1.5, thickness: 1, material: 'stone', crenellated: true,
    centroid: [30, 30], gates,
  };
}

function placeBuilding(world: World, x: number, y: number, id = 'core_bldg'): void {
  world.addEntity({ id, kind: 'house', x, y, tags: ['building'] });
}

describe('defense.closed-circuit', () => {
  it('is clean for an intact ring (raiders can only get in through the gate)', () => {
    const { world, map } = makeWorld(60, 60);
    const run = makeRing();
    const id = placeBarrier(world, run);
    map.barrierRuns = [{ id, run }];
    placeBuilding(world, 30, 30);
    map.contracts = { declarations: defenseRingContracts(map.barrierRuns) };

    const report = evaluateContracts({ world, map });
    expect(report.byRule['defense.closed-circuit'] ?? 0).toBe(0);
  });

  it('fires an error when the ring has a hole (a hostile path sneaks through a non-gate gap)', () => {
    const { world, map } = makeWorld(60, 60);
    const run = makeRing();
    const id = placeBarrier(world, run);
    map.barrierRuns = [{ id, run }];
    placeBuilding(world, 30, 30);

    // Punch a hole: drop a few blocking cells on the RIGHT edge (x=40), far from the gate on
    // the top edge — a raider entering from the east should now be able to walk straight through.
    const original = world.registry.get(id)!;
    const cells = (original.properties!.footprintCells as [number, number][])
      .filter(([x, y]) => !(x === 40 && y >= 29 && y <= 31));
    world.removeEntity(id);
    world.addEntity({ ...original, properties: { ...original.properties, footprintCells: cells } });

    map.contracts = { declarations: defenseRingContracts(map.barrierRuns) };
    const report = evaluateContracts({ world, map });
    expect(report.byRule['defense.closed-circuit'] ?? 0).toBeGreaterThan(0);
    const hit = report.diagnostics.find((d) => d.rule === 'defense.closed-circuit');
    expect(hit?.severity).toBe('error');
  });
});

describe('defense.gate-observed', () => {
  // Tight radius so the geometric tower FALLBACK (~gate.width/2+2 = 3 tiles from the gate)
  // reliably fails to "observe" the approach, isolating the entity-tower path under test.
  const declsTightRadius = (barrierRuns: { id: string; run: BarrierRun }[]) =>
    defenseRingContracts(barrierRuns).map((d) =>
      d.contract === 'defense.gate-observed' ? { ...d, params: { radius: 2, m: 4, n: 2 } } : d);

  it('warns when no tower observes the gate approach (the geometric proxy sits too far away at this radius)', () => {
    const { world, map } = makeWorld(60, 60);
    const run = makeRing();
    const id = placeBarrier(world, run);
    map.barrierRuns = [{ id, run }];
    placeBuilding(world, 30, 30);
    map.contracts = { declarations: declsTightRadius(map.barrierRuns) };

    const report = evaluateContracts({ world, map });
    expect(report.byRule['defense.gate-observed'] ?? 0).toBeGreaterThan(0);
  });

  it('is clean once a real tower entity sits right at the gate (removing it re-introduces the warn)', () => {
    const { world, map } = makeWorld(60, 60);
    const run = makeRing();
    const id = placeBarrier(world, run);
    map.barrierRuns = [{ id, run }];
    placeBuilding(world, 30, 30);
    // Gate world point is (30, 20) — a tower planted right there fully observes its own approach.
    world.addEntity({ id: 'tower_gate', kind: 'tower', x: 30, y: 20, tags: ['tower'] });
    map.contracts = { declarations: declsTightRadius(map.barrierRuns) };

    const withTower = evaluateContracts({ world, map });
    expect(withTower.byRule['defense.gate-observed'] ?? 0).toBe(0);

    world.removeEntity('tower_gate');
    const withoutTower = evaluateContracts({ world, map });
    expect(withoutTower.byRule['defense.gate-observed'] ?? 0).toBeGreaterThan(0);
  });
});

describe('defense.no-cheap-bypass', () => {
  it('is a no-op when the ring has no nature-defended (gap) opening to compare against', () => {
    const { world, map } = makeWorld(60, 60);
    const run = makeRing();   // only a real 'gate', no 'gap'
    const id = placeBarrier(world, run);
    map.barrierRuns = [{ id, run }];
    placeBuilding(world, 30, 30);
    map.contracts = { declarations: defenseRingContracts(map.barrierRuns) };

    const report = evaluateContracts({ world, map });
    expect(report.byRule['defense.no-cheap-bypass'] ?? 0).toBe(0);
  });

  it('warns when a nature-defended gap is markedly cheaper to raid through than the real gate', () => {
    const { world, map } = makeWorld(60, 60);
    // A real 'gate' on the FAR (bottom) edge and a water 'gap' on the near (top) edge; the
    // settlement's core building sits right next to the top edge, so the gap is a much shorter
    // (cheaper) raid than trekking to the bottom gate and back up.
    const run = makeRing([
      { t: 50, width: 2, kind: 'gate' },   // bottom edge midpoint, world point (30,40)
      { t: 10, width: 2, kind: 'gap' },    // top edge midpoint, world point (30,20)
    ]);
    const id = placeBarrier(world, run);
    map.barrierRuns = [{ id, run }];
    placeBuilding(world, 30, 22);   // core hugs the top (gap) side
    map.contracts = { declarations: defenseRingContracts(map.barrierRuns) };

    const report = evaluateContracts({ world, map });
    expect(report.byRule['defense.no-cheap-bypass'] ?? 0).toBeGreaterThan(0);
  });
});
