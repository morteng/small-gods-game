/**
 * Capability registry — the single source of truth for every divine possibility.
 *
 * One `CapabilityDef` per verb. The player, rivals, Fate, the UI, and tests all
 * introspect this to know the full vocabulary and how each verb is gated. Divine
 * verbs delegate their effect to `divine-actions.ts` (the channel routes + gates;
 * it never reimplements an effect). Authoring-tier verbs are declared but
 * `implemented: false` — the executor rejects them `not_implemented` until the
 * Fate cycle fills in their `apply`.
 */
import type { Entity } from '@/core/types';
import { getNpc, npcProps } from '@/world/npc-helpers';
import {
  whisper, omen, dream, miracle, answerPrayer, smite, smiteLocation, summonStorm,
  WHISPER_COST, OMEN_COST, DREAM_COST, MIRACLE_COST, ANSWER_PRAYER_COST, SMITE_COST, SUMMON_STORM_COST,
} from '@/sim/divine-actions';
import { aggregateDomain, DOMAIN_DEFS } from '@/sim/belief-domains';
import { mindProbeCost, probeMind } from '@/sim/mind-probe';
import type { Command, CommandCtx, ApplyCtx, CommandVerb, CommandTargetKind, RejectionReason } from './types';
import {
  removePrecondition, removeApply,
  spawnPrecondition, spawnApply,
  modifyPrecondition, modifyApply,
  placePrecondition, placeApply,
  movePrecondition, moveApply,
  setClimatePrecondition, setClimateApply,
} from './editor-verbs';
import { injectNpcPrecondition, injectNpcApply, biasEventPrecondition, biasEventApply, nudgeSeverityPrecondition, nudgeSeverityApply } from './authoring-verbs';
import { placeBuildingPrecondition, placeBuildingApply } from './building-verbs';
import { growSettlementPrecondition, growSettlementApply } from './settlement-verbs';
import {
  renameWardPrecondition, renameWardApply, retypeWardPrecondition, retypeWardApply,
} from './ward-verbs';

export interface CapabilityDef {
  verb: CommandVerb;
  tier: 'divine' | 'authoring' | 'editor';
  /** Power cost; reuses the divine-actions.ts constants. */
  cost: number;
  /** Primary target shape — the default for labels, castPower defaults, and the MCP view. */
  targetKind: CommandTargetKind;
  /**
   * The FULL set of target shapes the verb accepts (agent-driven-UI P2). Defaults
   * to `[targetKind]` — read via `acceptedTargetKinds`, never `def.targetKinds`.
   * E.g. smite accepts a person, a thing, or a spot: `['npc','entity','tile']`.
   */
  targetKinds?: readonly CommandTargetKind[];
  /**
   * Reticle shape for verb-first targeting (agent-driven-UI). 'point' highlights
   * one cell/entity; 'area' brushes a radius (stretch). Defaults to 'point' — read
   * via `capFootprint`, never `def.footprint` directly.
   */
  footprint?: 'point' | 'area';
  /**
   * UI shape (agent-driven-UI). 'leaf' fires one Command on click; 'branch' expands
   * to a UiSpec card of paths. Defaults to 'leaf' — read via `capShape`. Reserve
   * branching for influence/speech verbs (whisper/dream/answer_prayer) where the
   * chosen content changes the outcome; keep visceral verbs (smite) as leaves.
   */
  shape?: 'leaf' | 'branch';
  /** false ⇒ executor rejects with 'not_implemented'. */
  implemented: boolean;
  /** Read-only gate (cooldown, worship-state, …). Returns a reason or null. */
  precondition?(cmd: Command, ctx: CommandCtx): RejectionReason | null;
  /**
   * Mutating effect. Delegates to divine-actions.ts, which itself pays the power
   * cost and appends the SimEvent. Returns false if the underlying function
   * declined (lost a race after the pre-gate).
   */
  apply?(cmd: Command, ctx: ApplyCtx): boolean;
  /** Short human/agent-readable summary for logs, tooltips, Fate introspection. */
  describe(cmd: Command): string;
}

function npcOf(cmd: Command, ctx: CommandCtx): Entity | undefined {
  return cmd.target.kind === 'npc' ? getNpc(ctx.world, cmd.target.npcId) : undefined;
}

