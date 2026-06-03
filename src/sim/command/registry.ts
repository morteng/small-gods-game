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
  whisper, omen, dream, miracle, answerPrayer,
  WHISPER_COST, OMEN_COST, DREAM_COST, MIRACLE_COST, ANSWER_PRAYER_COST,
} from '@/sim/divine-actions';
import type { Command, CommandCtx, ApplyCtx, CommandVerb, RejectionReason } from './types';
import {
  removePrecondition, removeApply,
  spawnPrecondition, spawnApply,
  modifyPrecondition, modifyApply,
  placePrecondition, placeApply,
  movePrecondition, moveApply,
} from './editor-verbs';

export interface CapabilityDef {
  verb: CommandVerb;
  tier: 'divine' | 'authoring' | 'editor';
  /** Power cost; reuses the divine-actions.ts constants. */
  cost: number;
  targetKind: 'npc' | 'settlement' | 'none';
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
    case 'settlement': return cmd.target.poiId;
    default: return 'world';
  }
}

export const CAPABILITY_REGISTRY: Record<CommandVerb, CapabilityDef> = {
  whisper: {
    verb: 'whisper', tier: 'divine', cost: WHISPER_COST, targetKind: 'npc', implemented: true,
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
    verb: 'answer_prayer', tier: 'divine', cost: ANSWER_PRAYER_COST, targetKind: 'npc', implemented: true,
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

  dream: {
    verb: 'dream', tier: 'divine', cost: DREAM_COST, targetKind: 'npc', implemented: true,
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

  // ── Authoring tier — declared, executor pending (Fate cycle) ─────────────────
  // Fate-reactive verbs: they will amplify/escalate what the sim already produces
  // (VISION §2.1), never inject arbitrary plot. No `apply` yet → 'not_implemented'.
  bias_event: {
    verb: 'bias_event', tier: 'authoring', cost: 0, targetKind: 'settlement', implemented: false,
    describe: (cmd) => `bias the next event at ${targetLabel(cmd)}`,
  },
  inject_npc: {
    verb: 'inject_npc', tier: 'authoring', cost: 0, targetKind: 'settlement', implemented: false,
    describe: (cmd) => `bring a stranger to ${targetLabel(cmd)}`,
  },
  nudge_severity: {
    verb: 'nudge_severity', tier: 'authoring', cost: 0, targetKind: 'settlement', implemented: false,
    describe: (cmd) => `nudge the severity of the event at ${targetLabel(cmd)}`,
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
};

export function getCapability(verb: CommandVerb): CapabilityDef | undefined {
  return CAPABILITY_REGISTRY[verb];
}

export function listCapabilities(): CapabilityDef[] {
  return Object.values(CAPABILITY_REGISTRY);
}
