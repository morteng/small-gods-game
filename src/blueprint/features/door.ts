// src/blueprint/features/door.ts
// The door opening. Size derives from the scale contract so it reads at villager height
// by construction. Rich semantics (hinge/swing/lock/open/hardware) are MODELLED as data
// now — they drive Fate narration, sim, and interaction; the rendered geometry is a thin
// flush leaf set into a carved recess (no protrusion).
import type { FeatureType } from '../registry';
import type { ResolvedFeature } from '../types';
import type { ApertureSpec } from './opening';
import type { Part as Prim } from '@/assetgen/compose';
import { DOOR_HEIGHT_TILES, DOOR_WIDTH_TILES } from '@/render/scale-contract';
import { leafBox } from '../wall-geometry';

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
    const leaf = leafBox(doorSpec(f), host);
    return [{ prim: 'box', at: leaf.at, size: leaf.size, material: 'door', ...(leaf.yaw !== undefined ? { yaw: leaf.yaw } : {}) }];
  },
};
