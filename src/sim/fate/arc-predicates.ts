/**
 * arc-predicates.ts — the predicate registry for arc goals (Track 4, F1/F3).
 *
 * A predicate is a PURE function of GameState (no rng, no Math.random — this lives
 * under src/sim/ and the no-random guard covers it). Goals name a predicate as a
 * string so they round-trip through the snapshot; `recomputeGoals` evaluates them
 * each pulse and on restore. F3 grows the registry to cover the arc library's
 * `seedWhen` gates and goals — every predicate a shape names MUST exist here
 * (guard: tests/unit/fate-arc-guards.test.ts, the sim-currency discipline).
 *
 * Every predicate tolerates PARTIAL state (test harnesses build minimal
 * GameStates) — a missing world/spirits/worldSeed evaluates to an honest `false`.
 */
import type { GameState } from '@/core/state';
import type { ActiveEvent, NpcRole } from '@/core/types';
import { PLAYER_SPIRIT_ID, BELIEVER_THRESHOLD } from '@/sim/believers';
import { queryNpcs, npcProps } from '@/world/npc-helpers';

export type ArcPredicate = (state: GameState, args?: Record<string, string | number>) => boolean;

/** Roles that read as a settlement's standing power — the arc library's "strongman". */
const PROMINENT_ROLES: readonly NpcRole[] = ['elder', 'noble', 'priest'];

/** Settlement events that read as a crisis (a vacuum, a feeding frenzy). */
const CRISIS_EVENTS: ReadonlySet<string> = new Set(['drought', 'plague', 'raiders', 'dispute']);
/** Settlement events that read as prosperity (the high-water mark before the fall). */
const THRIVING_EVENTS: ReadonlySet<string> = new Set(['festival', 'harvest_blessing', 'trading_caravan']);

/** A devout follower: behavioral commitment, not just faith (see SpiritBelief). */
const DEVOUT_DEVOTION = 0.5;

function anyActiveEvent(state: GameState, types: ReadonlySet<string>): boolean {
  const events = state.world?.activeEvents;
  if (!events) return false;
  for (const list of events.values()) {
    if (list.some((ev: ActiveEvent) => types.has(ev.type))) return true;
  }
  return false;
}

export const ARC_PREDICATES: Record<string, ArcPredicate> = {
  /** Always true — the dullest goal; useful as a stub / smoke predicate. */
  always: () => true,
  /** Always false. */
  never: () => false,
  /** True once the world has at least one settlement (POI). Derivable from worldSeed. */
  has_settlements: (state) => (state.worldSeed?.pois?.length ?? 0) > 0,
  /** ≥2 settlements — there is an "abroad" for exiles and dying strongmen. */
  has_multiple_settlements: (state) => (state.worldSeed?.pois?.length ?? 0) >= 2,
  /** At least one rival spirit contests the world. */
  has_rival: (state) => {
    if (!state.spirits) return false;
    for (const s of state.spirits.values()) if (!s.isPlayer) return true;
    return false;
  },
  /** The player cult has at least one practicing believer (named tier). */
  player_has_believers: (state) => {
    if (!state.world) return false;
    return queryNpcs(state.world).some((e) => {
      const b = npcProps(e).beliefs?.[PLAYER_SPIRIT_ID];
      return !!b && b.faith >= BELIEVER_THRESHOLD;
    });
  },
  /** A standing power lives: an elder, noble, or priest walks the world. */
  has_prominent_mortal: (state) => {
    if (!state.world) return false;
    return queryNpcs(state.world).some((e) => PROMINENT_ROLES.includes(npcProps(e).role));
  },
  /** Someone is DEVOUT toward the player — commitment deep enough to make (or unmake) kings. */
  has_devout_follower: (state) => {
    if (!state.world) return false;
    return queryNpcs(state.world).some((e) => {
      const b = npcProps(e).beliefs?.[PLAYER_SPIRIT_ID];
      return !!b && b.devotion >= DEVOUT_DEVOTION;
    });
  },
  /** Some settlement is in crisis (drought/plague/raiders/dispute active). */
  settlement_in_crisis: (state) => anyActiveEvent(state, CRISIS_EVENTS),
  /** Some settlement is riding high (festival/harvest/caravan active). */
  settlement_thriving: (state) => anyActiveEvent(state, THRIVING_EVENTS),
};

/** Evaluate a named predicate. An UNKNOWN predicate is honestly `false` (never throws). */
export function evalArcPredicate(
  name: string,
  state: GameState,
  args?: Record<string, string | number>,
): boolean {
  const fn = ARC_PREDICATES[name];
  return fn ? fn(state, args) : false;
}
