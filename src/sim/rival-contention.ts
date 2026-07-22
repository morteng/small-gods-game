/**
 * rival-contention.ts — the PERSISTENT escalation ladder that turns the live,
 * per-settlement follower balance into a state machine: two gods holding
 * near-even, populous congregations in the same town heat it from `calm` →
 * `tension` → `schism` → `holy_war`, and let it cool the same way. Fully
 * deterministic and `Math.random`-free (the guard test enforces the latter):
 * the ledger state is a pure function of the live census + logged disputes +
 * time, so it snapshots/scrubs uniformly and replays byte-identically.
 *
 * Three concerns, all pure:
 *
 *  1. `censusBelieversByPoi` — ONE pass over the living named congregation
 *     counting practising believers (faith ≥ `BELIEVER_THRESHOLD`) per
 *     (poi, spirit), then the SAME sorted cohort fold `buildRivalSituation` /
 *     rival-claims use (`cohortBelievers`) so the statistical tier weighs in
 *     identically. → `Map<poiId, Map<SpiritId, believers>>`.
 *
 *  2. `contentionIndex` — the live-numbers pressure scalar for one settlement:
 *     take the top-2 believer counts a ≥ b (id-sorted tie-break), `parity =
 *     a>0 ? b/a : 0`, `index = parity·(a+b)`. High ONLY when two gods are
 *     near-even (parity → 1) AND the congregation is large (a+b big) — a
 *     lopsided or thin settlement scores near 0.
 *
 *  3. `ContentionLedger` — the snapshot-authoritative store (serialize /
 *     hydrate / fromSnapshot, mirroring `RoadUseTally` / `CrossingTierStore`).
 *     `step` integrates `heat += index·GAIN − DECAY (+ DISPUTE_BUMP·disputes)`
 *     clamped `[0, HEAT_MAX]`, then applies HYSTERESIS thresholds
 *     (`*_ON` > `*_OFF`) moving `state` at most ONE rung per step. Belligerents
 *     are the id-sorted top-2 gods by live count. `claimMultiplier` returns
 *     `< 1` for a `holy_war` poi so neglected pleas there are claimed FASTER —
 *     escalation changes the belief economy, not just the UI.
 */
import type { World } from '@/world/world';
import type { Spirit, SpiritId } from '@/core/spirit';
import type { ContentionState } from '@/core/contention-types';
import type { SettlementCohorts } from '@/sim/cohorts';
import { forEachNpc, npcProps } from '@/world/npc-helpers';
import { BELIEVER_THRESHOLD } from '@/sim/believers';
import { cohortBelievers } from '@/sim/cohorts';

// ── tuning (conservative: escalation is rare-but-real) ───────────────────────
// Heat lives in an abstract `[0, HEAT_MAX]` band; `index` (parity·total) drives
// it up, a constant `DECAY` bleeds it down, disputes give a small bump. The
// thresholds are picked so a genuinely near-even, populous settlement climbs one
// rung per step over a handful of steps, and a collapsed rivalry eases back.

/** Ceiling on accumulated heat — bounds how long a resolved rivalry takes to cool. */
export const HEAT_MAX = 100;
/** Heat gained per unit of contention index per step. */
export const CONTENTION_GAIN = 0.8;
/** Constant heat bled off every step (the "peace returns on its own" term). */
export const CONTENTION_DECAY = 4;
/** Extra heat per logged `rival_dispute` folded into a step (friction is fuel). */
export const DISPUTE_BUMP = 5;

/** Hysteresis thresholds — each rung turns ON at a higher heat than it turns
 *  OFF, so a settlement hovering at the boundary never flickers rungs. */
export const TENSION_ON = 8;
export const TENSION_OFF = 4;
export const SCHISM_ON = 30;
export const SCHISM_OFF = 18;
export const WAR_ON = 60;
export const WAR_OFF = 40;

/** A `holy_war` poi's claim-window multiplier (< 1 ⇒ neglected pleas are
 *  claimable sooner). Mild by design — a war strips a contested town faster,
 *  but not instantly. */
export const HOLY_WAR_CLAIM_MULT = 0.75;

/** Ladder order — index = rung height; the hysteresis stepper walks it ±1. */
export const CONTENTION_LADDER: readonly ContentionState[] = ['calm', 'tension', 'schism', 'holy_war'];

/** Numeric rank of a ladder rung (calm=0 … holy_war=3). */
export function stateRank(s: ContentionState): number {
  return CONTENTION_LADDER.indexOf(s);
}

