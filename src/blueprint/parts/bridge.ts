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
import type { ArchStyle } from '@/assetgen/geometry/arch';
import { mToTiles } from '@/render/scale-contract';
import { WALL_MAT } from './body';

type Dir = 'ns' | 'ew';

function matOf(ctx: CompileCtx): Mat {
  return WALL_MAT[ctx.materials.walls] ?? 'stone';
}

/** Rotate a planar offset (lx,ly) by `deg` (CCW, the same convention `solidBoxYawed` /
 *  manifold's `rotate([0,0,deg])` uses), so a box placed at the rotated offset and given the
 *  SAME `yaw` lands flush on a yawed slab. */
function rotXY(lx: number, ly: number, deg: number): [number, number] {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [lx * c - ly * s, lx * s + ly * c];
}

/** A box centred at (cx,cy,z0) with planar size (sx,sy) and height h, yawed `deg` about its
 *  own centre — which is exactly the centre `solidBoxYawed` rotates around, so several such
 *  boxes (slab + parapets) at rotated offsets compose into one rigid yawed deck. */
function yawedBox(cx: number, cy: number, sx: number, sy: number, z0: number, h: number, deg: number, mat: Mat): Prim {
  return { prim: 'box', at: [cx - sx / 2, cy - sy / 2, z0], size: [sx, sy, h], yaw: deg || undefined, material: mat };
}

/** Back-compat: a cardinal `dir` maps to a yaw of the canonical local frame whose LONG axis is
 *  +x (east). `ew` keeps +x (yaw 0); `ns` rotates the long axis onto +y (yaw 90). A `yawDeg`
 *  param, when present, wins — it carries the crossing's TRUE bank→bank bearing so a deck spans
 *  a diagonal ford as one straight slab instead of snapping to a cardinal. */
function deckYaw(params: Record<string, unknown>): number {
  if (params.yawDeg !== undefined && params.yawDeg !== null) return Number(params.yawDeg);
  return ((params.dir as Dir) ?? 'ns') === 'ns' ? 90 : 0;
}

/** A deck segment — the running surface. Spans along its yaw (any angle); optional side parapets. */
export const deckPartType: PartType = {
  type: 'deck',
  paramSchema: {
    lengthM: { kind: 'number', min: 0.5, max: 60, default: 4 },
    widthM: { kind: 'number', min: 0.5, max: 20, default: 3 },
    thicknessM: { kind: 'number', min: 0.1, max: 3, default: 0.6 },
    dir: { kind: 'enum', values: ['ns', 'ew'], default: 'ns' },
    // TRUE span bearing in degrees (CCW from +x). Overrides `dir`; lets a deck go diagonal. `any`
    // (not `number`) so it stays UNSET when a caller passes only `dir` — a number default would be
    // injected and shadow the dir-based bearing.
    yawDeg: { kind: 'any', doc: 'true bank→bank bearing °, CCW from +x; overrides dir' },
    parapet: { kind: 'enum', values: ['none', 'both'], default: 'none' },
  },
  resolve: (part: Part) => ({ params: { ...(part.params ?? {}) } }),
  toPrims(p, ctx): Prim[] {
    const mat = matOf(ctx);
    const len = mToTiles((p.params.lengthM as number) ?? 4);   // along the span (local +x)
    const wid = mToTiles((p.params.widthM as number) ?? 3);    // across the road (local +y)
    const thick = mToTiles((p.params.thicknessM as number) ?? 0.6);
    const yaw = deckYaw(p.params);
    // The deck is centred on the part box, so a yawed slab stays inside the footprint AABB the
    // crossing sizes for it. Local frame: long axis +x (len), width +y (wid), top at z=thick.
    const cx = p.at.x + (p.size?.w ?? len) / 2, cy = p.at.y + (p.size?.h ?? wid) / 2;
    const out: Prim[] = [yawedBox(cx, cy, len, wid, 0, thick, yaw, mat)];
    if ((p.params.parapet as string) === 'both') {
      const pH = mToTiles(0.9), pT = mToTiles(0.25);
      // The two parapets line the long edges: local cross-offset ±(wid−pT)/2 from the centreline,
      // each a full-length box yawed to match the slab. Rotating the offset by the SAME yaw seats
      // them on the slab edges at any bearing (cardinal or diagonal).
      const off = (wid - pT) / 2;
      for (const s of [-1, 1]) {
        const [ox, oy] = rotXY(0, s * off, yaw);
        out.push(yawedBox(cx + ox, cy + oy, len, pT, thick, pH, yaw, mat));
      }
    }
    return out;
  },
  // A deck is a WALKABLE surface — the road crosses ON it — so it blocks no cells (traversal
  // rides the carved road/bridge tiles beneath; the deck is the massing above them).
  toCollision: () => [],
  toAnchors: () => [],
  toBrief(p) { return `${(p.params.parapet as string) === 'both' ? 'parapeted ' : ''}deck`; },
};

