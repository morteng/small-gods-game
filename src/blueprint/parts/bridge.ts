// src/blueprint/parts/bridge.ts
// Parametric bridge pieces — deck, pier, arch — the structural vocabulary the crossing
// connectome already composes (detect-crossings → crossing-builder → realize-crossing).
// Each is a class-neutral part type emitting raw assetgen prims, so a bridge is just a
// composition of these the same way a building is a composition of wings: a log
// footbridge = deck + 2 piers; a stone viaduct = deck + arches + piers + parapet.
// The deck rides the authored deck elevation via the entity's `liftElev` (G4); piers
// stand from the riverbed up, billboarded from their foot like any building.
import type { Part } from '../types';
import type { PartType, CompileCtx, ResolveCtx } from '../registry';
import type { Mat } from '@/assetgen/types';
import type { Part as Prim } from '@/assetgen/compose';
import { mToTiles } from '@/render/scale-contract';
import { WALL_MAT } from './body';

type Dir = 'ns' | 'ew';

function matOf(ctx: CompileCtx): Mat {
  return WALL_MAT[ctx.materials.walls] ?? 'stone';
}

/** A deck segment — the running surface. Span axis `dir`; optional side parapets. */
export const deckPartType: PartType = {
  type: 'deck',
  paramSchema: {
    lengthM: { kind: 'number', min: 0.5, max: 60, default: 4 },
    widthM: { kind: 'number', min: 0.5, max: 20, default: 3 },
    thicknessM: { kind: 'number', min: 0.1, max: 3, default: 0.6 },
    dir: { kind: 'enum', values: ['ns', 'ew'], default: 'ns' },
    parapet: { kind: 'enum', values: ['none', 'both'], default: 'none' },
  },
  resolve: (part: Part) => ({ params: { ...(part.params ?? {}) } }),
  toPrims(p, ctx): Prim[] {
    const mat = matOf(ctx);
    const len = mToTiles((p.params.lengthM as number) ?? 4);
    const wid = mToTiles((p.params.widthM as number) ?? 3);
    const thick = mToTiles((p.params.thicknessM as number) ?? 0.6);
    const dir = (p.params.dir as Dir) ?? 'ns';
    // Local: span along the long axis, deck top at z=thick (underside at 0).
    const along = dir === 'ns' ? len : wid;   // y-extent
    const cross = dir === 'ns' ? wid : len;   // x-extent
    const out: Prim[] = [{ prim: 'box', at: [p.at.x, p.at.y, 0], size: [cross, along, thick], material: mat }];
    if ((p.params.parapet as string) === 'both') {
      const pH = mToTiles(0.9), pT = mToTiles(0.25);
      for (const s of [0, 1]) {
        const x = p.at.x + (s === 0 ? 0 : cross - pT);
        out.push({ prim: 'box', at: [x, p.at.y, thick], size: [pT, along, pH], material: mat });
      }
    }
    return out;
  },
  toCollision(p) {
    const cells: Array<[number, number]> = [];
    for (let i = 0; i < p.size.w; i++) for (let j = 0; j < p.size.h; j++) cells.push([p.at.x + i, p.at.y + j]);
    return cells;
  },
  toAnchors: () => [],
  toBrief(p) { return `${(p.params.parapet as string) === 'both' ? 'parapeted ' : ''}deck`; },
};

/** A pier — a vertical support standing from the riverbed up to the deck underside. */
export const pierPartType: PartType = {
  type: 'pier',
  paramSchema: {
    heightM: { kind: 'number', min: 0.3, max: 40, default: 3 },
    widthM: { kind: 'number', min: 0.3, max: 8, default: 1 },
    /** Top-vs-base taper, 0 = straight, 0.5 = top half the base width. */
    batter: { kind: 'number', min: 0, max: 0.6, default: 0 },
  },
  resolve: (part: Part) => ({ params: { ...(part.params ?? {}) } }),
  toPrims(p, ctx): Prim[] {
    const mat = matOf(ctx);
    const hM = (p.params.heightM as number) ?? 3;
    const w = mToTiles((p.params.widthM as number) ?? 1);
    const h = mToTiles(hM);
    const batter = (p.params.batter as number) ?? 0;
    const cx = p.at.x + w / 2, cy = p.at.y + w / 2;
    if (batter > 0) {
      // Tapered pier → a many-sided prism is the closest solid (square footprint read).
      return [{ prim: 'prism', center: [cx, cy], baseZ: 0, radius: w / 2, height: h, sides: 4, material: mat }];
    }
    return [{ prim: 'box', at: [p.at.x, p.at.y, 0], size: [w, w, h], material: mat }];
  },
  toCollision(p) { return [[p.at.x, p.at.y]]; },
  toAnchors: () => [],
  toBrief: () => 'pier',
};

/** A masonry arch between piers — uses the existing `arch` prim. */
export const archSpanPartType: PartType = {
  type: 'arch_span',
  paramSchema: {
    spanM: { kind: 'number', min: 0.5, max: 40, default: 4 },
    riseM: { kind: 'number', min: 0.3, max: 20, default: 2 },
    thicknessM: { kind: 'number', min: 0.2, max: 6, default: 1 },
  },
  resolve: (part: Part, _ctx: ResolveCtx) => ({ params: { ...(part.params ?? {}) } }),
  toPrims(p, ctx): Prim[] {
    const mat = matOf(ctx);
    return [{
      prim: 'arch',
      at: [p.at.x, p.at.y, 0],
      span: mToTiles((p.params.spanM as number) ?? 4),
      height: mToTiles((p.params.riseM as number) ?? 2),
      thickness: mToTiles((p.params.thicknessM as number) ?? 1),
      material: mat,
    }];
  },
  toCollision(p) { return [[p.at.x, p.at.y]]; },
  toAnchors: () => [],
  toBrief: () => 'arch',
};
