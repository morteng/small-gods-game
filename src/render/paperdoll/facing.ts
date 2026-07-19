/**
 * Facing registry — maps the runtime's four-way `Direction` onto paper-doll
 * templates. South and north share one chip vocabulary (the back view reuses
 * the front's chip names, so every south clip plays on north unchanged —
 * pinned by paperdoll-north.test.ts). West is its own profile chip set
 * (near/far limbs), so profile clips are authored against WEST_CHIP_NAMES.
 * East is never authored: bake/render west, then `mirrorFrame` each finished
 * frame — pixel-perfect and free.
 *
 * Donor caveat for renderers: LPC sheets stack rows up(0)/left(1)/down(2)/
 * right(3); the layer rasters fed to renderPose must be sliced from the ROW
 * matching the facing (the templates describe the cell, not the sheet).
 */
import type { Direction } from '../../core/types';
import type { AnimTemplate } from './rig';
import { LPC_HUMANOID_SOUTH } from './lpc-humanoid';
import { LPC_HUMANOID_NORTH } from './lpc-humanoid-north';
import { LPC_HUMANOID_WEST } from './lpc-humanoid-west';

export interface FacingSpec {
  template: AnimTemplate;
  /** Render with the template, then horizontally mirror the finished frame. */
  mirror: boolean;
  /** LPC sheet row to slice layer cells from for this facing. */
  sheetRow: number;
}

export const HUMANOID_FACINGS: Record<Direction, FacingSpec> = {
  down: { template: LPC_HUMANOID_SOUTH, mirror: false, sheetRow: 2 },
  up: { template: LPC_HUMANOID_NORTH, mirror: false, sheetRow: 0 },
  left: { template: LPC_HUMANOID_WEST, mirror: false, sheetRow: 1 },
  // Mirrored WEST — LPC row 3 exists but mirroring keeps one authored
  // profile vocabulary instead of two.
  right: { template: LPC_HUMANOID_WEST, mirror: true, sheetRow: 1 },
};
