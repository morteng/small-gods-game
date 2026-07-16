import type { Entity, EntityId, NpcProperties, NpcRole, Direction, NpcInstance, NpcSimState, Region } from '@/core/types';
import type { World } from '@/world/world';
import type { EventLog, SimEvent } from '@/core/events';
import { Random } from '@/core/noise';
import { clamp01 } from '@/core/math';

export const NPC_KIND = 'npc';
export const REMAINS_KIND = 'remains';

export function getNpc(world: World, id: EntityId): Entity | undefined {
  const e = world.registry.get(id);
  return e && e.kind === NPC_KIND ? e : undefined;
}

export function npcProps(e: Entity): NpcProperties {
  return e.properties as unknown as NpcProperties;
}

export function queryNpcs(world: World, opts?: { region?: Region }): Entity[] {
  return world.query({ kind: NPC_KIND, region: opts?.region });
}

export function forEachNpc(world: World, fn: (e: Entity) => void): void {
  for (const e of queryNpcs(world)) fn(e);
}

/** Size of the per-NPC memory ring (`recentEventIds`) — the LLM narration window. */
export const RECENT_EVENT_CAP = 8;

/**
 * Push an event id into an NPC's memory ring (`recentEventIds`), evicting the
 * oldest past `RECENT_EVENT_CAP`. The ONE writer every emit site shares (WP-C).
 * Ids ≤ 0 are skipped: `SilentEventLog.append` (replay) returns id 0, and letting
 * those zeros in would evict real memories with unresolvable ids.
 */
export function rememberEvent(props: NpcProperties, eventId: number): void {
  if (eventId <= 0) return;
  props.recentEventIds.push(eventId);
  if (props.recentEventIds.length > RECENT_EVENT_CAP) props.recentEventIds.shift();
}

/**
 * A settlement's aggregate "enlightenment" 0..1: the mean, over its resident NPCs, of each
 * resident's STRONGEST understanding across all the gods they believe in. A people who deeply
 * comprehend SOME deity have the mental sophistication to attempt grander works — this feeds
 * the buildability-envelope tech axis (`liftEraByUnderstanding`) so a devout settlement grows
 * grander architecture as belief deepens. Pure read (no mutation, no `Math.random`); 0 when the
 * settlement has no living residents (early game) so growth stays unchanged until belief grows.
 */
export function settlementUnderstanding(world: World, poiId: string): number {
  let sum = 0, n = 0;
  for (const e of queryNpcs(world)) {
    const p = npcProps(e);
    if (p.homePoiId !== poiId) continue;
    let best = 0;
    for (const k in p.beliefs) {
      const u = p.beliefs[k]?.understanding ?? 0;
      if (u > best) best = u;
    }
    sum += best; n++;
  }
  return n > 0 ? sum / n : 0;
}

/** Adapter to the legacy NpcInstance shape used by the renderer. The renderer
 *  itself is refactored later; this shim keeps PR 3 mechanical. */
export function toRenderNpc(e: Entity): NpcInstance {
  const p = npcProps(e);
  return {
    id: e.id,
    name: p.name,
    role: p.role,
    seed: p.seed,
    tileX: e.x,
    tileY: e.y,
    direction: p.direction,
    frame: p.frame,
    frameTimer: p.frameTimer,
    animation: p.animForce ?? p.animation,
    homeBuildingId: p.homeBuildingId,
    homePoiId: p.homePoiId,
    moveCooldown: p.moveCooldown,
  };
}

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];
const ROLE_FAITH: Record<NpcRole, number> = {
  priest: 0.7, elder: 0.5, farmer: 0.3, merchant: 0.25,
  soldier: 0.2, noble: 0.3, child: 0.4, beggar: 0.5,
};
const ROLE_PIETY_BONUS: Record<NpcRole, number> = {
  priest: 0.3, elder: 0.1, farmer: 0, merchant: -0.1,
  soldier: -0.1, noble: 0, child: 0.05, beggar: 0.1,
};

/** Human label for a sim event as seen from an NPC's perspective. `selfId` (when
 *  known) disambiguates first-person events from witnessed ones — the same ring
 *  entry reads differently in the subject's memory vs a relation's. */
function describeSimEvent(event: SimEvent, selfId?: EntityId): string {
  switch (event.type) {
    case 'whisper':       return '💬 Whisper received';
    case 'dream':         return '🌙 Dream sent';
    case 'omen':          return '⛈ Omen witnessed';
    case 'miracle':       return '✨ Miracle witnessed';
    case 'answer_prayer': return '🙏 Prayer answered';
    case 'mind_probed':   return '🧠 Mind probed';
    case 'believer_lost': return '💔 Faith lapsed';
    case 'smite':         return selfId !== undefined && event.npcId === selfId
      ? '⚡ Struck by the heavens'
      : '⚡ Lightning strike witnessed';
    case 'place_flooded': return `🌊 The waters rose over ${event.name}`;
    case 'npc_death':     return selfId === undefined || event.npcId === selfId
      ? `💀 Died (${event.cause})`
      : `💀 A death close to home (${event.cause})`;
    case 'npc_birth':     return selfId === undefined || event.npcId === selfId
      ? '👶 Born'
      : '👶 A child born to kin';
    case 'belief_cross':  return `📈 Belief ${event.kind} (${Math.round(event.faith * 100)}%)`;
    case 'mood_cross':    return `🙂 Mood ${event.kind}`;
    default:              return event.type;
  }
}

