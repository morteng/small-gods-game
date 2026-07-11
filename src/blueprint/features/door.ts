// src/blueprint/features/door.ts
// The door opening. Size derives from the scale contract so it reads at villager height
// by construction. Rich semantics (hinge/swing/lock/open/hardware) are MODELLED as data
// now — they drive Fate narration, sim, and interaction; the rendered geometry is a thin
// flush leaf set into a carved recess (no protrusion).
import type { FeatureType, CompileCtx } from '../registry';
import type { ResolvedFeature, ResolvedPart } from '../types';
import type { ApertureSpec } from './opening';
import type { Part as Prim } from '@/assetgen/compose';
import type { Mat, Vec3 } from '@/assetgen/types';
import { DOOR_HEIGHT_TILES, DOOR_WIDTH_TILES } from '@/render/scale-contract';
import { leafBox, faceSpanBox, alongCentre, FACE_FACING, type FaceSpan, type FaceBox } from '../wall-geometry';

const MAIN_SCALE = 1.18;   // a main entrance: modestly grander, still human-relative
const DOOR_RECESS = 0.3;   // recess (niche) depth — a door, not a see-through portal

/** The carved-recess spec for a resolved door (shared by the aperture + filler hooks). */
function doorSpec(f: ResolvedFeature): ApertureSpec {
  return {
    face: f.face ?? 'south', t: f.params.t as number, sill: 0,
    halfW: f.params.halfW as number, height: f.params.height as number, depth: DOOR_RECESS,
    // An arched doorway (the user's "arches occur in doorways too") — a round head.
    ...(f.params.arched ? { arch: 'round' as const } : {}),
  };
}

export const doorFeatureType: FeatureType = {
  type: 'door',
  paramSchema: {
    main: { kind: 'bool', default: false, doc: 'the primary entrance (drives the main pathing anchor)' },
    arched: { kind: 'bool', default: false, doc: 'round-headed doorway' },
    width: { kind: 'number', min: -1, max: 2, default: -1, doc: 'half-width along the wall (tiles); -1 = scale default' },
    height: { kind: 'number', min: -1, max: 4, default: -1, doc: 'door height (tiles); -1 = scale default' },
    t: { kind: 'number', min: 0, max: 1, default: 0.5, doc: 'centre along the wall run (0..1)' },
    hinge: { kind: 'enum', values: ['left', 'right'], default: 'left', doc: 'hinge side' },
    swing: { kind: 'enum', values: ['in', 'out', 'slide'], default: 'in', doc: 'how the leaf opens' },
    locked: { kind: 'bool', default: false, doc: 'starts locked (state)' },
    open: { kind: 'number', min: 0, max: 1, default: 0, doc: '0 shut … 1 wide open (state)' },
    handle: { kind: 'bool', default: true, doc: 'has a handle (hardware, shown at close zoom)' },
    lock: { kind: 'bool', default: false, doc: 'has a visible lock' },
    bell: { kind: 'bool', default: false, doc: 'has a bell' },
    knocker: { kind: 'bool', default: false, doc: 'has a knocker' },
  },
  resolve: (f) => {
    const p = f.params ?? {};
    const main = p.main === true;
    const grand = main ? MAIN_SCALE : 1;
    const halfW = (p.width as number) >= 0 ? (p.width as number) : (DOOR_WIDTH_TILES / 2) * grand;
    const height = (p.height as number) >= 0 ? (p.height as number) : DOOR_HEIGHT_TILES * grand;
    return {
      params: {
        main, halfW, height,
        arched: p.arched === true,
        t: (p.t as number) ?? 0.5,
        hinge: (p.hinge as string) ?? 'left',
        swing: (p.swing as string) ?? 'in',
        locked: p.locked === true,
        open: (p.open as number) ?? 0,
        handle: p.handle !== false,
        lock: p.lock === true,
        bell: p.bell === true,
        knocker: p.knocker === true,
      },
    };
  },
  toBrief: () => 'human-height door',

  // ── opening hooks ──
  threshold: true,
  aperture: (f): ApertureSpec => doorSpec(f),
  filler: (f, host, ctx): Prim[] => {
    const s = doorSpec(f);
    const leaf = leafBox(s, host);
    // The blueprint `open` param drives the swing by default (author it in the tree — a
    // door can simply BE open). The studio's ephemeral `featureStates` (click-to-open test
    // affordance, never a blueprint param) OVERRIDES it when present — including an explicit
    // `{open: 0}`, which shuts a param-opened door (`??` only falls through on null/undefined,
    // never on 0). `open` absent/0 either way ⇒ the leaf prim below is EXACTLY today's (the
    // `?? {}` yaw spread), so the default compile path — and the golden hashes — are byte-identical.
    const open = (ctx as CompileCtx | undefined)?.featureStates?.[`${host.id}/${f.id}`]?.open
      ?? (f.params.open as number) ?? 0;
    const swung = open > 0 && host.params?.plan !== 'round'
      ? swingLeaf(leaf, s, (f.params.hinge as string) ?? 'left', open)
      : null;
    const leafPrim: Prim = swung
      ? { prim: 'box', at: swung.at, size: leaf.size, material: 'door', yaw: swung.yaw }
      : { prim: 'box', at: leaf.at, size: leaf.size, material: 'door', ...(leaf.yaw !== undefined ? { yaw: leaf.yaw } : {}) };
    return [leafPrim, ...doorTrim(f, s, host)];
  },
};

