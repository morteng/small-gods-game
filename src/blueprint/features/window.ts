// src/blueprint/features/window.ts
// The window opening. A raised, non-threshold aperture with a recessed pane. style/glazed
// are MODELLED (feed the brief) — the rendered geometry is a thin recessed pane.
import type { FeatureType } from '../registry';
import type { ResolvedFeature } from '../types';
import type { ApertureSpec } from './opening';
import type { ResolvedPart } from '../types';
import type { Part as Prim } from '@/assetgen/compose';
import type { Mat } from '@/assetgen/types';
import { leafBox, faceSpanBox, alongCentre, type FaceSpan } from '../wall-geometry';

const WINDOW_RECESS = 0.18;
const WINDOW_SILL = 0.4;       // raised off the ground (height-units)
const WINDOW_HALF_W = 0.18;    // narrower than a door
const WINDOW_HEIGHT = 0.55;

/** The carved-recess spec for a resolved window (shared by the aperture + filler hooks). */
function windowSpec(f: ResolvedFeature): ApertureSpec {
  return {
    face: f.face ?? 'south', t: f.params.t as number, sill: f.params.sill as number,
    halfW: f.params.halfW as number, height: f.params.height as number, depth: WINDOW_RECESS,
    // 'arched' carves a round head (K2); 'lancet' a tall Gothic POINTED head (church lights).
    ...(f.params.style === 'lancet' ? { arch: 'pointed' as const }
      : f.params.style === 'arched' ? { arch: 'round' as const } : {}),
  };
}

export const windowFeatureType: FeatureType = {
  type: 'window',
  paramSchema: {
    style: { kind: 'enum', values: ['plain', 'shuttered', 'arched', 'lancet'], default: 'plain',
      doc: 'opening shape: square, shuttered, round-arched, or tall narrow lancet' },
    glazed: { kind: 'bool', default: true, doc: 'glazed (wealthier) vs open/shuttered (crude)' },
    t: { kind: 'number', min: 0, max: 1, default: 0.5, doc: 'centre along the wall run (0..1)' },
    width: { kind: 'number', min: -1, max: 2, default: -1, doc: 'half-width along the wall (tiles); -1 = default' },
    height: { kind: 'number', min: -1, max: 4, default: -1,
      doc: 'opening height (tiles); -1 = default. Clamped under the eave — an over-tall value fires an eave-breach lint' },
    sill: { kind: 'number', min: 0, max: 3, default: WINDOW_SILL, doc: 'height of the sill above the floor (tiles)' },
    lightsWide: { kind: 'number', min: 1, max: 6, default: 2,
      doc: 'panes across (glazing-bar count = lightsWide−1). 1 = a single undivided light; more, smaller lights read as leaded/wealthier' },
    lightsHigh: { kind: 'number', min: 1, max: 6, default: 2,
      doc: 'panes tall (transom count = lightsHigh−1)' },
    perStorey: { kind: 'bool', default: false,
      doc: 'repeat this window at every upper storey sill (adding a floor adds its windows); false = author each level' },
  },
  resolve: (f) => {
    const p = f.params ?? {};
    const halfW = (p.width as number) >= 0 ? (p.width as number) : WINDOW_HALF_W;
    const height = (p.height as number) >= 0 ? (p.height as number) : WINDOW_HEIGHT;
    const glazed = p.glazed !== false;
    // Bars only make sense on a glazed light; an open/shuttered hole keeps a single opening.
    return {
      params: {
        style: (p.style as string) ?? 'plain',
        glazed,
        t: (p.t as number) ?? 0.5,
        halfW, height,
        sill: (p.sill as number) ?? WINDOW_SILL,
        lightsWide: glazed ? Math.max(1, Math.round((p.lightsWide as number) ?? 2)) : 1,
        lightsHigh: glazed ? Math.max(1, Math.round((p.lightsHigh as number) ?? 2)) : 1,
        perStorey: p.perStorey === true,
      },
    };
  },
  toBrief: (f) => `${f.params.style as string} window`,

  // ── opening hooks ──
  threshold: false,
  aperture: (f): ApertureSpec => windowSpec(f),
  filler: (f, host): Prim[] => {
    const s = windowSpec(f);
    const pane = leafBox(s, host);   // a recessed 'glass' pane: dark glazing by day, warm emissive at night
    const lightsWide = Math.max(1, Math.round((f.params.lightsWide as number) ?? 2));
    const lightsHigh = Math.max(1, Math.round((f.params.lightsHigh as number) ?? 2));
    return [
      { prim: 'box', at: pane.at, size: pane.size, material: 'glass', ...(pane.yaw !== undefined ? { yaw: pane.yaw } : {}) },
      ...windowTrim(s, host, lightsWide, lightsHigh),
    ];
  },
};

