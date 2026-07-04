/**
 * authoring-verbs.ts — the effect of Fate's authoring-tier verbs.
 *
 * These are Fate's reactive escalation levers: they amplify what the sim already
 * produces (VISION §2.1), never arbitrary plot. v1 implements `inject_npc` — a
 * stranger (preacher / skeptic / refugee) arrives at a settlement under an active
 * thread. All randomness flows through ctx.rng (seeded) — never Math.random.
 */
import type { NpcRole, SettlementEventType } from '@/core/types';
import type { Command, ApplyCtx, CommandCtx, RejectionReason } from './types';
import { initNpcProps } from '@/world/npc-helpers';
import { strategyForPersonality } from '@/sim/rival-spirit';
import { resolveCenter, findPlacement } from './editor-verbs';

const P = (cmd: Command): Record<string, unknown> => cmd.payload ?? {};
const STRANGER_NAMES = ['Wanderer', 'Pilgrim', 'Outsider', 'Traveller', 'Foundling', 'Exile'];

/** Fate-narrative roles → existing sim NpcRole. */
export const FATE_ROLE_MAP: Record<string, NpcRole> = {
  preacher: 'priest',
  skeptic: 'elder',
  refugee: 'beggar',
};

function poiOf(cmd: Command): string | undefined {
  return cmd.target.kind === 'settlement' ? cmd.target.poiId : undefined;
}

export function injectNpcPrecondition(cmd: Command, ctx: CommandCtx): RejectionReason | null {
  const role = P(cmd).role as string | undefined;
  if (!role || !(role in FATE_ROLE_MAP)) return 'invalid_payload';
  const poiId = poiOf(cmd);
  if (!poiId) return 'invalid_target';
  if (resolveCenter(poiId, ctx) === null) return 'invalid_target';   // no resident → can't place
  return null;
}

export function injectNpcApply(cmd: Command, ctx: ApplyCtx): boolean {
  const fateRole = P(cmd).role as string;
  const role = FATE_ROLE_MAP[fateRole];
  const center = resolveCenter(poiOf(cmd)!, ctx)!;       // validated in precondition
  const spot = findPlacement(ctx.world, center.x, center.y);
  if (!spot) return false;                                // no room → decline cleanly

  const seed = ctx.rng.nextInt(0x7fffffff);
  const props = initNpcProps(ctx.rng.pick(STRANGER_NAMES), role, seed);
  props.birthTick = ctx.now;
  props.homeX = spot.x; props.homeY = spot.y;
  props.beliefs.player.faith = 0;                         // a stranger, yet to believe
  props.fateRole = fateRole;

  let id = '';
  do { id = `npc-f${ctx.now}-${ctx.rng.nextInt(0x7fffffff)}`; } while (ctx.world.registry.get(id));
  props.lineageId = id;                                   // founder of its own lineage
  ctx.world.addEntity({ id, kind: 'npc', x: spot.x, y: spot.y, properties: props as unknown as Record<string, unknown> });
  ctx.log.append({ type: 'authored_spawn', entityIds: [id], role, count: 1 });
  return true;
}

// ── bias_event ───────────────────────────────────────────────────────────────
// Force the next settlement event at a poi to be a specific type. A one-shot
// write onto world.forcedEvents; the settlement-event system consumes it later.
const EVENT_TYPES: ReadonlySet<string> = new Set<SettlementEventType>([
  'drought', 'festival', 'dispute', 'plague', 'raiders', 'trading_caravan', 'stranger_arrives', 'harvest_blessing',
]);

export function biasEventPrecondition(cmd: Command, _ctx: CommandCtx): RejectionReason | null {
  const poiId = poiOf(cmd);
  if (!poiId) return 'invalid_target';
  const type = P(cmd).eventType;
  if (typeof type !== 'string' || !EVENT_TYPES.has(type)) return 'invalid_payload';
  return null;
}

export function biasEventApply(cmd: Command, ctx: ApplyCtx): boolean {
  ctx.world.forcedEvents.set(poiOf(cmd)!, P(cmd).eventType as SettlementEventType);
  return true;
}

