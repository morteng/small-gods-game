/**
 * NpcEncounterSystem — mortals actually MEET ("A Town You Can Watch", Phase 2).
 *
 * Runs at 1 Hz, AFTER the activity + movement systems have placed everyone this
 * tick and BEFORE belief propagation. The activity system sends mortals on the
 * two PUBLIC errands — `socialize`, and (since S2a.1) `worship` — to their
 * settlement's gathering tile (the well at the green's heart), so neighbours
 * converge there. This system detects the meetings that fall out of that
 * convergence and makes them MEAN something:
 *
 *   two socially-tied mortals, both AT A GATHERING, co-located within
 *   ENCOUNTER_RADIUS, whose pair-cooldown has elapsed → an encounter:
 *     • their trust shifts — warmth for kin/friends, friction for rivals. The
 *       social graph, frozen at spawn until now, finally moves at runtime.
 *     • each records a (forgettable) `social` memory of the other, so a soul
 *       carries who it has been spending time with.
 *     • an `npc_encounter` SimEvent fires — the chronicler narrates it today,
 *       and Phase 3's speech bubbles will render it.
 *
 * FAITH is deliberately NOT touched here: faith/understanding/devotion spread
 * stays owned by BeliefPropagationSystem (communion + the graph roll), whose
 * equilibrium is carefully tuned. What a warm meeting DOES spread is belief
 * *content* — the RUMOUR (Phase 3b): "did you hear the god calls down lightning?"
 * A conversation drifts each party toward the other's stronger domain beliefs
 * (the Track-B `domains` channel), a punctuated boost on top of the ambient
 * BeliefContentSystem drift. Gated by the same rule that system uses — you must
 * believe the god EXISTS to believe what it does — so this rides faith, never
 * moves it. "The sim is truth; dialog animates it."
 *
 * ACQUAINTANCE FORMATION (interaction-scaling S2a.2) is the second pass, and the
 * reason encounter rate can scale with DENSITY at all. Before it, the edge set
 * was frozen at worldgen by `seedSocialGraph` and nothing ever created a
 * `Relationship` at runtime — so a town of 200 produced exactly as many meetings
 * per head as a hamlet of 6, and materialized extras (who spawn with NO
 * relationships) could never interact with anyone, ever. Now: two gathering
 * mortals who are co-located and DON'T yet know each other may strike up an
 * acquaintance — a weak `friend` edge — and thereafter meet like anyone else.
 * The rate is `min(sociability) × ACQUAINTANCE_RATE` (the shyer of the pair sets
 * the pace, which also makes the roll order-independent), and it is bounded on
 * BOTH sides so a market square never collapses into a complete graph:
 * `MAX_ACQUAINTANCES_PER_DAY` new edges per mortal per game-day, and
 * `MAX_SOCIAL_DEGREE` total edges. Density still raises the rate — more bodies
 * at the well means more candidate pairs per head — but a mortal's social world
 * stays humanly sized.
 *
 * Deterministic: the encounter half draws no rng at all (every effect is a fixed
 * delta) and pairs fire in a canonical id order (a.id < b.id) so A-meets-B is
 * counted once; the acquaintance half takes ONE value from `ctx.rng` per tick to
 * seed a local stream (the `NpcActivitySystem` pattern), never `Math.random`.
 * The per-pair cooldown map and the per-day edge budget are sim truth that lives
 * outside the entity world, so the system joins the WP-D snapshot seam
 * (serialize/hydrate) — a scrubbed-and-committed timeline must not inherit
 * "already met" ghosts, or a spent edge budget, from a discarded future.
 */

import type { Entity, EntityId, BeliefDomain, NpcProperties } from '@/core/types';
import type { SpiritId } from '@/core/spirit';
import { npcProps, forEachNpc } from '@/world/npc-helpers';
import type { System, SystemContext } from '@/core/scheduler';
import type { SerializableSystem } from '@/core/system-state';
import { TICKS_PER_DAY, dayIndexForTick } from '@/core/calendar';
import { Random } from '@/core/noise';
import { recordMemory, computeSalience } from '@/llm/interaction-memory';
import { addDomainBelief, getDomainBelief } from '@/sim/belief-domains';
import { addAcquaintance } from '@/sim/social-graph';

/** Chebyshev tile radius within which two gathering mortals count as "met". */
export const ENCOUNTER_RADIUS = 2;

/** Per co-located tick, the chance the shyer of two strangers at the green says
 *  something: `min(sociability) × ACQUAINTANCE_RATE`. Small — a passing crowd
 *  yields the odd new name, not a phone book — but at 1 Hz a pair that keeps
 *  sharing a bench for a few minutes will probably speak. */
