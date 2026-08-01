/**
 * Social graph seeding and query helpers.
 *
 * Relationships are generated on spawn: NPCs sharing a POI are linked via
 * the social graph with trust derived from personality compatibility.
 */

import type { Entity, Relationship } from '@/core/types';
import { npcProps } from '@/world/npc-helpers';
import { Random } from '@/core/noise';

export { npcProps };

// ─── Seeding ────────────────────────────────────────────────────────────────

/**
 * Possible relationship types between two NPCs sharing a tile (building cohab). */
const COHAB_TYPES: Relationship['type'][] = ['family', 'lover', 'friend'];

/**
 * Seed the `relationships` array on every NPC that shares a POI or building
 * with other NPCs. Called once after all NPCs for a POI are spawned.
 *
 * Rules:
 *  - Same building → cohab (family/lover/friend), trust 0.5–0.9
 *  - Same POI, different building → community (friend/rival), trust 0.2–0.7
 *  - Rivalry: personality clash (sociability + assertiveness Δ >= 1.0)
 */
export function seedSocialGraph(npcs: Entity[], globalSeed: number): void {
  if (npcs.length < 2) return;

  // Group by POI, then by building
  const byPoi = new Map<string, Entity[]>();
  for (const e of npcs) {
    const p = npcProps(e);
    const key = p.homePoiId ?? '__orphan';
    if (!byPoi.has(key)) byPoi.set(key, []);
    byPoi.get(key)!.push(e);
  }

  for (const [, poiNpcs] of byPoi) {
    if (poiNpcs.length < 2) continue;

    // Group by building within the POI
    const byBuilding = new Map<string, Entity[]>();
    for (const e of poiNpcs) {
      const key = npcProps(e).homeBuildingId ?? '__no_home';
      if (!byBuilding.has(key)) byBuilding.set(key, []);
      byBuilding.get(key)!.push(e);
    }

    // Seed relationships for each building group
    for (const [, buildingNpcs] of byBuilding) {
      if (buildingNpcs.length < 2) continue;
      seedGroupRelationships(buildingNpcs, COHAB_TYPES, globalSeed);
    }

    // Seed cross-building relationships (weaker, community ties)
    const buildingList = [...byBuilding.entries()];
    if (buildingList.length < 2) continue;
    for (let i = 0; i < buildingList.length; i++) {
      for (let j = i + 1; j < buildingList.length; j++) {
        const [, aNpcs] = buildingList[i];
        const [, bNpcs] = buildingList[j];
        seedCrossGroup(aNpcs, bNpcs, globalSeed + i * 31 + j * 97);
      }
    }
  }
}

/** Seed relationships within a tight-knit group (same building). */
function seedGroupRelationships(
  npcs: Entity[],
  allowedTypes: Relationship['type'][],
  seed: number,
): void {
  for (let i = 0; i < npcs.length; i++) {
    for (let j = i + 1; j < npcs.length; j++) {
      const rng = new Random(seed + i * npcs.length + j);
      const a = npcs[i];
      const b = npcs[j];
      const pa = npcProps(a);
      const pb = npcProps(b);

      // Detect rivalry from personality clash (sociability × assertiveness)
      const sociabilityDelta = Math.abs(pa.personality.sociability - pb.personality.sociability);
      const assertivenessDelta = Math.abs(pa.personality.assertiveness - pb.personality.assertiveness);
      const deltaSum = sociabilityDelta + assertivenessDelta;

      let relType: Relationship['type'];
      let trust: number;

      if (deltaSum >= 1.0) {
        // Strong personality clash → rival
        relType = 'rival';
        trust = 0.1 + rng.next() * 0.2; // low trust
      } else {
        relType = allowedTypes[Math.floor(rng.next() * allowedTypes.length)];
        trust = 0.5 + rng.next() * 0.4; // 0.5–0.9
      }

      addMutualRelationship(a, b, relType, trust);
    }
  }
}

