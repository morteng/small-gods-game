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
const TIME_VERBS: CommandVerb[] = ['set_time_rate', 'skip_to_next_event', 'cancel_seek'];

// UI v3: meta-tier SHELL verbs — the menu flow (new/load/save, screens, settings,
// rebinding, photo + world code). Same apply-less contract as the time verbs;
// intercepted by `Game.handleMetaCommand`, so the whole menu is drivable through
// the ordinary command path by MCP / the dev bus / tests.
const SHELL_VERBS: CommandVerb[] = [
  'new_game', 'load_slot', 'save_slot', 'delete_slot', 'rename_slot',
  'quit_to_title', 'open_screen', 'close_screen',
  'set_setting', 'rebind_key', 'capture_photo', 'copy_world_code',
];

const META_VERBS: CommandVerb[] = [...TIME_VERBS, ...SHELL_VERBS];

const ALL_VERBS: CommandVerb[] = [
  'whisper', 'omen', 'dream', 'miracle', 'answer_prayer', 'probe_mind', 'smite', 'summon_storm',
  'proclaim_peace', 'bind_oath',
  'bias_event', 'inject_npc', 'nudge_severity', 'place_building', 'grow_settlement',
  'rename_ward', 'retype_ward', 'set_rival_stance', 'set_lord_stance', 'found_castle',
  'muster_garrison', 'stand_down_garrison',
  ...EDITOR_VERBS,
  ...META_VERBS,
];

describe('capability registry', () => {
  it('declares every verb exactly once, and nothing extra', () => {
    // Asserted against the enumerated list rather than a bare magic number, so a
    // verb added to the registry but forgotten here fails with a NAME, not just a
    // count mismatch.
    const declared = listCapabilities().map((d) => d.verb).sort();
    expect(declared).toEqual([...ALL_VERBS].sort());
    for (const v of ALL_VERBS) {
      expect(getCapability(v)).toBeDefined();
      expect(CAPABILITY_REGISTRY[v].verb).toBe(v);
    }
  });

  it('every shell verb takes NO target, so hover-affordance ranking is untouched', () => {
    // Affordances rank by accepted target kind; a shell verb that accepted an npc
    // or tile would start appearing in hover chips and inspector rows.
    for (const v of SHELL_VERBS) {
      expect(CAPABILITY_REGISTRY[v].targetKind).toBe('none');
      expect(CAPABILITY_REGISTRY[v].targetKinds).toBeUndefined();
    }
  });

  it('every shell verb describes itself without throwing on empty params', () => {
    // `describe` feeds the MCP `preview_command` output and the dev bus log, and
    // callers legitimately omit params — it must degrade, never throw.
    for (const v of SHELL_VERBS) {
      const def = CAPABILITY_REGISTRY[v];
      const text = def.describe({ verb: v, source: 'player', target: { kind: 'none' }, seq: 1 });
      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(0);
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

  it('wires the Peace of God verbs as divine, DEVOTION-funded (power cost 0), gated by precondition', () => {
    // M6: the currency is the congregation's devotion, drawn down in the effect —
    // cost stays 0 so the power gate NEVER fires (spends devotion, not power).
    for (const [verb, targetKind] of [['proclaim_peace', 'settlement'], ['bind_oath', 'npc']] as const) {
      const def = CAPABILITY_REGISTRY[verb];
      expect(def.tier).toBe('divine');
      expect(def.implemented).toBe(true);
      expect(def.cost).toBe(0);
      expect(def.targetKind).toBe(targetKind);
      expect(typeof def.apply).toBe('function');
      expect(typeof def.precondition).toBe('function');
    }
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

  it('wires muster_garrison / stand_down_garrison as authoring (mortal power, settlement-targeted)', () => {
    // Manning the Walls (W3): same tier reasoning as found_castle — a lord musters his own watch,
    // never a god buying soldiers with belief-power. Both take a settlement target and cost 0.
    for (const v of ['muster_garrison', 'stand_down_garrison'] as CommandVerb[]) {
      const def = CAPABILITY_REGISTRY[v];
      expect(def.tier).toBe('authoring');
      expect(def.implemented).toBe(true);
      expect(def.targetKind).toBe('settlement');
      expect(def.cost).toBe(0);
      expect(typeof def.apply).toBe('function');
      expect(typeof def.precondition).toBe('function');
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
