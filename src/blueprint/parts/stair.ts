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

/** Masonry/timber coursing for the flight body (steps + nosing + blocks): a dressed flight
 *  reads as ashlar, a cut-stone one as coursed rubble, a rough scramble as random rubble;
 *  a timber flight is boarded. Feeds the analytic surface engine (per-stone tone + relief) so
 *  the banded lighting has real coursing to shade instead of one flat grey face — the material
 *  channel does the variation, no lighting is painted into the albedo. */
function stairWork(mat: Mat, construction: number): string {
  if (mat === 'timber') return 'plank';
  if (mat === 'brick') return 'running';
  // Dressed + cut-stone flights read cleaner as regular ashlar coursing (irregular rubble
  // patterns alias into scribble on the small tread faces); only a rough scramble is rubble.
  return construction >= 0.34 ? 'ashlar' : 'random_rubble';
}
/** Dressed flanking work for the side cheeks — a stringer/parapet is dressed even when the
 *  treads are rough (coursed stone flank beside rubble steps; a vertical-board timber stringer). */
function cheekWork(mat: Mat): string {
  return mat === 'timber' ? 'plank_v' : mat === 'brick' ? 'running' : 'ashlar';
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
    const construction = clamp01((p.params.construction as number) ?? 0.5);
    const widthTiles = mToTiles((p.params.widthM as number) ?? 2);
    const runTiles = mToTiles(runM);
    const { ax, sign } = axis((p.params.dir as Dir) ?? 'south');
    const work = stairWork(mat, construction);
    const out: Prim[] = [];

    const baseX = p.at.x, baseY = p.at.y;
    const spanTiles = treads * runTiles;

    // One AABB in the flight's (along = climb axis, cross = width axis) frame → a world box.
    // Keeps every part below coordinate-frame-agnostic; only this helper knows the dir mapping.
    const box = (
      along0: number, alongLen: number, cross0: number, crossLen: number,
      z0: number, zTop: number, w: string, src: string,
    ): void => {
      const h = Math.max(1e-4, zTop - z0);
      const at: [number, number, number] = ax === 1
        ? [baseX + cross0, baseY + along0, z0]
        : [baseX + along0, baseY + cross0, z0];
      const size: [number, number, number] = ax === 1
        ? [crossLen, alongLen, h]
        : [alongLen, crossLen, h];
      out.push({ prim: 'box', at, size, material: mat, work: w, srcId: src });
    };

    const treadTop = (i: number) => mToTiles((i + 1) * riserM);
    const topZ = treadTop(treads - 1);
    // Each step's smaller-along edge (sign>0 → climbs toward +along; sign<0 → toward −along).
    const stepLo = (i: number) => (sign > 0 ? i * runTiles : spanTiles - (i + 1) * runTiles);
    // The step's foot-facing (downhill) edge — where its exposed riser drops toward the foot.
    const faceEdge = (i: number) => (sign > 0 ? i * runTiles : spanTiles - i * runTiles);

    // 1. STEPS — a solid coursed block per tread, grade → its tread top (full walking width).
    for (let i = 0; i < treads; i++) box(stepLo(i), runTiles, 0, widthTiles, 0, treadTop(i), work, 'flight');

    // 2. NOSING — a slightly proud lip at each tread's leading edge, overhanging the riser below.
    //    Its top face catches the band (a ~1–2 px highlight edge per step); its overhang shades
    //    the riser beneath (AO), so the step rhythm reads even at native zoom. Skipped on a rough
    //    scramble (no dressed nosing on hewn boulders).
    if (construction >= 0.2) {
      const noseProj = mToTiles(0.075), noseDrop = mToTiles(0.075), noseRaise = mToTiles(0.02);
      for (let i = 0; i < treads; i++) {
        const e = faceEdge(i);
        const along0 = sign > 0 ? e - noseProj : e;
        box(along0, noseProj, 0, widthTiles, treadTop(i) - noseDrop, treadTop(i) + noseRaise, work, 'flight/nose');
      }
    }

    // 3. SIDE CHEEKS — solid coursed flanks running the full climb so the flight has mass instead
    //    of floating steps. A dressed/cut stone or any timber flight gets them; a rough scramble
    //    keeps its bare hewn steps. A railed side (`railing`) grows its cheek into a raking parapet
    //    (masonry) or keeps a low stringer under timber balusters; an unrailed side stays a low
    //    stringer just proud of the treads.
    const railing = (p.params.railing as string) ?? 'none';
    const railSides = railing === 'both' ? [0, 1] : railing === 'one' ? [1] : [];
    const hasCheeks = mat === 'timber' || construction >= 0.34;
    const cheekW = mToTiles(0.34);
    const stringerFree = mToTiles(0.15), parapetFree = mToTiles(0.85);
    const cw = cheekWork(mat);
    if (hasCheeks) {
      for (const s of [0, 1]) {
        const cross0 = s === 0 ? -cheekW : widthTiles;
        const railed = railSides.includes(s);
        const parapet = railed && mat !== 'timber';           // masonry parapet vs low stringer
        const free = parapet ? parapetFree : stringerFree;
        const src = parapet ? 'flight/rail' : 'flight/cheek';
        for (let i = 0; i < treads; i++) box(stepLo(i), runTiles, cross0, cheekW, 0, treadTop(i) + free, cw, src);
      }
    }

    // 4. FOOT & HEAD BLOCKS — a low plinth seating the flight into the ground at its foot, and a
    //    coping at the head tucking into the slope it climbs, so the flight reads as built INTO
    //    the terrain rather than floating on it.
    const outerCross0 = hasCheeks ? -cheekW : 0;
    const outerCrossLen = widthTiles + (hasCheeks ? 2 * cheekW : 0);
    {
      const footProj = mToTiles(0.24), footH = mToTiles(0.34), footInset = runTiles * 0.6;
      const footEnd = sign > 0 ? 0 : spanTiles;
      const along0 = sign > 0 ? footEnd - footProj : footEnd - footInset;
      box(along0, footProj + footInset, outerCross0, outerCrossLen, 0, footH, work, 'flight/foot');
    }
    {
      const headProj = mToTiles(0.20), copeDrop = mToTiles(0.12), headInset = runTiles * 0.5;
      const headEnd = sign > 0 ? spanTiles : 0;
      const along0 = sign > 0 ? headEnd - headInset : headEnd - headProj;
      box(along0, headProj + headInset, outerCross0, outerCrossLen, topZ - copeDrop, topZ, work, 'flight/head');
    }

    // 5. TIMBER BALUSTERS — a wooden flight's railing is upright posts riding the stringer (a stone
    //    flight uses its raised parapet instead). Roughly one post per 1.2 m of run.
    if (mat === 'timber' && railSides.length) {
      const postR = mToTiles(0.055), postH = mToTiles(0.85);
      const everyTreads = Math.max(1, Math.round(mToTiles(1.2) / runTiles));
      for (const s of railSides) {
        const crossC = s === 0 ? -cheekW / 2 : widthTiles + cheekW / 2;
        for (let i = 0; i < treads; i += everyTreads) {
          const alongC = stepLo(i) + runTiles / 2;
          const z = treadTop(i) + stringerFree;
          const cx = ax === 1 ? baseX + crossC : baseX + alongC;
          const cy = ax === 1 ? baseY + alongC : baseY + crossC;
          out.push({ prim: 'cylinder', center: [cx, cy], baseZ: z, radius: postR, height: postH, material: mat, srcId: 'flight/post' });
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
