/**
 * NpcEncounterSystem — mortals actually MEET ("A Town You Can Watch", Phase 2).
 *
 * Runs at 1 Hz, AFTER the activity + movement systems have placed everyone this
 * tick and BEFORE belief propagation. The activity system now sends socializing
 * mortals to their settlement's gathering tile (the well), so neighbours
 * converge there. This system detects the meetings that fall out of that
 * convergence and makes them MEAN something:
 *
 *   two socially-tied mortals, both `socialize`, co-located within
 *   ENCOUNTER_RADIUS, whose pair-cooldown has elapsed → an encounter:
 *     • their trust shifts — warmth for kin/friends, friction for rivals. The
 *       social graph, frozen at spawn until now, finally moves at runtime.
 *     • each records a (forgettable) `social` memory of the other, so a soul
 *       carries who it has been spending time with.
 *     • an `npc_encounter` SimEvent fires — the chronicler narrates it today,
 *       and Phase 3's speech bubbles will render it.
 *
 * Belief is deliberately NOT touched here: faith/understanding/devotion spread
 * stays owned by BeliefPropagationSystem (communion + the graph roll), whose
 * equilibrium is carefully tuned. Phase 3 will layer rumour-driven belief on top
 * of actual dialog CONTENT — "the sim is truth; dialog animates it."
 *
 * Deterministic: no rng at all (every effect is a fixed delta), pairs fire in a
 * canonical id order (a.id < b.id) so A-meets-B is counted once. The per-pair
 * cooldown map is sim truth that lives outside the entity world, so the system
 * joins the WP-D snapshot seam (serialize/hydrate) — a scrubbed-and-committed
 * timeline must not inherit "already met" ghosts from a discarded future.
 */

import type { Entity, EntityId } from '@/core/types';
import { npcProps, forEachNpc } from '@/world/npc-helpers';
import type { System, SystemContext } from '@/core/scheduler';
import type { SerializableSystem } from '@/core/system-state';
import { TICKS_PER_DAY } from '@/core/calendar';
import { recordMemory, computeSalience } from '@/llm/interaction-memory';

/** Chebyshev tile radius within which two socializing mortals count as "met". */
export const ENCOUNTER_RADIUS = 2;

/** A given pair meets meaningfully at most once per this window (real time,
 *  derived from the day so it survives any tick-rate change) ≈ 30 real minutes.
 *  Bounds both the belief-neutral trust drift and the event-log volume. */
export const ENCOUNTER_COOLDOWN_TICKS = Math.floor(TICKS_PER_DAY / 48);

/** Trust nudge per meeting — warmth between kin/friends, friction between rivals.
 *  Small, so saturation takes dozens of meetings (hours of shared socializing). */
export const TRUST_WARMTH = 0.02;
export const TRUST_FRICTION = -0.015;

/** Relationship types that read as friendly (a meeting warms them); anything
 *  else (`rival`) reads as friction. */
const WARM_TYPES = new Set(['family', 'friend', 'lover', 'mentor']);

function pairKey(a: EntityId, b: EntityId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export class NpcEncounterSystem implements System, SerializableSystem {
  readonly name = 'npc_encounter';
  readonly tickHz = 1;

  /** pairKey → sim tick of the pair's last meaningful encounter. */
  private lastMet = new Map<string, number>();

  tick(ctx: SystemContext): void {
    const now = ctx.now;

    // Drop stale cooldowns (past the window they can re-fire anyway) so the map
    // stays bounded to recently-active pairs.
    for (const [k, t] of this.lastMet) {
      if (now - t >= ENCOUNTER_COOLDOWN_TICKS) this.lastMet.delete(k);
    }

    const byId = new Map<EntityId, Entity>();
    forEachNpc(ctx.world, (e) => byId.set(e.id, e));

    for (const a of byId.values()) {
      const pa = npcProps(a);
      if (pa.activity !== 'socialize' || pa.relationships.length === 0) continue;

      for (const rel of pa.relationships) {
        // Canonical order: only the lower id drives the pair, so we fire once.
        if (!(a.id < rel.npcId)) continue;
        const b = byId.get(rel.npcId);
        if (!b) continue;
        const pb = npcProps(b);
        if (pb.activity !== 'socialize') continue;

        // Co-located? Chebyshev distance on tile coords.
        if (Math.abs(a.x - b.x) > ENCOUNTER_RADIUS || Math.abs(a.y - b.y) > ENCOUNTER_RADIUS) continue;

        const key = pairKey(a.id, b.id);
        const last = this.lastMet.get(key);
        if (last !== undefined && now - last < ENCOUNTER_COOLDOWN_TICKS) continue;
        this.lastMet.set(key, now);

        this.fireEncounter(a, b, rel.type, now, ctx);
      }
    }
  }

  private fireEncounter(
    a: Entity, b: Entity, relType: string, now: number, ctx: SystemContext,
  ): void {
    const pa = npcProps(a);
    const pb = npcProps(b);
    const warm = WARM_TYPES.has(relType);
    const delta = warm ? TRUST_WARMTH : TRUST_FRICTION;

    // The social graph moves: nudge BOTH directional entries (a→b and b→a).
    bumpTrust(pa, b.id, delta);
    bumpTrust(pb, a.id, delta);

    // Each remembers the other — a forgettable social memory (lowest salience of
    // any kind, first to be evicted, never displaces a divine deed).
    const sal = computeSalience('social');
    recordMemory(pa, { tick: now, kind: 'social', salience: sal,
      summary: warm ? `Passed the time with ${pb.name}.` : `Crossed words with ${pb.name}.` });
    recordMemory(pb, { tick: now, kind: 'social', salience: sal,
      summary: warm ? `Passed the time with ${pa.name}.` : `Crossed words with ${pa.name}.` });

    ctx.log.append({
      type: 'npc_encounter',
      aId: a.id, bId: b.id,
      poiId: pa.homePoiId,
      warm,
      x: Math.round((a.x + b.x) / 2),
      y: Math.round((a.y + b.y) / 2),
    });
  }

  serialize(): unknown {
    return { lastMet: [...this.lastMet] };
  }

  hydrate(state: unknown): void {
    const s = state as { lastMet?: [string, number][] } | undefined;
    this.lastMet = new Map(Array.isArray(s?.lastMet) ? s!.lastMet : []);
  }
}

/** Move the trust on one directional relationship entry, clamped to [0,1]. */
function bumpTrust(props: ReturnType<typeof npcProps>, otherId: EntityId, delta: number): void {
  const rel = props.relationships.find(r => r.npcId === otherId);
  if (!rel) return;
  rel.trust = Math.max(0, Math.min(1, rel.trust + delta));
}