/** A pier — a vertical support standing from the riverbed up to the deck underside.
 *  A pier IS a (square) Column — it emits the kit's `column` prim so its batter is a
 *  TRUE taper (the old code faked it with a non-tapering 4-gon prism). `batter` maps to
 *  the column's diminution: top half-width = (1 − batter) × base. */
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
    const w = mToTiles((p.params.widthM as number) ?? 1);
    const h = mToTiles((p.params.heightM as number) ?? 3);
    const batter = (p.params.batter as number) ?? 0;
    const r = w / 2;
    return [{
      prim: 'column',
      center: [p.at.x + r, p.at.y + r],
      baseZ: 0,
      shape: 'square',
      radius: r,
      topRadius: r * (1 - batter),
      height: h,
      material: mat,
    }];
  },
  toCollision: () => [],   // stands in the watercourse below the deck — blocks no land cell
  toAnchors: () => [],
  toBrief: () => 'pier',
};

/** A masonry arch between piers — uses the existing `arch` prim. The arch frame springs along
 *  the deck's travel axis (`dir`): an ew span uses the native +x frame, an ns span yaws it 90°
 *  so the opening faces across the watercourse the way a real bridge arch does. */
export const archSpanPartType: PartType = {
  type: 'arch_span',
  paramSchema: {
    spanM: { kind: 'number', min: 0.5, max: 40, default: 4 },
    riseM: { kind: 'number', min: 0.3, max: 20, default: 2 },
    thicknessM: { kind: 'number', min: 0.2, max: 6, default: 1 },
    dir: { kind: 'enum', values: ['ns', 'ew'], default: 'ew' },
    // TRUE span bearing °, CCW from +x; overrides `dir` (lets the arch face a diagonal ford). `any`
    // so it stays unset when only `dir` is passed (a number default would shadow the dir bearing).
    yawDeg: { kind: 'any', doc: 'true bank→bank bearing °, CCW from +x; overrides dir' },
    // Arch head profile. Default `round` — a real curved ring, replacing the historic
    // square portal. `flat` keeps the post-and-lintel portal for any caller that wants it.
    style: { kind: 'enum', values: ['round', 'segmental', 'pointed', 'horseshoe', 'flat'], default: 'round' },
  },
  resolve: (part: Part, _ctx: ResolveCtx) => ({ params: { ...(part.params ?? {}) } }),
  toPrims(p, ctx): Prim[] {
    const mat = matOf(ctx);
    // `dir` (ew → 0°, ns → 90°) is the cardinal default; an explicit `yawDeg` carries the true
    // bank→bank bearing so the arch springs along a diagonal span, like the deck above it.
    const yaw = p.params.yawDeg !== undefined && p.params.yawDeg !== null
      ? Number(p.params.yawDeg)
      : (((p.params.dir as Dir) ?? 'ew') === 'ns' ? 90 : 0);
    return [{
      prim: 'arch',
      at: [p.at.x, p.at.y, 0],
      span: mToTiles((p.params.spanM as number) ?? 4),
      height: mToTiles((p.params.riseM as number) ?? 2),
      thickness: mToTiles((p.params.thicknessM as number) ?? 1),
      yaw,
      style: (p.params.style as ArchStyle) ?? 'round',
      material: mat,
    }];
  },
  toCollision(p) { return [[p.at.x, p.at.y]]; },
  toAnchors: () => [],
  toBrief: () => 'arch',
};
