/**
 * Paper-doll flora rig — precomputed wind-sway spritesheet loops for ground
 * vegetation (grass tufts, wildflowers). Reuses the SAME template-agnostic rig
 * as the humanoid paper-doll (`rig.ts`): a flora sprite's blades are chips
 * pivoted at the soil line, keyframed into a seamlessly looping clip and baked
 * with `bakeClip` — pixel-perfect frames replace the GPU's per-vertex ribbon
 * bend (`render/gpu/grass-scatter.ts`) for clutter that reads at a fixed
 * camera distance and doesn't need continuous simulation.
 *
 * Geometry only — no sprite rasters live here. The demo species below give
 * chip rects/pivots against a synthesized 32×32 tuft/flower (see
 * `tmp/flora-wind-bake.ts`); the real clutter atlas is TTI-sourced and sliced
 * by `scripts/slice-clutter-sprites.ts`, whose cell grid a production flora
 * template would slice instead.
 */
import type { AnimTemplate, ChipDef, ChipRect, Clip, Keyframe } from './rig';

/** One bendable element of a flora sprite: a blade/stem chip pivoted at the soil. */
export interface FloraBlade {
  /** Slice rect in cell coords. Blades may NOT overlap each other (rig rects scoop). */
  rect: ChipRect;
  /** Pivot at the blade's rooting point (soil line). */
  pivot: [number, number];
  /** Sway phase offset in [0,1) — de-syncs blades within the tuft. */
  phase?: number;
  /** Sway amplitude multiplier (default 1) — tall blades bend more than short. */
  gain?: number;
}

/**
 * Build an AnimTemplate for a flora sprite: chip 0 is the root (everything
 * not a blade — soil clutter, a flower head that stays rigid unless it is
 * itself given a blade), then one chip per blade, parented to root, named
 * 'blade0'…'bladeN' in list order. All blade chips share z 1 (paint order
 * among them follows list order via the rig's stable z-sort).
 */
export function floraTemplate(name: string, cell: number, blades: readonly FloraBlade[]): AnimTemplate {
  const chips: ChipDef[] = [
    { name: 'root', rect: { x: 0, y: 0, w: cell, h: cell }, pivot: [cell / 2, cell - 1], parent: -1, z: 0 },
  ];
  for (let i = 0; i < blades.length; i++) {
    const b = blades[i];
    chips.push({ name: `blade${i}`, rect: b.rect, pivot: b.pivot, parent: 0, z: 1 });
  }
  return { name, cell, chips };
}

/** Keyframe times per wind cycle — 5 samples/cycle; the rig's smoothstep between
 *  keys approximates the sine closely enough at this density. */
const WIND_KEY_T = [0, 0.25, 0.5, 0.75] as const;

/**
 * Build a SEAMLESSLY LOOPING wind-sway clip for a template built by
 * `floraTemplate`. Blade i (phase p, gain g) gets a cyclic angle track:
 *
 *   deg(t) = g × amplitudeDeg × sin(2π(t + p))
 *
 * sampled at t = 0, .25, .5, .75. Per-blade phase is applied by ROTATING the
 * key VALUES through the shifted sine (not by shifting key times), so every
 * blade shares the same keyframe grid. Mathematically sin(2π(0+p)) equals
 * sin(2π(1+p)) for every p — but IEEE double `Math.sin` on the two DIFFERENT
 * arguments `2π·p` vs `2π·(1+p)` can differ in the last bit. So the t=1 key
 * is not recomputed: it's a literal copy of the t=0 key's `deg`, which makes
 * loop closure an exact, bit-for-bit guarantee rather than a floating-point
 * near-miss.
 */
export function floraWindClip(
  template: AnimTemplate,
  blades: readonly FloraBlade[],
  frames: number,
  amplitudeDeg: number,
): Clip {
  const tracks: Record<string, Keyframe[]> = {};
  for (let i = 0; i < blades.length; i++) {
    const b = blades[i];
    const phase = b.phase ?? 0;
    const gain = b.gain ?? 1;
    const keys: Keyframe[] = WIND_KEY_T.map((t) => ({
      t,
      deg: gain * amplitudeDeg * Math.sin(2 * Math.PI * (t + phase)),
    }));
    keys.push({ t: 1, deg: keys[0].deg }); // exact copy — see closure note above
    tracks[`blade${i}`] = keys;
  }
  return { name: `${template.name}-wind`, frames, tracks };
}

/**
 * Demo species: a 5-blade grass tuft, authored for a 32×32 cell (matches the
 * synthesized bake sprite in `tmp/flora-wind-bake.ts`). Blade rects are 3px-
 * wide non-overlapping columns fanning from a shared soil line at row 29
 * (pivot row constant across blades; only the rect's top edge — i.e. blade
 * height — varies). Center blade is tallest; heights taper outward.
 *
 * Phase/gain are hand-authored, not derived: gain scales with blade height
 * (taller blades bend more), and the tallest (center) blade gets phase +0.08
 * over its neighbors — a hand-placed follow-through offset (a tall blade's
 * extra mass reads as trailing the shorter ones a beat into the gust) rather
 * than a per-clip coupling, since flora chips have no shared parent chain to
 * couple through the way limbs do.
 */
export const GRASS_TUFT_BLADES: readonly FloraBlade[] = [
  { rect: { x: 7, y: 16, w: 3, h: 14 }, pivot: [8, 29], phase: 0, gain: 0.55 },
  { rect: { x: 11, y: 10, w: 3, h: 20 }, pivot: [12, 29], phase: 0.15, gain: 0.8 },
  { rect: { x: 15, y: 4, w: 3, h: 26 }, pivot: [16, 29], phase: 0.3 + 0.08, gain: 1 },
  { rect: { x: 19, y: 10, w: 3, h: 20 }, pivot: [20, 29], phase: 0.45, gain: 0.8 },
  { rect: { x: 23, y: 16, w: 3, h: 14 }, pivot: [24, 29], phase: 0.6, gain: 0.55 },
];

/**
 * Demo species: a single wildflower, also authored for a 32×32 cell. Two
 * blades — the stem+head sways as one rigid unit (the head rides along
 * because its pixels sit inside the stem chip's rect, not because it is
 * coupled), and one of the two base leaves gets its own, slightly later-
 * phased blade for a touch of compound motion. The OTHER leaf stays in the
 * root chip (rigid clutter) — flowers don't need every part animated.
 */
export const FLOWER_STEM_BLADES: readonly FloraBlade[] = [
  { rect: { x: 13, y: 8, w: 6, h: 22 }, pivot: [16, 29], phase: 0, gain: 1 },
  // Starts at x19, one column clear of the stem's x13..18 span — adjacent,
  // never overlapping, even though their y ranges overlap (rects only
  // collide when BOTH axes overlap).
  { rect: { x: 19, y: 20, w: 5, h: 5 }, pivot: [19, 24], phase: 0.1, gain: 0.6 },
];
