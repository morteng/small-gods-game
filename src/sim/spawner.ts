import type { BuildingInstance, NpcRole, WorldSeed, GameMap, Entity } from '@/core/types';
import type { World } from '@/world/world';
import type { EventLog } from '@/core/events';
import { initNpcProps, forEachNpc } from '@/world/npc-helpers';
import { getBuildingTemplate } from '@/map/building-templates';
import { seedSocialGraph } from '@/sim/social-graph';

const VALID_ROLES: NpcRole[] = ['farmer', 'priest', 'soldier', 'merchant', 'elder', 'child', 'noble', 'beggar'];

const ROLE_PREFERRED_CATEGORY: Record<string, string> = {
  priest:   'religious', farmer:   'farm',        merchant: 'commercial',
  soldier:  'military',  noble:    'residential', elder:    'residential',
  child:    'residential', beggar:  'residential',
};

export function assignHomeBuilding(
  role: string,
  buildings: BuildingInstance[],
  index: number,
): BuildingInstance | undefined {
  if (!buildings.length) return undefined;
  const preferred = ROLE_PREFERRED_CATEGORY[role];
  if (preferred) {
    const match = buildings.find(b => {
      const t = getBuildingTemplate(b.templateId);
      return t?.category === preferred;
    });
    if (match) return match;
  }
  return buildings[index % buildings.length];
}

function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Populate every POI's NPCs into the world (used when leaving cradle phase). */
export function spawnAllPoiNpcs(args: {
  world: World; log: EventLog; worldSeed: WorldSeed; map: GameMap;
}): void {
  const { world, log, worldSeed, map } = args;
  for (const poi of worldSeed.pois) {
    if (!poi.npcs?.length || !poi.position) continue;
    const { x: px, y: py } = poi.position;
    const poiBuildings = (map.buildings ?? []).filter(b => b.poiId === poi.id);

    for (let i = 0; i < poi.npcs.length; i++) {
      const npcDef = poi.npcs[i];
      const id = `${poi.id}-npc-${i}`;
      if (world.registry.get(id)) continue;  // already spawned (e.g. seed npc)
      const seed = hashId(id);
      const role: NpcRole = VALID_ROLES.includes(npcDef.role as NpcRole) ? npcDef.role as NpcRole : 'farmer';
      const name = npcDef.name || role;
      const home = assignHomeBuilding(role, poiBuildings, i);

      let tileX: number, tileY: number;
      if (home) {
        const t = getBuildingTemplate(home.templateId);
        if (t) { tileX = home.tileX + t.doorCell.x; tileY = home.tileY + t.doorCell.y; }
        else   { tileX = Math.max(0, Math.min(map.width - 1, px + (seed % 3) - 1));
                 tileY = Math.max(0, Math.min(map.height - 1, py + ((seed >> 2) % 3) - 1)); }
      } else {
        tileX = Math.max(0, Math.min(map.width - 1, px + (seed % 3) - 1));
        tileY = Math.max(0, Math.min(map.height - 1, py + ((seed >> 2) % 3) - 1));
      }

      const props = initNpcProps(name, role, seed);
      props.homeBuildingId = home?.id;
      props.homePoiId = poi.id;
      world.addEntity({
        id, kind: 'npc', x: tileX, y: tileY,
        properties: props as unknown as Record<string, unknown>,
      });
      log.append({ type: 'npc_spawn', npcId: id, role, poiId: poi.id });
    }
  }

  // Seed social graph among all NPCs
  const allNpcs: Entity[] = [];
  forEachNpc(world, e => allNpcs.push(e));
  seedSocialGraph(allNpcs, map.seed);
}
