// src/blueprint/parts/body.ts
// The building massing part. Ports the descriptor→geometry mapping (formerly
// building-spec.ts) onto the Blueprint registry, keyed off params not descriptor fields.
import type { Part, ResolvedPart } from '../types';
import type { PartType, CompileCtx, ResolveCtx } from '../registry';
import type { Mat } from '@/assetgen/types';
import type { Wing, RoofKind } from '@/assetgen/geometry/building';
import { STOREY } from '@/assetgen/geometry/building';
import { DOOR_HEIGHT_TILES, mToTiles } from '@/render/scale-contract';
import type { Part as Prim } from '@/assetgen/compose';
import type { Anchor } from '@/world/anchors';

export type Plan = 'rect' | 'round' | 'L' | 'cross' | 'stepped';

export const WALL_MAT: Record<string, Mat> = {
  mud: 'plaster', wattle: 'plaster', hide: 'plaster',
  timber: 'timber', log: 'timber', brick: 'brick', stone: 'stone', marble: 'stone',
};
export const ROOF_MAT: Record<string, Mat> = {
  thatch: 'thatch', hide: 'thatch', wood: 'timber', tile: 'tile', slate: 'stone', none: 'tile',
};
export const ROOF_KIND: Record<string, RoofKind> = {
  gable: 'gable', gambrel: 'gable', mansard: 'gable', saltbox: 'gable',
  cross_gable: 'gable', lean_to: 'gable',
  jerkinhead: 'half_hip', half_hip: 'half_hip',
  hip: 'hip',
  pyramidal: 'pyramidal', conical: 'pyramidal', spire: 'pyramidal',
  tented: 'pyramidal', onion: 'pyramidal', domed: 'pyramidal',
  flat: 'flat', stepped: 'flat',
};

const wallMatOf = (ctx: CompileCtx) => WALL_MAT[ctx.materials.walls] ?? 'plaster';
const roofMatOf = (ctx: CompileCtx) => ROOF_MAT[ctx.materials.roof] ?? 'tile';

/** Wing rectangles for a plan, structure-local (origin 0,0). Ported from building-spec.ts. */
export function bodyWings(p: ResolvedPart): Array<{ x: number; y: number; w: number; h: number }> {
  const { w, h } = p.size;
  switch (p.params.plan as Plan) {
    case 'cross': {
      const naveH = Math.max(1, Math.round(h / 2));
      const transW = Math.max(1, Math.round(w / 2));
      return [
        { x: 0, y: Math.floor((h - naveH) / 2), w, h: naveH },
        { x: Math.floor((w - transW) / 2), y: 0, w: transW, h },
      ];
    }
    case 'L': {
      const barH = Math.max(1, Math.round(h / 2));
      const armW = Math.max(1, Math.round(w / 2));
      return [{ x: 0, y: 0, w, h: barH }, { x: 0, y: 0, w: armW, h }];
    }
    default:
      return [{ x: 0, y: 0, w, h }];
  }
}

function roundPrims(p: ResolvedPart, ctx: CompileCtx): Prim[] {
  const { w, h } = p.size;
  const r = Math.min(w, h) / 2, cx = w / 2 + p.at.x, cy = h / 2 + p.at.y;
  // Yurts are squat: the felt wall (khana) stands only a touch above the door, and the
  // dome is shallow. Anchor both to the door opening (not the fixed multi-storey STOREY, which
  // would render a 2.5×-door-tall wall), and decouple the dome rise from radius so WIDE yurts
  // stay shallow instead of ballooning into a tall hemisphere.
  const wallH = Math.max(1, p.params.levels as number) * DOOR_HEIGHT_TILES * 1.15;
  const out: Prim[] = [{ prim: 'cylinder', center: [cx, cy], baseZ: 0, radius: r, height: wallH, material: wallMatOf(ctx) }];
  const roof = p.params.roof as string;
  // A round body emits no `building` prim, so a smoke-vent feature can't ride a roof ridge.
  // Render it instead as the yurt's toono: a round hole bored straight through the dome apex.
  const hasVent = p.features.some(f => f.type === 'vent');
  if (roof === 'domed' || roof === 'onion') {
    // Snap the dome's centre to the cylinder's top centre: the lower hemisphere embeds
    // inside the wall (occluded), so the dome caps the cylinder instead of floating above it.
    // solidEllipsoid centres at baseZ + radii[2], so baseZ = wallH - radii[2] puts the centre at wallH.
    // Rise = 1.5× the door opening (shallow), capped at the radius so narrow yurts never go pointy.
    const domeRz = Math.min(r, DOOR_HEIGHT_TILES * 1.5);
    out.push({
      prim: 'ellipsoid', center: [cx, cy], baseZ: wallH - domeRz, radii: [r, r, domeRz], material: roofMatOf(ctx),
      ...(hasVent ? { bore: { radius: r * 0.28, depth: domeRz * 0.9 } } : {}),
    });
  } else if (roof !== 'flat') {
    out.push({ prim: 'cone', center: [cx, cy], baseZ: wallH, radius: r, height: r * 1.2, material: roofMatOf(ctx) });
  }
  return out;
}

