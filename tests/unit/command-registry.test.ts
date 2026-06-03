import { describe, it, expect } from 'vitest';
import { CAPABILITY_REGISTRY, getCapability, listCapabilities } from '@/sim/command/registry';
import {
  WHISPER_COST, OMEN_COST, DREAM_COST, MIRACLE_COST, ANSWER_PRAYER_COST,
} from '@/sim/divine-actions';
import type { CommandVerb } from '@/sim/command/types';

const ALL_VERBS: CommandVerb[] = [
  'whisper', 'omen', 'dream', 'miracle', 'answer_prayer',
  'bias_event', 'inject_npc', 'nudge_severity',
];

describe('capability registry', () => {
  it('declares all 8 verbs', () => {
    expect(listCapabilities()).toHaveLength(8);
    for (const v of ALL_VERBS) {
      expect(getCapability(v)).toBeDefined();
      expect(CAPABILITY_REGISTRY[v].verb).toBe(v);
    }
  });

  it('implements the 5 divine verbs with an apply and the canonical cost', () => {
    const costs: Record<string, number> = {
      whisper: WHISPER_COST, omen: OMEN_COST, dream: DREAM_COST,
      miracle: MIRACLE_COST, answer_prayer: ANSWER_PRAYER_COST,
    };
    for (const [verb, cost] of Object.entries(costs)) {
      const def = CAPABILITY_REGISTRY[verb as CommandVerb];
      expect(def.tier).toBe('divine');
      expect(def.implemented).toBe(true);
      expect(typeof def.apply).toBe('function');
      expect(def.cost).toBe(cost);
    }
  });

  it('declares authoring verbs but leaves them unwired (executor pending)', () => {
    for (const v of ['bias_event', 'inject_npc', 'nudge_severity'] as CommandVerb[]) {
      const def = CAPABILITY_REGISTRY[v];
      expect(def.tier).toBe('authoring');
      expect(def.implemented).toBe(false);
      expect(def.apply).toBeUndefined();
      expect(def.cost).toBe(0);
    }
  });

  it('every verb has the expected target kind', () => {
    expect(CAPABILITY_REGISTRY.whisper.targetKind).toBe('npc');
    expect(CAPABILITY_REGISTRY.dream.targetKind).toBe('npc');
    expect(CAPABILITY_REGISTRY.answer_prayer.targetKind).toBe('npc');
    expect(CAPABILITY_REGISTRY.omen.targetKind).toBe('settlement');
    expect(CAPABILITY_REGISTRY.miracle.targetKind).toBe('settlement');
  });

  it('describe() produces a non-empty string for each verb', () => {
    for (const v of ALL_VERBS) {
      const s = CAPABILITY_REGISTRY[v].describe({ verb: v, source: 'player', target: { kind: 'settlement', poiId: 'poi1' }, seq: 0 });
      expect(s.length).toBeGreaterThan(0);
    }
  });
});
