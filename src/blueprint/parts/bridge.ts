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

/** Base segment count a cambered (hump-backed) deck is built from; the actual count scales up
 *  with the hump so each step stays sub-perceptible (a steep short hump needs more segments than
 *  a shallow long one). A flat deck (camberM≈0) collapses to ONE slab, byte-identical. */
const DECK_CAMBER_SEGMENTS = 12;
/** Max per-step top rise (m) before we add segments — keeps the stair-stepping under the eye. */
const DECK_CAMBER_STEP_M = 0.12;

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
    // Deck-underside height above the part's z datum (m). 0 ⇒ foots at the datum (the historic
    // behaviour — the crossing pipeline lifts the whole entity via liftElev). A whole-bridge
    // OBJECT sets this to the arch-crown / pier-top height so the deck rides ON the supports
    // instead of plugging them. `any` (not number) so an unset caller stays byte-identical.
    baseZM: { kind: 'any', doc: 'deck-underside height above the part z datum (m); overrides nothing when unset' },
    // Hump: extra crown rise at mid-span (m), parabolic to 0 at the abutments. 0 ⇒ flat slab.
    camberM: { kind: 'any', doc: 'hump-back crown rise at mid-span (m); 0/unset ⇒ flat deck' },
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
    const baseZ = mToTiles((p.params.baseZM as number) ?? 0);  // deck underside above the datum
    const camber = mToTiles((p.params.camberM as number) ?? 0); // hump crown rise at mid-span
    const yaw = deckYaw(p.params);
    // The deck is centred on the part box, so a yawed slab stays inside the footprint AABB the
    // crossing sizes for it. Local frame: long axis +x (len), width +y (wid).
    const cx = p.at.x + (p.size?.w ?? len) / 2, cy = p.at.y + (p.size?.h ?? wid) / 2;
    const parapet = (p.params.parapet as string) === 'both';
    const pH = mToTiles(0.9), pT = mToTiles(0.25);
    const off = (wid - pT) / 2;   // parapet cross-offset from the centreline
    // A flat deck is ONE slab (segs=1, byte-identical to the historic single box). A cambered
    // deck is a short run of segments whose tops follow a shallow parabola (crown = camber at
    // mid-span, 0 at the abutments), so a hump-backed bridge reads without a curved-slab prim.
    // Scale segment count with the hump so each step's top rise stays under DECK_CAMBER_STEP_M —
    // the peak slope of the parabola is ~2·camber/(len/2), so steps ≈ camber·4/segs near the ends.
    const camberM = (p.params.camberM as number) ?? 0;
    const segs = camber > 1e-3
      ? Math.min(48, Math.max(DECK_CAMBER_SEGMENTS, Math.ceil((camberM * 4) / DECK_CAMBER_STEP_M)))
      : 1;
    const segLen = len / segs;
    const out: Prim[] = [];
    for (let i = 0; i < segs; i++) {
      const u = -len / 2 + (i + 0.5) * segLen;   // segment centre offset along the span
      const t = (2 * u) / len;                   // −1 … +1
      const z0 = baseZ + camber * (1 - t * t);   // parabolic hump top
      const [dx, dy] = rotXY(u, 0, yaw);
      out.push(yawedBox(cx + dx, cy + dy, segLen, wid, z0, thick, yaw, mat));
      if (parapet) {
        // The two parapets line the long edges: local cross-offset ±off from the centreline,
        // each riding the same segment top; rotating the offset by the SAME yaw seats them on
        // the slab edges at any bearing (cardinal or diagonal).
        for (const s of [-1, 1]) {
          const [ox, oy] = rotXY(u, s * off, yaw);
          out.push(yawedBox(cx + ox, cy + oy, segLen, pT, z0 + thick, pH, yaw, mat));
        }
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
    // Masonry ring depth above the intrados crown (m) — the voussoir band's substance. Unset ⇒
    // the arch prim's own default (0.35 cube = 0.7 m). A bridge sets this to make the arch ring
    // read as a proud archivolt; the caller must seat the deck at riseM + THIS so the crown still
    // meets the underside. `any` so an unset caller stays byte-identical.
    ringDepthM: { kind: 'any', doc: 'masonry ring depth above the intrados crown (m); unset ⇒ arch default 0.7 m' },
  },
  resolve: (part: Part, _ctx: ResolveCtx) => ({ params: { ...(part.params ?? {}) } }),
  toPrims(p, ctx): Prim[] {
    const mat = matOf(ctx);
    // `dir` (ew → 0°, ns → 90°) is the cardinal default; an explicit `yawDeg` carries the true
    // bank→bank bearing so the arch springs along a diagonal span, like the deck above it.
    const yaw = p.params.yawDeg !== undefined && p.params.yawDeg !== null
      ? Number(p.params.yawDeg)
      : (((p.params.dir as Dir) ?? 'ew') === 'ns' ? 90 : 0);
    const ringM = p.params.ringDepthM as number | undefined | null;
    return [{
      prim: 'arch',
      at: [p.at.x, p.at.y, 0],
      span: mToTiles((p.params.spanM as number) ?? 4),
      height: mToTiles((p.params.riseM as number) ?? 2),
      thickness: mToTiles((p.params.thicknessM as number) ?? 1),
      yaw,
      style: (p.params.style as ArchStyle) ?? 'round',
      // Pass ringDepth only when the caller opts in — omitted ⇒ the arch prim's own default.
      ...(ringM !== undefined && ringM !== null ? { ringDepth: mToTiles(ringM) } : {}),
      material: mat,
    }];
  },
  // An arch is an OPENING under the deck — blocking its springing cell would wall off the
  // very bridge tile traffic crosses on (deck and pier block nothing for the same reason).
  toCollision: () => [],
  toAnchors: () => [],
  toBrief: () => 'arch',
};

