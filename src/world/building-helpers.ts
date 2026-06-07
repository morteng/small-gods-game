/**
 * Building entity helpers — the building-side analogue of npc-helpers.
 *
 * `findBuildingAtTile` resolves a clicked/hovered tile to the building whose
 * footprint covers it. `buildingInfoOf` renders a building entity into the
 * display shape the hover tooltip + info modal consume — reusing the SAME
 * AssetBrief → describeForHuman path the art pipeline uses, so the inspector
 * lore matches the sprite (tri-alignment).
 */
import type { Entity, Era } from '@/core/types';
import type { World } from './world';
import type { BuildingDescriptor } from './building-descriptor';
import type { DoorFace } from '@/assetgen/asset-brief';
import { buildingBrief } from '@/assetgen/producers/building-producer';
import { describeForHuman } from '@/assetgen/describe';

/** FNV-1a → non-negative int, so the seeded detail trait is stable per entity. */
function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

function descriptorOf(e: Entity): BuildingDescriptor | null {
  const d = (e.properties as { descriptor?: BuildingDescriptor } | undefined)?.descriptor;
  return d && d.footprint ? d : null;
}

/** The building whose footprint covers (x, y), or null. Entity x/y is top-left. */
export function findBuildingAtTile(world: World, x: number, y: number): Entity | null {
  for (const e of world.query({ tag: 'building' })) {
    const fp = (e.properties as { footprint?: { w: number; h: number } } | undefined)?.footprint;
    if (!fp) continue;
    const ex = Math.floor(e.x);
    const ey = Math.floor(e.y);
    if (x >= ex && x < ex + fp.w && y >= ey && y < ey + fp.h) return e;
  }
  return null;
}

export interface BuildingFact {
  label: string;
  value: string;
}

export interface BuildingInfo {
  id: string;
  title: string;
  description: string;
  era: Era;
  footprint: { w: number; h: number };
  doorFace: DoorFace;
  facts: BuildingFact[];
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Display info for a building entity, or null if it carries no descriptor. */
export function buildingInfoOf(e: Entity): BuildingInfo | null {
  const d = descriptorOf(e);
  if (!d) return null;
  const brief = buildingBrief(d, hashStr(e.id));

  const wall = brief.materials.find((m) => m.part === 'walls')?.material;
  const roof = brief.materials.find((m) => m.part === 'roof')?.material;
  const ground = brief.materials.find((m) => m.part === 'ground')?.material;

  const facts: BuildingFact[] = [
    { label: 'Size', value: `${d.footprint.w}×${d.footprint.h} tiles` },
    { label: 'Era', value: titleCase(d.era) },
  ];
  if (wall) facts.push({ label: 'Walls', value: titleCase(wall) });
  if (roof) facts.push({ label: 'Roof', value: titleCase(roof) });
  if (ground) facts.push({ label: 'Ground', value: titleCase(ground) });
  facts.push({ label: 'Door', value: { n: 'North', e: 'East', s: 'South', w: 'West' }[brief.door!.face] });

  return {
    id: e.id,
    title: titleCase(brief.subject),
    description: describeForHuman(brief),
    era: d.era,
    footprint: { ...d.footprint },
    doorFace: brief.door!.face,
    facts,
  };
}
