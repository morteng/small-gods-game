/**
 * LPC (Liberated Pixel Cup) universal-spritesheet animation table.
 *
 * The vendored character generator (`src/render/lpc/`) composites each NPC into
 * a single 64px-cell "universal sheet" whose rows follow the classic LPC layout
 * (spellcast at row 0, thrust 4, walk 8, slash 12, shoot 16, hurt 20). This
 * table is the single source of truth for which row/column a given animation +
 * direction + frame maps to — consumed by the renderer (`getSpriteCoords`) and
 * by the sim's movement system (frame advance + animation selection).
 *
 * Frame counts mirror the upstream `ANIMATION_CONFIGS` cycle arrays in
 * `src/render/lpc/state/constants.js` (verified against the vendored sheets).
 * Walk reserves column 0 as the idle stand (outside its 1..8 cycle); the action
 * animations start at column 0. `hurt` is the one non-directional row (the death
 * collapse faces south only in the LPC standard).
 *
 * Lives in `core/` so both `render/` and `sim/` can import it without crossing a
 * layer boundary (it is pure data — no DOM, no render deps).
 */
import type { Direction } from './types';

export type NpcAnimation = 'walk' | 'spellcast' | 'thrust' | 'slash' | 'shoot' | 'hurt';

export interface LpcAnimSpec {
  /** Row of the north-facing frame in the 64px universal sheet (×64 = sy). */
  readonly rowBase: number;
  /** First column of the cycle (walk's idle stand is column 0, before this). */
  readonly firstCol: number;
  /** Last column of the cycle (inclusive). */
  readonly lastCol: number;
  /** false → single non-directional row (hurt/death faces south only). */
  readonly directional: boolean;
  /** false → play once and hold the last frame (death does not loop). */
  readonly loop: boolean;
}

export const LPC_ANIMATIONS: Record<NpcAnimation, LpcAnimSpec> = {
  spellcast: { rowBase: 0,  firstCol: 0, lastCol: 6,  directional: true,  loop: true },
  thrust:    { rowBase: 4,  firstCol: 0, lastCol: 7,  directional: true,  loop: true },
  walk:      { rowBase: 8,  firstCol: 1, lastCol: 8,  directional: true,  loop: true },
  slash:     { rowBase: 12, firstCol: 0, lastCol: 5,  directional: true,  loop: true },
  shoot:     { rowBase: 16, firstCol: 0, lastCol: 12, directional: true,  loop: true },
  hurt:      { rowBase: 20, firstCol: 0, lastCol: 5,  directional: false, loop: false },
};

/** Direction → row offset from an animation's `rowBase` (LPC order: n,w,s,e). */
export const LPC_DIR_OFFSET: Record<Direction, number> = { up: 0, left: 1, down: 2, right: 3 };

/** Frames-per-second cadence for action animations (slightly snappier than walk). */
export const ACTION_FRAME_MS = 120;

/**
 * Advance `frame` one step within `anim`'s cycle. Looping animations wrap to
 * `firstCol`; non-looping ones hold at `lastCol`. Pure — caller owns the clock.
 */
export function nextFrame(anim: NpcAnimation, frame: number): number {
  const spec = LPC_ANIMATIONS[anim];
  if (frame >= spec.lastCol) return spec.loop ? spec.firstCol : spec.lastCol;
  return frame + 1;
}