/** Per-rung ON/OFF gates, indexed by rung. Index 0 (calm) is the floor and has
 *  no gate. To REACH rung r (r≥1) heat must be ≥ `ON[r]`; to hold rung r heat
 *  must stay ≥ `OFF[r]`, else it drops toward r−1. */
const ON: readonly number[] = [0, TENSION_ON, SCHISM_ON, WAR_ON];
const OFF: readonly number[] = [0, TENSION_OFF, SCHISM_OFF, WAR_OFF];

/**
 * Apply the hysteresis ladder for one step: move AT MOST one rung. Climb when
 * heat clears the next rung's ON threshold; fall when heat drops below the
 * current rung's OFF threshold. Between a rung's OFF and the next rung's ON the
 * state is sticky (no flicker).
 */
export function nextContentionState(current: ContentionState, heat: number): ContentionState {
  const cur = stateRank(current);
  if (cur < CONTENTION_LADDER.length - 1 && heat >= ON[cur + 1]) return CONTENTION_LADDER[cur + 1];
  if (cur > 0 && heat < OFF[cur]) return CONTENTION_LADDER[cur - 1];
  return current;
}

// ── 1. census ────────────────────────────────────────────────────────────────

/** Believers per spirit for one settlement (id-sortable). */
export type PoiBelieverCounts = Map<SpiritId, number>;

/**
 * Count practising believers (faith ≥ `BELIEVER_THRESHOLD`) toward every live
 * spirit, per home POI, in ONE named pass — then fold in the statistical tier
 * with the SAME sorted `cohortBelievers` walk `buildRivalSituation` uses (so the
 * contention numbers and the rival-decider numbers can never disagree). Only
 * spirits present in `spirits` are counted (a belief toward a departed god is
 * never contention).
 */
export function censusBelieversByPoi(
  world: World,
  spirits: ReadonlyMap<SpiritId, Spirit>,
  cohorts?: ReadonlyMap<string, SettlementCohorts> | null,
): Map<string, PoiBelieverCounts> {
  const out = new Map<string, PoiBelieverCounts>();
  const bump = (poi: string, sid: SpiritId, n: number): void => {
    let m = out.get(poi);
    if (!m) out.set(poi, (m = new Map()));
    m.set(sid, (m.get(sid) ?? 0) + n);
  };
  forEachNpc(world, (e) => {
    const p = npcProps(e);
    const poi = p.homePoiId ?? '';
    for (const [sid, b] of Object.entries(p.beliefs)) {
      if (spirits.has(sid) && b.faith >= BELIEVER_THRESHOLD) bump(poi, sid, 1);
    }
  });
  if (cohorts) {
    const sids = [...spirits.keys()].sort();
    for (const poiId of [...cohorts.keys()].sort()) {
      const sc = cohorts.get(poiId)!;
      for (const sid of sids) {
        const n = cohortBelievers(sc, sid);
        if (n > 0) bump(poiId, sid, n);
      }
    }
  }
  return out;
}

// ── 2. contention index ──────────────────────────────────────────────────────

/** The top-2 believer counts in a settlement, `a ≥ b`, id-sorted tie-break, plus
 *  the two spirit ids (or null when fewer than two gods hold any believer). */
