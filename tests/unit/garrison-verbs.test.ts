// Manning the Walls (W3) — `muster_garrison` / `stand_down_garrison`.
//
// AUTHORING tier (mortal power, exactly the `found_castle` reasoning): a lord musters his own
// watch. The verbs are a thin call onto `state.garrisonOrders`; `GarrisonSystem.tick` (already
// covered by `garrison-system.test.ts`) is what actually walks soldiers onto the wall next tick —
// this file is about the ORDER surface: honest refusals, preview/apply agreement, and the
// end-to-end loop from a command through to a real muster.
import { describe, it, expect } from 'vitest';
import { createState } from '@/core/state';
import { World } from '@/world/world';
import { createRng } from '@/core/rng';
import { previewCommand, executeCommand } from '@/sim/command/command-system';
import { GarrisonSystem } from '@/sim/systems/garrison-system';
import { initNpcProps } from '@/world/npc-helpers';
import type { ApplyCtx, Command } from '@/sim/command/types';
import type { BarrierRun, PlacedBarrier } from '@/world/barrier';
import type { Entity, GameMap, Tile } from '@/core/types';

const RING: [number, number][] = [[4, 4], [24, 4], [24, 20], [4, 20], [4, 4]];
const CENTROID: [number, number] = [14, 12];
const POI_ID = 'town';
const BARRIER_ID = 'barrier:0001';

function ringRun(): BarrierRun {
  return {
    kind: 'wall', path: RING, height: 3, thickness: 2, material: 'stone',
    crenellated: true, centroid: CENTROID, gates: [{ t: 10, width: 3, kind: 'gate' }],
  };
}

function makeMap(opts: { barriers?: PlacedBarrier[] } = {}): GameMap {
  const w = 32, h = 32;
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return {
    tiles, width: w, height: h, villages: [], seed: 1, success: true,
    stats: { iterations: 0, backtracks: 0 }, buildings: [],
    worldSeed: { pois: [{ id: POI_ID, type: 'village', position: { x: CENTROID[0], y: CENTROID[1] } }] },
    barrierRuns: opts.barriers ?? [{ id: BARRIER_ID, run: ringRun() }],
  } as unknown as GameMap;
}

function addSoldier(world: World, id: string, x: number, y: number, poiId = POI_ID): Entity {
  const p = initNpcProps(id, 'soldier', 3);
  p.homePoiId = poiId;
  p.homeX = x; p.homeY = y;
  const e: Entity = { id, kind: 'npc', x, y, properties: p as unknown as Record<string, unknown> };
  world.addEntity(e);
  return e;
}

/** A walled town with `n` resident soldiers, wired to a fresh `GameState`. */
function walledState(n: number, opts: { barriers?: PlacedBarrier[] } = {}) {
  const map = makeMap(opts);
  const world = new World(map);
  for (let i = 0; i < n; i++) addSoldier(world, `sol${String(i).padStart(2, '0')}`, 14, 14);
  const state = createState();
  state.map = map;
  state.world = world;
  state.worldSeed = map.worldSeed;
  return state;
}

function applyCtx(state: ReturnType<typeof createState>, seed = 11): ApplyCtx {
  return {
    world: state.world!, spirits: state.spirits, log: state.eventLog,
    rng: createRng(seed), now: state.clock.now(), state,
  };
}

const MUSTER: Omit<Command, 'seq'> = {
  verb: 'muster_garrison', source: 'fate', target: { kind: 'settlement', poiId: POI_ID },
};
const STAND_DOWN: Omit<Command, 'seq'> = {
  verb: 'stand_down_garrison', source: 'fate', target: { kind: 'settlement', poiId: POI_ID },
};

