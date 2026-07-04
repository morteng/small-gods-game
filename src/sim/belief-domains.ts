/**
 * Belief-content: the *domains* model (Track B — "a god's powers are what its
 * believers think it can do").
 *
 * Today belief is `beliefs[spiritId] = { faith, understanding, devotion }` —
 * *how much* an NPC believes. This layer adds *what about*: a sparse per-NPC
 * vector over a small fixed enum of **domains** (storm, …), layered on top of
 * faith. The **aggregate** (faith×devotion-weighted, attributed to a spirit)
 * gates the dramatic-action vocabulary: cross a threshold → the capability
 * unlocks → the skill panel lights its button.
 *
 * Pure + deterministic + `Math.random`-free (no RNG needed here; seeding lives
 * at the act site). Sparse by construction — a near-zero entry is deleted, so we
 * never allocate dense N×D arrays. Rides the snapshot via structuredClone (it's
 * plain data on `NpcProperties.domains`).
 *
 * Design: docs/superpowers/specs/2026-06-18-belief-powers-divine-inbox-design.md
 */
import type { Entity, BeliefDomain, NpcProperties, SettlementEventType } from '@/core/types';
import type { SpiritId } from '@/core/spirit';
import type { CommandVerb } from '@/sim/command/types';
import type { World } from '@/world/world';
import { forEachNpc, npcProps } from '@/world/npc-helpers';
import { clamp01 } from '@/sim/npc-sim';

/** One domain definition: the capability it unlocks + the conviction bar. */
export interface DomainDef {
  domain: BeliefDomain;
  /** Player-facing name of the power ("Storm & Lightning"). */
  label: string;
  /** One-line of what believing it grants. */
  blurb: string;
  /** The capability verb this domain gates. The button does nothing until the
   *  verb is both `implemented` AND past `unlockThreshold` aggregate conviction. */
  verb: CommandVerb;
  /** Aggregate conviction (0–1) at/above which the capability unlocks. */
  unlockThreshold: number;
}

/** The single source of truth for belief domains. Bounded by real capabilities. */
export const DOMAIN_DEFS: Record<BeliefDomain, DomainDef> = {
  storm: {
    domain: 'storm',
    label: 'Storm & Lightning',
    blurb: 'They believe you command the angry sky — call down lightning to smite.',
    verb: 'smite',
    unlockThreshold: 0.5,
  },
  flood: {
    domain: 'flood',
    label: 'Tempests & Deluge',
    blurb: 'They believe you command the rains — summon a storm to flood a place.',
    verb: 'summon_storm',
    unlockThreshold: 0.45,
  },
};

export const ALL_DOMAINS: BeliefDomain[] = Object.keys(DOMAIN_DEFS) as BeliefDomain[];

/** Settlement events that read as the world's wrath/suffering — the coincidence
 *  fuel for storm-attribution (a sign in the sky over a dying field convinces).
 *  Also what the inbox surfaces as "opportunities". */
export const OMINOUS_EVENTS: ReadonlySet<SettlementEventType> =
  new Set<SettlementEventType>(['drought', 'plague', 'raiders', 'dispute']);

export function isOminous(t: SettlementEventType): boolean {
  return OMINOUS_EVENTS.has(t);
}

/** Below this an NPC's domain belief is treated as zero (and pruned). */
export const DOMAIN_EPSILON = 0.02;

// ── per-NPC reads/writes (sparse) ────────────────────────────────────────────

/** This NPC's belief that `spiritId` commands `domain` (0 when unheld). */
export function getDomainBelief(p: NpcProperties, spiritId: SpiritId, domain: BeliefDomain): number {
  return p.domains?.[spiritId]?.[domain] ?? 0;
}

/**
 * Add (or subtract) to an NPC's domain belief, clamped to 0–1. Sparse: a value
 * that falls at/below DOMAIN_EPSILON is deleted, and emptied records are pruned,
 * so idle NPCs carry no `domains` allocation at all. Returns the new value.
 */
