// src/blueprint/features/opening.ts
// The Opening feature family contract. An opening is a FeatureType that implements the
// opening hooks (threshold/aperture/filler). It describes a hole on a wall face plus a
// kind-specific filler (door leaf / window pane). Geometry is carved by wall-geometry.ts.
import type { FeatureType } from '../registry';
import type { WallFace } from '../types';
import type { ArchStyle } from '@/assetgen/geometry/arch';

/** The hole to subtract from a host wall, in part-local units. */
export interface ApertureSpec {
  face: WallFace;
  /** centre position along the wall run (0..1) and sill height (height-units). */
  t: number;
  sill: number;
  /** opening size: half-width along the wall (tiles) and height (height-units). */
  halfW: number;
  height: number;
  /** how deep to cut into the wall (a recess for door/window; full thickness for a portal). */
  depth: number;
  /** if set, the opening gets a curved head of this style instead of a square top (K2). */
  arch?: ArchStyle;
}

/** True if this feature kind is a wall opening (declares an aperture hook). */
export function isOpening(ft: FeatureType | undefined): ft is FeatureType & Required<Pick<FeatureType, 'aperture'>> {
  return !!ft && typeof ft.aperture === 'function';
}
