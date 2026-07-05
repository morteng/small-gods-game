/**
 * Rival claims — the Track-3 headline: "claim the prayers you don't answer."
 *
 * Two pure, deterministic concerns, both `Math.random`-free (the guard test
 * enforces this) and both feeding the live `RivalSystem` (0.5 Hz):
 *
 *  1. **Real situation data** for the rival decider — follower counts per
 *     settlement for the player + a rival, and the rival's per-NPC belief map.
 *     `decideRivalAction` used to receive an EMPTY situation; now it sees the
 *     world. Cheap: one pass over the living NPCs per rival.
 *
 *  2. **The unanswered-prayer claim ledger + state machine.** A prayer is just an
 *     NPC in `activity === 'worship'` (there is no discrete prayer object). We
 *     stamp `prayerSince` on the NPC the first tick we observe the plea and clear
 *     it the moment the plea lifts, so `now - prayerSince` is the prayer's age.
 *     Once a plea has gone unanswered for `PRAYER_CLAIM_WINDOW_TICKS`, an eligible
 *     rival may answer it — through the SAME command queue the player and rivals
 *     already use (`answer_prayer`), so belief shifts toward the rival via the
 *     existing `answerPrayer` loop with no new write path.
 *
 * The claim rule (eligibility) is deliberately simple and defensible: since
 * rivals carry no domain vector today and answering a plea is the *universal*
 * divine competency (the player's `answer_prayer` is itself un-domain-gated), the
 * "compatible domain" test collapses to TERRITORIAL PRESENCE — a rival may only
 * claim pleas in a settlement it holds (`ai.settlements`) and must be able to
 * afford the answer. Prayers in settlements no rival holds are never poachable.
 */
import type { World } from '@/world/world';
import type { Spirit, SpiritId } from '@/core/spirit';
import type { Entity, NpcProperties, SpiritBelief } from '@/core/types';
import type { Rng } from '@/core/rng';
import { forEachNpc, npcProps } from '@/world/npc-helpers';
import { BELIEVER_THRESHOLD, PLAYER_SPIRIT_ID } from '@/sim/believers';
import { ANSWER_PRAYER_COST } from '@/sim/divine-actions';
import { TICKS_PER_DAY } from '@/core/calendar';

/** A plea unanswered for this long becomes claimable by a rival — HALF A DAY
 *  (~12 hours, and under 1:1 realtime that IS ~12 real hours): long enough
 *  that an attentive god answering within a few hours keeps the follower,
 *  short enough that neglect has real teeth. The half-day fiction intent is
 *  unchanged from the compressed-clock era (it was 120 of the old 240-tick
 *  day); only the tick denomination moved. */
export const PRAYER_CLAIM_WINDOW_TICKS = TICKS_PER_DAY / 2;

/** A plea older than this (0.6 × the window) is "contested" — surfaced to the
 *  player as a threat while there is still time to answer before the loss. */
export const PRAYER_CLAIM_WARNING_TICKS = PRAYER_CLAIM_WINDOW_TICKS * 0.6;

/** How long a successful rival claim lingers in the divine inbox as a "you were
 *  beaten to it" notice — one day. */
export const CLAIM_NOTICE_HORIZON_TICKS = TICKS_PER_DAY;

// ── 1. situation data ────────────────────────────────────────────────────────

export interface RivalSituation {
  playerPower: number;
  /** Practising believers (faith ≥ believer line) toward the player, per home POI. */
  playerFollowersInSettlement: Record<string, number>;
  /** Practising believers toward THIS rival, per home POI. */
  rivalFollowersInSettlement: Record<string, number>;
  /** Change in the rival's per-settlement follower counts vs the caller-supplied
   *  baseline (one cooldown window ago). Negative = losing ground there. Only
   *  non-zero entries are recorded; empty when no baseline was supplied. */
  rivalFollowerDelta: Record<string, number>;
  /** Standing pleas old enough to be at risk (age ≥ PRAYER_CLAIM_WARNING_TICKS),
   *  per home POI — the "unanswered-prayer pressure" opportunists read. */
  prayerPressureInSettlement: Record<string, number>;
  /** The rival's own belief record for every NPC that holds one — what the rival
   *  "knows" about each soul it has any purchase on. */
  npcBeliefs: Map<string, SpiritBelief>;
}

export interface RivalSituationOptions {
  /** Current sim tick — needed to age standing pleas. Omitted ⇒ pressure reads 0. */
  now?: number;
  /** The rival's per-settlement follower counts as of the last baseline refresh
   *  (see `RivalSystem`); omitted ⇒ all deltas read 0. */
  baseline?: Record<string, number>;
  playerId?: SpiritId;
}

/** Build the decider's situation from the world in ONE pass (only for rivals off
 *  cooldown — no per-frame work). Everything is a plain count/record so it
 *  snapshots trivially and the decider stays deterministic. */
