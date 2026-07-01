/**
 * ward-verbs.ts — `rename_ward` / `retype_ward` authoring verbs (S6). Fate or the
 * Create panel names a settlement + ward id and gives it a new display name or
 * district type; the verb mutates `plan.wards[i]` in place. District authoring is
 * a typed intent (named ward + new value), never a raw tile edit, and touches no
 * entities — deterministic, no rng.
 */
import type { Command, ApplyCtx, CommandCtx, RejectionReason } from './types';
import type { SettlementPlan, Ward } from '@/world/settlement-plan';

/** The valid ward district types (the `Ward['type']` union). */
const WARD_TYPES: ReadonlySet<Ward['type']> = new Set<Ward['type']>([
  'market', 'harbour', 'temple', 'gate', 'residential', 'craft', 'suburb',
]);

function planFor(cmd: Command, ctx: CommandCtx): SettlementPlan | undefined {
  if (cmd.target.kind !== 'settlement') return undefined;
  const poiId = cmd.target.poiId;
  return ctx.world.tiles.settlementPlans?.find(p => p.poiId === poiId);
}

/** The `wardId` argument from either the structured payload or loose params. */
function wardId(cmd: Command): unknown {
  return cmd.payload?.wardId ?? cmd.params?.wardId;
}

function wardFor(cmd: Command, plan: SettlementPlan): Ward | undefined {
  const id = wardId(cmd);
  return typeof id === 'string' ? plan.wards.find(w => w.id === id) : undefined;
}

// ─── rename_ward ────────────────────────────────────────────────────────────

function rawName(cmd: Command): unknown { return cmd.payload?.name ?? cmd.params?.name; }

export function renameWardPrecondition(cmd: Command, ctx: CommandCtx): RejectionReason | null {
  if (cmd.target.kind !== 'settlement') return 'invalid_target';
  const plan = planFor(cmd, ctx);
  if (!plan) return 'invalid_target';
  if (!wardFor(cmd, plan)) return 'invalid_target';
  const name = rawName(cmd);
  if (typeof name !== 'string' || name.trim() === '') return 'invalid_payload';
  return null;
}

export function renameWardApply(cmd: Command, ctx: ApplyCtx): boolean {
  const plan = planFor(cmd, ctx);
  if (!plan) return false;
  const ward = wardFor(cmd, plan);
  const name = rawName(cmd);
  if (!ward || typeof name !== 'string' || name.trim() === '') return false;
  ward.name = name;
  return true;
}

// ─── retype_ward ────────────────────────────────────────────────────────────

function rawType(cmd: Command): unknown { return cmd.payload?.type ?? cmd.params?.type; }

export function retypeWardPrecondition(cmd: Command, ctx: CommandCtx): RejectionReason | null {
  if (cmd.target.kind !== 'settlement') return 'invalid_target';
  const plan = planFor(cmd, ctx);
  if (!plan) return 'invalid_target';
  if (!wardFor(cmd, plan)) return 'invalid_target';
  const type = rawType(cmd);
  if (typeof type !== 'string' || !WARD_TYPES.has(type as Ward['type'])) return 'invalid_payload';
  return null;
}

export function retypeWardApply(cmd: Command, ctx: ApplyCtx): boolean {
  const plan = planFor(cmd, ctx);
  if (!plan) return false;
  const ward = wardFor(cmd, plan);
  const type = rawType(cmd);
  if (!ward || typeof type !== 'string' || !WARD_TYPES.has(type as Ward['type'])) return false;
  ward.type = type as Ward['type'];
  return true;
}
