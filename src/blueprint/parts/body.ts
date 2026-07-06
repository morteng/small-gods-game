// src/blueprint/parts/body.ts
// The building massing part. Ports the descriptor→geometry mapping (formerly
// building-spec.ts) onto the Blueprint registry, keyed off params not descriptor fields.
import type { Part, ResolvedPart } from '../types';
import type { PartType, CompileCtx, ResolveCtx } from '../registry';
import type { Mat } from '@/assetgen/types';
import type { Wing, RoofKind, WallFace } from '@/assetgen/geometry/building';
import { STOREY } from '@/assetgen/geometry/building';
import { DOOR_HEIGHT_TILES, mToTiles } from '@/render/scale-contract';
import type { Part as Prim } from '@/assetgen/compose';
import type { Anchor } from '@/world/anchors';
import { buttressPrims, parapetPrims } from './trim';
import { framePrims, type FrameOpening } from './frame';

export type Plan = 'rect' | 'round' | 'L' | 'cross' | 'stepped';

export const WALL_MAT: Record<string, Mat> = {
  mud: 'plaster', wattle: 'plaster', hide: 'plaster',
  timber: 'timber', log: 'timber', brick: 'brick', stone: 'stone', marble: 'stone',
};
/** Descriptor → bond/coursing (SurfaceWork) within the wall family (KC). Absent ⇒ family
 *  default (stone→coursed_rubble, brick→running, timber→plank). marble = fine ashlar;
 *  log = board-and-batten timber to read distinct from sawn plank. */
export const WALL_WORK: Record<string, string> = {
  stone: 'coursed_rubble', marble: 'ashlar', brick: 'running',
  timber: 'plank', log: 'board_batten',
};
const wallWorkOf = (ctx: CompileCtx): string | undefined => WALL_WORK[ctx.materials.walls];
export const ROOF_MAT: Record<string, Mat> = {
  thatch: 'thatch', hide: 'thatch', wood: 'timber', tile: 'tile', slate: 'stone', none: 'tile',
};
export const ROOF_KIND: Record<string, RoofKind> = {
  gable: 'gable',
  // Real distinct silhouettes (solids.ts wingRoof builds each as its own geometry).
  gambrel: 'gambrel', mansard: 'mansard', saltbox: 'saltbox', cross_gable: 'cross_gable',
  // Mono-pitch single-slope roofs (lean-to / shed / penthouse) — one plane, not a gable.
  lean_to: 'shed', shed: 'shed', mono_pitch: 'shed', penthouse: 'shed',
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

/** The door/window openings on a rect body, in absolute part coords, so the timber frame can
 *  break its rails/studs around them. Features arrive already resolved (halfW/height/sill
 *  filled) and perStorey-expanded, so upper-floor windows are included. */
function frameOpenings(p: ResolvedPart): FrameOpening[] {
  const out: FrameOpening[] = [];
  for (const f of p.features) {
    if (f.type !== 'window' && f.type !== 'door') continue;
    const face = (f.face ?? 'south') as WallFace;
    const halfW = f.params.halfW as number;
    const height = f.params.height as number;
    if (!(halfW > 0) || !(height > 0)) continue;
    const sill = (f.params.sill as number) ?? 0;   // a door has no sill param → sits on the ground
    const t = (f.params.t as number) ?? 0.5;
    const horiz = face === 'south' || face === 'north';
    const c = horiz ? p.at.x + t * p.size.w : p.at.y + t * p.size.h;
    out.push({ face, a0: c - halfW, a1: c + halfW, z0: sill, z1: sill + height });
  }
  return out;
}

function roundPrims(p: ResolvedPart, ctx: CompileCtx): Prim[] {
  const { w, h } = p.size;
  const r = Math.min(w, h) / 2, cx = w / 2 + p.at.x, cy = h / 2 + p.at.y;
  // Yurts are squat: the felt wall (khana) stands only a touch above the door, and the
  // dome is shallow. Anchor both to the door opening (not the fixed multi-storey STOREY, which
  // would render a 2.5×-door-tall wall), and decouple the dome rise from radius so WIDE yurts
  // stay shallow instead of ballooning into a tall hemisphere.
  const wallH = Math.max(1, p.params.levels as number) * DOOR_HEIGHT_TILES * 1.15;
  const out: Prim[] = [{
    prim: 'cylinder', center: [cx, cy], baseZ: 0, radius: r, height: wallH,
    material: wallMatOf(ctx), work: wallWorkOf(ctx),
    ...(ctx.palette?.walls ? { finish: ctx.palette.walls } : {}),
  }];
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
    out.push({ prim: 'box', at: [off + p.at.x, off + p.at.y, lvl * storeyTiles], size: [w, h, storeyTiles], material: mat, work: wallWorkOf(ctx) });
  }
  return out;
}

