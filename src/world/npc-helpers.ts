import type { Entity, EntityId, NpcProperties, NpcRole, Direction, NpcInstance, Region } from '@/core/types';
import type { World } from '@/world/world';
import { Random } from '@/core/noise';

export const NPC_KIND = 'npc';

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

/** Adapter to the legacy NpcInstance shape used by the renderer. The renderer
 *  itself is refactored later; this shim keeps PR 3 mechanical. */
export function toRenderNpc(e: Entity): NpcInstance {
  const p = npcProps(e);
  return {
    id: e.id,
    name: p.name,
    role: p.role,
    seed: p.seed,
    tileX: Math.floor(e.x),
    tileY: Math.floor(e.y),
    direction: p.direction,
    frame: p.frame,
    frameTimer: p.frameTimer,
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
function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

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
    personality,
    beliefs: { player: { faith: clamp01(baseFaith), understanding: 0.1, devotion: 0.05 } },
    needs,
    mood,
    whisperCooldown: 0,
    recentEventIds: [],
  };
}
