// src/blueprint/parts/barrier.ts
// The kit's Barrier/defensive-line part — a single straight RUN of wall / rampart / palisade /
// fence / hedge, authored as a Blueprint part so a barrier rides the SAME blueprint → toGeometry
// → composeStructure → SpritePack → banded-PBR-lighting pipeline as a building. It emits the
// `linear` prim (a `BarrierRun`), whose believable defensive cross-section (battered plinth,
// wall-walk, crenellated parapet, pointed stakes, …) lives in `assetgen/geometry/linear.ts` so
// BOTH this preset path and the world's per-run chunk renderer share one geometry generator.
//
// This part is a STRAIGHT representative segment (the studio/preview subject + the unit a world
// run is tiled from). Multi-point rings + terrain-following live in the world barrier source,
// not here. Pure prim emission → inherits resolve → compile → manifold → SpritePack → lighting.
import type { Part } from '../types';
import type { PartType, CompileCtx, ResolveCtx } from '../registry';
import type { Part as Prim } from '@/assetgen/compose';
import { mToTiles } from '@/render/scale-contract';
import { BARRIER_DEFAULTS, type BarrierKind, type BarrierRun } from '@/world/barrier';

const KINDS: BarrierKind[] = ['wall', 'rampart', 'palisade', 'fence', 'barricade', 'hedge'];

/** The canonical BarrierRun.material string for a kind (what the linear geometry keys its
 *  construction family off). A param can override it (e.g. an earthen rampart vs a stone one). */
const KIND_MATERIAL: Record<BarrierKind, string> = {
  wall: 'stone', rampart: 'earth', palisade: 'timber', fence: 'timber', barricade: 'timber', hedge: 'hedge',
};

/** Build the straight `BarrierRun` this part describes (origin at `at`, running +x). */
export function barrierRunFromParams(at: { x: number; y: number }, params: Record<string, unknown>): BarrierRun {
  const kind = (KINDS.includes(params.kind as BarrierKind) ? params.kind : 'wall') as BarrierKind;
  const def = BARRIER_DEFAULTS[kind];
  const lengthU = mToTiles((params.lengthM as number) ?? 12);
  const heightM = (params.heightM as number) ?? 0;
  const thicknessTiles = (params.thicknessTiles as number) ?? 0;
  const gateWidthM = (params.gateWidthM as number) ?? 0;
  const material = (params.material as string) || KIND_MATERIAL[kind];
  const gateW = mToTiles(gateWidthM);
  return {
    kind,
    path: [[at.x, at.y], [at.x + lengthU, at.y]],
    height: heightM > 0 ? mToTiles(heightM) : def.height,
    thickness: thicknessTiles > 0 ? thicknessTiles : def.thickness,
    material,
    crenellated: (params.crenellated as boolean) ?? def.crenellated ?? false,
    posts: (params.posts as boolean) ?? def.posts ?? false,
    gates: gateW > 0 ? [{ t: lengthU / 2, width: gateW }] : [],
  };
}

export const barrierPartType: PartType = {
  type: 'barrier',
  paramSchema: {
    kind: { kind: 'enum', values: KINDS as unknown as string[], default: 'wall',
      doc: 'defensive-structure family: wall (masonry curtain), rampart (earthen bank), palisade (staked), fence, barricade, or living hedge — each picks its own default cross-section + construction' },
    lengthM: { kind: 'number', min: 2, max: 48, default: 12, doc: 'run length (metres; 1 tile = 2 m) — the wall/palisade is extruded along this line' },
    heightM: { kind: 'number', min: 0, max: 12, default: 0, doc: 'height (metres); 0 = the kind default (a tall town wall vs a low hedge)' },          // 0 = kind default
    thicknessTiles: { kind: 'number', min: 0, max: 4, default: 0, doc: 'wall thickness in tiles; 0 = the kind default (thick masonry vs a thin paling)' },    // 0 = kind default
    crenellated: { kind: 'bool', default: false, doc: 'merlon/crenel teeth along the top (masonry wall)' },
    posts: { kind: 'bool', default: false, doc: 'render the palisade stakes / fence posts (palisade & fence families)' },
    gateWidthM: { kind: 'number', min: 0, max: 8, default: 0, doc: 'gate opening cut through the run (metres); 0 = solid, no gate' },        // 0 = no gate
    material: { kind: 'enum', values: ['', 'stone', 'brick', 'timber', 'earth', 'hedge'], default: '',
      doc: "construction material; '' = the kind default (stone wall, timber palisade, hedge)" },
  },
  resolve: (part: Part, _ctx: ResolveCtx) => ({ params: { ...(part.params ?? {}) } }),
  toPrims(p, _ctx: CompileCtx): Prim[] {
    return [{ prim: 'linear', run: barrierRunFromParams(p.at, p.params) }];
  },
  // The world barrier (placeBarrier) owns its own A*-blocking footprint cells; a blueprint
  // barrier preset is a studio/preview subject, so it reserves no traversal cells here.
  toCollision: () => [],
  toAnchors: () => [],
  toBrief(p) { return `${(p.params.kind as string) ?? 'wall'} run`; },
};
