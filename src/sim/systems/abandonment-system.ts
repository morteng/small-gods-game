import type { System, SystemContext } from '@/core/scheduler';
import { forEachNpc, npcProps, rememberEvent } from '@/world/npc-helpers';
import { PLAYER_SPIRIT_ID, BELIEVER_THRESHOLD, LAPSED_FLOOR } from '@/sim/believers';

const GRACE_TICKS = 10; // consecutive floored ticks before we call it a lapse

/** Detects when a believer turns away from the player — their faith collapses to
 *  ~0 after having once been an active believer. It marks the moment with a
 *  `believer_lost` event (once per lapse), but it does NOT remove the NPC: per the
 *  world's rule, an instantiated soul never leaves the world. A lapsed ex-believer
 *  keeps living — walking, working, socializing — as a non-believer, no longer
 *  feeding the god's power, and is re-convertible if the player wins them back.
 *
 *  "Ever believed" is learned by observation: faith decays gradually, so the system
 *  sees a believer above the threshold before it bleeds to the floor. */
export class AbandonmentSystem implements System {
  readonly name = 'abandonment';
  readonly tickHz = 1;
  private everBelieved = new Set<string>();
  private lapsed = new Map<string, number>();
  private announced = new Set<string>();

  tick(ctx: SystemContext): void {
    forEachNpc(ctx.world, (e) => {
      const b = npcProps(e).beliefs[PLAYER_SPIRIT_ID];
      const faith = b?.faith ?? 0;

      if (faith >= BELIEVER_THRESHOLD) {
        // Active believer (possibly re-converted) — re-arm a future lapse.
        this.everBelieved.add(e.id);
        this.lapsed.delete(e.id);
        this.announced.delete(e.id);
        return;
      }
      if (!this.everBelieved.has(e.id)) return; // never a believer → nothing to lose

      if (faith <= LAPSED_FLOOR) {
        const n = (this.lapsed.get(e.id) ?? 0) + 1;
        this.lapsed.set(e.id, n);
        if (n >= GRACE_TICKS && !this.announced.has(e.id)) {
          this.announced.add(e.id);
          const appended = ctx.log.append({ type: 'believer_lost', npcId: e.id });
          // Losing one's faith is a memory the lapsed soul carries (WP-C).
          rememberEvent(npcProps(e), appended.id);
        }
      } else {
        // Declining but not yet floored — reset the grace counter.
        this.lapsed.delete(e.id);
      }
    });
  }
}