/** An abutment — the battered masonry end-block that grounds the span on its bank. Sits at a
 *  deck END, from the bed (datum) up to the deck underside, wider than the deck and flaring at the
 *  foot (the `batter`). Without it a composed span ends flush at the footprint edge and reads as
 *  a floating slab; the abutment gives the img2img pass masonry to land on the bank. Built as a
 *  short vertical stack of yawed boxes that taper from a wide foot to a deck-width top (a stepped
 *  batter — the same trick the cambered deck uses to avoid a curved-solid prim). */
const ABUT_STEP_M = 0.8;   // one batter step per ~this much height
export const abutmentPartType: PartType = {
  type: 'abutment',
  paramSchema: {
    heightM: { kind: 'number', min: 0.3, max: 20, default: 3 },   // bed → deck underside
    widthM: { kind: 'number', min: 0.5, max: 20, default: 3 },    // across the road (deck width)
    depthM: { kind: 'number', min: 0.3, max: 8, default: 1.5 },   // along the span (into the bank)
    /** Foot flare, 0 = straight, 0.3 = foot 30% wider than the top. */
    batter: { kind: 'number', min: 0, max: 0.6, default: 0.15 },
    dir: { kind: 'enum', values: ['ns', 'ew'], default: 'ew' },
    // TRUE span bearing °, CCW from +x; overrides `dir`. `any` so an unset caller keeps the dir bearing.
    yawDeg: { kind: 'any', doc: 'true bank→bank bearing °, CCW from +x; overrides dir' },
  },
  resolve: (part: Part) => ({ params: { ...(part.params ?? {}) } }),
  toPrims(p, ctx): Prim[] {
    const mat = matOf(ctx);
    const dep = mToTiles((p.params.depthM as number) ?? 1.5);   // along the span (local +x)
    const wid = mToTiles((p.params.widthM as number) ?? 3);     // across the road (local +y)
    const h = mToTiles((p.params.heightM as number) ?? 3);
    const batter = (p.params.batter as number) ?? 0.15;
    const heightM = (p.params.heightM as number) ?? 3;
    // `dir` (ew → 0°, ns → 90°) unless an explicit yawDeg carries the true bearing (as deck/arch do).
    const yaw = p.params.yawDeg !== undefined && p.params.yawDeg !== null
      ? Number(p.params.yawDeg)
      : (((p.params.dir as Dir) ?? 'ew') === 'ns' ? 90 : 0);
    const cx = p.at.x + (p.size?.w ?? dep) / 2, cy = p.at.y + (p.size?.h ?? wid) / 2;
    const steps = Math.max(2, Math.min(6, Math.ceil(heightM / ABUT_STEP_M)));
    const stepH = h / steps;
    const out: Prim[] = [];
    for (let i = 0; i < steps; i++) {
      const f = i / (steps - 1);             // 0 at the foot … 1 at the top
      const flare = 1 + batter * (1 - f);    // foot (1+batter) tapering to 1 at the top (deck width)
      // The stack centres on (cx,cy); a straight (unyawed) block leaves yaw 0 so it stays a plain box.
      out.push(yawedBox(cx, cy, dep * flare, wid * flare, i * stepH, stepH * 1.02, yaw, mat));
    }
    return out;
  },
  // Blocks no cell — the approach road terminates ON the span (deck/pier/arch do the same); the
  // abutment is the masonry mass under the deck end, not an obstacle in the road's path.
  toCollision: () => [],
  toAnchors: () => [],
  toBrief: () => 'abutment',
};
