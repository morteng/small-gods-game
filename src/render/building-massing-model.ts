/**
 * Renderer-agnostic massing model derived from a BuildingDescriptor.
 *
 * One source of massing truth consumed by BOTH the topdown silhouette renderer
 * (`building-massing.ts`) and the isometric projector (`iso/iso-building.ts`),
 * so plan shape, roof kind, colours, door, stepped insets, and heights never
 * drift between the two views. Pure — no canvas, fully unit-testable.
 *
 * This is building-specific; it is deliberately NOT the general RenderViewModel
 * seam (that remains its own future project).
 */
import {
  buildingPalette, type BuildingDescriptor, type Plan, type Roof,
} from '@/world/building-descriptor';

export interface Massing {
  footprint: { w: number; h: number };
  plan: Plan;
  /** Number of stacked levels (≥1). */
  levels: number;
  /** Tiles each successive level insets per side (for `stepped` ziggurats). */
  levelInset: number;
  /** Total wall/body height, in tile-height units (`levels × heightPerLevel`). */
  bodyHeight: number;
  roof: Roof;
  /** Roof rise above the body, in tile-height units (0 for flat). */
  roofHeight: number;
  walls: string;
  roofColor: string;
  trim: string;
  door: { x: number; y: number };
}

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

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

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

export function buildingMassing(d: BuildingDescriptor): Massing {
  const pal = buildingPalette(d);
  const levels = Math.max(1, d.levels);
  return {
    footprint: { w: d.footprint.w, h: d.footprint.h },
    plan: d.plan,
    levels,
    levelInset: Math.max(0, d.levelInset),
    bodyHeight: levels * Math.max(0.1, d.heightPerLevel),
    roof: d.roof,
    roofHeight: roofRise(d.roof, d.footprint),
    walls: pal.walls,
    roofColor: pal.roof,
    trim: pal.trim,
    door: { x: d.door.x, y: d.door.y },
  };
}
