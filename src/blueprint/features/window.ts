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
  };
}

export const windowFeatureType: FeatureType = {
  type: 'window',
  paramSchema: {
    style: { kind: 'enum', values: ['plain', 'shuttered', 'arched'], default: 'plain' },
    glazed: { kind: 'bool', default: true },
    t: { kind: 'number', min: 0, max: 1, default: 0.5 },
    width: { kind: 'number', min: -1, max: 2, default: -1 },
    height: { kind: 'number', min: -1, max: 4, default: -1 },
    sill: { kind: 'number', min: 0, max: 3, default: WINDOW_SILL },
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
      },
    };
  },
  toBrief: (f) => `${f.params.style as string} window`,

  // ── opening hooks ──
  threshold: false,
  aperture: (f): ApertureSpec => windowSpec(f),
  filler: (f, host): Prim[] => {
    const pane = leafBox(windowSpec(f), host);   // a recessed dark pane reads as a glazed opening
    return [{ prim: 'box', at: pane.at, size: pane.size, material: 'door' }];
  },
};