// ── window trim ─────────────────────────────────────────────────────────────────────────
// A sill + head lintel (stone, projecting proud of the wall) and a mullion cross (timber
// glazing bars over the pane) so a window READS as a window, not a blank dark hole. Flat
// wall faces only — a round body's openings keep the bare recessed pane.
const SILL_OVERHANG = 0.08;   // sill/lintel run this much wider than the opening, each side
const SILL_PROUD = 0.065;     // how far the ledge projects out past the wall plane (a shallow ledge)
const LINTEL_PROUD = 0.05;    // the head lintel projects a touch less than the sill
const BAR_HALF = 0.028;       // half-thickness of a glazing bar

function box(host: ResolvedPart, face: ApertureSpec['face'], sp: FaceSpan, material: Mat): Prim {
  const b = faceSpanBox(host, face, sp);
  return { prim: 'box', at: b.at, size: b.size, material };
}

function windowTrim(s: ApertureSpec, host: ResolvedPart, lightsWide: number, lightsHigh: number): Prim[] {
  if (host.params?.plan === 'round') return [];   // curved wall: trim axes wouldn't line up
  const c = alongCentre(host, s);
  const a0 = c - s.halfW, a1 = c + s.halfW;
  const zTop = s.sill + s.height;
  // Glazing bars sit at the pane, straddling the wall plane and standing PROUD enough to
  // catch the sun and cast a shadow line — otherwise a dark timber bar on dark glass
  // vanishes and the divided light reads as one blank pane.
  const barO: [number, number] = [-0.06, 0.06];
  const out: Prim[] = [
    // stone sill: a ledge under the opening, projecting out
    box(host, s.face, { a0: a0 - SILL_OVERHANG, a1: a1 + SILL_OVERHANG, z0: s.sill - 0.11, z1: s.sill + 0.03, o0: -0.06, o1: SILL_PROUD }, 'stone'),
  ];
  // Mullions (vertical) + transoms (horizontal) evenly divide the light into a pane grid.
  for (let i = 1; i < lightsWide; i++) {
    const a = a0 + (a1 - a0) * (i / lightsWide);
    out.push(box(host, s.face, { a0: a - BAR_HALF, a1: a + BAR_HALF, z0: s.sill, z1: zTop, o0: barO[0], o1: barO[1] }, 'timber'));
  }
  for (let j = 1; j < lightsHigh; j++) {
    const z = s.sill + s.height * (j / lightsHigh);
    out.push(box(host, s.face, { a0, a1, z0: z - BAR_HALF, z1: z + BAR_HALF, o0: barO[0], o1: barO[1] }, 'timber'));
  }
  // A square head gets a stone lintel; an arched/lancet head keeps its carved curve clean.
  if (!s.arch) {
    out.push(box(host, s.face, { a0: a0 - SILL_OVERHANG, a1: a1 + SILL_OVERHANG, z0: zTop - 0.03, z1: zTop + 0.08, o0: -0.06, o1: LINTEL_PROUD }, 'stone'));
  }
  return out;
}
