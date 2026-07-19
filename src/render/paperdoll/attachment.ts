/**
 * Attachment resolver — props pinned to animated limbs (an arrow stuck in a
 * shoulder, a held torch, a carried bucket) without being rasterized into the
 * 64px cell. The rig only tells us WHERE each prop's sprite should draw this
 * frame — position + rotation of a pin point riding the chip's world
 * transform — leaving the caller free to draw it as its own z-sorted quad
 * that can legally overhang the cell (a raised torch head above the hand,
 * a quiver's fletching past the shoulder).
 *
 * Pure, allocation-light math over `chipWorldTransforms` output — no raster,
 * no DOM, no GPU — so it composes with both the Node bake path and the
 * motion studio's live per-frame draw list.
 */
import { applyAffine, chipWorldTransforms, type Affine, type AnimTemplate, type ChipPose } from './rig';

/** A prop pinned to a chip: carried by the chip's world transform every frame. */
export interface Attachment {
  /** Chip name to ride (e.g. 'armR_fore'). */
  chip: string;
  /** Pin point in the chip's REST cell coordinates (same space as ChipDef.rect). */
  at: [number, number];
  /** Extra rotation of the prop sprite relative to the chip, degrees (default 0). */
  deg?: number;
  /** If true the prop keeps its authored upright orientation (ignores chip rotation) — e.g. a carried lantern that hangs. Default false. */
  keepUpright?: boolean;
}

/** Resolved placement in cell space: position of the pin point + final sprite rotation. */
export interface ResolvedAttachment {
  x: number;
  y: number;
  /** Degrees, clockwise-positive, y-down — same convention as ChipPose.deg. */
  deg: number;
}

/** Rotation component of an affine (degrees, cw-positive y-down). Assumes rigid transform (no shear/scale). */
export function affineRotationDeg(m: Affine): number {
  return (Math.atan2(m[3], m[0]) * 180) / Math.PI;
}

/**
 * Resolve attachments against a pose. Unknown chip names resolve to null (a
 * template variant may lack the chip — e.g. a one-armed statue). Pass a
 * precomputed `world` (from `chipWorldTransforms`) to avoid recomputation
 * when the caller already has it (e.g. right after `renderPose`).
 */
export function resolveAttachments(
  template: AnimTemplate,
  poses: readonly ChipPose[],
  attachments: readonly Attachment[],
  world?: readonly Affine[],
): (ResolvedAttachment | null)[] {
  const W = world ?? chipWorldTransforms(template, poses);
  return attachments.map((att) => {
    const ci = template.chips.findIndex((ch) => ch.name === att.chip);
    if (ci < 0) return null;
    const m = W[ci];
    const [x, y] = applyAffine(m, att.at[0], att.at[1]);
    const deg = (att.keepUpright ? 0 : affineRotationDeg(m)) + (att.deg ?? 0);
    return { x, y, deg };
  });
}
