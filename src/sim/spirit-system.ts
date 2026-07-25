import type { System, SystemContext } from '@/core/scheduler';
import type { SpiritId } from '@/core/spirit';
// Type-only (erased at runtime): cohorts.ts value-imports this module's power
// coefficients at eval time, so a value import back would be a circular-eval hazard.
import type { SettlementCohorts } from '@/sim/cohorts';
import { forEachNpc, npcProps } from '@/world/npc-helpers';
import { tierFor, stepFading } from '@/sim/god-tier';

export const POWER_REGEN_RATE = 0.02;
/** Understanding & devotion are multipliers on a believer's faith contribution.
 *  contribution = faith × (1 + U·understanding) × (1 + D·devotion). */
export const POWER_UNDERSTANDING_COEFF = 2;
export const POWER_DEVOTION_COEFF = 2;

export class SpiritSystem implements System {
  readonly name = 'spirits';
  readonly tickHz = 1;
  private depletedAlready = new Set<SpiritId>();

  /** P1 (two-tier population): when wired, each spirit's regen also collects the
   *  STATISTICAL tier's per-band `sumContribution` — maintained with this exact
   *  formula in `cohorts.ts`, so a settlement's fiction population feeds the
   *  economy identically to named souls. Absent getter ⇒ pre-P1 behavior. */
  constructor(
    private readonly getCohorts?: () => ReadonlyMap<string, SettlementCohorts> | null | undefined,
  ) {}

  tick(ctx: SystemContext): void {
    const totals = new Map<SpiritId, number>();
    // T5.0: Σ contribution·(u·d) alongside the mass, so `intimacy` is a
    // mass-weighted mean rather than a headcount mean — one deep believer
    // outweighs a crowd of shallow ones, which is the whole point of the axis.
    // NAMED TIER ONLY (see `Spirit.intimacy`): the statistical tier has no
    // Σ contribution·u·d to fold in, and mixing an exact sum with an
    // approximation silently would be worse than scoping this honestly.
    const intimacyNum = new Map<SpiritId, number>();
    const intimacyDen = new Map<SpiritId, number>();
    forEachNpc(ctx.world, (e) => {
      const p = npcProps(e);
      for (const [sid, b] of Object.entries(p.beliefs)) {
        const contribution =
          b.faith *
          (1 + POWER_UNDERSTANDING_COEFF * b.understanding) *
          (1 + POWER_DEVOTION_COEFF * b.devotion);
        totals.set(sid, (totals.get(sid) ?? 0) + contribution);
        intimacyNum.set(sid, (intimacyNum.get(sid) ?? 0) + contribution * b.understanding * b.devotion);
        intimacyDen.set(sid, (intimacyDen.get(sid) ?? 0) + contribution);
      }
    });

    // Statistical tier (P1): exact running sums, folded in sorted poiId /
    // spirit-id order so the float accumulation is replay-stable.
    const cohorts = this.getCohorts?.();
    if (cohorts) {
      for (const poiId of [...cohorts.keys()].sort()) {
        for (const band of cohorts.get(poiId)!.bands) {
          for (const sid of Object.keys(band.belief).sort()) {
            const c = band.belief[sid].sumContribution;
            if (c !== 0) totals.set(sid, (totals.get(sid) ?? 0) + c);
          }
        }
      }
    }

    for (const [sid, spirit] of ctx.spirits) {
      const total = totals.get(sid) ?? 0;
      spirit.power += total * POWER_REGEN_RATE;

      // ── T5.0: the reality number ──────────────────────────────────────────
      // The same total, kept instead of discarded. Tier is hysteretic against
      // its own previous value, so a god parked on an edge cannot flicker its
      // title every second — a god's name changing is a story beat.
      spirit.beliefMass = total;
      const den = intimacyDen.get(sid) ?? 0;
      spirit.intimacy = den > 0 ? (intimacyNum.get(sid) ?? 0) / den : 0;
      spirit.tier = tierFor(total, spirit.tier);

      // ── T5.1: the god lifecycle (VISION §5) ───────────────────────────────
      // Symmetric across player, rivals, and great gods alike. Sustained, not
      // instantaneous: two game days below the line, so one bad hour is survivable.
      const fade = stepFading(spirit, total, ctx.now);
      const wasFaded = spirit.faded === true;
      spirit.belowSinceTick = fade.belowSinceTick;
      spirit.faded = fade.faded;
      if (fade.transition === 'faded' && !wasFaded) {
        ctx.log.append({ type: 'god_faded', spiritId: sid });
      } else if (fade.transition === 'returned' && wasFaded) {
        ctx.log.append({ type: 'god_returned', spiritId: sid });
      }

      if (spirit.power <= 0) {
        if (!this.depletedAlready.has(sid)) {
          ctx.log.append({ type: 'power_depleted', spiritId: sid });
          this.depletedAlready.add(sid);
        }
      } else {
        this.depletedAlready.delete(sid);
      }
    }
  }
}
