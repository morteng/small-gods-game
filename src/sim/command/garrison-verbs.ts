/**
 * garrison-verbs.ts — `muster_garrison` / `stand_down_garrison` (Manning the Walls W3, mortal
 * power).
 *
 * TIER RESOLUTION: exactly the `found_castle` reasoning (`castle-verbs.ts`) — a lord musters his
 * own watch. MORTAL power made concrete (VISION tenet 9: "mortals act first; the god is the
 * margin"); a god does not buy soldiers with belief-power. AUTHORING tier, so it never appears on
 * the player's divine affordance surfaces (`affordancesForTarget` is `tier === 'divine'` only).
 *
 * Effect: a THIN call onto `state.garrisonOrders` (`GarrisonOrders`, `@/sim/garrison`) — the
 * command-reachable half of `GarrisonSystem` (W1). A command receives `ctx.state`/`ctx.world`,
 * never a live system instance, so the standing-order bit a verb can actually move lives on
 * `GameState`, not inside the system. `GarrisonSystem.tick` reads the order back out on its next
 * (0.5 Hz) tick and does the actual mustering/posting AND logs the observable
 * `garrison_mustered`/`garrison_stood_down` edge event — this verb only records the order, so a
 * repeated call sees `precondition_failed` and never double-emits.
 *
 * Preconditions reuse the SAME ring/roster lookups `GarrisonSystem` musters from
 * (`garrisonableRingFor`/`residentSoldiers`, `@/sim/garrison`) — one derivation, never two that
 * can drift apart, so a preview can never promise a muster the apply then can't deliver.
 */
import type { Command, ApplyCtx, CommandCtx, RejectionReason } from './types';
import { garrisonableRingFor, residentSoldiers } from '@/sim/garrison';

function poiOf(cmd: Command): string | undefined {
  return cmd.target.kind === 'settlement' ? cmd.target.poiId : undefined;
}

/** Target validity shared by both verbs: a garrisonable wall ring AND at least one resident
 *  soldier to post on it. Neither verb can mean anything without both. */
function invalidTarget(poiId: string, ctx: CommandCtx): boolean {
  const ring = garrisonableRingFor(ctx.world.tiles, poiId);
  if (!ring) return true;                                     // no wall to man
  return residentSoldiers(ctx.world, poiId).length === 0;      // no one to post
}

export function musterGarrisonPrecondition(cmd: Command, ctx: CommandCtx): RejectionReason | null {
  const poiId = poiOf(cmd);
  if (!poiId) return 'invalid_target';
  if (invalidTarget(poiId, ctx)) return 'invalid_target';
  // State-dependent gate — preview callers without `ctx.state` skip it; the apply re-checks and
  // declines cleanly (same pattern as `found_castle`'s one-castle-per-seat gate).
  if (ctx.state?.garrisonOrders.hasStandingOrder(poiId)) return 'precondition_failed';   // already mustered
  return null;
}

export function musterGarrisonApply(cmd: Command, ctx: ApplyCtx): boolean {
  const state = ctx.state;
  if (!state) return false;                                   // executor always injects it
  const poiId = poiOf(cmd)!;                                  // validated in precondition
  if (invalidTarget(poiId, ctx)) return false;                // lapsed after the pre-gate
  if (state.garrisonOrders.hasStandingOrder(poiId)) return false;   // already mustered
  state.garrisonOrders.setStandingOrder(poiId, true);
  return true;
}

export function standDownGarrisonPrecondition(cmd: Command, ctx: CommandCtx): RejectionReason | null {
  const poiId = poiOf(cmd);
  if (!poiId) return 'invalid_target';
  if (invalidTarget(poiId, ctx)) return 'invalid_target';
  if (ctx.state && !ctx.state.garrisonOrders.hasStandingOrder(poiId)) return 'precondition_failed'; // already stood down
  return null;
}

export function standDownGarrisonApply(cmd: Command, ctx: ApplyCtx): boolean {
  const state = ctx.state;
  if (!state) return false;
  const poiId = poiOf(cmd)!;
  if (invalidTarget(poiId, ctx)) return false;
  if (!state.garrisonOrders.hasStandingOrder(poiId)) return false;   // already stood down
  state.garrisonOrders.setStandingOrder(poiId, false);
  return true;
}