function topTwo(perSpirit: PoiBelieverCounts): { a: number; b: number; rivals: [SpiritId, SpiritId] | null } {
  const rows = [...perSpirit.entries()]
    .filter(([, n]) => n > 0)
    .sort((x, y) => (y[1] - x[1]) || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  if (rows.length === 0) return { a: 0, b: 0, rivals: null };
  if (rows.length === 1) return { a: rows[0][1], b: 0, rivals: null };
  return { a: rows[0][1], b: rows[1][1], rivals: [rows[0][0], rows[1][0]] };
}

/**
 * The live-numbers contention pressure for one settlement: `parity·(a+b)` over
 * the top-2 believer counts `a ≥ b`. High only when two gods are near-even AND
 * the congregation is large; 0 when one god (or none) is present.
 */
export function contentionIndex(perSpirit: PoiBelieverCounts): number {
  const { a, b } = topTwo(perSpirit);
  if (a <= 0) return 0;
  const parity = b / a;      // a>0 guaranteed; 0 when only one god present
  return parity * (a + b);
}

// ── 3. the ledger store ──────────────────────────────────────────────────────

export interface ContentionEntry {
  poiId: string;
  /** Accumulated heat `[0, HEAT_MAX]`. */
  heat: number;
  state: ContentionState;
  /** The two belligerent gods (id-sorted-by-count top-2), carried so the inbox
   *  can name the war even on a step where the census briefly lost one side. */
  rivals: [SpiritId, SpiritId];
  /** Tick the CURRENT `state` was entered (for future dwell-time reads). */
  enteredTick: number;
}

/** One state change `step` produced (the caller logs it as an event). */
export interface ContentionTransition {
  poiId: string;
  from: ContentionState;
  to: ContentionState;
  rivals: [SpiritId, SpiritId];
}

/** Plain structured-clone-friendly snapshot of the ledger. */
export interface ContentionLedgerSnapshot {
  entries: ContentionEntry[];
}

export class ContentionLedger {
  private entries = new Map<string, ContentionEntry>();

  /** All entries, sorted by poiId (deterministic iteration/serialization order). */
  all(): ContentionEntry[] {
    return [...this.entries.values()].sort((a, b) => (a.poiId < b.poiId ? -1 : a.poiId > b.poiId ? 1 : 0));
  }

  entry(poiId: string): ContentionEntry | undefined {
    return this.entries.get(poiId);
  }

  /** The escalation state of a settlement (`calm` when it has no entry). */
  stateOf(poiId: string): ContentionState {
    return this.entries.get(poiId)?.state ?? 'calm';
  }

  /** Claim-window multiplier for a poi: `< 1` under holy war (neglected pleas
   *  claimed faster), `1` otherwise. The mechanical teeth of escalation. */
  claimMultiplier(poiId: string): number {
    return this.entries.get(poiId)?.state === 'holy_war' ? HOLY_WAR_CLAIM_MULT : 1;
  }

  reset(): void {
    this.entries.clear();
  }

  /**
   * Integrate ONE step of the ladder over every settlement that either has a
   * believer census this step OR still carries a live entry (so an emptied town
   * still decays). Returns the state transitions (the system logs them). Pure,
   * deterministic, no rng.
   */
  step(
    census: ReadonlyMap<string, PoiBelieverCounts>,
    disputesByPoi: ReadonlyMap<string, number>,
    now: number,
  ): ContentionTransition[] {
    const transitions: ContentionTransition[] = [];
    // Union of censused + already-tracked poi ids, sorted for a replay-stable walk.
    const poiIds = [...new Set([...census.keys(), ...this.entries.keys()])].sort();
    for (const poiId of poiIds) {
      const perSpirit = census.get(poiId) ?? new Map<SpiritId, number>();
      const idx = contentionIndex(perSpirit);
      const disputes = disputesByPoi.get(poiId) ?? 0;
      const prev = this.entries.get(poiId);
      const prevHeat = prev?.heat ?? 0;
      const prevState = prev?.state ?? 'calm';
      const heat = Math.max(0, Math.min(HEAT_MAX,
        prevHeat + idx * CONTENTION_GAIN - CONTENTION_DECAY + disputes * DISPUTE_BUMP));
      // Belligerents: this step's id-sorted top-2, else keep the entry's memory,
      // else a self-pair (only reached at index≈0 where the state can't climb).
      const { rivals: liveRivals } = topTwo(perSpirit);
      const rivals: [SpiritId, SpiritId] = liveRivals ?? prev?.rivals ?? ['', ''];
      const state = nextContentionState(prevState, heat);
      if (state !== prevState) {
        transitions.push({ poiId, from: prevState, to: state, rivals });
      }
      // Prune fully-cooled settlements so the ledger stays sparse (like the road
      // tally): keep an entry only while it carries heat or is above calm.
      if (state === 'calm' && heat <= 0) {
        this.entries.delete(poiId);
      } else {
        this.entries.set(poiId, {
          poiId,
          heat,
          state,
          rivals,
          enteredTick: state !== prevState ? now : (prev?.enteredTick ?? now),
        });
      }
    }
    return transitions;
  }

  serialize(): ContentionLedgerSnapshot {
    // Deep-clone: the timeline ring must never alias live entries the stepper
    // keeps mutating (the RoadUseTally / RuntimePoiStore aliasing lesson).
    return structuredClone({ entries: this.all() });
  }

  hydrate(snap: ContentionLedgerSnapshot): void {
    this.entries.clear();
    for (const e of structuredClone(snap.entries ?? [])) this.entries.set(e.poiId, e);
  }

  static fromSnapshot(snap: ContentionLedgerSnapshot): ContentionLedger {
    const l = new ContentionLedger();
    l.hydrate(snap);
    return l;
  }
}
