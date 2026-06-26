// src/blueprint/parts/stair.ts
// Parametric stairs — "all kinds of stairs, the same way we support all kinds of
// buildings." A flight emits raw assetgen prims (stepped boxes + optional balustrade
// posts) through the class-neutral blueprint pipeline, so it inherits resolve →
// compile → manifold → SpritePack for free. Variety comes from params, not presets:
// the `construction` knob sweeps the spectrum scramble → cut-stone → dressed, exactly
// as `road-state.ts deriveRoadState` does for roads, and `material` picks timber /
// stone / brick. Switchbacks = multiple `stair_flight` + `landing` parts composed in
// one blueprint, just like a multi-wing building.
import type { Part } from '../types';
import type { PartType, CompileCtx, ResolveCtx } from '../registry';
import type { Mat } from '@/assetgen/types';
import type { Part as Prim } from '@/assetgen/compose';
import { mToTiles } from '@/render/scale-contract';
import { WALL_MAT } from './body';

/** Direction the flight climbs, in structure-local tiles. */
type Dir = 'north' | 'south' | 'east' | 'west';

/** Pure tread breakdown for a flight — shared by geometry, footprint and tests so the
 *  sprite, collision footprint and any siting logic agree on the run length. The
 *  `construction` knob (0 rough → 1 dressed) gives a steeper/rougher or gentler/finer
 *  flight; an explicit `treads` count overrides the rise-derived one. */
export function stairTreads(params: {
  riseM?: number; treads?: number; construction?: number;
}): { treads: number; riserM: number; runM: number; riseM: number } {
  const construction = clamp01(params.construction ?? 0.5);
  // Rough scrambles climb in tall, shallow lunges; dressed stairs in low, deep steps.
  const riserM = lerp(0.30, 0.15, construction);
  const runM = lerp(0.30, 0.38, construction);
  const riseM = Math.max(riserM, params.riseM ?? 1.8);
  const treads = Math.max(1, params.treads ?? Math.round(riseM / riserM));
  return { treads, riserM: riseM / treads, runM, riseM };
}

/** Footprint (tiles) a flight needs along its climb axis, so presets can size to fit. */
export function stairFootprint(params: { riseM?: number; treads?: number; construction?: number; widthM?: number; }): { w: number; h: number } {
  const { treads, runM } = stairTreads(params);
  const runTiles = Math.max(1, Math.ceil(mToTiles(treads * runM)));
  const widthTiles = Math.max(1, Math.ceil(mToTiles(params.widthM ?? 2)));
  return { w: widthTiles, h: runTiles };
}

function matOf(ctx: CompileCtx): Mat {
  return WALL_MAT[ctx.materials.walls] ?? 'stone';
}

/** Step offset per tread along the climb axis (local tiles, signed) for a direction. */
function axis(dir: Dir): { ax: 0 | 1; sign: 1 | -1 } {
  switch (dir) {
    case 'north': return { ax: 1, sign: -1 };  // climbs toward -y
    case 'south': return { ax: 1, sign: 1 };   // climbs toward +y
    case 'west':  return { ax: 0, sign: -1 };
    case 'east':  return { ax: 0, sign: 1 };
  }
}

