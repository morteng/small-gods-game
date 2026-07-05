// src/blueprint/features/door.ts
// The door opening. Size derives from the scale contract so it reads at villager height
// by construction. Rich semantics (hinge/swing/lock/open/hardware) are MODELLED as data
// now — they drive Fate narration, sim, and interaction; the rendered geometry is a thin
// flush leaf set into a carved recess (no protrusion).
import type { FeatureType } from '../registry';
import type { ResolvedFeature, ResolvedPart } from '../types';
import type { ApertureSpec } from './opening';
import type { Part as Prim } from '@/assetgen/compose';
import type { Mat } from '@/assetgen/types';
import { DOOR_HEIGHT_TILES, DOOR_WIDTH_TILES } from '@/render/scale-contract';
import { leafBox, faceSpanBox, alongCentre, type FaceSpan } from '../wall-geometry';

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
  filler: (f, host): Prim[] => {
    const s = doorSpec(f);
    const leaf = leafBox(s, host);
    return [
      { prim: 'box', at: leaf.at, size: leaf.size, material: 'door', ...(leaf.yaw !== undefined ? { yaw: leaf.yaw } : {}) },
      ...doorTrim(f, s, host),
    ];
  },
};

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
    const ha = p.hinge === 'left' ? a1 - 0.07 : a0 + 0.07;   // opposite the hinge
    out.push(box(host, s.face, { a0: ha - 0.045, a1: ha + 0.045, z0: hz - 0.05, z1: hz + 0.05, o0: 0, o1: 0.09 }, 'metal'));
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