function steppedPrims(p: ResolvedPart, ctx: CompileCtx): Prim[] {
  const levels = Math.max(1, p.params.levels as number);
  const inset = Math.max(0, p.params.levelInset as number);
  const storeyM = p.params.storeyM as number;
  const storeyTiles = storeyM > 0 ? mToTiles(storeyM) : STOREY;
  const mat = wallMatOf(ctx);
  const out: Prim[] = [];
  for (let lvl = 0; lvl < levels; lvl++) {
    const off = inset * lvl;
    const w = p.size.w - 2 * off, h = p.size.h - 2 * off;
    if (w <= 0 || h <= 0) break;
    out.push({ prim: 'box', at: [off + p.at.x, off + p.at.y, lvl * storeyTiles], size: [w, h, storeyTiles], material: mat });
  }
  return out;
}

export const bodyPartType: PartType = {
  type: 'body',
  paramSchema: {
    plan: { kind: 'enum', values: ['rect', 'round', 'L', 'cross', 'stepped'], default: 'rect' },
    levels: { kind: 'number', min: 1, max: 8, default: 1 },
    levelInset: { kind: 'number', min: 0, max: 3, default: 0 },
    storeyM: { kind: 'number', min: 0.5, max: 12, default: -1 },  // -1 = use the standard metric storey
    /** Tiles each upper storey oversails the one below toward the street (+x/+y) —
     *  the jettied townhouse cue. 0.12 ≈ a 24 cm jetty per storey. */
    jetty: { kind: 'number', min: 0, max: 0.3, default: 0 },
    roof: {
      kind: 'enum',
      values: [
        'flat', 'gable', 'hip', 'half_hip', 'conical', 'domed', 'stepped', 'lean_to',
        'gambrel', 'mansard', 'pyramidal', 'saltbox', 'onion', 'spire',
        'tented', 'jerkinhead', 'cross_gable',
      ],
      default: 'gable',
    },
  },
  resolve: (part: Part, _ctx: ResolveCtx) => ({ params: { ...(part.params ?? {}) } }),
  toPrims(p, ctx) {
    const plan = p.params.plan as Plan;
    if (plan === 'round') return roundPrims(p, ctx);
    if (plan === 'stepped') return steppedPrims(p, ctx);
    const storeys = Math.max(1, p.params.levels as number);
    const storeyM = p.params.storeyM as number;
    const storeyTiles = storeyM > 0 ? mToTiles(storeyM) : STOREY;
    const jetty = (p.params.jetty as number) || 0;
    const wings: Wing[] = bodyWings(p).map(r => ({
      x: r.x + p.at.x, y: r.y + p.at.y, w: r.w, h: r.h, storeys,
      storeyHeight: storeyTiles,
      roof: ROOF_KIND[p.params.roof as string] ?? 'gable',
      ...(jetty > 0 ? { jetty } : {}),
    }));
    return [{
      prim: 'building', wings,
      wallMat: wallMatOf(ctx), roofMat: roofMatOf(ctx), roofStyle: 'gable',
      features: {}, seed: 0,
    }];
  },
  toCollision(p) {
    const cells: Array<[number, number]> = [];
    for (let i = 0; i < p.size.w; i++) for (let j = 0; j < p.size.h; j++) cells.push([p.at.x + i, p.at.y + j]);
    return cells;
  },
  toAnchors: () => [],   // doors live on features; see to-anchors compiler
  toBrief(p) {
    const plan = p.params.plan as Plan;
    const planTrait = plan === 'round' ? 'round plan'
      : plan === 'stepped' ? 'stepped tiers'
      : plan === 'L' ? 'L-shaped plan'
      : plan === 'cross' ? 'cross-shaped plan' : '';
    const levels = Math.max(1, p.params.levels as number);
    const storey = levels === 1 ? 'single-storey' : `${levels} storeys`;
    return [storey, `${(p.params.roof as string).replace('_', '-')} roof`, planTrait].filter(Boolean).join(', ');
  },
};

export type { Anchor };
