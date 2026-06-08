// src/blueprint/compile/to-brief.ts
// Port of buildingBrief onto the Blueprint. Subject/traits/materials/door come from
// the resolved parts+features; the guidance/negatives block is unchanged.
import type { ResolvedBlueprint, ResolvedPart, WallFace } from '../types';
import { getPartType, getFeatureType, type CompileCtx } from '../registry';
import {
  WALL_COLORS, ROOF_COLORS, GROUND_COLORS, NEUTRAL,
} from '@/blueprint/materials';
import type { AssetBrief, BriefMaterial, DoorFace } from '@/assetgen/asset-brief';
import { roofRise } from '@/render/building-massing-model';

const DETAILS = ['weathered', 'moss-streaked', 'sun-bleached', 'newly-built', 'soot-stained', 'ivy-clad'];

/** Map a footprint-relative door cell to the face it presents (s>e>n>w on ties). Ported. */
function doorFaceLetter(face: WallFace): DoorFace {
  return ({ south: 's', east: 'e', north: 'n', west: 'w' } as Record<WallFace, DoorFace>)[face];
}

export function toBrief(rb: ResolvedBlueprint, instanceSeed: number): AssetBrief {
  const ctx: CompileCtx = { materials: rb.materials, footprint: rb.footprint };
  const body = rb.parts.find(p => p.type === 'body') ?? rb.parts[0];

  // structure bbox
  let maxX = 0, maxY = 0;
  for (const p of rb.parts) { maxX = Math.max(maxX, p.at.x + p.size.w); maxY = Math.max(maxY, p.at.y + p.size.h); }

  const wallsMat = rb.materials.walls ?? 'stone';
  const roofMat = rb.materials.roof;
  const groundMat = rb.materials.ground;
  const materials: BriefMaterial[] = [{ part: 'walls', material: wallsMat, color: WALL_COLORS[wallsMat as never] ?? NEUTRAL }];
  if (roofMat && roofMat !== 'none') materials.push({ part: 'roof', material: roofMat, color: ROOF_COLORS[roofMat as never] ?? NEUTRAL });
  if (groundMat) materials.push({ part: 'ground', material: groundMat, color: GROUND_COLORS[groundMat as never] ?? NEUTRAL });
  const paletteAnchors = [...new Set(materials.map(m => m.color))];

  // traits: each part + feature contributes a phrase
  const partTraits: string[] = [];
  for (const p of rb.parts) partTraits.push(getPartType(p.type).toBrief(p, ctx));
  for (const p of rb.parts) for (const f of p.features) { const ft = getFeatureType(f.type); if (ft) partTraits.push(ft.toBrief(f, ctx)); }
  const detail = DETAILS[((instanceSeed % DETAILS.length) + DETAILS.length) % DETAILS.length];
  const traits = [`${wallsMat}-walled`, ...partTraits.filter(Boolean), detail];

  const levels = Math.max(1, (body?.params.levels as number) ?? 1);
  const heightPerLevel = Math.max(0.1, (body?.params.heightPerLevel as number) ?? 1);
  const roofKind = (body?.params.roof as string) ?? 'gable';
  const heightUnits = levels * heightPerLevel + roofRise(roofKind as never, rb.footprint);

  const doorFeat = body?.features.find(f => f.type === 'door');
  const face = doorFaceLetter((doorFeat?.face ?? 'south') as WallFace);
  // door cell (structure-local) for the brief's door coords
  const dc = doorFeat ? doorCellFor(body, (doorFeat.face ?? 'south') as WallFace) : [0, 0];

  const subject = (rb.preset ?? rb.category ?? 'building').replace(/_(small|large|tiny|big)$/, '').replace(/_/g, ' ');

  return {
    kind: 'building', subject, traits, materials, view: 'iso-3q', era: rb.era ?? 'medieval',
    footprint: { w: maxX, h: maxY },
    heightUnits,
    door: { x: dc[0], y: dc[1], face },
    paletteAnchors,
    guidance: { source: 'none', strength: 0 },
    negatives: [
      'blurry', 'text', 'watermark',
      'ground', 'terrain', 'grass', 'dirt patch', 'base tile', 'floor slab',
      'foundation', 'plinth', 'pedestal', 'platform', 'shadow', 'background',
      'multiple doors', 'door on side wall', 'door on rear wall', 'doorway facing away',
      'flat front view', 'straight-on elevation', 'blank front wall',
    ],
    seed: instanceSeed,
  };
}

function doorCellFor(part: ResolvedPart, face: WallFace): [number, number] {
  const { x, y } = part.at, { w, h } = part.size;
  const midX = x + Math.floor(w / 2), midY = y + Math.floor(h / 2);
  switch (face) {
    case 'south': return [midX, y + h - 1];
    case 'north': return [midX, y];
    case 'east':  return [x + w - 1, midY];
    case 'west':  return [x, midY];
  }
}
