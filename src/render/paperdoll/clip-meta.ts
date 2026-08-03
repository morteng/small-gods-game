/**
 * What an imported clip knows about the capture it came from.
 *
 * A `Clip` is pure pose data: angle tracks against a normalized t ∈ [0,1]. It
 * deliberately has no idea how fast it should play or how far the body it was
 * cut from actually travelled — that keeps the bake engine (`rig.ts`) free of
 * capture provenance, and hand-authored clips carry none of it.
 *
 * But the imported clips DO know, and until now they only knew it in a doc
 * comment. That made the one question M2 exists to answer unaskable in code:
 * an in-place walk's feet read as PLANTED only when the NPC's ground speed
 * matches the capture's stride ÷ duration, so anything wanting to judge — or
 * tune — foot contact has to be able to read that number.
 *
 * Leaf module: imports nothing, so the generated clip modules can pull the type
 * in without dragging the rig engine behind it.
 */

/** Capture-derived facts about one imported clip, in the rig's own units. */
export interface ImportedClipMeta {
  /** Vendored capture the clip was cut from, e.g. `104_02.bvh`. */
  readonly source: string;
  /** Wall-clock seconds the whole clip covers at capture speed. */
  readonly cycleSeconds: number;
  /**
   * Wall-clock ms ONE baked frame covers — `cycleSeconds` spread over the
   * frame intervals. Playing the clip at any other cadence retimes the motion;
   * that is allowed, but it is a decision, and this is the number it departs from.
   */
  readonly frameMs: number;
  /** Cell px the body travelled across the capture range. 0 for a clip in one spot. */
  readonly stridePx: number;
  /**
   * `stridePx / cycleSeconds` — the ground speed at which this clip's feet read
   * as planted, in cell px per second. 0 for a non-locomotion clip, which is a
   * real statement: such a clip should be played by an NPC standing still.
   */
  readonly groundSpeedPxPerSec: number;
  /** True when t=0 and t=1 sample identically, i.e. it can be looped. */
  readonly loop: boolean;
}

/** True when this clip describes travel, so its ground speed means something. */
export function isLocomotion(meta: ImportedClipMeta): boolean {
  return meta.groundSpeedPxPerSec > 0;
}

/**
 * Playback rate that makes an in-place locomotion clip's feet hold still at
 * `speedPxPerSec`, as a multiplier on the capture cadence (1 = capture speed).
 *
 * This is the whole foot-plant relationship in one line, and it runs BOTH ways:
 * retime the clip to the NPC, or move the NPC at the clip's speed. Neither is
 * privileged here — the studio shows the number and the caller decides.
 *
 * Returns 1 for a clip that does not travel: there is no skate to cancel, so
 * any rate is as planted as any other.
 */
export function rateForGroundSpeed(meta: ImportedClipMeta, speedPxPerSec: number): number {
  if (!isLocomotion(meta) || speedPxPerSec <= 0) return 1;
  return speedPxPerSec / meta.groundSpeedPxPerSec;
}
