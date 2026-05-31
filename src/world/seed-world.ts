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

  // 3. Spawn a band of ~6 NPCs around the seed POI. Varied roles → varied
  //    skepticism/piety so they decay and convert at different rates. Each starts
  //    as a near-non-believer: faith ≈ 0.1, understanding = devotion = 0.
  const BAND: { name: string; role: NpcRole; dx: number; dy: number }[] = [
    { name: 'Tola',  role: 'farmer',   dx: 0,  dy: 0 },
    { name: 'Bram',  role: 'elder',    dx: 1,  dy: 0 },
    { name: 'Sefa',  role: 'child',    dx: -1, dy: 1 },
    { name: 'Doran', role: 'beggar',   dx: 2,  dy: 1 },
    { name: 'Mira',  role: 'merchant', dx: 0,  dy: 2 },
    { name: 'Garr',  role: 'soldier',  dx: -2, dy: 0 },
  ];
  const ox = seedPoi.position.x;
  const oy = seedPoi.position.y;
  const mapW = map.width;
  const mapH = map.height;

  BAND.forEach((member, i) => {
    const x = Math.max(0, Math.min(mapW - 1, ox + member.dx));
    const y = Math.max(0, Math.min(mapH - 1, oy + member.dy));
    const id = `${seedPoi.id}-npc-${i}`;
    const memberSeed = hashId(id);
    const p = initNpcProps(member.name, member.role, memberSeed);
    p.homePoiId = seedPoi.id;
    p.homeX = x;
    p.homeY = y;
    // Near-non-believer start (override initNpcProps' role-scaled belief).
    p.beliefs['player'] = { faith: 0.1, understanding: 0, devotion: 0 };
    world.addEntity({
      id, kind: 'npc', x, y,
      properties: p as unknown as Record<string, unknown>,
    });
    log.append({ type: 'npc_spawn', npcId: id, role: member.role, poiId: seedPoi.id });
  });

  // 4. Seed social graph over the initial band
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
