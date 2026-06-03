import type { Entity, NpcProperties } from '@/core/types';
import type { World } from '@/world/world';
import type { MindLink } from '@/llm/npc-attention-store';

/** A sim entity the focused NPC could plausibly reference (gold-link target). */
export interface MindCandidate { id: string; label: string; kind: 'npc' | 'place'; }

/** Raw link as proposed by the LLM, before validation against real ids. */
export interface RawMindLink { label: string; kind: 'entity' | 'concept'; entityId?: string; }

const NEARBY_RADIUS = 6;
const MAX_CANDIDATES = 16;

/**
 * Build the set of real sim ids the given NPC could plausibly reference: its
 * relationship targets, its home POI, and any nearby NPCs. Used to validate
 * (and degrade) LLM-proposed entity links.
 */
export function buildCandidateIds(npc: Entity, world: World): MindCandidate[] {
  const p = npc.properties as unknown as NpcProperties;
  const out = new Map<string, MindCandidate>();

  for (const rel of p.relationships ?? []) {
    const e = world.registry.get(rel.npcId);
    if (e) out.set(rel.npcId, { id: rel.npcId, label: (e.properties as any)?.name ?? rel.npcId, kind: 'npc' });
  }
  if (p.homePoiId) out.set(p.homePoiId, { id: p.homePoiId, label: p.homePoiId, kind: 'place' });

  // Nearby NPCs (excluding self).
  const region = { x: npc.x - NEARBY_RADIUS, y: npc.y - NEARBY_RADIUS, w: NEARBY_RADIUS * 2, h: NEARBY_RADIUS * 2 };
  for (const e of world.query({ kind: 'npc', region })) {
    if (e.id === npc.id || out.has(e.id)) continue;
    out.set(e.id, { id: e.id, label: (e.properties as any)?.name ?? e.id, kind: 'npc' });
    if (out.size >= MAX_CANDIDATES) break;
  }
  return [...out.values()].slice(0, MAX_CANDIDATES);
}

/**
 * Validate LLM-proposed links against the candidate ids. A valid entity link
 * (kind:'entity' with an id present in candidates) stays a gold link; any
 * unresolved entity link degrades to a purple concept link. Concept links pass
 * through unchanged.
 */
export function resolveLinks(raw: RawMindLink[], candidates: MindCandidate[]): MindLink[] {
  const byId = new Map(candidates.map(c => [c.id, c]));
  return raw.map((l) => {
    if (l.kind === 'entity' && l.entityId && byId.has(l.entityId)) {
      return { label: l.label, kind: 'entity', entityId: l.entityId };
    }
    return { label: l.label, kind: 'concept' };
  });
}