function targetLabel(cmd: Command): string {
  switch (cmd.target.kind) {
    case 'npc': return cmd.target.npcId;
    case 'entity': return cmd.target.id;
    case 'settlement': return cmd.target.poiId;
    case 'tile': return `(${cmd.target.x}, ${cmd.target.y})`;
    default: return 'world';
  }
}

export const CAPABILITY_REGISTRY: Record<CommandVerb, CapabilityDef> = {
  whisper: {
    verb: 'whisper', tier: 'divine', cost: WHISPER_COST, targetKind: 'npc', shape: 'branch', implemented: true,
    precondition(cmd, ctx) {
      const npc = npcOf(cmd, ctx);
      if (!npc) return 'invalid_target';
      // Conversational sends are power-throttled only — bypass the 5-tick cooldown.
      if (cmd.payload?.conversational === true) return null;
      return npcProps(npc).whisperCooldown > 0 ? 'precondition_failed' : null;
    },
    apply(cmd, ctx) {
      return whisper(ctx.spirits.get(cmd.source)!, npcOf(cmd, ctx)!, ctx.log, cmd.payload?.conversational === true);
    },
    describe: (cmd) => `whisper to ${targetLabel(cmd)}`,
  },

  answer_prayer: {
    verb: 'answer_prayer', tier: 'divine', cost: ANSWER_PRAYER_COST, targetKind: 'npc', shape: 'branch', implemented: true,
    precondition(cmd, ctx) {
      const npc = npcOf(cmd, ctx);
      if (!npc) return 'invalid_target';
      return npcProps(npc).activity !== 'worship' ? 'precondition_failed' : null;
    },
    apply(cmd, ctx) {
      return answerPrayer(ctx.spirits.get(cmd.source)!, npcOf(cmd, ctx)!, ctx.log);
    },
    describe: (cmd) => `answer the prayer of ${targetLabel(cmd)}`,
  },

  probe_mind: {
    verb: 'probe_mind', tier: 'divine', cost: 0, targetKind: 'npc', implemented: true,
    precondition(cmd, ctx) {
      const npc = npcOf(cmd, ctx);
      if (!npc) return 'invalid_target';
      const depth = Number(cmd.payload?.depth ?? 0);
      const spirit = ctx.spirits.get(cmd.source);
      if (!spirit) return 'invalid_target';
      return spirit.power < mindProbeCost(depth) ? 'insufficient_power' : null;
    },
    apply(cmd, ctx) {
      const depth = Number(cmd.payload?.depth ?? 0);
      return probeMind(ctx.spirits.get(cmd.source)!, depth, ctx.log, npcOf(cmd, ctx)!.id);
    },
    describe: (cmd) => `read the mind of ${targetLabel(cmd)} (depth ${Number(cmd.payload?.depth ?? 0)})`,
  },

  dream: {
    verb: 'dream', tier: 'divine', cost: DREAM_COST, targetKind: 'npc', shape: 'branch', implemented: true,
    apply(cmd, ctx) {
      return dream(ctx.spirits.get(cmd.source)!, npcOf(cmd, ctx)!, ctx.log);
    },
    describe: (cmd) => `send a dream to ${targetLabel(cmd)}`,
  },

  omen: {
    verb: 'omen', tier: 'divine', cost: OMEN_COST, targetKind: 'settlement', implemented: true,
    apply(cmd, ctx) {
      const poiId = (cmd.target as { poiId: string }).poiId;
      return omen(ctx.spirits.get(cmd.source)!, poiId, ctx.world, ctx.log);
    },
    describe: (cmd) => `show an omen over ${targetLabel(cmd)}`,
  },

  miracle: {
    verb: 'miracle', tier: 'divine', cost: MIRACLE_COST, targetKind: 'settlement', implemented: true,
    apply(cmd, ctx) {
      const poiId = (cmd.target as { poiId: string }).poiId;
      return miracle(ctx.spirits.get(cmd.source)!, poiId, ctx.world, ctx.log);
    },
    describe: (cmd) => `work a miracle at ${targetLabel(cmd)}`,
  },

  smite: {
    verb: 'smite', tier: 'divine', cost: SMITE_COST, targetKind: 'npc',
    targetKinds: ['npc', 'entity', 'tile'], implemented: true,
    precondition(cmd, ctx) {
      // Target kind + existence are validated by previewCommand; here we only gate
      // on power + the belief-CONTENT requirement (congregation must believe you
      // command the storm), which holds for a strike on anyone or anything.
      const spirit = ctx.spirits.get(cmd.source);
      if (!spirit) return 'invalid_target';
      if (spirit.power < SMITE_COST) return 'insufficient_power';
      const def = DOMAIN_DEFS.storm;
      const agg = aggregateDomain(ctx.world, cmd.source, 'storm');
      if (agg.conviction < def.unlockThreshold) return 'precondition_failed';
      return null;
    },
    apply(cmd, ctx) {
      const sp = ctx.spirits.get(cmd.source)!;
      const t = cmd.target;
      if (t.kind === 'npc') return smite(sp, npcOf(cmd, ctx)!, ctx.world, ctx.log);
      if (t.kind === 'tile') return smiteLocation(sp, t.x, t.y, ctx.world, ctx.log);
      if (t.kind === 'entity') {
        const e = ctx.world.registry.get(t.id);
        return e ? smiteLocation(sp, e.x, e.y, ctx.world, ctx.log) : false;
      }
      return false;
    },
    describe: (cmd) => `call lightning down on ${targetLabel(cmd)}`,
  },

  summon_storm: {
    verb: 'summon_storm', tier: 'divine', cost: SUMMON_STORM_COST, targetKind: 'settlement', implemented: true,
    precondition(cmd, ctx) {
      if (cmd.target.kind !== 'settlement') return 'invalid_target';
      const spirit = ctx.spirits.get(cmd.source);
      if (!spirit) return 'invalid_target';
      if (spirit.power < SUMMON_STORM_COST) return 'insufficient_power';
      // Belief-CONTENT gate: the congregation must believe you command the rains.
      const def = DOMAIN_DEFS.flood;
      const agg = aggregateDomain(ctx.world, cmd.source, 'flood');
      if (agg.conviction < def.unlockThreshold) return 'precondition_failed';
      return null;
    },
    apply(cmd, ctx) {
      const poiId = (cmd.target as { poiId: string }).poiId;
      return summonStorm(ctx.spirits.get(cmd.source)!, poiId, ctx.log, ctx.weather);
    },
    describe: (cmd) => `summon a deluge over ${targetLabel(cmd)}`,
  },

  // ── Authoring tier — declared, executor pending (Fate cycle) ─────────────────
  // Fate-reactive verbs: they will amplify/escalate what the sim already produces
  // (VISION §2.1), never inject arbitrary plot. No `apply` yet → 'not_implemented'.
  bias_event: {
    verb: 'bias_event', tier: 'authoring', cost: 0, targetKind: 'settlement', implemented: true,
    precondition: biasEventPrecondition,
    apply: biasEventApply,
    describe: (cmd) => `force next event at ${targetLabel(cmd)} to be ${cmd.payload?.eventType ?? 'an event'}`,
  },
  inject_npc: {
    verb: 'inject_npc', tier: 'authoring', cost: 0, targetKind: 'settlement', implemented: true,
    precondition: injectNpcPrecondition,
    apply: injectNpcApply,
    describe: (cmd) => `bring a ${cmd.payload?.role ?? 'stranger'} to ${targetLabel(cmd)}`,
  },
  nudge_severity: {
    verb: 'nudge_severity', tier: 'authoring', cost: 0, targetKind: 'settlement', implemented: true,
    precondition: nudgeSeverityPrecondition,
    apply: nudgeSeverityApply,
    describe: (cmd) => `nudge severity of ${targetLabel(cmd)} event by ${cmd.payload?.delta ?? 0}`,
  },
  place_building: {
    verb: 'place_building', tier: 'authoring', cost: 0, targetKind: 'settlement', implemented: true,
    precondition: placeBuildingPrecondition,
    apply: placeBuildingApply,
    describe: (cmd) => `raise a ${cmd.payload?.preset ?? 'building'} at ${targetLabel(cmd)}`,
  },
  grow_settlement: {
    verb: 'grow_settlement', tier: 'authoring', cost: 0, targetKind: 'settlement', implemented: true,
    precondition: growSettlementPrecondition,
    apply: growSettlementApply,
    describe: (cmd) => `grow ${targetLabel(cmd)} by ${cmd.payload?.steps ?? cmd.params?.steps ?? 1} step(s)`,
  },
  rename_ward: {
    verb: 'rename_ward', tier: 'authoring', cost: 0, targetKind: 'settlement', implemented: true,
    precondition: renameWardPrecondition,
    apply: renameWardApply,
    describe: (cmd) => `rename ward ${cmd.payload?.wardId ?? cmd.params?.wardId ?? '?'} to "${cmd.payload?.name ?? cmd.params?.name ?? '?'}"`,
  },
  retype_ward: {
    verb: 'retype_ward', tier: 'authoring', cost: 0, targetKind: 'settlement', implemented: true,
    precondition: retypeWardPrecondition,
    apply: retypeWardApply,
    describe: (cmd) => `set ward ${cmd.payload?.wardId ?? cmd.params?.wardId ?? '?'} type to ${cmd.payload?.type ?? cmd.params?.type ?? '?'}`,
  },

  // ── Editor tier — god-mode authoring (Create panel). cost 0, no spirit. ──────
  // precondition/apply wired in SP2 tasks 3-6; stubs reject not_implemented.
  author_spawn_npc: {
    verb: 'author_spawn_npc', tier: 'editor', cost: 0, targetKind: 'none', implemented: true,
    precondition: spawnPrecondition,
    apply: spawnApply,
    describe: (cmd) => `spawn ${(cmd.payload?.count as number) ?? 1}× ${cmd.payload?.role ?? 'npc'}`,
  },
  author_remove_entity: {
    verb: 'author_remove_entity', tier: 'editor', cost: 0, targetKind: 'none', implemented: true,
    precondition: removePrecondition,
    apply: removeApply,
    describe: (cmd) => `remove ${cmd.payload?.entityId ?? `${cmd.payload?.filter ? 'matching entities' : 'entities'}`}`,
  },
  author_modify_npc: {
    verb: 'author_modify_npc', tier: 'editor', cost: 0, targetKind: 'none', implemented: true,
    precondition: modifyPrecondition,
    apply: modifyApply,
    describe: (cmd) => `modify ${cmd.payload?.entityId ?? 'an npc'}`,
  },
  author_place_object: {
    verb: 'author_place_object', tier: 'editor', cost: 0, targetKind: 'none', implemented: true,
    precondition: placePrecondition,
    apply: placeApply,
    describe: (cmd) => `place ${(cmd.payload?.count as number) ?? 1}× ${cmd.payload?.kind ?? 'object'}`,
  },
  author_move_entity: {
    verb: 'author_move_entity', tier: 'editor', cost: 0, targetKind: 'none', implemented: true,
    precondition: movePrecondition,
    apply: moveApply,
    describe: (cmd) => `move ${cmd.payload?.entityId ?? 'an entity'}`,
  },
  author_set_climate: {
    verb: 'author_set_climate', tier: 'editor', cost: 0, targetKind: 'none', implemented: true,
    precondition: setClimatePrecondition,
    apply: setClimateApply,
    describe: (cmd) => `set the world climate to ${cmd.payload?.climate ?? '?'}`,
  },
};

export function getCapability(verb: CommandVerb): CapabilityDef | undefined {
  return CAPABILITY_REGISTRY[verb];
}

/** The full set of target shapes a verb accepts, defaulted to `[targetKind]`. */
export function acceptedTargetKinds(def: CapabilityDef): readonly CommandTargetKind[] {
  return def.targetKinds ?? [def.targetKind];
}

/** Reticle shape, defaulted. Always read footprint through this, never `def.footprint`. */
export function capFootprint(def: CapabilityDef): 'point' | 'area' {
  return def.footprint ?? 'point';
}

/** UI shape (leaf/branch), defaulted. Always read shape through this, never `def.shape`. */
export function capShape(def: CapabilityDef): 'leaf' | 'branch' {
  return def.shape ?? 'leaf';
}

export function listCapabilities(): CapabilityDef[] {
  return Object.values(CAPABILITY_REGISTRY);
}
