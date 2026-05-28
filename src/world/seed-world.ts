import type { GameMap, WorldSeed, NpcRole, Entity } from '@/core/types';
import type { EventLog } from '@/core/events';
import type { SimClock } from '@/core/clock';
import type { Spirit, SpiritId } from '@/core/spirit';
import type { Oracle } from '@/world/oracle';
import type { Rng } from '@/core/rng';
import { World } from '@/world/world';
import { PerceptionSystem } from '@/world/perception-system';
import { initNpcProps, forEachNpc } from '@/world/npc-helpers';
import { seedSocialGraph } from '@/sim/social-graph';

const VALID_ROLES: NpcRole[] = ['farmer', 'priest', 'soldier', 'merchant', 'elder', 'child', 'noble', 'beggar'];

export interface SeedWorldArgs {
  world: World;
  log: EventLog;
  clock: SimClock;
  spirits: Map<SpiritId, Spirit>;
  rng: Rng;
  worldSeed: WorldSeed;
  map: GameMap;
  oracle: Oracle;
}

export function seedWorld(args: SeedWorldArgs): void {
  const { world, log, clock, spirits, rng, worldSeed, map, oracle } = args;

  // 1. Mark every tile void
  for (const row of map.tiles) for (const t of row) t.state = 'void';

  // 2. Pick seed POI (first one with NPCs and a position)
  const seedPoi = worldSeed.pois.find(p => p.npcs && p.npcs.length > 0 && p.position);
  if (!seedPoi || !seedPoi.position) {
    throw new Error('seedWorld: no POI with a seed NPC found in worldSeed');
  }

  // 3. Spawn the seed NPC
  const npcDef = seedPoi.npcs![0];
  const role: NpcRole = VALID_ROLES.includes(npcDef.role as NpcRole) ? npcDef.role as NpcRole : 'farmer';
  const name = npcDef.name || role;
  const id = `${seedPoi.id}-npc-0`;
  const seed = hashId(id);
  const props = initNpcProps(name, role, seed);
  props.homePoiId = seedPoi.id;
  props.homeX = seedPoi.position.x;
  props.homeY = seedPoi.position.y;
  // Cradle starts with low faith — the believer barely believes
  props.beliefs['player'].faith = 0.2;
  world.addEntity({
    id, kind: 'npc',
    x: seedPoi.position.x, y: seedPoi.position.y,
    properties: props as unknown as Record<string, unknown>,
  });
  log.append({ type: 'npc_spawn', npcId: id, role, poiId: seedPoi.id });

  // 4. Seed social graph (single seed NPC at this point, no-op; prepares for more)
  const allNpcs: Entity[] = [];
  forEachNpc(world, e => allNpcs.push(e));
  seedSocialGraph(allNpcs, map.seed);

  // 5. Run PerceptionSystem once to realize the cradle bubble
  const perception = new PerceptionSystem(oracle, () => map);
  perception.tick({
    world, spirits, log, clock, rng,
    dt: 500, now: clock.now(),
  });

  // 6. Append world_seeded as the final cradle event (chapter zero marker)
  log.append({
    type: 'world_seeded',
    worldSeed,
    substrateSeed: map.seed,
  });
}

function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