export const ACQUAINTANCE_RATE = 0.02;

/** Trust a brand-new acquaintance starts at: barely more than a stranger, and
 *  well under the `seedSocialGraph` community band (0.2–0.7). It warms from
 *  there through ordinary encounters (TRUST_WARMTH) if they keep meeting. */
export const ACQUAINTANCE_TRUST = 0.15;

/** Budget: new edges one mortal may form per GAME DAY, and the total number of
 *  social ties it can carry. Both caps are what keep encounter rate density-
 *  DEPENDENT rather than density-EXPLOSIVE: without them a big enough gathering
 *  converges on a complete graph and the per-capita rate runs away as O(N). */
export const MAX_ACQUAINTANCES_PER_DAY = 3;
export const MAX_SOCIAL_DEGREE = 12;

/** A given pair meets meaningfully at most once per this window (real time,
 *  derived from the day so it survives any tick-rate change) ≈ 30 real minutes.
 *  Bounds both the belief-neutral trust drift and the event-log volume. */
export const ENCOUNTER_COOLDOWN_TICKS = Math.floor(TICKS_PER_DAY / 48);

/** Trust nudge per meeting — warmth between kin/friends, friction between rivals.
 *  Small, so saturation takes dozens of meetings (hours of shared socializing). */
export const TRUST_WARMTH = 0.02;
export const TRUST_FRICTION = -0.015;

/** Rumour spread rate (Phase 3b): fraction of the domain-belief GAP a warm
 *  meeting pulls the lesser holder toward the greater, per meeting. A punctuated
 *  boost — ~3× the ambient BeliefContentSystem per-tick drift (0.05) — but
 *  cooldown-throttled, and it only ever touches `domains`, never faith. */
export const RUMOUR_RATE = 0.15;

/** Relationship types that read as friendly (a meeting warms them); anything
 *  else (`rival`) reads as friction. */
const WARM_TYPES = new Set(['family', 'friend', 'lover', 'mentor']);

