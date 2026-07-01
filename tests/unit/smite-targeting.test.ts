import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { createRng } from '@/core/rng';
import { initNpcProps } from '@/world/npc-helpers';
import { addDomainBelief, getDomainBelief } from '@/sim/belief-domains';
import type { Entity, GameMap, NpcProperties } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';
import type { Command, CommandTarget, ApplyCtx } from '@/sim/command/types';
import { smiteLocation, SMITE_COST } from '@/sim/divine-actions';
import { derivePreview } from '@/sim/command/preview';
import { executeCommand } from '@/sim/command/command-system';
import { affordancesForTarget } from '@/game/affordance/derive';

// ── scaffolding ────────────────────────────────────────────────────────────────
function makeWorld(): World {
  return new World({
    tiles: [], width: 40, height: 40, villages: [], seed: 1,
    success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as GameMap);
}
function spirit(id: string, power = 100): Spirit {
  return { id, name: id, sigil: '*', color: '#fff', isPlayer: true, power, manifestation: null };
}
let nid = 0;
function addNpc(world: World, x: number, y: number, opts: { faith?: number; devotion?: number; storm?: number } = {}): Entity {
  const props = initNpcProps('Pip', 'farmer', ++nid) as NpcProperties;
  props.beliefs = { player: { faith: opts.faith ?? 0.5, understanding: 0.5, devotion: opts.devotion ?? 0.2 } };
  if (opts.storm !== undefined) addDomainBelief(props, 'player', 'storm', opts.storm);
  const e = { id: `n${nid}`, kind: 'npc', x, y, properties: props as unknown as Record<string, unknown> } as Entity;
  world.addEntity(e);
  return e;
}
/** A fully-convinced congregation so the storm domain unlocks smite. */
function convince(world: World, x = 0, y = 0): void {
  addNpc(world, x, y, { faith: 1, devotion: 1, storm: 1 });
  addNpc(world, x, y, { faith: 1, devotion: 1, storm: 1 });
}
function applyCtx(world: World, spirits: Map<SpiritId, Spirit>): ApplyCtx {
  return { world, spirits, log: new EventLog(new SimClock()), rng: createRng(0), now: 1 };
}

describe('smiteLocation — a strike on a spot (no soul to convert)', () => {
  it('reinforces storm belief only in witnesses within radius, and logs x/y (no npcId)', () => {
    const world = makeWorld();
    const near = addNpc(world, 3, 3, { faith: 0.8, storm: 0.4 });   // within radius 6 of (0,0)
    const far = addNpc(world, 30, 30, { faith: 0.8, storm: 0.4 });  // far away
    const log = new EventLog(new SimClock());
    const sp = spirit('player');
    const near0 = getDomainBelief(near.properties as unknown as NpcProperties, 'player', 'storm');
    const far0 = getDomainBelief(far.properties as unknown as NpcProperties, 'player', 'storm');

    expect(smiteLocation(sp, 0, 0, world, log)).toBe(true);

    expect(getDomainBelief(near.properties as unknown as NpcProperties, 'player', 'storm')).toBeGreaterThan(near0);
    expect(getDomainBelief(far.properties as unknown as NpcProperties, 'player', 'storm')).toBeCloseTo(far0, 6);
    expect(sp.power).toBe(100 - SMITE_COST);
    const ev = log.since(0).find(a => a.event.type === 'smite')!.event as { x?: number; y?: number; npcId?: string };
    expect(ev.x).toBe(0); expect(ev.y).toBe(0); expect(ev.npcId).toBeUndefined();
  });
});

describe('smite target-set widening (preview + execute + affordance)', () => {
  function cmd(target: CommandTarget): Command {
    return { verb: 'smite', source: 'player', target, seq: 0 };
  }
  function spiritsMap(power = 100) {
    return new Map<SpiritId, Spirit>([['player', spirit('player', power)]]);
  }

  it('preview accepts a tile target once the storm is believed', () => {
    const world = makeWorld();
    convince(world);
    const p = derivePreview(cmd({ kind: 'tile', x: 5, y: 5 }), { world, spirits: spiritsMap(), log: new EventLog(new SimClock()) });
    expect(p.blockedReason).toBeNull();
  });

  it('preview rejects an entity target that does not exist', () => {
    const world = makeWorld();
    convince(world);
    const p = derivePreview(cmd({ kind: 'entity', id: 'ghost' }), { world, spirits: spiritsMap(), log: new EventLog(new SimClock()) });
    expect(p.blockedReason).toBe('invalid_target');
  });

  it('executes on a tile end-to-end', () => {
    const world = makeWorld();
    convince(world);
    const spirits = spiritsMap();
    const res = executeCommand(cmd({ kind: 'tile', x: 0, y: 0 }), applyCtx(world, spirits));
    expect(res.status).toBe('applied');
    expect(spirits.get('player')!.power).toBe(100 - SMITE_COST);
  });

  it('strikes an entity at its own location', () => {
    const world = makeWorld();
    convince(world, 10, 10);
    const bush = { id: 'bush1', kind: 'vegetation', x: 10, y: 10, properties: {} } as Entity;
    world.addEntity(bush);
    const spirits = spiritsMap();
    const res = executeCommand(cmd({ kind: 'entity', id: 'bush1' }), applyCtx(world, spirits));
    expect(res.status).toBe('applied');
  });

  it('affordancesForTarget on a tile yields smite (the only tile-capable divine verb)', () => {
    const world = makeWorld();
    const affs = affordancesForTarget({ kind: 'tile', x: 1, y: 1 }, 'player', { world, spirits: spiritsMap(), log: new EventLog(new SimClock()) }, [{ verb: 'smite', unlocked: true }]);
    expect(affs.map(a => a.verb)).toEqual(['smite']);
    expect(affs[0].targetKind).toBe('tile');
    expect(affs[0].shape).toBe('leaf');
  });
});
