// src/blueprint/features/window.ts
// The window opening. A raised, non-threshold aperture with a recessed pane. style/glazed
// are MODELLED (feed the brief) — the rendered geometry is a thin recessed pane.
import type { FeatureType } from '../registry';
import type { ResolvedFeature } from '../types';
import type { ApertureSpec } from './opening';
import type { Part as Prim } from '@/assetgen/compose';
import { leafBox } from '../wall-geometry';

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
    perStorey: { kind: 'bool', default: false,
      doc: 'repeat this window at every upper storey sill (adding a floor adds its windows); false = author each level' },
  },
  resolve: (f) => {
    const p = f.params ?? {};
    const halfW = (p.width as number) >= 0 ? (p.width as number) : WINDOW_HALF_W;
    const height = (p.height as number) >= 0 ? (p.height as number) : WINDOW_HEIGHT;
    return {
      params: {
        style: (p.style as string) ?? 'plain',
        glazed: p.glazed !== false,
        t: (p.t as number) ?? 0.5,
        halfW, height,
        sill: (p.sill as number) ?? WINDOW_SILL,
        perStorey: p.perStorey === true,
      },
    };
  },
  toBrief: (f) => `${f.params.style as string} window`,

  // ── opening hooks ──
  threshold: false,
  aperture: (f): ApertureSpec => windowSpec(f),
  filler: (f, host): Prim[] => {
    const pane = leafBox(windowSpec(f), host);   // a recessed 'glass' pane: dark glazing by day, warm emissive at night
    return [{ prim: 'box', at: pane.at, size: pane.size, material: 'glass', ...(pane.yaw !== undefined ? { yaw: pane.yaw } : {}) }];
  },
};
