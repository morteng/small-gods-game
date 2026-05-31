import { describe, it, expect } from 'vitest';
import { tickNpcEntity } from '@/sim/npc-sim';
import { initNpcProps } from '@/world/npc-helpers';
import type { Entity, NpcProperties } from '@/core/types';

function npc(overrides: Partial<NpcProperties> = {}): Entity {
  const p = initNpcProps('t', 'farmer', 7);
  p.personality.skepticism = 0; // isolate the new decays from baseline decay
  Object.assign(p, overrides);
  return { id: 't', kind: 'npc', x: 0, y: 0, properties: p as unknown as Record<string, unknown> };
}
function P(e: Entity): NpcProperties { return e.properties as unknown as NpcProperties; }

describe('comfort decay', () => {
  it('high needs erode faith when devotion is 0', () => {
    const e = npc();
    P(e).activity = 'idle';
    P(e).needs = { safety: 0.9, prosperity: 0.9, community: 0.9, meaning: 0.9 };
    P(e).beliefs['player'] = { faith: 0.8, understanding: 0, devotion: 0 };
    tickNpcEntity(e);
    expect(P(e).beliefs['player'].faith).toBeLessThan(0.8);
  });

  it('devotion resists comfort decay', () => {
    const e = npc();
    P(e).activity = 'idle';
    P(e).needs = { safety: 0.9, prosperity: 0.9, community: 0.9, meaning: 0.9 };
    P(e).beliefs['player'] = { faith: 0.8, understanding: 0, devotion: 1 };
    tickNpcEntity(e);
    expect(P(e).beliefs['player'].faith).toBeCloseTo(0.8, 5); // (1−devotion)=0 ⇒ no comfort decay
  });
});

describe('abandonment decay', () => {
  it('an unanswered worshipper loses faith', () => {
    const e = npc();
    P(e).activity = 'worship';
    P(e).needs = { safety: 0.5, prosperity: 0.5, community: 0.5, meaning: 0.5 };
    P(e).beliefs['player'] = { faith: 0.5, understanding: 0, devotion: 0 };
    tickNpcEntity(e);
    expect(P(e).beliefs['player'].faith).toBeLessThan(0.5);
  });

  it('devotion resists abandonment decay', () => {
    const e = npc();
    P(e).activity = 'worship';
    P(e).needs = { safety: 0.5, prosperity: 0.5, community: 0.5, meaning: 0.5 };
    P(e).beliefs['player'] = { faith: 0.5, understanding: 0, devotion: 1 };
    tickNpcEntity(e);
    expect(P(e).beliefs['player'].faith).toBeCloseTo(0.5, 5);
  });
});

describe('meaning decay', () => {
  it('meaning falls by MEANING_DECAY per tick', () => {
    const e = npc();
    P(e).needs = { safety: 0.8, prosperity: 0.8, community: 0.8, meaning: 0.8 };
    tickNpcEntity(e);
    expect(P(e).needs.meaning).toBeCloseTo(0.8 - 0.004, 5);
  });
});
