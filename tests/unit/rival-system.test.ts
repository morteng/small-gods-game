import { describe, it, expect } from 'vitest';
import { RivalSystem } from '@/sim/systems/rival-system';
import { CommandExecutorSystem } from '@/sim/command/command-system';
import { CommandQueue } from '@/sim/command/command-queue';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { initNpcProps } from '@/world/npc-helpers';
import { createRng, type Rng } from '@/core/rng';
import type { Entity, GameMap, NpcProperties } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';
import type { SystemContext } from '@/core/scheduler';

function tinyMap(): GameMap {
  const tiles = [] as GameMap['tiles'];
  for (let y = 0; y < 3; y++) {
    const row = [];
    for (let x = 0; x < 3; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row as never);
  }
  return { tiles, width: 3, height: 3, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

function npc(id: string, poiId: string): Entity {
  const p = initNpcProps(id, 'farmer', 7);
  p.homePoiId = poiId;
  p.whisperCooldown = 0;
  return { id, kind: 'npc', x: 0, y: 0, properties: p as unknown as Record<string, unknown> };
}
function P(e: Entity): NpcProperties { return e.properties as unknown as NpcProperties; }

function rival(power: number): Spirit {
  return {
    id: 'rival-1', name: 'Sablethorn', sigil: '◆', color: '#a0f', isPlayer: false, power, manifestation: null,
    ai: {
      policy: 'coexist', cooldowns: {},
      personality: { aggression: 0.2, subtlety: 0.5, territoriality: 0.5, assertiveness: 0.3, jealousy: 0.3 },
      settlements: ['poi1'], lastActionTick: 0, actionCooldown: 0,
    },
  };
}

function player(): Spirit {
  return { id: 'player', name: 'You', sigil: '✦', color: '#fff', isPlayer: true, power: 0, manifestation: null };
}

/** A rival with an arbitrary id/personality — for D5/D6 rival-vs-rival scenarios
 *  the single hardcoded `rival(power)` helper above can't express. */
function rivalWithId(
  id: SpiritId, power: number, settlements: string[],
  personality: { aggression?: number; subtlety?: number; territoriality?: number; assertiveness?: number; jealousy?: number } = {},
): Spirit {
  return {
    id, name: 'X', sigil: '◆', color: '#a0f', isPlayer: false, power, manifestation: null,
    ai: {
      policy: 'coexist', cooldowns: {},
      personality: { aggression: 0.2, subtlety: 0.5, territoriality: 0.5, assertiveness: 0.3, jealousy: 0.3, ...personality },
      settlements, lastActionTick: 0, actionCooldown: 0,
    },
  };
}

/** Deterministic stub: coexist whispers when rng() < 0.3, and picks pool index 0. */
const forceAct: Rng = { next: () => 0.1, nextInt: () => 0 } as unknown as Rng;

function ctx(world: World, spirits: Map<SpiritId, Spirit>, rng: Rng, now = 10): SystemContext {
  return { world, spirits, log: new EventLog(new SimClock()), clock: new SimClock(), rng, dt: 2000, now };
}

describe('RivalSystem', () => {
  it('a funded rival emits a command that, once executed, raises a target NPC faith in the rival', () => {
    const world = new World(tinyMap());
    const e = npc('a', 'poi1');
    world.addEntity(e);
    const spirits = new Map<SpiritId, Spirit>([['player', player()], ['rival-1', rival(10)]]);

    const queue = new CommandQueue();
    new RivalSystem(queue).tick(ctx(world, spirits, forceAct));

    expect(queue.size()).toBe(1);

    new CommandExecutorSystem(queue).tick(ctx(world, spirits, forceAct));

    expect(P(e).beliefs['rival-1']).toBeDefined();
    expect(P(e).beliefs['rival-1'].faith).toBeGreaterThan(0);
    expect(spirits.get('rival-1')!.power).toBe(9); // whisper cost paid by the rival
  });

  it('an unfunded rival emits nothing and changes no state', () => {
    const world = new World(tinyMap());
    const e = npc('a', 'poi1');
    world.addEntity(e);
    const spirits = new Map<SpiritId, Spirit>([['player', player()], ['rival-1', rival(0)]]);

    const queue = new CommandQueue();
    new RivalSystem(queue).tick(ctx(world, spirits, forceAct));

    expect(queue.size()).toBe(0);
    expect(P(e).beliefs['rival-1']).toBeUndefined();
  });

  it('is deterministic: same seed ⇒ identical emissions', () => {
    const run = () => {
      const world = new World(tinyMap());
      world.addEntity(npc('a', 'poi1'));
      world.addEntity(npc('b', 'poi1'));
      const spirits = new Map<SpiritId, Spirit>([['player', player()], ['rival-1', rival(10)]]);
      const queue = new CommandQueue();
      new RivalSystem(queue).tick(ctx(world, spirits, createRng(123)));
      return queue.drain().map(c => [c.verb, c.source, JSON.stringify(c.target)]);
    };
    expect(run()).toEqual(run());
  });

  // ── D2: idle-poor guard ─────────────────────────────────────────────────
  it('D2: idle-poor guard skips the situation sweep entirely (power below WHISPER_COST)', () => {
    const world = new World(tinyMap());
    world.addEntity(npc('a', 'poi1'));
    const spirits = new Map<SpiritId, Spirit>([['player', player()], ['rival-1', rival(0.5)]]);
    const queue = new CommandQueue();
    new RivalSystem(queue).tick(ctx(world, spirits, forceAct));
    expect(queue.size()).toBe(0);
    // The sweep (buildRivalSituation + baseline refresh) never ran at all.
    expect(spirits.get('rival-1')!.ai!.followerBaseline).toBeUndefined();
  });

  it('D2: a rival exactly AT WHISPER_COST still acts (guard is strictly-below, not at-or-below)', () => {
    const world = new World(tinyMap());
    world.addEntity(npc('a', 'poi1'));
    const spirits = new Map<SpiritId, Spirit>([['player', player()], ['rival-1', rival(1)]]);
    const queue = new CommandQueue();
    new RivalSystem(queue).tick(ctx(world, spirits, forceAct));
    expect(queue.size()).toBe(1);
  });

  // ── D6: the rival_dispute event ──────────────────────────────────────────
  it('D6: rival_dispute is logged when the acting rival targets ANOTHER NON-PLAYER spirit', () => {
    const world = new World(tinyMap());
    const e = npc('a', 'poi2');
    delete P(e).beliefs.player; // initNpcProps seeds a starter player belief; clear it so rival-2 is unambiguously dominant
    P(e).beliefs['rival-2'] = { faith: 0.9, understanding: 0, devotion: 0 };
    world.addEntity(e);
    // Undermine bucket: aggression > 0.4 && subtlety < 0.4. High jealousy makes
    // the discredit roll land with the forced low rng.
    const actor = rivalWithId('rival-1' as SpiritId, 10, ['poi1'], { aggression: 0.6, subtlety: 0.2, jealousy: 0.9 });
    const victim = rivalWithId('rival-2' as SpiritId, 0, ['poi2']); // power 0 ⇒ its OWN idle-poor guard keeps it passive
    const spirits = new Map<SpiritId, Spirit>([['player', player()], ['rival-1', actor], ['rival-2', victim]]);

    const c = ctx(world, spirits, forceAct);
    new RivalSystem(new CommandQueue()).tick(c);

    const disputes = c.log.since(0).filter(a => a.event.type === 'rival_dispute');
    expect(disputes).toHaveLength(1);
    expect(disputes[0].event).toMatchObject({
      type: 'rival_dispute',
      spiritId: 'rival-1',
      data: { otherRivalId: 'rival-2', poiId: 'poi2' },
    });
  });

  it('D6: no rival_dispute is logged when the acting rival targets the PLAYER', () => {
    const world = new World(tinyMap());
    const e = npc('a', 'poi1');
    P(e).beliefs['player'] = { faith: 0.9, understanding: 0, devotion: 0 };
    world.addEntity(e);
    const actor = rivalWithId('rival-1' as SpiritId, 10, ['poi1'], { aggression: 0.6, subtlety: 0.2, jealousy: 0.9 });
    const spirits = new Map<SpiritId, Spirit>([['player', player()], ['rival-1', actor]]);

    const c = ctx(world, spirits, forceAct);
    new RivalSystem(new CommandQueue()).tick(c);

    expect(c.log.since(0).some(a => a.event.type === 'rival_dispute')).toBe(false);
  });
});