export function buildRivalSituation(
  world: World,
  spirits: Map<SpiritId, Spirit>,
  rivalId: SpiritId,
  opts: RivalSituationOptions = {},
): RivalSituation {
  const playerId = opts.playerId ?? PLAYER_SPIRIT_ID;
  const now = opts.now ?? 0;
  const playerFollowersInSettlement: Record<string, number> = {};
  const rivalFollowersInSettlement: Record<string, number> = {};
  const prayerPressureInSettlement: Record<string, number> = {};
  const npcBeliefs = new Map<string, SpiritBelief>();
  forEachNpc(world, (e) => {
    const p = npcProps(e);
    const poi = p.homePoiId ?? '';
    const pb = p.beliefs[playerId];
    if (pb && pb.faith >= BELIEVER_THRESHOLD) {
      playerFollowersInSettlement[poi] = (playerFollowersInSettlement[poi] ?? 0) + 1;
    }
    const rb = p.beliefs[rivalId];
    if (rb) {
      npcBeliefs.set(e.id, rb);
      if (rb.faith >= BELIEVER_THRESHOLD) {
        rivalFollowersInSettlement[poi] = (rivalFollowersInSettlement[poi] ?? 0) + 1;
      }
    }
    if (p.prayerSince !== undefined && prayerAge(p, now) >= PRAYER_CLAIM_WARNING_TICKS) {
      prayerPressureInSettlement[poi] = (prayerPressureInSettlement[poi] ?? 0) + 1;
    }
  });
  const rivalFollowerDelta: Record<string, number> = {};
  const baseline = opts.baseline;
  if (baseline) {   // no baseline ⇒ no trend information, NOT "everything is growth"
    for (const k of new Set([...Object.keys(rivalFollowersInSettlement), ...Object.keys(baseline)])) {
      const d = (rivalFollowersInSettlement[k] ?? 0) - (baseline[k] ?? 0);
      if (d !== 0) rivalFollowerDelta[k] = d;
    }
  }
  return {
    playerPower: spirits.get(playerId)?.power ?? 0,
    playerFollowersInSettlement,
    rivalFollowersInSettlement,
    rivalFollowerDelta,
    prayerPressureInSettlement,
    npcBeliefs,
  };
}

// ── 2. claim-window state machine ────────────────────────────────────────────

/** Maintain `prayerSince` across the living congregation: stamp it the first tick
 *  a plea is observed, clear it the moment the plea lifts. Deterministic and
 *  snapshot-safe (the field rides `NpcProperties` via structuredClone). Call once
 *  per decision tick, BEFORE reading prayer ages. */
export function updatePrayerLedger(world: World, now: number): void {
  forEachNpc(world, (e) => {
    const p = npcProps(e);
    if (p.activity === 'worship') {
      if (p.prayerSince === undefined) p.prayerSince = now;
    } else if (p.prayerSince !== undefined) {
      delete p.prayerSince;
    }
  });
}

/** Age (in ticks) of an NPC's current plea, or 0 if it has no standing plea. */
export function prayerAge(p: NpcProperties, now: number): number {
  return p.prayerSince === undefined ? 0 : Math.max(0, now - p.prayerSince);
}

/** Is `spirit` a rival that holds the given settlement? (presence / "compatible
 *  domain" — see the module header for why this collapses to territory). */
export function isRivalPresent(spirit: Spirit, poiId: string | undefined): boolean {
  return !spirit.isPlayer
    && !!spirit.ai?.personality
    && !!poiId
    && (spirit.ai.settlements ?? []).includes(poiId);
}

/** Rivals eligible to claim a given worshipper: present in its settlement AND able
 *  to afford the answer. Returned in a deterministic (id-sorted) order. */
export function eligibleClaimants(npc: Entity, spirits: Map<SpiritId, Spirit>): SpiritId[] {
  const poi = npcProps(npc).homePoiId;
  const out: SpiritId[] = [];
  for (const s of spirits.values()) {
    if (isRivalPresent(s, poi) && s.power >= ANSWER_PRAYER_COST) out.push(s.id);
  }
  out.sort();
  return out;
}

export interface PrayerClaim {
  npcId: string;
  rivalId: SpiritId;
  poiId?: string;
}

/**
 * Every claimable plea this tick, each assigned to exactly one eligible rival.
 * A plea is claimable once its age clears `PRAYER_CLAIM_WINDOW_TICKS`. When more
 * than one rival is eligible, the claimant is chosen with `ctx.rng` (deterministic
 * / replay-safe); a single eligible rival is chosen without touching the RNG so
 * the common case never perturbs the shared stream.
 *
 * A rival may be assigned several claims in one tick even if it can only afford
 * one — the surplus commands are safely rejected (`insufficient_power`) at
 * execution, so there is no double-spend and no need to pre-reserve power here.
 */
export function findClaimablePrayers(
  world: World,
  spirits: Map<SpiritId, Spirit>,
  now: number,
  rng: Rng,
): PrayerClaim[] {
  const claims: PrayerClaim[] = [];
  forEachNpc(world, (e) => {
    const p = npcProps(e);
    if (p.activity !== 'worship') return;
    if (prayerAge(p, now) < PRAYER_CLAIM_WINDOW_TICKS) return;
    const eligible = eligibleClaimants(e, spirits);
    if (eligible.length === 0) return;
    const rivalId = eligible.length === 1 ? eligible[0] : eligible[rng.nextInt(eligible.length)];
    claims.push({ npcId: e.id, rivalId, poiId: p.homePoiId });
  });
  claims.sort((a, b) => (a.npcId < b.npcId ? -1 : a.npcId > b.npcId ? 1 : 0));
  return claims;
}
