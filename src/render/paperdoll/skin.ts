/**
 * Contour-aware joint skinning for the paper-doll rig (spike).
 *
 * Instead of every pixel rigidly following exactly one chip, pixels within a
 * blend band of a joint interface follow a WEIGHTED MIX of the parent and
 * child transforms — the raster analogue of linear-blend skinning. The band
 * is geodesic: weights propagate only THROUGH OPAQUE PIXELS, so a sleeve's
 * blend band flows around the underarm silhouette and never bleeds across
 * the transparent gap onto the torso (the failure that forced tight rects).
 *
 * Pure raster math, deterministic, node + browser identical — same contract
 * as `rig.ts`. The skinned render path lives in `renderPose` behind
 * `RenderPoseOptions.skin`; this module only builds the per-pixel weights.
 */
import type { Raster } from '../sprite-postprocess';
import type { AnimTemplate } from './rig';

/**
 * Per-pixel skin binding for one layer raster. For pixel i:
 * transform = lerp(world[boneA[i]], world[boneB[i]], w[i]).
 * Rigid pixels have boneA === boneB (w irrelevant). `assign` is the pixel's
 * owning chip for z-ordering (blended pixels keep their slice assignment).
 */
export interface SkinField {
  assign: Uint8Array;
  boneA: Uint8Array;
  boneB: Uint8Array;
  w: Float32Array;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/**
 * Build the skin field for one SLICED layer. `band` is the half-width of the
 * blend zone in px on each side of a joint interface (0 = fully rigid, the
 * legacy behavior). Assigned (whole-chip) layers don't need one — every pixel
 * rides the assigned bone rigidly.
 *
 * The blend seeds only from interface pixels within `pivotRadius` of the
 * child's pivot: the crease is LOCAL to the joint. The distal seam between two
 * segments (an arm alongside the torso) must stay rigid so the mesh TEARS
 * cleanly there when the limb swings away — blending the whole seam stretches
 * dark seam pixels into webbing across the opening gap (first spike bake).
 */
export function buildSkinField(
  template: AnimTemplate,
  raster: Raster,
  band: number,
  pivotRadius = band + 2,
): SkinField {
  const n = template.cell;
  const N = n * n;
  const chips = template.chips;

  // Pixel → owning chip. Later chips win rect overlaps (the moving part
  // carries shared joint pixels, e.g. the forearm's cap rows over the arm).
  const assign = new Uint8Array(N); // root = 0
  for (let c = 1; c < chips.length; c++) {
    const r = chips[c].rect;
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) assign[y * n + x] = c;
  }

  const boneA = new Uint8Array(assign);
  const boneB = new Uint8Array(assign);
  const w = new Float32Array(N);
  if (band <= 0) return { assign, boneA, boneB, w };

  const alpha = raster.data;
  const opaque = (i: number): boolean => alpha[i * 4 + 3] > 0;
  // Nearest-joint wins where bands touch (never with band ≲ rect size / 2).
  const bestDist = new Float32Array(N).fill(Infinity);
  const queue = new Int32Array(N);

  for (let c = 1; c < chips.length; c++) {
    const p = chips[c].parent;
    const [px0, py0] = chips[c].pivot;
    // Multi-source BFS from the near-pivot c|p interface, through opaque
    // {c,p} pixels.
    const dist = new Float32Array(N).fill(Infinity);
    let head = 0;
    let tail = 0;
    const inPair = (i: number): boolean => (assign[i] === c || assign[i] === p) && opaque(i);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        if (!inPair(i)) continue;
        if ((x + 0.5 - px0) ** 2 + (y + 0.5 - py0) ** 2 > pivotRadius * pivotRadius) continue;
        const mine = assign[i];
        const other = mine === c ? p : c;
        const touches =
          (x > 0 && assign[i - 1] === other && opaque(i - 1)) ||
          (x < n - 1 && assign[i + 1] === other && opaque(i + 1)) ||
          (y > 0 && assign[i - n] === other && opaque(i - n)) ||
          (y < n - 1 && assign[i + n] === other && opaque(i + n));
        if (touches) {
          dist[i] = 0;
          queue[tail++] = i;
        }
      }
    }
    while (head < tail) {
      const i = queue[head++];
      const d = dist[i];
      if (d >= band - 1) continue;
      const x = i % n;
      const y = (i / n) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < n - 1 ? i + 1 : -1, y > 0 ? i - n : -1, y < n - 1 ? i + n : -1]) {
        if (j < 0 || !inPair(j) || dist[j] <= d + 1) continue;
        dist[j] = d + 1;
        queue[tail++] = j;
      }
    }
    for (let i = 0; i < N; i++) {
      const d = dist[i];
      if (d === Infinity || d >= bestDist[i]) continue;
      bestDist[i] = d;
      // Signed offset from the interface: child side +, parent side −.
      const s = (assign[i] === c ? 1 : -1) * (d + 0.5);
      boneA[i] = p;
      boneB[i] = c;
      w[i] = smooth(Math.max(0, Math.min(1, 0.5 + s / (2 * band))));
    }
  }
  return { assign, boneA, boneB, w };
}

/** Rigid field for an assigned (whole-chip) layer: every pixel rides `chip`. */
export function rigidSkinField(template: AnimTemplate, chip: number): SkinField {
  const N = template.cell * template.cell;
  return {
    assign: new Uint8Array(N).fill(chip),
    boneA: new Uint8Array(N).fill(chip),
    boneB: new Uint8Array(N).fill(chip),
    w: new Float32Array(N),
  };
}
