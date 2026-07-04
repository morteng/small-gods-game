/**
 * R7 WP-B — the flood domain's ungated bootstrap.
 *
 * Before this round, `flood` belief was seeded ONLY by floods (seedFloodBelief /
 * seedSiteBelief), and floods were produced ONLY by summon_storm itself — a
 * circular gate that made summon_storm unreachable on a fresh world. The fix
 * mirrors the storm bootstrap: an omen over suffering believers who live in
 * sight of water seeds flood-attribution through the same ungated omen path.
 *
 * These tests exercise the loop at the sim level (no worldgen): fresh world →
 * repeated omens → flood conviction crosses the summon_storm bar → the
 * capability precondition passes.
 */
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { createRng } from '@/core/rng';
import { initNpcProps } from '@/world/npc-helpers';
import { omen } from '@/sim/divine-actions';
import { aggregateDomain, DOMAIN_DEFS, getDomainBelief } from '@/sim/belief-domains';
import { getCapability } from '@/sim/command/registry';
import type { Entity, GameMap, Tile, NpcProperties, ActiveEvent } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';
import type { ApplyCtx, Command } from '@/sim/command/types';

/** 20×20 grass map with a river running down column x=5. */
function makeRiverWorld(): World {
  const w = 20, h = 20;
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) {
      row.push({ type: x === 5 ? 'river' : 'grass', x, y, walkable: x !== 5, state: 'realized' });
    }
    tiles.push(row);
  }
  const map: GameMap = {
    tiles, width: w, height: h, villages: [], seed: 1,
    success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
  return new World(map);
}

function spirit(power = 1000): Spirit {
  return { id: 'player', name: 'p', sigil: '*', color: '#fff', isPlayer: true, power, manifestation: null };
}

let nextId = 0;
function addBeliever(world: World, poi: string, x: number, y: number): Entity {
  const props = initNpcProps('Pip', 'farmer', ++nextId) as NpcProperties;
  props.beliefs = { player: { faith: 1, understanding: 0.6, devotion: 1 } };
  props.homePoiId = poi;
  const e = { id: `n${nextId}`, kind: 'npc', x, y, properties: props as unknown as Record<string, unknown> } as Entity;
  world.addEntity(e);
  return e;
}

function drought(poiId: string): ActiveEvent {
  return { type: 'drought', poiId, severity: 1.0, durationTicks: 1000, ticksElapsed: 0 };
}

function applyCtx(world: World, spirits: Map<SpiritId, Spirit>): ApplyCtx {
  return { world, spirits, log: new EventLog(new SimClock()), weather: null, rng: createRng(1), now: 0 };
}
const stormCmd = (poiId: string): Command =>
  ({ verb: 'summon_storm', source: 'player', target: { kind: 'settlement', poiId }, seq: 1 });

describe('flood domain bootstrap (R7 WP-B)', () => {
  it('an omen over water-adjacent suffering believers seeds flood-attribution', () => {
    const world = makeRiverWorld();
    const log = new EventLog(new SimClock());
    const e = addBeliever(world, 'ford', 7, 4); // 2 tiles from the river (radius 4)
    world.activeEvents.set('ford', [drought('ford')]);
    omen(spirit(), 'ford', world, log);
    const p = e.properties as unknown as NpcProperties;
    expect(getDomainBelief(p, 'player', 'flood')).toBeGreaterThan(0);
    expect(getDomainBelief(p, 'player', 'storm')).toBeGreaterThan(0); // storm path untouched
  });

  it('believers far from any water read the sign as storm only — no flood seed', () => {
    const world = makeRiverWorld();
    const log = new EventLog(new SimClock());
    const e = addBeliever(world, 'plain', 15, 10); // 10 tiles from the river
    world.activeEvents.set('plain', [drought('plain')]);
    omen(spirit(), 'plain', world, log);
    const p = e.properties as unknown as NpcProperties;
    expect(getDomainBelief(p, 'player', 'flood')).toBe(0);
    expect(getDomainBelief(p, 'player', 'storm')).toBeGreaterThan(0); // control: the omen did land
  });

  it('summon_storm is reachable on a fresh sim via repeated riverside omens (the circle is broken)', () => {
    const world = makeRiverWorld();
    const log = new EventLog(new SimClock());
    const sp = spirit(1000);
    const spirits = new Map<SpiritId, Spirit>([['player', sp]]);
    for (let i = 0; i < 6; i++) addBeliever(world, 'ford', 7, 3 + i);
    world.activeEvents.set('ford', [drought('ford')]);
    const cap = getCapability('summon_storm')!;

    // Fresh world: no flood conviction anywhere → gated.
    expect(cap.precondition!(stormCmd('ford'), applyCtx(world, spirits))).toBe('precondition_failed');

    // Work the coincidence bootstrap: each omen seeds
    //   OMEN_FLOOD_SEED(0.05) × signResponse(0.6)=0.8 × (1+severity 1) = 0.08
    // per believer, so conviction crosses the 0.45 bar within 6 omens.
    let omens = 0;
    while (omens < 12 &&
           aggregateDomain(world, 'player', 'flood').conviction < DOMAIN_DEFS.flood.unlockThreshold) {
      expect(omen(sp, 'ford', world, log)).toBe(true);
      omens++;
    }
    expect(aggregateDomain(world, 'player', 'flood').conviction)
      .toBeGreaterThanOrEqual(DOMAIN_DEFS.flood.unlockThreshold);
    expect(omens).toBeLessThanOrEqual(8); // reachable at a sane omen budget (6 expected)
    expect(cap.precondition!(stormCmd('ford'), applyCtx(world, spirits))).toBeNull();
  });
});
