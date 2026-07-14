import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { placeBarrier } from '@/world/place-barrier';
import { findPath } from '@/sim/pathfinding';
import { matchAnchors } from '@/world/anchor-rules';
import { gateOpeningCell } from '@/world/barrier';
import type { Anchor } from '@/world/anchors';
import type { GameMap, Tile } from '@/core/types';
import type { BarrierRun } from '@/world/barrier';

/** Build a small all-walkable, all-realized grass map + a World over it. */
function makeWorld(w: number, h: number): { world: World; map: GameMap } {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) {
      row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    }
    tiles.push(row);
  }
  const map: GameMap = {
    tiles, width: w, height: h, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as unknown as GameMap;
  const world = new World(map);
  return { world, map };
}

describe('placeBarrier', () => {
  it('creates an obstacle entity that blocks its cells but leaves the gate walkable', () => {
    const { world, map } = makeWorld(7, 7);
    const run: BarrierRun = {
      kind: 'wall', path: [[0, 3], [6, 3]], height: 3, thickness: 1, material: 'stone',
      gates: [{ t: 3, width: 1 }],
    };
    const id = placeBarrier(world, run);
    const e = world.registry.get(id)!;
    expect(e.kind).toBe('wall_run');
    expect(e.tags).toContain('obstacle');
    // a blocking cell along the wall is indexed under the entity id
    expect(world.registry.getAtTile(1, 3).some(x => x.id === id)).toBe(true);
    // the gate gap is NOT indexed (passable)
    expect(world.registry.getAtTile(3, 3).some(x => x.id === id)).toBe(false);
    // A* routes vertically THROUGH the gate at x=3
    expect(findPath(map, 3, 0, 3, 6, world)).not.toBeNull();
  });

  it('a gateless wall spanning the full width blocks all crossing paths', () => {
    const { world, map } = makeWorld(7, 7);
    const run: BarrierRun = {
      kind: 'wall', path: [[0, 3], [6, 3]], height: 3, thickness: 1, material: 'stone',
      gates: [],
    };
    placeBarrier(world, run);
    expect(findPath(map, 3, 0, 3, 6, world)).toBeNull();
  });
});

describe('placeBarrier — gate anchors (gate/wall tile-exactness)', () => {
  // A closed 12×12 ring with a declared inside: one real gate on the TOP edge, one gap.
  const ring: BarrierRun = {
    kind: 'wall', path: [[2, 2], [14, 2], [14, 14], [2, 14], [2, 2]],
    height: 3, thickness: 1, material: 'stone', centroid: [8, 8],
    gates: [
      { t: 6, width: 4, kind: 'gate' },        // top edge → opening cell (8,2)
      { t: 18, width: 3, kind: 'gap' },        // right edge waterfront gap — must emit NOTHING
    ],
  };

  function anchorsOf(): Anchor[] {
    const { world } = makeWorld(20, 20);
    const id = placeBarrier(world, ring, 'poi:t_ring');
    const e = world.registry.get(id)!;
    return (e.properties as { anchors?: Anchor[] }).anchors ?? [];
  }

  it('emits NO gate anchors for kind:gap openings', () => {
    const anchors = anchorsOf();
    expect(anchors.filter((a) => a.kind === 'gate')).toHaveLength(1);
    expect(anchors.filter((a) => a.kind === 'gate_anchor')).toHaveLength(2);
  });

  it('faces the gate anchor OUTWARD relative to the ring centroid', () => {
    const gate = anchorsOf().find((a) => a.kind === 'gate')!;
    // Top edge: outward is −y (away from centroid (8,8)).
    const out = gate.facing[0] * (gate.x - 8) + gate.facing[1] * (gate.y - 8);
    expect(out).toBeGreaterThan(0);
    expect(gate.facing[1]).toBeLessThan(0);
  });

  it('emits a gate_anchor inner/outer PAIR straddling the shared opening cell, and matchAnchors pairs them', () => {
    const anchors = anchorsOf();
    const ports = anchors.filter((a) => a.kind === 'gate_anchor');
    const outer = ports.find((p) => p.tags?.includes('outer'))!;
    const inner = ports.find((p) => p.tags?.includes('inner'))!;
    expect(outer.pair).toBe(inner.pair);
    expect(outer.pair).toBe('poi:t_ring:gate:6');
    // Both sit 1 tile off THE shared opening cell along the outward normal (top edge → ±y).
    const [ox, oy] = gateOpeningCell(ring, ring.gates[0]);
    expect([outer.x, outer.y]).toEqual([ox, oy - 1]);
    expect([inner.x, inner.y]).toEqual([ox, oy + 1]);
    // The snap rule (oppose + requireSamePair) links exactly the pair, as one 'spans' link.
    const links = matchAnchors(anchors, {});
    const gateLinks = links.filter((l) => l.a.kind === 'gate_anchor' && l.b.kind === 'gate_anchor');
    expect(gateLinks).toHaveLength(1);
    expect(gateLinks[0].relation).toBe('spans');
  });
});