// ── nudge_severity ───────────────────────────────────────────────────────────
// Adjust the severity of every active event at a settlement by a signed delta.
// Pure mutation — no RNG. Clamped to [0.05, 1.0]; per-call magnitude capped ±0.5.
const SEVERITY_MIN = 0.05;
const SEVERITY_MAX = 1.0;
const MAX_NUDGE = 0.5;       // per-call magnitude cap

export function nudgeSeverityPrecondition(cmd: Command, ctx: CommandCtx): RejectionReason | null {
  const poiId = poiOf(cmd);
  if (!poiId) return 'invalid_target';
  const delta = P(cmd).delta;
  if (typeof delta !== 'number' || !Number.isFinite(delta)) return 'invalid_payload';
  const events = ctx.world.activeEvents.get(poiId);
  if (!events || events.length === 0) return 'precondition_failed';
  return null;
}

export function nudgeSeverityApply(cmd: Command, ctx: ApplyCtx): boolean {
  const events = ctx.world.activeEvents.get(poiOf(cmd)!);
  if (!events || events.length === 0) return false;          // lost a race after the pre-gate
  const raw = P(cmd).delta as number;
  const delta = Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, raw));
  for (const e of events) {
    e.severity = Math.round(Math.max(SEVERITY_MIN, Math.min(SEVERITY_MAX, e.severity + delta)) * 100) / 100;
  }
  return true;
}

// ── set_rival_stance ─────────────────────────────────────────────────────────
// Fate's anti-snowball lever: coach a RIVAL spirit's personality by clamped deltas
// (VISION §"the counter-loop" — Fate escalates against dominance, eases on collapse).
// The rival id rides `payload.rivalId` (there is no spirit CommandTarget); each
// listed field is nudged by a signed delta, per-call capped ±0.2 and clamped to
// [0,1]. Pure mutation — no RNG. Never targets the player (precondition guards it).
const STANCE_FIELDS = ['aggression', 'subtlety', 'territoriality', 'assertiveness', 'jealousy'] as const;
const STANCE_MIN = 0.0;
const STANCE_MAX = 1.0;
const MAX_STANCE_DELTA = 0.2;   // per-call, per-field magnitude cap

function stanceRivalId(cmd: Command): string | undefined {
  const id = P(cmd).rivalId;
  return typeof id === 'string' && id ? id : undefined;
}

export function setRivalStancePrecondition(cmd: Command, ctx: CommandCtx): RejectionReason | null {
  const rivalId = stanceRivalId(cmd);
  if (!rivalId) return 'invalid_target';
  const spirit = ctx.spirits.get(rivalId);
  if (!spirit) return 'invalid_target';
  if (spirit.isPlayer || !spirit.ai?.personality) return 'invalid_target';   // rivals only
  // At least one field must carry a finite delta, and no field may carry a bad one.
  let any = false;
  for (const f of STANCE_FIELDS) {
    const d = P(cmd)[f];
    if (d === undefined) continue;
    if (typeof d !== 'number' || !Number.isFinite(d)) return 'invalid_payload';
    any = true;
  }
  if (!any) return 'invalid_payload';
  return null;
}

export function setRivalStanceApply(cmd: Command, ctx: ApplyCtx): boolean {
  const rivalId = stanceRivalId(cmd)!;                       // validated in precondition
  const ai = ctx.spirits.get(rivalId)?.ai;
  const pers = ai?.personality;
  if (!ai || !pers) return false;                            // lost a race after the pre-gate
  for (const f of STANCE_FIELDS) {
    const raw = P(cmd)[f];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    const delta = Math.max(-MAX_STANCE_DELTA, Math.min(MAX_STANCE_DELTA, raw));
    pers[f] = Math.round(Math.max(STANCE_MIN, Math.min(STANCE_MAX, pers[f] + delta)) * 100) / 100;
  }
  // Decisions derive strategy live from personality; refresh the stored label so
  // prompts/UI/snapshots stay truthful too.
  ai.policy = strategyForPersonality(pers);
  return true;
}
