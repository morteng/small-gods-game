import { describe, it, expect } from 'vitest';
import { answerPrayer, dream } from '@/sim/divine-actions';
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
    expect(P(e).beliefs['player'].faith).toBeCloseTo(0.5, 5);
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
    expect(P(e).beliefs['player'].faith).toBeCloseTo(0.2, 5);
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
