import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { evaluateContracts } from '@/world/connectome-contracts';
import { settlementRingContracts } from '@/world/connectome/wall-contracts';
import type { GameMap, Tile } from '@/core/types';
import type { BarrierRun } from '@/world/barrier';

/** Build a small all-walkable, all-realized grass map + a World over it (same shape as
 *  `defense-contracts.test.ts`'s helper — `gate.minimum-separation` doesn't read World/tiles
 *  itself, but `evaluateContracts` also runs the world-level invariants unscoped, so ctx needs
 *  a well-formed map). */
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

/** A point on a circle of radius `r` around `(cx,cy)`, at bearing `deg` (0=east, 90=south, matching
 *  `atan2(dy,dx)` in screen/tile space — the same convention `gate.minimum-separation` measures). */
function polarPoint(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

/** Build a closed ring (path.length >= 4, so `settlementRingContracts` treats it as a defensive
 *  ring) with real gates planted at the given bearings (degrees) from `centroid`, at path-distance
 *  `t` computed to land exactly on each vertex. */
function makeRingAtBearings(
  centroid: [number, number],
  bearingsDeg: number[],
  gateKinds: Array<'gate' | 'gap'> = [],
): BarrierRun {
  const [cx, cy] = centroid;
  const radius = 10;
  const verts = bearingsDeg.map((deg) => polarPoint(cx, cy, radius, deg));
  const path: [number, number][] = [...verts, verts[0]]; // close the ring
  let acc = 0;
  const ts: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    acc += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    ts.push(acc);
  }
  const gates: BarrierRun['gates'] = bearingsDeg.map((_, i) => ({
    t: ts[i], width: 1, kind: gateKinds[i] ?? 'gate',
  }));
  return {
    kind: 'wall', path, height: 1.5, thickness: 1, material: 'stone', crenellated: true,
    centroid, gates,
  };
}

describe('gate.minimum-separation', () => {
  it('fires a warn when two real gates are ~20 degrees apart (below the 55 degree default)', () => {
    const { world, map } = makeWorld(60, 60);
    const centroid: [number, number] = [30, 30];
    const run = makeRingAtBearings(centroid, [-90, -70, 0]);
    map.barrierRuns = [{ id: 'ring1', run }];
    map.contracts = { declarations: settlementRingContracts(map.barrierRuns) };

    const report = evaluateContracts({ world, map });
    expect(report.byRule['gate.minimum-separation'] ?? 0).toBeGreaterThan(0);
    const hit = report.diagnostics.find((d) => d.rule === 'gate.minimum-separation');
    expect(hit?.severity).toBe('warn');
    expect((hit?.metrics?.angleDeg as number) ?? 0).toBeLessThan(55);
  });

  it('is silent when the only two real gates are 90 degrees apart', () => {
    const { world, map } = makeWorld(60, 60);
    const centroid: [number, number] = [30, 30];
    const run = makeRingAtBearings(centroid, [-90, 0]);
    map.barrierRuns = [{ id: 'ring1', run }];
    map.contracts = { declarations: settlementRingContracts(map.barrierRuns) };

    const report = evaluateContracts({ world, map });
    expect(report.byRule['gate.minimum-separation'] ?? 0).toBe(0);
  });

  it('ignores gap-kind openings (nature-forced, not sited) even when close in bearing', () => {
    const { world, map } = makeWorld(60, 60);
    const centroid: [number, number] = [30, 30];
    // Same ~20 degree pair as the first test, but the second opening is a 'gap' — with only one
    // real gate left, there is no pair to compare.
    const run = makeRingAtBearings(centroid, [-90, -70, 0], ['gate', 'gap', 'gate']);
    map.barrierRuns = [{ id: 'ring1', run }];
    map.contracts = { declarations: settlementRingContracts(map.barrierRuns) };

    const report = evaluateContracts({ world, map });
    expect(report.byRule['gate.minimum-separation'] ?? 0).toBe(0);
  });

  it('exempts runtime-owned rings (ownerPoiId set) via the shared declaration rule', () => {
    const { world, map } = makeWorld(60, 60);
    const centroid: [number, number] = [30, 30];
    const run = makeRingAtBearings(centroid, [-90, -70, 0]); // same violating pair as test 1
    map.barrierRuns = [{ id: 'ring1', run, ownerPoiId: 'castle:0001' }];
    map.contracts = { declarations: settlementRingContracts(map.barrierRuns) };

    // The exemption lives in the declaration builder: no declaration is emitted for an owned ring.
    expect(map.contracts.declarations.some((d) => d.contract === 'gate.minimum-separation')).toBe(false);

    const report = evaluateContracts({ world, map });
    expect(report.byRule['gate.minimum-separation'] ?? 0).toBe(0);
  });
});