/** Seed weaker cross-building relationships (friendship or rivalry). */
function seedCrossGroup(aNpcs: Entity[], bNpcs: Entity[], seed: number): void {
  for (const a of aNpcs) {
    for (const b of bNpcs) {
      const rng = new Random(seed + a.id.charCodeAt(0) * 13 + b.id.charCodeAt(0) * 7);
      const pa = npcProps(a);
      const pb = npcProps(b);

      const sociabilityDelta = Math.abs(pa.personality.sociability - pb.personality.sociability);
      const assertivenessDelta = Math.abs(pa.personality.assertiveness - pb.personality.assertiveness);

      let relType: Relationship['type'];
      let trust: number;

      if (sociabilityDelta + assertivenessDelta >= 1.2) {
        relType = 'rival';
        trust = 0.1 + rng.next() * 0.15;
      } else {
        relType = rng.next() < 0.3 ? 'rival' : 'friend';
        trust = 0.2 + rng.next() * 0.5; // 0.2–0.7
      }

      addMutualRelationship(a, b, relType, trust);
    }
  }
}

/** Add a symmetric relationship entry on both NPCs. */
function addMutualRelationship(
  a: Entity,
  b: Entity,
  type: Relationship['type'],
  trust: number,
): void {
  const pa = npcProps(a);
  const pb = npcProps(b);

  // Deduplicate
  if (pa.relationships.some(r => r.npcId === b.id)) return;
  if (pb.relationships.some(r => r.npcId === a.id)) return;

  pa.relationships.push({ npcId: b.id, type, trust });
  pb.relationships.push({ npcId: a.id, type, trust });
}

// ─── Runtime edges (interaction-scaling S2a.2) ──────────────────────────────

/**
 * Two strangers who met at the green now know each other's name: a weak,
 * symmetric `friend` edge. The FIRST code path in the game that creates a
 * `Relationship` after worldgen — until S2a.2 `seedSocialGraph` froze the graph
 * at spawn, which is why a materialized extra (spawned with an empty
 * `relationships` array) could never interact with anybody for as long as it
 * lived. Callers own the budget/probability; this just writes the edge, and
 * de-duplicates so a double call is a no-op.
 */
export function addAcquaintance(a: Entity, b: Entity, trust: number): void {
  addMutualRelationship(a, b, 'friend', trust);
}

/**
 * Erase every edge in the world pointing AT `id`. Called when a materialized
 * soul folds back into its statistical cohort: the extra's own array leaves with
 * its entity, but the acquaintances it made are recorded on the SURVIVORS too,
 * and a surviving mortal holding an edge to an entity that no longer exists is a
 * dangling id — `NpcEncounterSystem`'s edge pass would skip it forever while it
 * still counted against `MAX_SOCIAL_DEGREE`, and `trustWeightedBeliefConnections`
 * would keep paying the map lookup.
 *
 * DECISION (plan S2.1): acquaintances of a folded soul DISSOLVE rather than
 * banking a "sociality" scalar into the cohort. It is the cheap option and the
 * defensible one — the statistical tier has no identities for an edge to point
 * at, so there is nothing to remember; the townsfolk simply stop seeing that
 * face once it goes back into the crowd. Seeded (worldgen) edges are unaffected
 * in practice because extras are never `seedSocialGraph`'d.
 */
export function dropRelationshipsTo(npcs: Iterable<Entity>, id: string): void {
  for (const e of npcs) {
    const rels = npcProps(e).relationships;
    const idx = rels.findIndex(r => r.npcId === id);
    if (idx >= 0) rels.splice(idx, 1);
  }
}

// ─── Queries ────────────────────────────────────────────────────────────────

/** Get all relationships for an NPC by their entity id. */
export function getRelationships(e: Entity): Relationship[] {
  return npcProps(e).relationships;
}

/** Filter relationships by type. */
export function getRelationshipsByType(e: Entity, type: Relationship['type']): Relationship[] {
  return npcProps(e).relationships.filter(r => r.type === type);
}

/**
 * Sum of trust-weighted relationships to NPCs that believe in a given spirit.
 * Used for belief propagation strength calculation.
 */
export function trustWeightedBeliefConnections(
  e: Entity,
  allNpcs: Map<string, Entity>,
  spiritId: string,
): number {
  const p = npcProps(e);
  let total = 0;
  for (const rel of p.relationships) {
    const other = allNpcs.get(rel.npcId);
    if (!other) continue;
    const otherBelief = npcProps(other).beliefs[spiritId];
    if (otherBelief && otherBelief.faith > 0.3) {
      total += rel.trust * otherBelief.faith;
    }
  }
  return total;
}
