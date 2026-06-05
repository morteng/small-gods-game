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

/** Roof rise per kind, in tile-height units. Pitched roofs rise; flat ones don't. */
const ROOF_RISE: Record<Roof, number> = {
  flat: 0.12,
  lean_to: 0.3,
  gable: 0.7,
  hip: 0.55,
  conical: 1.1,
  domed: 0.8,
  stepped: 0.2,
};

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
    roofHeight: ROOF_RISE[d.roof] ?? 0.4,
    walls: pal.walls,
    roofColor: pal.roof,
    trim: pal.trim,
    door: { x: d.door.x, y: d.door.y },
  };
}
