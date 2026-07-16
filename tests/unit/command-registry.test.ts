import { describe, it, expect } from 'vitest';
import { CAPABILITY_REGISTRY, getCapability, listCapabilities } from '@/sim/command/registry';
import {
  WHISPER_COST, OMEN_COST, DREAM_COST, MIRACLE_COST, ANSWER_PRAYER_COST,
} from '@/sim/divine-actions';
import type { CommandVerb } from '@/sim/command/types';

const EDITOR_VERBS: CommandVerb[] = [
  'author_spawn_npc', 'author_remove_entity', 'author_modify_npc',
  'author_place_object', 'author_move_entity', 'author_set_climate',
];

// R9: meta-tier time-control verbs — declared in the registry (so the bus/story
// allowlist accepts them) but handled off-sim by TimeController (no `apply`).
const META_VERBS: CommandVerb[] = ['set_time_rate', 'skip_to_next_event', 'cancel_seek'];

const ALL_VERBS: CommandVerb[] = [
  'whisper', 'omen', 'dream', 'miracle', 'answer_prayer', 'probe_mind', 'smite', 'summon_storm',
  'bias_event', 'inject_npc', 'nudge_severity', 'place_building', 'grow_settlement',
  'rename_ward', 'retype_ward', 'set_rival_stance', 'set_lord_stance',
  ...EDITOR_VERBS,
  ...META_VERBS,
];

describe('capability registry', () => {
  it('declares all 26 verbs', () => {
    expect(listCapabilities()).toHaveLength(26);
    for (const v of ALL_VERBS) {
      expect(getCapability(v)).toBeDefined();
      expect(CAPABILITY_REGISTRY[v].verb).toBe(v);
    }
  });

  it('declares the meta verbs as apply-less, cost-0, meta-tier', () => {
    for (const v of META_VERBS) {
      const def = CAPABILITY_REGISTRY[v];
      expect(def.tier).toBe('meta');
      expect(def.cost).toBe(0);
      expect(def.implemented).toBe(true);
      expect(def.apply).toBeUndefined();   // routed to TimeController, never applied in-sim
    }
  });

  it('wires smite as a belief-gated divine verb (npc target, has a precondition)', () => {
    const def = CAPABILITY_REGISTRY.smite;
    expect(def.tier).toBe('divine');
    expect(def.implemented).toBe(true);
    expect(def.targetKind).toBe('npc');
    expect(typeof def.apply).toBe('function');
    expect(typeof def.precondition).toBe('function');
  });

  it('declares the editor verbs as implemented, cost-0, editor-tier', () => {
    for (const v of EDITOR_VERBS) {
      const def = CAPABILITY_REGISTRY[v];
      expect(def.tier).toBe('editor');
      expect(def.cost).toBe(0);
      expect(def.implemented).toBe(true);
      expect(typeof def.apply).toBe('function');
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

  it('wires every authoring verb as implemented (executor in place)', () => {
    for (const v of ['bias_event', 'inject_npc', 'nudge_severity', 'place_building', 'grow_settlement', 'rename_ward', 'retype_ward', 'set_lord_stance'] as CommandVerb[]) {
      const def = CAPABILITY_REGISTRY[v];
      expect(def.tier).toBe('authoring');
      expect(def.implemented).toBe(true);
      expect(typeof def.apply).toBe('function');
      expect(typeof def.precondition).toBe('function');
      expect(def.cost).toBe(0);
    }
  });

  it('wires bias_event as an implemented authoring (Fate escalation) verb', () => {
    const def = CAPABILITY_REGISTRY.bias_event;
    expect(def.tier).toBe('authoring');
    expect(def.implemented).toBe(true);
    expect(typeof def.apply).toBe('function');
    expect(typeof def.precondition).toBe('function');
    expect(def.cost).toBe(0);
  });

  it('wires inject_npc as the first implemented authoring (Fate escalation) verb', () => {
    const def = CAPABILITY_REGISTRY.inject_npc;
    expect(def.tier).toBe('authoring');
    expect(def.implemented).toBe(true);
    expect(typeof def.apply).toBe('function');
    expect(typeof def.precondition).toBe('function');
    expect(def.cost).toBe(0);
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
