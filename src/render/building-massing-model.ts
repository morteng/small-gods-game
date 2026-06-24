/**
 * Roof rise model — the surviving slice of the old renderer-agnostic massing
 * model. `roofRise` is the single source of roof-height truth, now consumed by
 * the Blueprint brief compiler (`@/blueprint/compile/to-brief`). Pure — no
 * canvas, fully unit-testable.
 */
import { clamp } from '@/core/math';

/** Roof silhouette. Extend by adding a member + a profile in ROOF_PROFILES. */
export type Roof =
  | 'flat' | 'gable' | 'hip' | 'conical' | 'domed' | 'stepped' | 'lean_to'
  | 'gambrel' | 'mansard' | 'pyramidal' | 'saltbox' | 'onion' | 'spire'
  | 'tented' | 'jerkinhead' | 'cross_gable';

export type RoofMode = 'pitch' | 'target';
export interface RoofProfile {
  mode: RoofMode;
  /** rise per unit run, for mode 'pitch' */
  pitch?: number;
  /** run = full short span (single-slope, e.g. lean_to) instead of half-span */
  fullSpan?: boolean;
  /** rise = targetAspect × the footprint's long axis (max(w,h)), for mode 'target' */
  targetAspect?: number;
  minRise?: number;
  maxRise?: number;
}

/** Hybrid roof height model. All rises in tile-height units. */
export const ROOF_PROFILES: Record<Roof, RoofProfile> = {
  flat:       { mode: 'pitch', pitch: 0,    minRise: 0.12, maxRise: 0.12 },
  stepped:    { mode: 'pitch', pitch: 0,    minRise: 0.2,  maxRise: 0.2 },
  gable:      { mode: 'pitch', pitch: 0.55 },
  hip:        { mode: 'pitch', pitch: 0.5 },
  pyramidal:  { mode: 'pitch', pitch: 0.7 },
  jerkinhead: { mode: 'pitch', pitch: 0.5 },
  saltbox:    { mode: 'pitch', pitch: 0.6 },
  gambrel:    { mode: 'pitch', pitch: 0.75 },
  mansard:    { mode: 'pitch', pitch: 0.8 },
  cross_gable:{ mode: 'pitch', pitch: 0.6 },
  lean_to:    { mode: 'pitch', pitch: 0.4, fullSpan: true },
  conical:    { mode: 'target', targetAspect: 0.55 },
  domed:      { mode: 'target', targetAspect: 0.5 },
  onion:      { mode: 'target', targetAspect: 0.7 },
  spire:      { mode: 'target', targetAspect: 1.4 },
  tented:     { mode: 'target', targetAspect: 1.0 },
};

/** Roof rise above the body, in tile-height units, correct for footprint width. */
export function roofRise(roof: Roof, footprint: { w: number; h: number }): number {
  const p = ROOF_PROFILES[roof] ?? { mode: 'pitch' as const, pitch: 0.4 };
  const shortSpan = Math.min(footprint.w, footprint.h);
  if (p.mode === 'pitch') {
    const run = p.fullSpan ? shortSpan : shortSpan / 2;
    return clamp((p.pitch ?? 0.4) * run, p.minRise ?? 0.1, p.maxRise ?? 2.5);
  }
  const diameter = Math.max(footprint.w, footprint.h);
  return clamp((p.targetAspect ?? 0.5) * diameter, p.minRise ?? 0.3, p.maxRise ?? 4);
}
