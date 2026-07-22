import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import { SimClock } from '@/core/clock';
import { EventLog, type SimEvent } from '@/core/events';
import { createRng, type Rng } from '@/core/rng';
import { RivalContentionSystem } from '@/sim/systems/rival-contention-system';
import { ContentionLedger } from '@/sim/rival-contention';
import type { Entity, GameMap, NpcProperties, SpiritBelief } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';
import type { SystemContext } from '@/core/scheduler';

// ── scaffolding ──────────────────────────────────────────────────────────────
function tinyMap(): GameMap {
  return { tiles: [], width: 4, height: 4, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}
function believer(faith: number): SpiritBelief { return { faith, understanding: 0.1, devotion: 0.1 }; }
function addBelievers(world: World, prefix: string, poiId: string, spiritId: SpiritId, n: number): Entity[] {
  const out: Entity[] = [];
  for (let i = 0; i < n; i++) {
    const id = `${prefix}${i}`;
    const p = initNpcProps(id, 'farmer', i + 1) as NpcProperties;
    p.homePoiId = poiId;
    p.beliefs = { [spiritId]: believer(0.6) };
    const e: Entity = { id, kind: 'npc', x: 0, y: 0, properties: p as unknown as Record<string, unknown> };
    world.addEntity(e);
    out.push(e);
  }
  return out;
}
function rivalSpirit(id: string): Spirit {
  return {
    id, name: id, sigil: '◆', color: '#a0f', isPlayer: false, power: 10, manifestation: null,
    ai: { policy: 'coexist', cooldowns: {}, personality: { aggression: 0.2, subtlety: 0.5, territoriality: 0.5, assertiveness: 0.3, jealousy: 0.3 }, settlements: ['poi1'], lastActionTick: 0, actionCooldown: 0 },
  };
}
function player(): Spirit {
  return { id: 'player', name: 'You', sigil: '✦', color: '#fff', isPlayer: true, power: 10, manifestation: null };
}
function makeCtx(world: World, spirits: Map<SpiritId, Spirit>, log: EventLog, rng: Rng, now: number): SystemContext {
  return { world, spirits, log, clock: new SimClock(), rng, dt: 5000, now };
}

describe('RivalContentionSystem', () => {
  it('climbs a near-even populous settlement calm→…→holy_war and logs contention_escalated', () => {
    const world = new World(tinyMap());
    addBelievers(world, 'p', 'poi1', 'player', 30);
    addBelievers(world, 'r', 'poi1', 'rival-1', 28);
    const spirits = new Map<SpiritId, Spirit>([['player', player()], ['rival-1', rivalSpirit('rival-1')]]);
    const ledger = new ContentionLedger();
    const log = new EventLog(new SimClock());
    const events: SimEvent[] = [];
    log.subscribe(a => events.push(a.event));
    const sys = new RivalContentionSystem(() => ledger);
    const rng = createRng(1);

    for (let i = 0; i < 3; i++) sys.tick(makeCtx(world, spirits, log, rng, i));

    const escalations = events.filter(e => e.type === 'contention_escalated');
    expect(escalations.map(e => (e as Extract<SimEvent, { type: 'contention_escalated' }>).to))
      .toEqual(['tension', 'schism', 'holy_war']);
    expect(ledger.stateOf('poi1')).toBe('holy_war');
    // The belligerents are named on the event.
    const war = escalations[escalations.length - 1] as Extract<SimEvent, { type: 'contention_escalated' }>;
    expect(war.rivals.sort()).toEqual(['player', 'rival-1']);
  });

  it('de-escalates when one god collapses and logs contention_eased', () => {
    const world = new World(tinyMap());
    addBelievers(world, 'p', 'poi1', 'player', 30);
    const rivals = addBelievers(world, 'r', 'poi1', 'rival-1', 28);
    const spirits = new Map<SpiritId, Spirit>([['player', player()], ['rival-1', rivalSpirit('rival-1')]]);
    const ledger = new ContentionLedger();
    const log = new EventLog(new SimClock());
    const events: SimEvent[] = [];
    log.subscribe(a => events.push(a.event));
    const sys = new RivalContentionSystem(() => ledger);
    const rng = createRng(1);

    for (let i = 0; i < 3; i++) sys.tick(makeCtx(world, spirits, log, rng, i));
    expect(ledger.stateOf('poi1')).toBe('holy_war');

    // The rival's flock loses its faith (drops below the believer line).
    for (const e of rivals) (e.properties as unknown as NpcProperties).beliefs['rival-1'] = believer(0.01);
    for (let i = 0; i < 60 && ledger.stateOf('poi1') !== 'calm'; i++) {
      sys.tick(makeCtx(world, spirits, log, rng, 100 + i));
    }

    const easings = events.filter(e => e.type === 'contention_eased');
    expect(easings.length).toBeGreaterThan(0);
    // Every easing steps strictly downward.
    for (const e of easings as Extract<SimEvent, { type: 'contention_eased' }>[]) {
      const order = ['calm', 'tension', 'schism', 'holy_war'];
      expect(order.indexOf(e.from)).toBeGreaterThan(order.indexOf(e.to));
    }
    expect(ledger.stateOf('poi1')).toBe('calm');
  });

  it('the ledger rides serialize→hydrate (scrub-ghost safety)', () => {
    const world = new World(tinyMap());
    addBelievers(world, 'p', 'poi1', 'player', 30);
    addBelievers(world, 'r', 'poi1', 'rival-1', 28);
    const spirits = new Map<SpiritId, Spirit>([['player', player()], ['rival-1', rivalSpirit('rival-1')]]);
    const ledger = new ContentionLedger();
    const log = new EventLog(new SimClock());
    const sys = new RivalContentionSystem(() => ledger);
    const rng = createRng(1);
    for (let i = 0; i < 3; i++) sys.tick(makeCtx(world, spirits, log, rng, i));

    const restored = ContentionLedger.fromSnapshot(ledger.serialize());
    expect(restored.all()).toEqual(ledger.all());
    expect(restored.stateOf('poi1')).toBe('holy_war');
  });
});
