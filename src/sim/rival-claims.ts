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
 * The claim rule (eligibility) is TERRITORIAL PRESENCE plus a DOMAIN WINDOW
 * (M0.b closed the "rivals can domain-match their claims" deferral): a rival may
 * only claim pleas in a settlement it holds (`ai.settlements`) and must be able
 * to afford the answer — presence + affordability is still the hard gate, never
 * relaxed by domain. On TOP of that, each rival carries an optional need-domain
 * affinity (`ai.domains`, assigned once at creation — see `assignRivalDomains`,
 * `src/sim/rival-spirit.ts`) scoring how it "specializes." A plea whose
 * `prayerNeed` (M0.b) matches one of the rival's domains is claimable at the
 * normal `PRAYER_CLAIM_WINDOW_TICKS`; a mismatched plea only becomes claimable to
 * that SAME rival after `DOMAIN_MISMATCH_WINDOW_MULT` × the window — neglect
 * eventually invites ANY present, funded rival, but a domain match gets there
 * first. Rivals with no `domains` (legacy saves, or a rival never given one) and
 * pleas with no `prayerNeed` (legacy worship / scripted) both read as "matches
 * everyone" — the universal fallback from before this feature never regresses.
 */
import type { World } from '@/world/world';
import type { Spirit, SpiritId } from '@/core/spirit';
import type { Entity, NpcNeeds, NpcProperties, SpiritBelief } from '@/core/types';
import type { Rng } from '@/core/rng';
import { forEachNpc, npcProps } from '@/world/npc-helpers';
import { BELIEVER_THRESHOLD, PLAYER_SPIRIT_ID } from '@/sim/believers';
import { cohortBelievers, type SettlementCohorts } from '@/sim/cohorts';
import { ANSWER_PRAYER_COST } from '@/sim/divine-actions';
import { TICKS_PER_DAY } from '@/core/calendar';

/** A plea unanswered for this long becomes claimable by a rival — HALF A DAY
 *  (~12 hours, and under 1:1 realtime that IS ~12 real hours): long enough
 *  that an attentive god answering within a few hours keeps the follower,
 *  short enough that neglect has real teeth. The half-day fiction intent is
 *  unchanged from the compressed-clock era (it was 120 of the old 240-tick
 *  day); only the tick denomination moved. */
export const PRAYER_CLAIM_WINDOW_TICKS = TICKS_PER_DAY / 2;

/** A plea outside a rival's need-domain still becomes claimable to it — just
 *  later: `DOMAIN_MISMATCH_WINDOW_MULT × PRAYER_CLAIM_WINDOW_TICKS` (a full
 *  fiction-day of neglect) instead of the normal half-day. Keeps the universal
 *  fallback (no plea rots forever) while a domain-matched rival gets there
 *  first. Expressed as a multiplier of the tick constant, never a raw literal. */