export function addDomainBelief(
  p: NpcProperties, spiritId: SpiritId, domain: BeliefDomain, delta: number,
): number {
  const next = clamp01(getDomainBelief(p, spiritId, domain) + delta);
  if (next <= DOMAIN_EPSILON) {
    // prune
    const perSpirit = p.domains?.[spiritId];
    if (perSpirit) {
      delete perSpirit[domain];
      if (Object.keys(perSpirit).length === 0) delete p.domains![spiritId];
      if (p.domains && Object.keys(p.domains).length === 0) delete p.domains;
    }
    return 0;
  }
  if (!p.domains) p.domains = {};
  if (!p.domains[spiritId]) p.domains[spiritId] = {};
  p.domains[spiritId][domain] = next;
  return next;
}

// ── population aggregate (drives unlocks) ────────────────────────────────────

export interface DomainAggregate {
  domain: BeliefDomain;
  /** The BEST single congregation's faith×devotion-weighted mean of domain
   *  belief, 0–1. Congregations are per-settlement (`homePoiId`); this is the
   *  unlock signal: "is there a congregation, somewhere, convinced you command
   *  this?" — a fully-convinced town unlocks the power even while believers
   *  elsewhere have never seen your storms (R7 WP-B: a world-wide mean diluted
   *  the devout town to nothing once faith spread across settlements). */
  conviction: number;
  /** Count of NPCs holding this domain belief above a visible floor. */
  reach: number;
  /** Count of faith-bearers toward this spirit (the denominator's support). */
  believers: number;
}

/** Per-NPC weight in the aggregate: faith primary, devotion a loyalty multiplier.
 *  A devout believer's model of you counts for more than a waverer's. */
function aggregateWeight(faith: number, devotion: number): number {
  return faith * (0.5 + 0.5 * devotion);
}

/** The floor at which an NPC visibly "holds" a domain belief (for `reach`). */
export const DOMAIN_REACH_FLOOR = 0.1;

/** Bucket key for faith-bearers with no home settlement. Settlement-less NPCs
 *  (wanderers, the freshly displaced) form their OWN congregation — "the
 *  roadless" — rather than diluting a town's or being invisible to unlocks.
 *  (Deliberate: nothing is ever deleted; a devout wandering band still counts.) */
const NOMAD_CONGREGATION = '__nomads';

/**
 * Aggregate a spirit's conviction for one domain. Conviction is computed
 * PER CONGREGATION (per `homePoiId`; settlement-less NPCs pool under
 * {@link NOMAD_CONGREGATION}) and the aggregate reports the best congregation —
 * seeding is local (omens, smites, floods land on one settlement), so the
 * unlock test must be local too. `reach`/`believers` stay world-wide counts
 * (they are informational, not the gate).
 */
export function aggregateDomain(world: World, spiritId: SpiritId, domain: BeliefDomain): DomainAggregate {
  const buckets = new Map<string, { wSum: number; wDomSum: number }>();
  let reach = 0, believers = 0;
  forEachNpc(world, (e: Entity) => {
    const p = npcProps(e);
    const b = p.beliefs[spiritId];
    if (!b || b.faith <= 0) return;
    believers++;
    const w = aggregateWeight(b.faith, b.devotion);
    const dom = getDomainBelief(p, spiritId, domain);
    const key = p.homePoiId ?? NOMAD_CONGREGATION;
    let bucket = buckets.get(key);
    if (!bucket) { bucket = { wSum: 0, wDomSum: 0 }; buckets.set(key, bucket); }
    bucket.wSum += w;
    bucket.wDomSum += w * dom;
    if (dom >= DOMAIN_REACH_FLOOR) reach++;
  });
  let conviction = 0;
  for (const b of buckets.values()) {
    if (b.wSum > 0) conviction = Math.max(conviction, b.wDomSum / b.wSum);
  }
  return { domain, conviction, reach, believers };
}

/** Is a domain's capability unlocked for this spirit right now? */
export function isDomainUnlocked(world: World, spiritId: SpiritId, domain: BeliefDomain): boolean {
  return aggregateDomain(world, spiritId, domain).conviction >= DOMAIN_DEFS[domain].unlockThreshold;
}
