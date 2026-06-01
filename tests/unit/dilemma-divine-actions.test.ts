import { describe, it, expect } from 'vitest';
import { answerPrayer, dream, whisper, omen } from '@/sim/divine-actions';
import { World } from '@/world/world';
import type { GameMap } from '@/core/types';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { initNpcProps } from '@/world/npc-helpers';
import type { Entity, NpcProperties } from '@/core/types';
import type { Spirit } from '@/core/spirit';

function spirit(power = 100): Spirit {
  return { id: 'player', name: 'You', sigil: '✦', color: '#fff', isPlayer: true, power, manifestation: null };
}
function npc(setup: (p: NpcProperties) => void): Entity {
  const p = initNpcProps('t', 'farmer', 7);
  setup(p);
  return { id: 't', kind: 'npc', x: 0, y: 0, properties: p as unknown as Record<string, unknown> };
}
function P(e: Entity): NpcProperties { return e.properties as unknown as NpcProperties; }
const log = () => new EventLog(new SimClock());

describe('Answer', () => {
  it('restores meaning, raises faith, and exits worship', () => {
    const e = npc((p) => {
      p.activity = 'worship';
      p.activityDuration = 5;
      p.needs.meaning = 0.1;
      p.beliefs['player'] = { faith: 0.3, understanding: 0.2, devotion: 0.2 };
    });
    const ok = answerPrayer(spirit(), e, log());
    expect(ok).toBe(true);
    expect(P(e).needs.meaning).toBeCloseTo(0.4, 5);
    // ANSWER_PRAYER_FAITH_BOOST=0.2; signResponse(0.2)=0.6 → +0.12 → 0.42
    expect(P(e).beliefs['player'].faith).toBeCloseTo(0.42, 5);
    // a successful answer nudges understanding up by 0.04 → 0.24
    expect(P(e).beliefs['player'].understanding).toBeCloseTo(0.24, 5);
    expect(P(e).beliefs['player'].devotion).toBeCloseTo(0.2, 5); // unchanged — Deepen owns devotion
    expect(P(e).activity).toBe('idle');
    expect(P(e).activityDuration).toBe(0);
  });

  it('recruits a non-believer who is praying', () => {
    const e = npc((p) => {
      p.activity = 'worship';
      p.needs.meaning = 0.1;
      delete (p.beliefs as Record<string, unknown>)['player'];
    });
    answerPrayer(spirit(), e, log());
    // recruit: faith = 0.2 * signResponse(0) = 0.1; understanding seeded at 0.04
    expect(P(e).beliefs['player'].faith).toBeCloseTo(0.1, 5);
    expect(P(e).beliefs['player'].understanding).toBeCloseTo(0.04, 5);
    expect(P(e).beliefs['player'].devotion).toBe(0);
  });

  it('refuses when the NPC is not praying', () => {
    const e = npc((p) => { p.activity = 'idle'; });
    expect(answerPrayer(spirit(), e, log())).toBe(false);
  });
});

describe('Deepen (dream)', () => {
  it('raises understanding and devotion, barely touches faith, leaves needs alone', () => {
    const e = npc((p) => {
      p.needs.meaning = 0.2;
      p.beliefs['player'] = { faith: 0.3, understanding: 0.1, devotion: 0.1 };
    });
    const meaningBefore = P(e).needs.meaning;
    dream(spirit(), e, log());
    expect(P(e).beliefs['player'].understanding).toBeCloseTo(0.22, 5);
    expect(P(e).beliefs['player'].devotion).toBeCloseTo(0.22, 5);
    expect(P(e).beliefs['player'].faith).toBeCloseTo(0.35, 5);
    expect(P(e).needs.meaning).toBeCloseTo(meaningBefore, 5);
  });
});

function tinyMap(): GameMap {
  const tiles = [] as GameMap['tiles'];
  for (let y = 0; y < 3; y++) {
    const row = [];
    for (let x = 0; x < 3; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' as const });
    tiles.push(row);
  }
  return { tiles, width: 3, height: 3, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

function worldNpc(id: string, poiId: string, belief: { faith: number; understanding: number; devotion: number }): Entity {
  const p = initNpcProps(id, 'farmer', 7);
  p.homePoiId = poiId;
  p.beliefs['player'] = belief;
  return { id, kind: 'npc', x: 0, y: 0, properties: p as unknown as Record<string, unknown> };
}

describe('Omen', () => {
  it('boosts faith proportional to each witness understanding', () => {
    const world = new World(tinyMap());
    const dull = worldNpc('dull', 'poi1', { faith: 0.3, understanding: 0.0, devotion: 0 });
    const wise = worldNpc('wise', 'poi1', { faith: 0.3, understanding: 1.0, devotion: 0 });
    world.addEntity(dull);
    world.addEntity(wise);

    omen(spirit(), 'poi1', world, log());

    // OMEN_FAITH_BOOST=0.08; signResponse(0)=0.5 → +0.04; signResponse(1)=1.0 → +0.08
    expect(P(dull).beliefs['player'].faith).toBeCloseTo(0.34, 5);
    expect(P(wise).beliefs['player'].faith).toBeCloseTo(0.38, 5);
  });
});

describe('Whisper', () => {
  it('scales faith gain by understanding but raises understanding flatly', () => {
    const e = npc((p) => {
      p.whisperCooldown = 0;
      p.beliefs['player'] = { faith: 0.3, understanding: 0.2, devotion: 0.1 };
    });
    whisper(spirit(), e, log());
    // WHISPER_FAITH_BOOST=0.15; signResponse(0.2)=0.6 → +0.09 → 0.39
    expect(P(e).beliefs['player'].faith).toBeCloseTo(0.39, 5);
    // WHISPER_UNDERSTANDING_BOOST=0.03, ungated → 0.23
    expect(P(e).beliefs['player'].understanding).toBeCloseTo(0.23, 5);
  });

  it('bootstraps a new believer at the floor response', () => {
    const e = npc((p) => {
      p.whisperCooldown = 0;
      delete (p.beliefs as Record<string, unknown>)['player'];
    });
    whisper(spirit(), e, log());
    // new believer: faith = 0.15 * signResponse(0) = 0.075; understanding = 0.03
    expect(P(e).beliefs['player'].faith).toBeCloseTo(0.075, 5);
    expect(P(e).beliefs['player'].understanding).toBeCloseTo(0.03, 5);
    expect(P(e).beliefs['player'].devotion).toBe(0);
  });
});
