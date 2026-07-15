import type { GameMap, WorldSeed, NpcRole, Entity } from '@/core/types';
import type { EventLog } from '@/core/events';
import type { SimClock } from '@/core/clock';
import type { Spirit, SpiritId } from '@/core/spirit';
import type { Oracle } from '@/world/oracle';
import type { Rng } from '@/core/rng';
import { World } from '@/world/world';
import { PerceptionSystem } from '@/world/perception-system';
import { initNpcProps, forEachNpc } from '@/world/npc-helpers';
import { snapToLand } from '@/world/land-snap';
import { seedSocialGraph } from '@/sim/social-graph';
import { TICKS_PER_YEAR } from '@/sim/mortality';
import { placeWallConnections } from '@/world/wall-connections';

/** Founders start as young adults so the cradle never opens with elders. */
const FOUNDER_MIN_AGE = 20;
const FOUNDER_MAX_AGE = 30;

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

  // 2. Pick seed POI (first one with NPCs and a position). A valid worldSeed may carry
  //    NO settlements at all — a terrain-only GENOME is pure ground for shader/biome work.
  //    That is not an error: seed no cradle band, reveal the whole map, and return.
  const seedPoi = worldSeed.pois.find(p => p.npcs && p.npcs.length > 0 && p.position);
  if (!seedPoi || !seedPoi.position) {
    for (const row of map.tiles) for (const t of row) t.state = 'realized';
    if (worldSeed.connections) placeWallConnections(world, worldSeed);
    log.append({ type: 'world_seeded', worldSeed, substrateSeed: map.seed });
    return;
  }

  // 3. Spawn a band of ~6 NPCs around the seed POI. Varied roles → varied
  //    skepticism/piety so they decay and convert at different rates. Each starts
  //    as a shallow believer: faith ≈ 0.18 (just above the 0.15 believer line),
  //    understanding = devotion = 0 — a small flock to keep from drifting, not yet
  //    deepened. The secularization dilemma is live from turn one.
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
    const cx = Math.max(0, Math.min(mapW - 1, ox + member.dx));
    const cy = Math.max(0, Math.min(mapH - 1, oy + member.dy));
    // Snap each founder onto land — a coastal seed POI can push band members
    // (offsets up to ±2) into the sea otherwise.
    const { x, y } = snapToLand(map, cx, cy);
    const id = `${seedPoi.id}-npc-${i}`;
    const memberSeed = hashId(id);
    const p = initNpcProps(member.name, member.role, memberSeed);
    p.homePoiId = seedPoi.id;
    p.homeX = x;
    p.homeY = y;
    // Found a lineage and back-date birth so each opens as a young adult (age in
    // [FOUNDER_MIN_AGE, FOUNDER_MAX_AGE]). Uses the seeded world rng for replay
    // parity. now is 0 at seed time, so birthTick is negative.
    const founderAge = FOUNDER_MIN_AGE + rng.next() * (FOUNDER_MAX_AGE - FOUNDER_MIN_AGE);
    p.birthTick = -Math.round(founderAge * TICKS_PER_YEAR);
    p.lineageId = id;
    p.parentIds = [];
    // Shallow-believer start (override initNpcProps' role-scaled belief):
    // just above the 0.15 believer line, no understanding/devotion yet.
    p.beliefs['player'] = { faith: 0.18, understanding: 0, devotion: 0 };
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

  // 5b. Interpret Connection{type:'wall'} as linear wall-run barriers between POIs.
  if (worldSeed.connections) placeWallConnections(world, worldSeed);

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