function pairKey(a: EntityId, b: EntityId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Is this mortal OUT AMONG PEOPLE right now? The two public errands qualify:
 *  • `socialize` — always, exactly as before S2a (a mortal socializing on its own
 *    doorstep because its settlement has no resolvable venue still counts; that
 *    is the map-less/orphan fallback and the shipped tests' world).
 *  • `worship` — only when the activity system actually sent it to the green
 *    (`gathering`). A soul praying alone at its own hearth (no venue, old save)
 *    is not in company and must not strike up acquaintances with the neighbours
 *    through the wall.
 * Every other activity — work, patrol, wander, idle, sleep — is not a gathering:
 * standing near someone at a plough is not a meeting.
 */
function isGathering(p: NpcProperties): boolean {
  return p.activity === 'socialize' || (p.activity === 'worship' && p.gathering === true);
}

export class NpcEncounterSystem implements System, SerializableSystem {
  readonly name = 'npc_encounter';
  readonly tickHz = 1;

  /** pairKey → sim tick of the pair's last meaningful encounter. */
  private lastMet = new Map<string, number>();

  /** Per-mortal count of acquaintances formed on `budgetDay` (S2a.2 budget).
   *  Cleared wholesale when the game-day rolls over, so it stays bounded by the
   *  number of mortals that gathered today. */
  private newEdgesToday = new Map<EntityId, number>();
  private budgetDay = -1;

  /** Local stream for the acquaintance roll, re-seeded from ONE `ctx.rng` draw
   *  per tick (the `NpcActivitySystem` pattern) so the number of values this
   *  system takes from the shared stream never depends on how crowded the green
   *  is — replay stays identical however many strangers happen to be standing
   *  next to each other. */
  private rng = new Random(0);

  // ── Probe-only instrumentation seam (interaction-scaling Phase 0) ──────────
  // Optional, settable AFTER construction (no constructor change, no call-site
  // churn), default undefined — ZERO behaviour change when unset. Fired once
  // per detected encounter regardless of warmth, and once per DIRECTION a warm
  // encounter actually pulled a domain-belief gap toward zero (not merely
  // "warm" — a warm pair with nothing to spread fires no rumour). `poiId` is
  // the meeting pair's settlement (`a`'s homePoiId — same field the logged
  // `npc_encounter` SimEvent already uses).
  onEncounter?: (a: EntityId, b: EntityId, poiId: string | undefined, warm: boolean) => void;
  onRumour?: (fromId: EntityId, toId: EntityId, poiId: string | undefined) => void;
  /** Fired once per acquaintance edge-PAIR formed (S2a.2), in canonical id order. */
  onAcquaintance?: (a: EntityId, b: EntityId, poiId: string | undefined) => void;

  tick(ctx: SystemContext): void {
    const now = ctx.now;
    this.rng = new Random(ctx.rng.next() * 0x7fffffff);

    // Drop stale cooldowns (past the window they can re-fire anyway) so the map
    // stays bounded to recently-active pairs.
    for (const [k, t] of this.lastMet) {
      if (now - t >= ENCOUNTER_COOLDOWN_TICKS) this.lastMet.delete(k);
    }

    const day = dayIndexForTick(now);
    if (day !== this.budgetDay) { this.budgetDay = day; this.newEdgesToday.clear(); }

    const byId = new Map<EntityId, Entity>();
    const gatherers: Entity[] = [];
    forEachNpc(ctx.world, (e) => {
      byId.set(e.id, e);
      if (isGathering(npcProps(e))) gatherers.push(e);
    });

    for (const a of byId.values()) {
      const pa = npcProps(a);
      if (!isGathering(pa) || pa.relationships.length === 0) continue;

      for (const rel of pa.relationships) {
        // Canonical order: only the lower id drives the pair, so we fire once.
        if (!(a.id < rel.npcId)) continue;
        const b = byId.get(rel.npcId);
        if (!b) continue;
        const pb = npcProps(b);
        if (!isGathering(pb)) continue;

        // Co-located? Chebyshev distance on tile coords.
        if (Math.abs(a.x - b.x) > ENCOUNTER_RADIUS || Math.abs(a.y - b.y) > ENCOUNTER_RADIUS) continue;

        const key = pairKey(a.id, b.id);
        const last = this.lastMet.get(key);
        if (last !== undefined && now - last < ENCOUNTER_COOLDOWN_TICKS) continue;
        this.lastMet.set(key, now);

        this.fireEncounter(a, b, rel.type, now, ctx);
      }
    }

    this.formAcquaintances(gatherers);
  }

  /**
   * S2a.2 — strangers who keep sharing the green start to know each other.
   *
   * Runs AFTER the edge-pair pass so a brand-new edge cannot also fire an
   * encounter on the same tick (they've only just said hello). Candidate pairs
   * come out of a coarse hash grid rather than an N² sweep, because a crowded
   * market is exactly the case this feature exists to make common — cell size is
   * `ENCOUNTER_RADIUS + 1`, so every co-located pair lives in the 3×3
   * neighbourhood of a's cell and none is missed. Iteration order is world order
   * (the `forEachNpc` order the rest of the sim already relies on) and each pair
   * is considered once in canonical id order, so the roll sequence is replayable.
   */
  private formAcquaintances(gatherers: Entity[]): void {
    if (gatherers.length < 2) return;

    const cell = ENCOUNTER_RADIUS + 1;
    const grid = new Map<string, Entity[]>();
    for (const e of gatherers) {
      const k = `${Math.floor(e.x / cell)},${Math.floor(e.y / cell)}`;
      const bucket = grid.get(k);
      if (bucket) bucket.push(e); else grid.set(k, [e]);
    }

    for (const a of gatherers) {
      const pa = npcProps(a);
      const cx = Math.floor(a.x / cell);
      const cy = Math.floor(a.y / cell);
      neighbourhood:
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const bucket = grid.get(`${cx + dx},${cy + dy}`);
          if (!bucket) continue;
          for (const b of bucket) {
            if (!this.canFormEdge(a.id, pa)) break neighbourhood;   // a is full for today
            if (!(a.id < b.id)) continue;                 // canonical order, once per pair
            if (Math.abs(a.x - b.x) > ENCOUNTER_RADIUS || Math.abs(a.y - b.y) > ENCOUNTER_RADIUS) continue;
            const pb = npcProps(b);
            if (!this.canFormEdge(b.id, pb)) continue;
            if (pa.relationships.some(r => r.npcId === b.id)) continue;   // already known

            // The shyer of the two sets the pace — symmetric, so the roll does
            // not depend on which of the pair the outer loop reached first.
            const chance = Math.min(pa.personality.sociability, pb.personality.sociability) * ACQUAINTANCE_RATE;
            if (this.rng.next() >= chance) continue;

            addAcquaintance(a, b, ACQUAINTANCE_TRUST);
            this.newEdgesToday.set(a.id, (this.newEdgesToday.get(a.id) ?? 0) + 1);
            this.newEdgesToday.set(b.id, (this.newEdgesToday.get(b.id) ?? 0) + 1);
            this.onAcquaintance?.(a.id, b.id, pa.homePoiId);
          }
        }
      }
    }
  }

  /** Both budget caps for one mortal: today's new-edge allowance and total degree. */
  private canFormEdge(id: EntityId, p: NpcProperties): boolean {
    return (this.newEdgesToday.get(id) ?? 0) < MAX_ACQUAINTANCES_PER_DAY
        && p.relationships.length < MAX_SOCIAL_DEGREE;
  }

  private fireEncounter(
    a: Entity, b: Entity, relType: string, now: number, ctx: SystemContext,
  ): void {
    const pa = npcProps(a);
    const pb = npcProps(b);
    const warm = WARM_TYPES.has(relType);
    const delta = warm ? TRUST_WARMTH : TRUST_FRICTION;

    this.onEncounter?.(a.id, b.id, pa.homePoiId, warm);

    // The social graph moves: nudge BOTH directional entries (a→b and b→a).
    bumpTrust(pa, b.id, delta);
    bumpTrust(pb, a.id, delta);

    // Rumour (Phase 3b): a warm conversation spreads what each thinks the gods
    // can DO — each drifts toward the other's stronger domain beliefs, weighted
    // by how much they trust them. Content only; faith is never moved here. A
    // barb spreads nothing (you don't take a rival's word for the divine).
    if (warm) {
      if (spreadRumour(pa, pb, trustToward(pb, a.id))) this.onRumour?.(a.id, b.id, pa.homePoiId);
      if (spreadRumour(pb, pa, trustToward(pa, b.id))) this.onRumour?.(b.id, a.id, pb.homePoiId);
    }

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
    return {
      lastMet: [...this.lastMet],
      newEdgesToday: [...this.newEdgesToday],
      budgetDay: this.budgetDay,
    };
  }

  hydrate(state: unknown): void {
    const s = state as {
      lastMet?: [string, number][];
      newEdgesToday?: [EntityId, number][];
      budgetDay?: number;
    } | undefined;
    this.lastMet = new Map(Array.isArray(s?.lastMet) ? s!.lastMet : []);
    // S2a.2: the per-day acquaintance budget is history, not a derived value —
    // a scrub-back that dropped it would hand every mortal a fresh allowance for
    // a day it has already half-spent. Absent (pre-S2a saves) ⇒ clean slate.
    this.newEdgesToday = new Map(Array.isArray(s?.newEdgesToday) ? s!.newEdgesToday : []);
    this.budgetDay = typeof s?.budgetDay === 'number' ? s.budgetDay : -1;
  }
}