/**
 * Resolve an NPC's recentEventIds against the event log, newest first.
 * Unknown ids are skipped. Cap defaults to the same 8 the writers retain.
 * Pass the NPC's own entity id as `selfId` for first-person vs witnessed phrasing.
 */
export function getRecentEventDescriptions(
  props: NpcProperties,
  eventLog: EventLog,
  cap = RECENT_EVENT_CAP,
  selfId?: EntityId,
): string[] {
  const out: string[] = [];
  const ids = props.recentEventIds ?? [];
  for (let i = ids.length - 1; i >= 0 && out.length < cap; i--) {
    const found = eventLog.getById(ids[i]);
    if (found) out.push(describeSimEvent(found.event, selfId));
  }
  return out;
}

// =============================================================================
// Entity → legacy-shape adapter (keeps overlay/info-panel code working until
// those are refactored to read NpcProperties directly)
// =============================================================================

export function simStateFromEntity(e: Entity): NpcSimState {
  const p = e.properties as unknown as NpcProperties;
  return {
    npcId: e.id, name: p.name, role: p.role, personality: p.personality,
    beliefs: p.beliefs, needs: p.needs, mood: p.mood,
    recentEvents: [],  // legacy field; recentEventIds is the new home
    relationships: p.relationships,
    whisperCooldown: p.whisperCooldown,
    homeBuildingId: p.homeBuildingId, homePoiId: p.homePoiId,
    activity: p.activity,
    epithet: p.epithet,
  };
}

/** Build a complete NpcProperties record from role + seed. Replaces initNpcSim. */
export function initNpcProps(name: string, role: NpcRole, seed: number): NpcProperties {
  const rng = new Random(seed);
  const personality = {
    assertiveness: rng.next(),
    skepticism:    rng.next(),
    piety:         clamp01(rng.next() + ROLE_PIETY_BONUS[role]),
    sociability:   rng.next(),
  };
  const baseFaith = ROLE_FAITH[role] * (0.5 + personality.piety * 0.5);
  const needsRng = new Random(seed ^ 0xdeadbeef);
  const jitter = () => (needsRng.next() - 0.5) * 0.2;
  const needs = {
    safety:     clamp01(0.6  + jitter()),
    prosperity: clamp01(0.5  + jitter()),
    community:  clamp01(0.55 + jitter()),
    meaning:    clamp01(0.45 + jitter()),
  };
  const mood = (needs.safety + needs.prosperity + needs.community + needs.meaning) / 4;
  return {
    name,
    role,
    seed,
    direction: DIRECTIONS[seed % 4],
    frame: (seed % 8) + 1,
    frameTimer: seed % 100,
    homeX: 0,
    homeY: 0,
    birthTick: 0,
    parentIds: [],
    lineageId: '',
    personality,
    beliefs: { player: { faith: clamp01(baseFaith), understanding: 0.1, devotion: 0.05 } },
    needs,
    mood,
    whisperCooldown: 0,
    activity: 'idle',
    activityDuration: 0,
    relationships: [],
    recentEventIds: [],
  };
}

// =============================================================================
// Lineage queries — operate over both living NPCs and their remains, since a
// dead parent is still a parent and a lineage spans the living and the dead.
// =============================================================================

/** All NPC-or-remains entities, in stable insertion order. */
function npcsAndRemains(world: World): Entity[] {
  return world.registry.all().filter(e => e.kind === NPC_KIND || e.kind === REMAINS_KIND);
}

/** Resolve an NPC's 0–2 parent entities (living or remains). */
export function getParents(world: World, npc: Entity): Entity[] {
  const ids = npcProps(npc).parentIds ?? [];
  return ids.map(id => world.registry.get(id)).filter((e): e is Entity => e !== undefined);
}

/** All entities whose parentIds include the given npc id (living or remains). */
export function getChildren(world: World, npc: Entity): Entity[] {
  return npcsAndRemains(world).filter(e => (npcProps(e).parentIds ?? []).includes(npc.id));
}

/** All entities (living + remains) sharing a root-ancestor lineage id. */
export function lineageMembers(world: World, lineageId: string): Entity[] {
  return npcsAndRemains(world).filter(e => npcProps(e).lineageId === lineageId);
}