export const DOMAIN_MISMATCH_WINDOW_MULT = 2;

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
  /** D4 — the player's plus every OTHER non-player spirit's practising believers,
   *  summed per home POI: the TRUE opposition field (not player-only). Built in
   *  the same NPC pass as `playerFollowersInSettlement`/`rivalFollowersInSettlement`
   *  and folds the P1 statistical cohort tier too. */
  opposingFollowersInSettlement: Record<string, number>;
  /** D4 — every other non-player spirit (≠ self) carrying an `ai.personality`
   *  (the same "is this a real rival" predicate `RivalSystem` uses to enumerate
   *  actors), in deterministic id-sorted order. `followerTotal` sums
   *  `followersInSettlement`, both counting the named tier AND the P1
   *  statistical cohort tier (see `buildRivalSituation`). */
  otherRivals: {
    id: SpiritId;
    power: number;
    followerTotal: number;
    followersInSettlement: Record<string, number>;
  }[];
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
  /** P1 (two-tier population): the STATISTICAL tier. When present, per-settlement
   *  follower counts include each settlement's aggregate believers — the rival
   *  decider sees the true balance of souls, named or not. Statistical PLEAS
   *  (and rival claims against them) are P2; in P1 the statistical tier only
   *  weighs the follower counts. */
  cohorts?: ReadonlyMap<string, SettlementCohorts> | null;
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
  const opposingFollowersInSettlement: Record<string, number> = {};
  const npcBeliefs = new Map<string, SpiritBelief>();

  // D4 — every OTHER non-player spirit with a behavioural profile: the same
  // "is this a real rival" predicate `RivalSystem` uses to enumerate actors
  // (`spirit.isPlayer || !spirit.ai?.personality` ⇒ skip). Computed ONCE, not
  // per-NPC — the roster is a handful of rivals, so checking each NPC's belief
  // record against it keeps this a single sweep, not an extra world scan.
  const otherRivalIds = [...spirits.keys()]
    .filter(id => id !== rivalId)
    .filter(id => { const s = spirits.get(id); return !!s && !s.isPlayer && !!s.ai?.personality; })
    .sort();
  const otherFollowers = new Map<SpiritId, Record<string, number>>(otherRivalIds.map(id => [id, {}]));

  forEachNpc(world, (e) => {
    const p = npcProps(e);
    const poi = p.homePoiId ?? '';
    const pb = p.beliefs[playerId];
    if (pb && pb.faith >= BELIEVER_THRESHOLD) {
      playerFollowersInSettlement[poi] = (playerFollowersInSettlement[poi] ?? 0) + 1;
      opposingFollowersInSettlement[poi] = (opposingFollowersInSettlement[poi] ?? 0) + 1;
    }
    const rb = p.beliefs[rivalId];
    if (rb) {
      npcBeliefs.set(e.id, rb);
      if (rb.faith >= BELIEVER_THRESHOLD) {
        rivalFollowersInSettlement[poi] = (rivalFollowersInSettlement[poi] ?? 0) + 1;
      }
    }
    for (const otherId of otherRivalIds) {
      const ob = p.beliefs[otherId];
      if (ob && ob.faith >= BELIEVER_THRESHOLD) {
        opposingFollowersInSettlement[poi] = (opposingFollowersInSettlement[poi] ?? 0) + 1;
        const rec = otherFollowers.get(otherId)!;
        rec[poi] = (rec[poi] ?? 0) + 1;
      }
    }
    if (p.prayerSince !== undefined && prayerAge(p, now) >= PRAYER_CLAIM_WARNING_TICKS) {
      prayerPressureInSettlement[poi] = (prayerPressureInSettlement[poi] ?? 0) + 1;
    }
  });
  // Statistical tier (P1): each settlement's aggregate believers join the same
  // per-POI counts the named pass built (sorted fold — replay-stable).
  // `cohortBelievers` is an O(bands) — i.e. effectively O(1) — lookup per
  // (POI, spirit), so folding it in for every other-rival id too costs exactly
  // as much as the existing player/self fold-in: the D4 fields are NOT
  // NPC-tier-only, the cohort fold-in generalizes cleanly.
  if (opts.cohorts) {
    for (const poiId of [...opts.cohorts.keys()].sort()) {
      const sc = opts.cohorts.get(poiId)!;
      const pn = cohortBelievers(sc, playerId);
      if (pn > 0) {
        playerFollowersInSettlement[poiId] = (playerFollowersInSettlement[poiId] ?? 0) + pn;
        opposingFollowersInSettlement[poiId] = (opposingFollowersInSettlement[poiId] ?? 0) + pn;
      }
      const rn = cohortBelievers(sc, rivalId);
      if (rn > 0) rivalFollowersInSettlement[poiId] = (rivalFollowersInSettlement[poiId] ?? 0) + rn;
      for (const otherId of otherRivalIds) {
        const on = cohortBelievers(sc, otherId);
        if (on > 0) {
          opposingFollowersInSettlement[poiId] = (opposingFollowersInSettlement[poiId] ?? 0) + on;
          const rec = otherFollowers.get(otherId)!;
          rec[poiId] = (rec[poiId] ?? 0) + on;
        }
      }
    }
  }
  const rivalFollowerDelta: Record<string, number> = {};
  const baseline = opts.baseline;
  if (baseline) {   // no baseline ⇒ no trend information, NOT "everything is growth"
    for (const k of new Set([...Object.keys(rivalFollowersInSettlement), ...Object.keys(baseline)])) {
      const d = (rivalFollowersInSettlement[k] ?? 0) - (baseline[k] ?? 0);
      if (d !== 0) rivalFollowerDelta[k] = d;
    }
  }
  const otherRivals = otherRivalIds.map(id => {
    const followersInSettlement = otherFollowers.get(id)!;
    const followerTotal = Object.values(followersInSettlement).reduce((a, b) => a + b, 0);
    return { id, power: spirits.get(id)?.power ?? 0, followerTotal, followersInSettlement };
  });
  return {
    playerPower: spirits.get(playerId)?.power ?? 0,
    playerFollowersInSettlement,
    rivalFollowersInSettlement,
    rivalFollowerDelta,
    prayerPressureInSettlement,
    opposingFollowersInSettlement,
    otherRivals,
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
      delete p.prayerNeed;  // the plea's SUBJECT (M0.b) lifts with the plea
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
 *  to afford the answer. Returned in a deterministic (id-sorted) order. This is
 *  the PRESENCE gate only — domain affinity never widens or narrows it, it only
 *  changes WHEN (see `claimWindowTicksFor`) a present, funded rival may act. */
export function eligibleClaimants(npc: Entity, spirits: Map<SpiritId, Spirit>): SpiritId[] {
  const poi = npcProps(npc).homePoiId;
  const out: SpiritId[] = [];
  for (const s of spirits.values()) {
    if (isRivalPresent(s, poi) && s.power >= ANSWER_PRAYER_COST) out.push(s.id);
  }
  out.sort();
  return out;
}

/** Does `spirit`'s need-domain affinity cover `need`? A rival with no `domains`
 *  (legacy save, or never assigned one) is universal — matches everything, same
 *  as before this field existed. A plea with no `prayerNeed` (legacy worship /
 *  scripted, `undefined`) likewise matches every rival — it has no subject to
 *  mismatch against. */
export function domainMatches(spirit: Spirit, need: keyof NpcNeeds | undefined): boolean {
  if (need === undefined) return true;
  const domains = spirit.ai?.domains;
  if (!domains || domains.length === 0) return true;
  return domains.includes(need);
}

/** How long a plea with subject `need` must stand before `spirit` may claim it:
 *  the normal window on a domain match (or no domain/no subject to check), else
 *  `DOMAIN_MISMATCH_WINDOW_MULT ×` that — a rival still gets to every neglected
 *  soul eventually, just later outside its specialty. */
export function claimWindowTicksFor(spirit: Spirit, need: keyof NpcNeeds | undefined): number {
  return domainMatches(spirit, need)
    ? PRAYER_CLAIM_WINDOW_TICKS
    : PRAYER_CLAIM_WINDOW_TICKS * DOMAIN_MISMATCH_WINDOW_MULT;
}

export interface PrayerClaim {
  npcId: string;
  rivalId: SpiritId;
  poiId?: string;
}

/**
 * Every claimable plea this tick, each assigned to exactly one eligible rival.
 * A plea is claimable once its age clears its per-rival domain window (the base
 * `PRAYER_CLAIM_WINDOW_TICKS` on a domain match, `DOMAIN_MISMATCH_WINDOW_MULT×`
 * that otherwise — see `claimWindowTicksFor`). Among the rivals actually
 * eligible THIS tick, a domain match is always preferred over a mismatch that
 * only cleared its longer window; ties within that preferred set are broken
 * with `ctx.rng` (deterministic / replay-safe), and a single candidate is chosen
 * without touching the RNG so the common case never perturbs the shared stream.
 *
 * A rival may be assigned several claims in one tick even if it can only afford
 * one — the surplus commands are safely rejected (`insufficient_power`) at
 * execution, so there is no double-spend and no need to pre-reserve power here.
 * Domain-matched claims sort BEFORE mismatched ones in the returned/emitted
 * order, so when a rival's power can only cover one of its assigned claims this
 * tick, the specialty plea is the one that actually lands.
 */
export function findClaimablePrayers(
  world: World,
  spirits: Map<SpiritId, Spirit>,
  now: number,
  rng: Rng,
  /** Rival economics: per-poi claim-window multiplier (< 1 compresses the window
   *  — a `holy_war` settlement lets neglected pleas be claimed FASTER). Default
   *  `1` everywhere, so the pre-contention behaviour is byte-identical. */
  contentionMult: (poiId: string) => number = () => 1,
): PrayerClaim[] {
  const claims: (PrayerClaim & { matched: boolean })[] = [];
  forEachNpc(world, (e) => {
    const p = npcProps(e);
    if (p.activity !== 'worship') return;
    const age = prayerAge(p, now);
    const mult = contentionMult(p.homePoiId ?? '');
    if (age < PRAYER_CLAIM_WINDOW_TICKS * mult) return;   // base window (contention-scaled): nobody clears sooner
    const need = p.prayerNeed;
    const candidates = eligibleClaimants(e, spirits)
      .filter(id => age >= claimWindowTicksFor(spirits.get(id)!, need) * mult);
    if (candidates.length === 0) return;
    const matching = candidates.filter(id => domainMatches(spirits.get(id)!, need));
    const pool = matching.length > 0 ? matching : candidates;
    const rivalId = pool.length === 1 ? pool[0] : pool[rng.nextInt(pool.length)];
    claims.push({ npcId: e.id, rivalId, poiId: p.homePoiId, matched: matching.includes(rivalId) });
  });
  claims.sort((a, b) => {
    if (a.matched !== b.matched) return a.matched ? -1 : 1;
    return a.npcId < b.npcId ? -1 : a.npcId > b.npcId ? 1 : 0;
  });
  return claims.map(({ matched: _matched, ...c }) => c);
}
