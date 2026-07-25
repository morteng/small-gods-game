import type { EntityId, NpcNeeds } from '@/core/types';
import type { RivalPersonality } from '@/sim/rival-spirit';
// Type-only (erased at runtime): god-tier.ts imports `Spirit` back, so a value
// import either way would be a circular-eval hazard — same rule as the above.
import type { GodTier } from '@/sim/god-tier';

export type SpiritId = string;

export type Manifestation =
  | { kind: 'avatar';     entityId: EntityId }
  | { kind: 'possessing'; npcEntityId: EntityId };

export interface Spirit {
  id: SpiritId;
  name: string;
  sigil: string;
  color: string;
  isPlayer: boolean;
  power: number;
  manifestation: Manifestation | null;
  /**
   * Track 5 (T5.0) — the reality number. `SpiritSystem` recomputes these every
   * sim second from the belief sum it was already paying for; they are DERIVED
   * TRUTH persisted for legibility and hysteresis (the `LordState.garrison`
   * precedent), never an independent source of state.
   *
   * All optional: spirits ride the snapshot via wholesale `structuredClone`
   * (`snapshot.ts`), so these get the same free ride `ai` does, and a pre-T5.0
   * save simply loads without them and re-derives within one tick.
   */
  /** Σ faith·(1+2u)·(1+2d) over BOTH population tiers — how real the god is. */
  beliefMass?: number;
  /** Mass-weighted mean of understanding·devotion, [0,1]. NAMED TIER ONLY —
   *  `CohortBelief` has no Σ contribution·u·d and a mean-of-products is not a
   *  product-of-means (T5.3 adds the running sum when hollow major gods make it
   *  load-bearing). Low mass + high intimacy = a small god; the inverse = hollow. */
  intimacy?: number;
  /** Tier over `beliefMass`, hysteretic against its own previous value. */
  tier?: GodTier;
  /** First tick at/below `FADE_MASS`; cleared the moment mass recovers. */
  belowSinceTick?: number;
  /** Faded to "nothing but names" (VISION §5) — keeps `whisper`, loses the rest. */
  faded?: boolean;
  /**
   * AI/behavioural profile. Present on rival (non-player) spirits so the
   * RivalSystem can drive them; rides along in snapshots via structuredClone, so
   * rival decision-state is replay-safe with no snapshot.ts change. `policy` doubles
   * as the rival strategy. Absent ⇒ not an autonomously-acting spirit.
   */
  ai?: {
    policy: string;                  // RivalStrategy for rivals
    cooldowns: Record<string, number>;
    personality?: RivalPersonality;
    settlements?: string[];          // claimed POI ids
    lastActionTick?: number;
    actionCooldown?: number;
    /** Per-settlement follower counts at the last baseline refresh — the trend
     *  anchor `RivalSystem` diffs against to detect "losing ground". */
    followerBaseline?: Record<string, number>;
    baselineTick?: number;
    /** Need-domain affinity (Track 3 deferral, closed by M0 `prayerNeed`): the
     *  need(s) this rival specializes in answering. Assigned deterministically at
     *  creation (see `assignRivalDomains`, `src/sim/rival-spirit.ts`). Absent or
     *  empty ⇒ legacy/universal — the rival competes for every prayer subject
     *  exactly as before this field existed (old saves degrade here for free). */
    domains?: readonly (keyof NpcNeeds)[];
  };
}