// ── door-open interaction (studio testing affordance) ────────────────────────────────────────
// A real door swings on a VERTICAL hinge → a rotation about Z, which the box prim expresses as
// `yaw` (see `solidBoxYawed`). But `yaw` rotates a box about its OWN centre, whereas a leaf pivots
// on its hinge EDGE (one jamb). So we do the classic translate-to-hinge / rotate / translate-back,
// solved ANALYTICALLY so we still emit a single yawed box: if c0 is the closed leaf's centre (XY)
// and H the hinge point (XY), the yawed box's centre must land at H + R(θ)·(c0 − H) for the hinge
// edge to stay fixed — then back out `at = centre − size/2` (yaw rotates about at + size/2).
//
// We ALWAYS swing OUTWARD (toward the wall's outward normal), IGNORING the authored `swing`
// param: an inward leaf rotates into the dark carved interior and still reads as "shut" in the
// 2:1 iso view, whereas an outward leaf unmistakably stands proud. The dark aperture it uncovers
// already reads as a hole (the recess is carved into the wall). Round bodies keep the closed leaf
// (their leaf already carries a radial `yaw`; composing a second rotation isn't worth it here).
const OPEN_MAX_DEG = 100;   // open=1 ⇒ ~100°, a touch past square so the leaf clearly stands proud

/** The closed leaf box swung open on its hinge jamb by `open`∈(0..1]. Flat faces only (the caller
 *  guards `plan !== 'round'`). Returns the swung `at` + the `yaw` (degrees) to feed `solidBoxYawed`. */
function swingLeaf(leaf: FaceBox, s: ApertureSpec, hinge: string, open: number): { at: Vec3; yaw: number } {
  const facing = FACE_FACING[s.face ?? 'south'];               // outward wall normal (XY)
  const alongIdx = s.face === 'south' || s.face === 'north' ? 0 : 1;   // wall-run axis (x or y)
  const c0x = leaf.at[0] + leaf.size[0] / 2, c0y = leaf.at[1] + leaf.size[1] / 2;   // closed centre
  // Hinge = one jamb. door.ts places the handle on the hinge-OPPOSITE end, so hinge 'left' ⇒ the
  // LOW end of the wall-run span, 'right' ⇒ the HIGH end; the hinge's cross-axis coord = the leaf
  // centre (pivot on the leaf's mid-plane — the 8 cm leaf thickness makes the choice invisible).
  const H: [number, number] = [c0x, c0y];
  H[alongIdx] = hinge === 'left' ? leaf.at[alongIdx] : leaf.at[alongIdx] + leaf.size[alongIdx];
  const vx = c0x - H[0], vy = c0y - H[1];                      // hinge → leaf-centre (runs along the wall)
  // Sign of θ that GROWS the leaf's outward component: d/dθ (R(θ)·v · n)|₀ = (−v.y, v.x)·n.
  const dir = -vy * facing[0] + vx * facing[1] >= 0 ? 1 : -1;
  const yaw = OPEN_MAX_DEG * Math.max(0, Math.min(1, open)) * dir;
  const th = (yaw * Math.PI) / 180, cos = Math.cos(th), sin = Math.sin(th);
  const cx = H[0] + (vx * cos - vy * sin), cy = H[1] + (vx * sin + vy * cos);   // c' = H + R(θ)·v
  return { at: [cx - leaf.size[0] / 2, cy - leaf.size[1] / 2, leaf.at[2]], yaw };
}

// ── door trim ───────────────────────────────────────────────────────────────────────────
// A stone threshold step plus the modelled hardware (handle, and optionally lock/knocker/
// bell) rendered as small proud prims — so a door reads as a door, and its data-modelled
// hardware is actually visible. Flat wall faces only; a round body keeps the bare leaf.
function box(host: ResolvedPart, face: ApertureSpec['face'], sp: FaceSpan, material: Mat): Prim {
  const b = faceSpanBox(host, face, sp);
  return { prim: 'box', at: b.at, size: b.size, material };
}

function doorTrim(f: ResolvedFeature, s: ApertureSpec, host: ResolvedPart): Prim[] {
  if (host.params?.plan === 'round') return [];
  const p = f.params;
  const c = alongCentre(host, s);
  const a0 = c - s.halfW, a1 = c + s.halfW;
  const out: Prim[] = [
    // stone threshold: a low step across the doorway, projecting proud of the wall
    box(host, s.face, { a0: a0 - 0.05, a1: a1 + 0.05, z0: 0, z1: 0.09, o0: -0.06, o1: 0.16 }, 'stone'),
  ];
  // Handle: a small knob on the latch (hinge-opposite) side, at waist height.
  if (p.handle !== false) {
    const hz = s.sill + s.height * 0.46;
    const ha = p.hinge === 'left' ? a1 - 0.06 : a0 + 0.06;   // opposite the hinge
    out.push(box(host, s.face, { a0: ha - 0.026, a1: ha + 0.026, z0: hz - 0.03, z1: hz + 0.03, o0: 0, o1: 0.055 }, 'metal'));
    // Lock plate just below the handle.
    if (p.lock === true) out.push(box(host, s.face, { a0: ha - 0.05, a1: ha + 0.05, z0: hz - 0.20, z1: hz - 0.10, o0: 0, o1: 0.06 }, 'metal'));
  }
  // Knocker: centred on the upper leaf. Bell: high on the latch side.
  if (p.knocker === true) {
    const kz = s.sill + s.height * 0.72;
    out.push(box(host, s.face, { a0: c - 0.05, a1: c + 0.05, z0: kz - 0.05, z1: kz + 0.05, o0: 0, o1: 0.07 }, 'metal'));
  }
  if (p.bell === true) {
    const bz = s.sill + s.height * 0.82;
    const ba = p.hinge === 'left' ? a1 + 0.02 : a0 - 0.02;
    out.push(box(host, s.face, { a0: ba - 0.04, a1: ba + 0.04, z0: bz - 0.05, z1: bz + 0.05, o0: 0, o1: 0.07 }, 'metal'));
  }
  return out;
}
