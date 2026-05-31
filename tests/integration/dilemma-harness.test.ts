import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { createRng } from '@/core/rng';
import { initNpcProps, forEachNpc, npcProps } from '@/world/npc-helpers';
import { NpcSimSystem } from '@/sim/systems/npc-sim-system';
import { NpcActivitySystem } from '@/sim/systems/npc-activity-system';
import { AbandonmentSystem } from '@/sim/systems/abandonment-system';
import { SpiritSystem } from '@/sim/spirit-system';
import { answerPrayer, dream } from '@/sim/divine-actions';
import { countPlayerBelievers, countDurableBelievers } from '@/sim/believers';
import type { GameMap, Entity } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

type Policy = 'ignore' | 'answerAll' | 'balanced';

function run(policy: Policy, ticks: number) {
  const world = new World(emptyMap());
  for (let i = 0; i < 6; i++) {
    const p = initNpcProps(`n${i}`, 'farmer', 100 + i);
    p.personality.skepticism = 0.5;
    p.beliefs['player'] = { faith: 0.3, understanding: 0, devotion: 0 };
    p.needs = { safety: 0.6, prosperity: 0.6, community: 0.6, meaning: 0.5 };
    world.addEntity({ id: `n${i}`, kind: 'npc', x: i, y: 0, properties: p as unknown as Record<string, unknown> });
  }

  const player: Spirit = { id: 'player', name: 'You', sigil: '✦', color: '#fff', isPlayer: true, power: 1000, manifestation: null };
  const spirits = new Map<SpiritId, Spirit>([['player', player]]);
  const clock = new SimClock();
  const log = new EventLog(clock);
  const rng = createRng(1);

  const sim = new NpcSimSystem();
  const activity = new NpcActivitySystem();
  const abandon = new AbandonmentSystem();
  const spiritSys = new SpiritSystem();

  for (let t = 0; t < ticks; t++) {
    const ctx = { world, spirits, log, clock, rng, dt: 1000, now: t };
    sim.tick(ctx);
    abandon.tick(ctx);
    activity.tick(ctx);
    spiritSys.tick(ctx);

    player.power = 1000; // test strategy shape, not the power economy
    const npcs: Entity[] = [];
    forEachNpc(world, (e) => npcs.push(e));
    for (const e of npcs) {
      const p = npcProps(e);
      const b = p.beliefs['player'];
      if (!b) continue;
      if (policy === 'ignore') continue;
      if (policy === 'answerAll') {
        if (p.activity === 'worship') answerPrayer(player, e, log);
      } else { // balanced: answer the praying, deepen the secure
        if (p.activity === 'worship') answerPrayer(player, e, log);
        else if (b.faith > 0.4 && b.devotion < 0.5) dream(player, e, log);
      }
    }
  }
  return { believers: countPlayerBelievers(world), durable: countDurableBelievers(world) };
}

describe('the dilemma (headless proof)', () => {
  it('ignore-everything → believers abandon you', () => {
    const r = run('ignore', 800);
    expect(r.believers).toBeLessThan(6);   // some left
    expect(r.durable).toBe(0);
  });

  it('answer-everything → can never build durable believers (Answer gives no devotion)', () => {
    const r = run('answerAll', 800);
    expect(r.durable).toBe(0);
  });

  it('balanced (answer + deepen) → grows durable believers', () => {
    const r = run('balanced', 800);
    expect(r.durable).toBeGreaterThan(0);
  });

  it('balanced retains more believers than ignore', () => {
    expect(run('balanced', 800).believers).toBeGreaterThan(run('ignore', 800).believers);
  });
});