export const bodyPartType: PartType = {
  type: 'body',
  paramSchema: {
    plan: { kind: 'enum', values: ['rect', 'round', 'L', 'cross', 'stepped'], default: 'rect',
      doc: 'footprint shape: rect box, round (cylinder+cap, e.g. yurt), L/cross multi-wing, or stepped ziggurat tiers' },
    levels: { kind: 'number', min: 1, max: 8, default: 1, doc: 'number of storeys (wall height = levels × storey)' },
    levelInset: { kind: 'number', min: 0, max: 3, default: 0, doc: 'stepped plan only: tiles each tier insets from the one below' },
    storeyM: { kind: 'number', min: 0.5, max: 12, default: -1, doc: 'metres per storey; -1 = the standard 2.7 m storey' },
    jetty: { kind: 'number', min: 0, max: 0.3, default: 0,
      doc: 'tiles each upper storey oversails toward the street (+x/+y) — the jettied townhouse cue; 0.12 ≈ 24 cm/storey' },
    roofPitch: { kind: 'number', min: 0, max: 3, default: -1,
      doc: 'gable pitch (ridge rise = pitch × half-span); -1 = the standard steep 1.5. Lower = shallower/less-tall roof (≈1.0 is a 45° roof)' },
    baseCourse: { kind: 'number', min: 0, max: 2, default: 0,
      doc: 'height (tiles) of a stone base course at the wall foot (burgage undercroft under timber, or a shallow plinth); 0 = none' },
    frame: { kind: 'bool', default: false,
      doc: 'exposed timber frame (half-timbering): render posts/rails/studs as raised timber over plaster infill panels (rect plan). The infill wall switches to plaster.' },
    cutaway: { kind: 'bool', default: false,
      doc: 'render roof-off + floor exposed (the interior-reveal geometry); false = closed building' },
    interior: { kind: 'any',
      doc: 'connectome-derived InteriorPlan {partitions, floorDrop} drawn only in a cutaway; set by cutawayOf' },
    buttress: { kind: 'bool', default: false,
      doc: 'stepped buttresses between windows + at corners (rect plan) — the masonry-span cue for churches/tithe barns' },
    parapet: { kind: 'bool', default: false, doc: 'crenellated parapet around a FLAT roof (keeps/watch towers)' },
    roof: {
      kind: 'enum',
      values: [
        'flat', 'gable', 'hip', 'half_hip', 'conical', 'domed', 'stepped', 'lean_to',
        'shed', 'mono_pitch', 'penthouse',
        'gambrel', 'mansard', 'pyramidal', 'saltbox', 'onion', 'spire',
        'tented', 'jerkinhead', 'cross_gable',
      ],
      default: 'gable',
      doc: 'roof silhouette; a dormer/gabled-dormer feature needs a pitched roof (not flat)',
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
    const roofPitch = (p.params.roofPitch as number) ?? -1;
    const wings: Wing[] = bodyWings(p).map(r => ({
      x: r.x + p.at.x, y: r.y + p.at.y, w: r.w, h: r.h, storeys,
      storeyHeight: storeyTiles,
      roof: ROOF_KIND[p.params.roof as string] ?? 'gable',
      ...(jetty > 0 ? { jetty } : {}),
      ...(roofPitch > 0 ? { pitch: roofPitch } : {}),
    }));
    // L3b: a stone undercroft base course (tiles) under the wall material, derived for bodies
    // with a sub-grade zone (see connectome/form) — the burgage townhouse's stone storey.
    const baseCourse = (p.params.baseCourse as number) || 0;
    // Interior I-1: a cutaway body (roof off, floor exposed) — the interior-view geometry.
    const cutaway = !!(p.params.cutaway as number | boolean | undefined);
    // Exposed timber frame (half-timbering): the infill wall becomes PLASTER (cream panels)
    // and the structural frame is rendered as raised timber trim over it. Rect plan only.
    const framed = !cutaway && !!(p.params.frame) && plan === 'rect';
    const wallMat = framed ? 'plaster' : wallMatOf(ctx);
    const wallWork = framed ? undefined : wallWorkOf(ctx);
    // Interior I-3: the connectome-derived partition + funnel plan, only meaningful in a cutaway.
    const interior = p.params.interior as { partitions: number[]; floorDrop: number[]; screens?: boolean[]; levels?: number[] } | undefined;
    const building: Prim = {
      prim: 'building', wings,
      wallMat, roofMat: roofMatOf(ctx), roofStyle: 'gable',
      wallWork, features: {}, seed: 0,
      ...(ctx.palette?.walls ? { wallFinish: ctx.palette.walls } : {}),
      ...(ctx.palette?.roof ? { roofFinish: ctx.palette.roof } : {}),
      ...(baseCourse > 0 ? { baseCourse } : {}),
      ...(cutaway ? { cutaway: true } : {}),
      ...(cutaway && interior ? { interior } : {}),
    };
    // Trim (skipped in the cutaway — interior view wants the bare shell): buttresses on a
    // rect plan; a crenellated parapet only where the roof is genuinely flat.
    const trims: Prim[] = [];
    if (!cutaway) {
      const eaveH = storeys * storeyTiles;
      if (p.params.buttress && plan === 'rect') trims.push(...buttressPrims(p, wallMatOf(ctx), eaveH, wallWorkOf(ctx), ctx.palette?.walls));
      if (p.params.parapet && ROOF_KIND[p.params.roof as string] === 'flat') {
        trims.push(...parapetPrims(p, eaveH, wallMatOf(ctx), wallWorkOf(ctx), ctx.palette?.walls));
      }
      if (framed) trims.push(...framePrims(wings, baseCourse, frameOpenings(p)));
    }
    return [building, ...trims];
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
