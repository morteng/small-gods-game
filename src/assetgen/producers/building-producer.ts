/**
 * buildingBrief — turns a BuildingDescriptor into a canonical AssetBrief.
 *
 * The descriptor's material→colour tables become BOTH the brief's language
 * (`traits`) and its guidance colours (`paletteAnchors` + massing init image),
 * so description ↔ prompt ↔ image stay aligned. The functional door cell is
 * mapped to a visible face so the generated door matches where NPCs path.
 */
import {
  WALL_COLORS, ROOF_COLORS, GROUND_COLORS, NEUTRAL,
  type BuildingDescriptor,
} from '@/world/building-descriptor';
import { buildingMassing } from '@/render/building-massing-model';
import type { AssetBrief, BriefMaterial, DoorFace } from '../asset-brief';

/** Map a footprint-relative door cell to the face it presents (s > e > n > w on ties). */
export function doorFace(
  footprint: { w: number; h: number },
  door: { x: number; y: number },
): DoorFace {
  const { w, h } = footprint;
  const dist: Record<DoorFace, number> = {
    n: door.y,
    s: h - 1 - door.y,
    e: w - 1 - door.x,
    w: door.x,
  };
  const order: DoorFace[] = ['s', 'e', 'n', 'w'];
  let best: DoorFace = 's';
  for (const f of order) {
    if (dist[f] < dist[best]) best = f;
  }
  return best;
}

/** Per-instance flavour details, picked deterministically by seed. */
const DETAILS = [
  'weathered', 'moss-streaked', 'sun-bleached', 'newly-built', 'soot-stained', 'ivy-clad',
];

function humanizeSubject(d: BuildingDescriptor): string {
  const base = d.preset ?? d.category;
  return base.replace(/_(small|large|tiny|big)$/, '').replace(/_/g, ' ');
}

function planTrait(plan: BuildingDescriptor['plan']): string | null {
  switch (plan) {
    case 'round': return 'round plan';
    case 'stepped': return 'stepped tiers';
    case 'L': return 'L-shaped plan';
    case 'cross': return 'cross-shaped plan';
    default: return null;
  }
}

export function buildingBrief(d: BuildingDescriptor, instanceSeed: number): AssetBrief {
  const massing = buildingMassing(d);

  const materials: BriefMaterial[] = [
    { part: 'walls', material: d.walls, color: WALL_COLORS[d.walls] ?? NEUTRAL },
  ];
  if (d.roofMat !== 'none') {
    materials.push({ part: 'roof', material: d.roofMat, color: ROOF_COLORS[d.roofMat] ?? NEUTRAL });
  }
  if (d.groundMaterial) {
    materials.push({
      part: 'ground', material: d.groundMaterial,
      color: GROUND_COLORS[d.groundMaterial] ?? NEUTRAL,
    });
  }

  const paletteAnchors = [...new Set(materials.map((m) => m.color))];

  const levels = Math.max(1, d.levels);
  const detail = DETAILS[((instanceSeed % DETAILS.length) + DETAILS.length) % DETAILS.length];
  const traits: string[] = [
    levels === 1 ? 'single-storey' : `${levels} storeys`,
    `${d.walls}-walled`,
    `${d.roof.replace('_', '-')} roof`,
    ...(planTrait(d.plan) ? [planTrait(d.plan) as string] : []),
    detail,
  ];

  const face = doorFace(d.footprint, d.door);

  return {
    kind: 'building',
    subject: humanizeSubject(d),
    traits,
    materials,
    view: 'iso-3q',
    era: d.era,
    footprint: { ...d.footprint },
    heightUnits: massing.bodyHeight + massing.roofHeight,
    door: { x: d.door.x, y: d.door.y, face },
    paletteAnchors,
    guidance: { source: 'massing', strength: 500 },
    negatives: ['blurry', 'flat front view', 'text', 'watermark'],
    seed: instanceSeed,
  };
}