describe('muster_garrison', () => {
  it('refuses invalid_target with no garrisonable wall ring', () => {
    const flat: BarrierRun = { ...ringRun(), crenellated: false };
    const state = walledState(1, { barriers: [{ id: BARRIER_ID, run: flat }] });
    expect(previewCommand({ ...MUSTER, seq: 0 }, applyCtx(state))).toBe('invalid_target');
    expect(executeCommand({ ...MUSTER, seq: 0 }, applyCtx(state)).status).toBe('rejected');
    expect(state.garrisonOrders.hasStandingOrder(POI_ID)).toBe(false);
  });

  it('refuses invalid_target with a ring but no resident soldiers', () => {
    const state = walledState(0);
    expect(previewCommand({ ...MUSTER, seq: 0 }, applyCtx(state))).toBe('invalid_target');
    expect(executeCommand({ ...MUSTER, seq: 0 }, applyCtx(state)).status).toBe('rejected');
  });

  it('refuses invalid_target for an unknown settlement', () => {
    const state = walledState(1);
    const cmd = { ...MUSTER, target: { kind: 'settlement' as const, poiId: 'nowhere' }, seq: 0 };
    expect(previewCommand(cmd, applyCtx(state))).toBe('invalid_target');
  });

  it('musters — preview matches apply, and raises the standing order', () => {
    const state = walledState(1);
    expect(previewCommand({ ...MUSTER, seq: 0 }, applyCtx(state))).toBeNull();
    const res = executeCommand({ ...MUSTER, seq: 0 }, applyCtx(state));
    expect(res.status).toBe('applied');
    expect(state.garrisonOrders.hasStandingOrder(POI_ID)).toBe(true);
  });

  it('refuses precondition_failed when already mustered — preview matches apply', () => {
    const state = walledState(1);
    expect(executeCommand({ ...MUSTER, seq: 0 }, applyCtx(state)).status).toBe('applied');
    expect(previewCommand({ ...MUSTER, seq: 1 }, applyCtx(state))).toBe('precondition_failed');
    expect(executeCommand({ ...MUSTER, seq: 1 }, applyCtx(state)))
      .toEqual({ status: 'rejected', verb: 'muster_garrison', source: 'fate', reason: 'precondition_failed' });
  });

  it('actually musters the garrison: the standing order survives to the next GarrisonSystem tick', () => {
    const state = walledState(2);
    expect(executeCommand({ ...MUSTER, seq: 0 }, applyCtx(state)).status).toBe('applied');

    const garrison = new GarrisonSystem(() => state.contention, () => state.garrisonOrders);
    garrison.tick({
      world: state.world!, spirits: state.spirits, log: state.eventLog,
      clock: state.clock, rng: state.rng, dt: 2000, now: 0,
    });
    const roster = garrison.rosterOf(POI_ID)!;
    expect(roster.mustered).toBe(true);
    expect(roster.standingOrder).toBe(true);
    expect(roster.members).toHaveLength(2);
    expect(state.eventLog.since(0).map(a => a.event.type)).toContain('garrison_mustered');
  });
});

describe('stand_down_garrison', () => {
  it('refuses invalid_target with no garrisonable wall ring', () => {
    const flat: BarrierRun = { ...ringRun(), crenellated: false };
    const state = walledState(1, { barriers: [{ id: BARRIER_ID, run: flat }] });
    expect(previewCommand({ ...STAND_DOWN, seq: 0 }, applyCtx(state))).toBe('invalid_target');
  });

  it('refuses invalid_target with a ring but no resident soldiers', () => {
    const state = walledState(0);
    expect(previewCommand({ ...STAND_DOWN, seq: 0 }, applyCtx(state))).toBe('invalid_target');
  });

  it('refuses precondition_failed when there is no standing order to release ("already stood down")', () => {
    const state = walledState(1);
    expect(previewCommand({ ...STAND_DOWN, seq: 0 }, applyCtx(state))).toBe('precondition_failed');
    expect(executeCommand({ ...STAND_DOWN, seq: 0 }, applyCtx(state)).status).toBe('rejected');
  });

  it('stands down — preview matches apply, and releases the standing order', () => {
    const state = walledState(1);
    expect(executeCommand({ ...MUSTER, seq: 0 }, applyCtx(state)).status).toBe('applied');
    expect(state.garrisonOrders.hasStandingOrder(POI_ID)).toBe(true);

    expect(previewCommand({ ...STAND_DOWN, seq: 1 }, applyCtx(state))).toBeNull();
    const res = executeCommand({ ...STAND_DOWN, seq: 1 }, applyCtx(state));
    expect(res.status).toBe('applied');
    expect(state.garrisonOrders.hasStandingOrder(POI_ID)).toBe(false);
  });

  it('releasing the order hands the decision back to the ladder — a schism-mustered town stays up', () => {
    const state = walledState(1);
    expect(executeCommand({ ...MUSTER, seq: 0 }, applyCtx(state)).status).toBe('applied');
    // Drive contention to schism BEFORE releasing the order — the ladder alone now musters it.
    const census = new Map([[POI_ID, new Map([['player', 30], ['rival-1', 28]])]]);
    for (let i = 0; i < 3; i++) state.contention.step(census, new Map(), i);
    expect(state.contention.stateOf(POI_ID)).toBe('holy_war');

    expect(executeCommand({ ...STAND_DOWN, seq: 1 }, applyCtx(state)).status).toBe('applied');

    const garrison = new GarrisonSystem(() => state.contention, () => state.garrisonOrders);
    garrison.tick({
      world: state.world!, spirits: state.spirits, log: state.eventLog,
      clock: state.clock, rng: state.rng, dt: 2000, now: 10,
    });
    expect(garrison.rosterOf(POI_ID)!.mustered).toBe(true);       // still up: the ladder says so
    expect(garrison.rosterOf(POI_ID)!.standingOrder).toBe(false); // but the order really is gone
  });
});
