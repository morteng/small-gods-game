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

/** Thickness (m) of the roadway course laid on the deck — a surface course, not a second slab. */
const ROADWAY_COURSE_M = 0.12;

// Open post-and-rail parapet (`parapet:'rails'`) — the timber-bridge edge every TTI reference
// draws: square posts whose heads stand PROUD of a top handrail, with a mid rail below. Rails are
// per-segment boxes so they follow the deck camber the way the solid parapet does; posts are
// placed independently along the span, their feet on the parabola at their own station.
const RAIL_POST_W_M = 0.18;      // square post side
const RAIL_POST_H_M = 1.0;       // post height above the deck top (proud of the top rail)
const RAIL_POST_SPACING_M = 1.8; // one post roughly every this much span
const RAIL_BAR_T_M = 0.12;       // rail thickness across the deck edge
const RAIL_TOP_Z_M = 0.75;       // top handrail underside above the deck top
const RAIL_TOP_H_M = 0.1;
const RAIL_MID_Z_M = 0.35;       // mid rail underside above the deck top
const RAIL_MID_H_M = 0.08;

/** The road's running surface → the deck course that carries it (material + coursing). A masonry
 *  deck's own stone is the STRUCTURE; the road ON it is a distinct surface, and without one a
 *  bridge reads as a bare slab with the road stopping dead at each bank (the shipped bug). The
 *  keys are `RoadState.surfaceMaterial` — the same value the painted ribbon's pavedness comes
 *  from — so the surface that arrives at the bank is the surface that crosses. */
const ROADWAY_SURFACE: Record<string, { mat: Mat; work?: string }> = {
  dirt: { mat: 'earth' },
  gravel: { mat: 'earth', work: 'random_rubble' },
  cobble: { mat: 'stone', work: 'cobble' },
  paved: { mat: 'stone', work: 'ashlar' },
};

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
    // `both` = solid masonry parapet walls; `rails` = open post-and-rail (timber bridges — posts
    // proud of a top handrail + mid rail, the profile every wooden TTI reference draws).
    parapet: { kind: 'enum', values: ['none', 'both', 'rails'], default: 'none' },
    // The ROAD the deck carries (a `RoadState.surfaceMaterial`). Laid as a thin surface course
    // between the parapets, so the bridge visibly carries the road across instead of presenting a
    // bare structural slab. `any` (not enum) so an unset caller injects NO default and keeps the
    // bare deck byte-identical.
    roadway: { kind: 'any', doc: "running surface carried across: dirt|gravel|cobble|paved; unset ⇒ bare structural deck" },
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
    const rails = (p.params.parapet as string) === 'rails';
    const pH = mToTiles(0.9), pT = mToTiles(0.25);
    const off = (wid - pT) / 2;   // parapet cross-offset from the centreline
    const railT = mToTiles(RAIL_BAR_T_M);
    const railOff = (wid - railT) / 2;   // rail band cross-offset (on the deck edge)
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
    // The roadway course: the ROAD carried across, laid on the deck top between the parapets. The
    // terrain's painted ribbon deliberately stops at the banks (the ground under the span is the
    // carved channel bed, metres below the deck and under the water plane), so THIS is the road
    // where it crosses the water — without it the ribbon simply ends at the river.
    const road = ROADWAY_SURFACE[String(p.params.roadway ?? '')];
    const roadT = mToTiles(ROADWAY_COURSE_M);
    // Clear width between the parapets (a bare deck keeps a small verge either side).
    const roadW = parapet ? Math.max(0, wid - 2 * pT)
      : rails ? Math.max(0, wid - 2 * mToTiles(RAIL_POST_W_M))
      : wid * 0.9;
    const out: Prim[] = [];
    for (let i = 0; i < segs; i++) {
      const u = -len / 2 + (i + 0.5) * segLen;   // segment centre offset along the span
      const t = (2 * u) / len;                   // −1 … +1
      const z0 = baseZ + camber * (1 - t * t);   // parabolic hump top
      const [dx, dy] = rotXY(u, 0, yaw);
      out.push(yawedBox(cx + dx, cy + dy, segLen, wid, z0, thick, yaw, mat));
      if (road && roadW > 0) {
        out.push({
          ...yawedBox(cx + dx, cy + dy, segLen, roadW, z0 + thick, roadT, yaw, road.mat),
          ...(road.work ? { work: road.work } : {}),
        });
      }
      if (parapet) {
        // The two parapets line the long edges: local cross-offset ±off from the centreline,
        // each riding the same segment top; rotating the offset by the SAME yaw seats them on
        // the slab edges at any bearing (cardinal or diagonal).
        for (const s of [-1, 1]) {
          const [ox, oy] = rotXY(u, s * off, yaw);
          out.push(yawedBox(cx + ox, cy + oy, segLen, pT, z0 + thick, pH, yaw, mat));
        }
      }
      if (rails) {
        // Open rails ride the segment tops like the solid parapet does, so they follow the
        // camber: a top handrail + a mid rail per side, per segment.
        for (const s of [-1, 1]) {
          const [ox, oy] = rotXY(u, s * railOff, yaw);
          out.push(yawedBox(cx + ox, cy + oy, segLen, railT, z0 + thick + mToTiles(RAIL_TOP_Z_M), mToTiles(RAIL_TOP_H_M), yaw, mat));
          out.push(yawedBox(cx + ox, cy + oy, segLen, railT, z0 + thick + mToTiles(RAIL_MID_Z_M), mToTiles(RAIL_MID_H_M), yaw, mat));
        }
      }
    }
    if (rails) {
      // Posts are stationed along the span independent of the segmenting, each footed on the
      // camber parabola at its own station; taller than the top rail so the heads stand PROUD
      // (the square post-head silhouette every wooden reference shows).
      const postW = mToTiles(RAIL_POST_W_M);
      const nPosts = Math.max(1, Math.round(((p.params.lengthM as number) ?? 4) / RAIL_POST_SPACING_M));
      for (let k = 0; k <= nPosts; k++) {
        const u = Math.max(-len / 2 + postW / 2, Math.min(len / 2 - postW / 2, -len / 2 + (k / nPosts) * len));
        const t = (2 * u) / len;
        const z0 = baseZ + camber * (1 - t * t);
        for (const s of [-1, 1]) {
          const [ox, oy] = rotXY(u, s * railOff, yaw);
          out.push(yawedBox(cx + ox, cy + oy, postW, postW, z0 + thick, mToTiles(RAIL_POST_H_M), yaw, mat));
        }
      }
    }
    return out;
  },
  // A deck is a WALKABLE surface — the road crosses ON it — so it blocks no cells (traversal
  // rides the carved road/bridge tiles beneath; the deck is the massing above them).
  toCollision: () => [],
  toAnchors: () => [],
  toBrief(p) {
    const par = p.params.parapet as string;
    return `${par === 'both' ? 'parapeted ' : par === 'rails' ? 'railed ' : ''}deck`;
  },
};

