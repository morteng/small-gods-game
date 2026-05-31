import type { System, SystemContext } from '@/core/scheduler';
import type { Entity } from '@/core/types';
import { forEachNpc, npcProps } from '@/world/npc-helpers';
import { PLAYER_SPIRIT_ID } from '@/sim/believers';

const BELIEVER_THRESHOLD = 0.15; // faith at/above this once → counts as "was a believer"
const ABANDON_FLOOR = 0.02;      // faith at/below this → lapsing
const GRACE_TICKS = 10;          // consecutive lapsed ticks before departure

/** Removes ex-believers whose faith in the player has collapsed to ~0. They stop
 *  believing and leave the world; their belief no longer feeds the god's power.
 *
 *  Only NPCs who *were* believers (faith ever ≥ BELIEVER_THRESHOLD) are eligible.
 *  Lifelong non-believers never "abandon." The `wasBeliever` flag is set on entity
 *  properties either at add-time (world.addEntity) or here when faith first crosses
 *  the threshold during the simulation. */
export class AbandonmentSystem implements System {
  readonly name = 'abandonment';
  readonly tickHz = 1;
  private lapsed = new Map<string, number>();

  tick(ctx: SystemContext): void {
    const toRemove: Entity[] = [];

    forEachNpc(ctx.world, (e) => {
      const p = npcProps(e);
      const b = p.beliefs[PLAYER_SPIRIT_ID];
      const faith = b?.faith ?? 0;

      // Update wasBeliever if faith crosses the threshold during simulation.
      if (faith >= BELIEVER_THRESHOLD) p.wasBeliever = true;

      // Only eligible if the NPC was once a believer.
      if (!p.wasBeliever) return;

      if (faith <= ABANDON_FLOOR) {
        const n = (this.lapsed.get(e.id) ?? 0) + 1;
        this.lapsed.set(e.id, n);
        if (n >= GRACE_TICKS) toRemove.push(e);
      } else {
        this.lapsed.delete(e.id);
      }
    });

    for (const e of toRemove) {
      // Scrub relationships pointing at the departed so nothing dangles.
      forEachNpc(ctx.world, (other) => {
        const op = npcProps(other);
        if (op.relationships.length > 0) {
          op.relationships = op.relationships.filter((r) => r.npcId !== e.id);
        }
      });
      ctx.world.removeEntity(e.id);
      this.lapsed.delete(e.id);
      ctx.log.append({ type: 'believer_lost', npcId: e.id });
    }
  }
}