export const stairFlightPartType: PartType = {
  type: 'stair_flight',
  paramSchema: {
    /** Total vertical rise in metres (drives tread count unless `treads` is set). */
    riseM: { kind: 'number', min: 0.3, max: 40, default: 1.8 },
    /** Explicit tread count (overrides the rise-derived one). */
    treads: { kind: 'number', min: 1, max: 200, default: -1 },
    /** Running width in metres. */
    widthM: { kind: 'number', min: 0.6, max: 12, default: 2 },
    /** 0 = rough scramble (tall steep steps) → 1 = dressed accessible (low deep steps). */
    construction: { kind: 'number', min: 0, max: 1, default: 0.5 },
    /** Climb direction in structure-local space. */
    dir: { kind: 'enum', values: ['north', 'south', 'east', 'west'], default: 'south' },
    /** Balustrade: none / one side / both sides. */
    railing: { kind: 'enum', values: ['none', 'one', 'both'], default: 'none' },
  },
  resolve: (part: Part, _ctx: ResolveCtx) => {
    const p = { ...(part.params ?? {}) };
    if ((p.treads as number) === -1) delete p.treads;  // -1 sentinel → rise-derived
    return { params: p };
  },
  toPrims(p, ctx): Prim[] {
    const { treads, riserM, runM } = stairTreads(p.params as never);
    const mat = matOf(ctx);
    const widthTiles = mToTiles((p.params.widthM as number) ?? 2);
    const runTiles = mToTiles(runM);
    const { ax, sign } = axis((p.params.dir as Dir) ?? 'south');
    const out: Prim[] = [];

    // Origin: when climbing toward -axis, anchor at the far edge so steps march inward.
    const baseX = p.at.x;
    const baseY = p.at.y;
    const spanTiles = treads * runTiles;
    const startAlong = sign > 0 ? 0 : spanTiles;  // local along-axis start of tread 0

    for (let i = 0; i < treads; i++) {
      const stepTopTiles = mToTiles((i + 1) * riserM);   // solid step rises from ground
      const a0 = startAlong + sign * (i * runTiles) - (sign < 0 ? runTiles : 0);
      const at: [number, number, number] = ax === 1
        ? [baseX, baseY + a0, 0]
        : [baseX + a0, baseY, 0];
      const size: [number, number, number] = ax === 1
        ? [widthTiles, runTiles, stepTopTiles]
        : [runTiles, widthTiles, stepTopTiles];
      out.push({ prim: 'box', at, size, material: mat });
    }

    const railing = (p.params.railing as string) ?? 'none';
    if (railing !== 'none') {
      const postR = mToTiles(0.06);
      const postH = mToTiles(0.95);
      const sides = railing === 'both' ? [0, 1] : [1];  // 'one' = the +cross side
      const crossLen = widthTiles;
      // A post roughly every 1.2 m of run, riding each tread top.
      const everyTreads = Math.max(1, Math.round(mToTiles(1.2) / runTiles));
      for (let i = 0; i < treads; i += everyTreads) {
        const along = startAlong + sign * (i * runTiles) - (sign < 0 ? runTiles : 0) + sign * runTiles / 2;
        const z = mToTiles((i + 1) * riserM);
        for (const s of sides) {
          const cross = s === 0 ? 0 : crossLen;
          const cx = ax === 1 ? baseX + cross : baseX + along;
          const cy = ax === 1 ? baseY + along : baseY + cross;
          out.push({ prim: 'cylinder', center: [cx, cy], baseZ: z, radius: postR, height: postH, material: mat });
        }
      }
    }
    return out;
  },
  toCollision(p) {
    const { w, h } = stairFootprint(p.params as never);
    const cells: Array<[number, number]> = [];
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) cells.push([p.at.x + i, p.at.y + j]);
    return cells;
  },
  toAnchors(p) {
    const { w, h } = stairFootprint(p.params as never);
    const { ax, sign } = axis((p.params.dir as Dir) ?? 'south');
    // Foot (ground) and head (top) anchors so paths can connect to a flight.
    const footAlong = sign > 0 ? 0 : (ax === 1 ? h : w);
    const headAlong = sign > 0 ? (ax === 1 ? h : w) : 0;
    const mid = (ax === 1 ? w : h) / 2;
    const facing: [number, number] = ax === 1 ? [0, sign] : [sign, 0];
    return [
      { kind: 'stair_foot', x: p.at.x + (ax === 1 ? mid : footAlong), y: p.at.y + (ax === 1 ? footAlong : mid), facing: [-facing[0], -facing[1]] as [number, number], main: true },
      { kind: 'stair_head', x: p.at.x + (ax === 1 ? mid : headAlong), y: p.at.y + (ax === 1 ? headAlong : mid), facing },
    ];
  },
  toBrief(p) {
    const { treads } = stairTreads(p.params as never);
    const c = clamp01((p.params.construction as number) ?? 0.5);
    const grade = c < 0.34 ? 'rough-hewn' : c < 0.67 ? 'cut-stone' : 'dressed';
    const rail = (p.params.railing as string) ?? 'none';
    return [`${grade} stair`, `${treads} steps`, rail !== 'none' ? `${rail} balustrade` : ''].filter(Boolean).join(', ');
  },
};

/** A flat platform — a stair landing or switchback turn. Pure box. */
export const landingPartType: PartType = {
  type: 'landing',
  paramSchema: {
    widthM: { kind: 'number', min: 0.6, max: 20, default: 2 },
    depthM: { kind: 'number', min: 0.6, max: 20, default: 2 },
    /** Top surface height above ground (where the flight below ends). */
    elevM: { kind: 'number', min: 0, max: 40, default: 0 },
    thicknessM: { kind: 'number', min: 0.1, max: 4, default: 0.4 },
  },
  resolve: (part: Part) => ({ params: { ...(part.params ?? {}) } }),
  toPrims(p, ctx): Prim[] {
    const mat = matOf(ctx);
    const w = mToTiles((p.params.widthM as number) ?? 2);
    const d = mToTiles((p.params.depthM as number) ?? 2);
    const elev = mToTiles((p.params.elevM as number) ?? 0);
    const thick = mToTiles((p.params.thicknessM as number) ?? 0.4);
    return [{ prim: 'box', at: [p.at.x, p.at.y, Math.max(0, elev - thick)], size: [w, d, Math.max(thick, elev || thick)], material: mat }];
  },
  toCollision(p) {
    const cells: Array<[number, number]> = [];
    for (let i = 0; i < p.size.w; i++) for (let j = 0; j < p.size.h; j++) cells.push([p.at.x + i, p.at.y + j]);
    return cells;
  },
  toAnchors: () => [],
  toBrief: () => 'landing',
};

function clamp01(n: number): number { return n < 0 ? 0 : n > 1 ? 1 : n; }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