/** A LOG — one horizontal ROUND timber (the `roundwood` prim): a real trunk with round
 *  flanks and end-grain ends, optionally tapered butt→tip, optionally adze-flattened on top
 *  so feet have somewhere to land while the sides stay round. The tier-0 crossing member the
 *  deck BOX could never be ("the log looks like a plank"). Pitched ±90° it doubles as a
 *  rustic round post/pier with the end grain facing up — the log-rail / bent vocabulary. */
export const logPartType: PartType = {
  type: 'log',
  paramSchema: {
    lengthM: { kind: 'number', min: 0.1, max: 40, default: 6 },
    /** Butt-end radius (m) — a generous trunk, not a pole. */
    radiusM: { kind: 'number', min: 0.02, max: 0.8, default: 0.3 },
    // Tip-end radius (m) — the natural taper. `any` so an unset caller emits an untapered
    // member (byte-identical to radiusM at both ends).
    tipRadiusM: { kind: 'any', doc: 'tip-end radius (m), < radiusM = natural taper; unset ⇒ no taper' },
    /** Axis-centre height above the part z datum (m) — the log RESTS with its underside at
     *  baseZM − radiusM, so seat it on blocks via baseZM = seatTop + radiusM. */
    baseZM: { kind: 'number', min: -10, max: 40, default: 0.5 },
    dir: { kind: 'enum', values: ['ns', 'ew'], default: 'ew' },
    // TRUE bearing °, CCW from +x; overrides `dir` (same convention as deck/arch/abutment).
    yawDeg: { kind: 'any', doc: 'true bearing °, CCW from +x; overrides dir' },
    // Incline °; positive lifts the far (+bearing) end. ±90 stands the log up as a post.
    pitchDeg: { kind: 'any', doc: 'incline °, + lifts the tip end; ±90 ⇒ a vertical post' },
    // Adze-flattened top: chord depth (m) cut from the crown in the log's own frame.
    flatDepthM: { kind: 'any', doc: 'hewn-flat top: chord depth (m) cut from the crown; unset ⇒ fully round' },
  },
  resolve: (part: Part) => ({ params: { ...(part.params ?? {}) } }),
  toPrims(p, ctx): Prim[] {
    const mat = matOf(ctx);
    const len = mToTiles((p.params.lengthM as number) ?? 6);
    const r = mToTiles((p.params.radiusM as number) ?? 0.3);
    const tipM = p.params.tipRadiusM as number | undefined | null;
    const flatM = p.params.flatDepthM as number | undefined | null;
    const pitchDeg = p.params.pitchDeg as number | undefined | null;
    // Centred on the part box (the deck convention), so yaw/pitch swing inside the footprint.
    const cx = p.at.x + (p.size?.w ?? len) / 2, cy = p.at.y + (p.size?.h ?? 1) / 2;
    return [{
      prim: 'roundwood',
      center: [cx, cy, mToTiles((p.params.baseZM as number) ?? 0.5)],
      length: len, radius: r,
      ...(tipM !== undefined && tipM !== null ? { tipRadius: mToTiles(tipM) } : {}),
      yawDeg: deckYaw(p.params),
      ...(pitchDeg !== undefined && pitchDeg !== null ? { pitchDeg: Number(pitchDeg) } : {}),
      ...(flatM !== undefined && flatM !== null ? { flatDepth: mToTiles(flatM) } : {}),
      material: mat,
    }];
  },
  // Walkable — traffic crosses ON the log (deck/pier/arch block nothing for the same reason).
  toCollision: () => [],
  toAnchors: () => [],
  toBrief: () => 'log',
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
    // A chunky square pile HEAD capping the column, headM tall and wider than the shaft — the
    // proud pile-head every timber-trestle reference draws. `any` so an unset caller (all
    // masonry piers, the historic path) emits the bare column, byte-identical.
    headM: { kind: 'any', doc: 'square pile-head cap height (m), ~1.4× the shaft width; unset ⇒ bare column' },
  },
  resolve: (part: Part) => ({ params: { ...(part.params ?? {}) } }),
  toPrims(p, ctx): Prim[] {
    const mat = matOf(ctx);
    const w = mToTiles((p.params.widthM as number) ?? 1);
    const h = mToTiles((p.params.heightM as number) ?? 3);
    const batter = (p.params.batter as number) ?? 0;
    const r = w / 2;
    const out: Prim[] = [{
      prim: 'column',
      center: [p.at.x + r, p.at.y + r],
      baseZ: 0,
      shape: 'square',
      radius: r,
      topRadius: r * (1 - batter),
      height: h,
      material: mat,
    }];
    const headM = p.params.headM as number | undefined | null;
    if (headM !== undefined && headM !== null && headM > 0) {
      const hw = w * 1.4;   // head sits proud of the shaft on every side
      out.push({ prim: 'box', at: [p.at.x + r - hw / 2, p.at.y + r - hw / 2, h], size: [hw, hw, mToTiles(headM)], material: mat });
    }
    return out;
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
    // Open RIB (no spandrel fill) — the timber moon-bridge member. `any` so an unset
    // caller (every masonry bridge) stays byte-identical.
    openRib: { kind: 'any', doc: 'true ⇒ open curved rib instead of a filled spandrel wall' },
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
      ...(p.params.openRib ? { open: true } : {}),
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
    // Pad base height above the part datum (m). Unset ⇒ 0 (the bed) — the classic full-height
    // block. A humble SEAT PAD sets baseZM = deckUnderside − heightM so the pad hangs under the
    // deck end and settles into the bank instead of towering up from the bed.
    baseZM: { kind: 'any', doc: 'base height above the part datum (m); unset ⇒ 0' },
    dir: { kind: 'enum', values: ['ns', 'ew'], default: 'ew' },
    // TRUE span bearing °, CCW from +x; overrides `dir`. `any` so an unset caller keeps the dir bearing.
    yawDeg: { kind: 'any', doc: 'true bank→bank bearing °, CCW from +x; overrides dir' },
  },
  resolve: (part: Part) => ({ params: { ...(part.params ?? {}) } }),
  toPrims(p, ctx): Prim[] {
    // Honour the part-level material override: `addAbutments` has always AUTHORED its
    // footings `material:'stone'` ("footings are ALWAYS dressed stone") but the compile
    // ignored it and used the recipe walls — a timber bridge rendered timber footings.
    // A part-level material now wins, so authored stone seats read as stone and a
    // deliberately material-less abutment (the plank-walk's timber sills) stays timber.
    const mat = WALL_MAT[p.material ?? ''] ?? matOf(ctx);
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
    const z0 = mToTiles(Number(p.params.baseZM ?? 0));
    const steps = Math.max(2, Math.min(6, Math.ceil(heightM / ABUT_STEP_M)));
    const stepH = h / steps;
    const out: Prim[] = [];
    for (let i = 0; i < steps; i++) {
      const f = i / (steps - 1);             // 0 at the foot … 1 at the top
      const flare = 1 + batter * (1 - f);    // foot (1+batter) tapering to 1 at the top (deck width)
      // The stack centres on (cx,cy); a straight (unyawed) block leaves yaw 0 so it stays a plain box.
      out.push(yawedBox(cx, cy, dep * flare, wid * flare, z0 + i * stepH, stepH * 1.02, yaw, mat));
    }
    return out;
  },
  // Blocks no cell — the approach road terminates ON the span (deck/pier/arch do the same); the
  // abutment is the masonry mass under the deck end, not an obstacle in the road's path.
  toCollision: () => [],
  toAnchors: () => [],
  toBrief: () => 'abutment',
};