/** Move the trust on one directional relationship entry, clamped to [0,1]. */
function bumpTrust(props: NpcProperties, otherId: EntityId, delta: number): void {
  const rel = props.relationships.find(r => r.npcId === otherId);
  if (!rel) return;
  rel.trust = Math.max(0, Math.min(1, rel.trust + delta));
}

/** `listener`'s trust toward `speakerId` (0 if the edge is somehow missing). */
function trustToward(listener: NpcProperties, speakerId: EntityId): number {
  return listener.relationships.find(r => r.npcId === speakerId)?.trust ?? 0;
}

/**
 * Spread belief CONTENT from `speaker` to `listener` (one direction). For each
 * spirit the speaker holds domain beliefs about that the listener ALSO believes
 * exists (faith > 0 — the BeliefContentSystem guard), pull the listener up toward
 * the speaker on every domain where the speaker believes more strongly. Faith,
 * understanding, devotion are untouched. Deterministic; no rng. Returns true iff
 * at least one domain gap was actually pulled (the probe's rumour-count seam).
 */
function spreadRumour(speaker: NpcProperties, listener: NpcProperties, trust: number): boolean {
  if (trust <= 0 || !speaker.domains) return false;
  let applied = false;
  for (const spirit of Object.keys(speaker.domains) as SpiritId[]) {
    if ((listener.beliefs[spirit]?.faith ?? 0) <= 0) continue; // no god, no rumour of its deeds
    const doms = speaker.domains[spirit]!;
    for (const domain of Object.keys(doms) as BeliefDomain[]) {
      const gap = (doms[domain] ?? 0) - getDomainBelief(listener, spirit, domain);
      if (gap > 0) { addDomainBelief(listener, spirit, domain, RUMOUR_RATE * trust * gap); applied = true; }
    }
  }
  return applied;
}
