import type { System, SystemContext } from '@/core/scheduler';
import type { SpiritId } from '@/core/spirit';
import { forEachNpc, npcProps } from '@/world/npc-helpers';

export const POWER_REGEN_RATE = 0.02;
/** Understanding & devotion are multipliers on a believer's faith contribution.
 *  contribution = faith × (1 + U·understanding) × (1 + D·devotion). */
export const POWER_UNDERSTANDING_COEFF = 2;
export const POWER_DEVOTION_COEFF = 2;

export class SpiritSystem implements System {
  readonly name = 'spirits';
  readonly tickHz = 1;
  private depletedAlready = new Set<SpiritId>();

  tick(ctx: SystemContext): void {
    const totals = new Map<SpiritId, number>();
    forEachNpc(ctx.world, (e) => {
      const p = npcProps(e);
      for (const [sid, b] of Object.entries(p.beliefs)) {
        const contribution =
          b.faith *
          (1 + POWER_UNDERSTANDING_COEFF * b.understanding) *
          (1 + POWER_DEVOTION_COEFF * b.devotion);
        totals.set(sid, (totals.get(sid) ?? 0) + contribution);
      }
    });

    for (const [sid, spirit] of ctx.spirits) {
      const total = totals.get(sid) ?? 0;
      spirit.power += total * POWER_REGEN_RATE;

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
