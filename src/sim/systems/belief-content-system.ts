/**
 * BeliefContentSystem — the slow life of belief *content* (Track B).
 *
 * Attribution (seeding what they think you can DO) happens at the act site
 * (`divine-actions.ts`: omen during suffering, smite). This system runs the two
 * forces that act on that content between acts:
 *
 *  - **Propagation** — domain belief spreads along the social graph: an NPC drifts
 *    toward what its trusted, believing neighbours think the god commands (gossip).
 *  - **Decay** — unused belief fades, so a power is a *live mirror* of the
 *    congregation, not a permanent unlock. Devotion resists it (doctrine, once
 *    deeply held, barely decays).
 *
 * Deterministic + `Math.random`-free (no entropy needed). Read-then-write in two
 * phases so the result is independent of NPC iteration order. Sparse throughout
 * (`addDomainBelief` prunes near-zero entries), so idle congregations cost ~0.
 */
import type { System, SystemContext } from '@/core/scheduler';
import type { SpiritId } from '@/core/spirit';
import type { BeliefDomain } from '@/core/types';
import { forEachNpc, npcProps, getNpc } from '@/world/npc-helpers';
import { addDomainBelief, getDomainBelief } from '@/sim/belief-domains';

/** Fraction of belief lost per tick when undefended by devotion. */
export const DOMAIN_DECAY = 0.01;
/** Fraction of the trust-weighted gap to a neighbour pulled in per tick. */
export const DOMAIN_PROPAGATION_RATE = 0.05;

interface Delta { spirit: SpiritId; domain: BeliefDomain; delta: number; }

export class BeliefContentSystem implements System {
  readonly name = 'belief-content';
  readonly tickHz = 0.5;

  tick(ctx: SystemContext): void {
    const world = ctx.world;
    // Phase 1 — accumulate deltas without mutating (order-independence).
    const pending = new Map<string, Delta[]>();
    const push = (id: string, d: Delta) => {
      const list = pending.get(id);
      if (list) list.push(d); else pending.set(id, [d]);
    };

    forEachNpc(world, (e) => {
      const p = npcProps(e);

      // ── decay every held domain belief; devotion to that spirit resists ──
      if (p.domains) {
        for (const spirit of Object.keys(p.domains) as SpiritId[]) {
          const doms = p.domains[spirit]!;
          const resist = p.beliefs[spirit]?.devotion ?? 0;
          const rate = DOMAIN_DECAY * (1 - resist);
          if (rate <= 0) continue;
          for (const domain of Object.keys(doms) as BeliefDomain[]) {
            push(e.id, { spirit, domain, delta: -rate * (doms[domain] ?? 0) });
          }
        }
      }

      // ── propagation: drift toward trusted, believing neighbours ──
      for (const rel of p.relationships) {
        const nb = getNpc(world, rel.npcId);
        if (!nb) continue;
        const np = npcProps(nb);
        if (!np.domains) continue;
        for (const spirit of Object.keys(np.domains) as SpiritId[]) {
          // The receiver must believe the god EXISTS to believe what it does.
          if ((p.beliefs[spirit]?.faith ?? 0) <= 0) continue;
          const nbDoms = np.domains[spirit]!;
          for (const domain of Object.keys(nbDoms) as BeliefDomain[]) {
            const nbVal = nbDoms[domain] ?? 0;
            const myVal = getDomainBelief(p, spirit, domain);
            if (nbVal > myVal) {
              push(e.id, { spirit, domain, delta: DOMAIN_PROPAGATION_RATE * rel.trust * (nbVal - myVal) });
            }
          }
        }
      }
    });

    // Phase 2 — apply.
    for (const [id, deltas] of pending) {
      const e = getNpc(world, id);
      if (!e) continue;
      const p = npcProps(e);
      for (const d of deltas) addDomainBelief(p, d.spirit, d.domain, d.delta);
    }
  }
}
