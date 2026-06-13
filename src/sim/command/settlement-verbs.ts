/**
 * settlement-verbs.ts — the `grow_settlement` authoring verb (S5). Fate (or the
 * Create panel) names a settlement; the verb runs the live growth sequence N
 * steps (infill → ribbon → upgrade → back-lane) — the SAME code the 0.25 Hz
 * SettlementGrowthSystem and the time-skip catch-up drive. Agent influence is an
 * input to the seeded planner (a step budget), never a raw tile edit, so the
 * world stays deterministic. All randomness flows through ctx.rng.
 */
import type { Command, ApplyCtx, CommandCtx, RejectionReason } from './types';
import { growSettlement } from '@/sim/systems/settlement-growth-system';
import type { SettlementPlan } from '@/world/settlement-plan';

/** Upper bound on steps per command — a town grows incrementally, not instantly. */
const MAX_STEPS = 64;

/** Raw `steps` argument from either the structured payload or params. */
function rawSteps(cmd: Command): unknown {
  return cmd.payload?.steps ?? cmd.params?.steps;
}

/** Clamp the requested step count into [1, MAX_STEPS]; defaults to 1. */
function stepCount(cmd: Command): number {
  const raw = rawSteps(cmd);
  const n = typeof raw === 'number' ? raw : 1;
  return Math.max(1, Math.min(MAX_STEPS, Math.floor(n)));
}

/** The targeted settlement's plan, if it exists and has lots to grow into. */
function planFor(cmd: Command, ctx: CommandCtx): SettlementPlan | undefined {
  if (cmd.target.kind !== 'settlement') return undefined;
  const poiId = cmd.target.poiId;
  return ctx.world.tiles.settlementPlans?.find(p => p.poiId === poiId);
}

export function growSettlementPrecondition(cmd: Command, ctx: CommandCtx): RejectionReason | null {
  if (cmd.target.kind !== 'settlement') return 'invalid_target';
  const plan = planFor(cmd, ctx);
  if (!plan || plan.lots.length === 0) return 'invalid_target';
  const raw = rawSteps(cmd);
  if (raw !== undefined && (typeof raw !== 'number' || raw < 1)) return 'invalid_payload';
  return null;
}

export function growSettlementApply(cmd: Command, ctx: ApplyCtx): boolean {
  const plan = planFor(cmd, ctx);
  if (!plan) return false;
  const n = stepCount(cmd);
  let any = false;
  for (let s = 0; s < n; s++) {
    // Per-step tag keeps grown/upgraded entity ids unique within this one tick;
    // (now, seq) make it deterministic and distinct from the bare-tick ids the
    // live system mints.
    if (!growSettlement(ctx, plan, `cmd${ctx.now}_${cmd.seq}_${s}`)) break;
    any = true;
  }
  return any;
}
