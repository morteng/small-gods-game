/**
 * Paper-doll rig — template-agnostic 2D cut-out animation over sprite cells.
 *
 * An `AnimTemplate` slices a square sprite cell into chips (limb pieces), each
 * with a rotation pivot and a parent, forming a 2-D FK hierarchy. A `Clip`
 * keyframes per-chip angles over normalized time. `renderPose` re-composites
 * the chips at a given set of angles — supersampled, then box-downscaled back
 * to the cell grid — so baked frames stay pixel-crisp.
 *
 * Layer-aware by design: pass every LPC layer of a character (body, clothes,
 * head, hair…) and each layer's chips are sliced and rotated by the SAME
 * transforms, then painted chip-by-chip (chip z outer, layer order inner).
 * Rotating layers independently keeps their clean alpha edges — no baked-in
 * inter-layer shadows smearing across rotations (the composed-slice artifact).
 *
 * Pure raster math on `Raster` buffers — no DOM, no GPU — so it runs identically
 * in Node bake scripts (`scripts/paperdoll-bake.ts`) and the motion studio.
 * Deterministic: same inputs → same bytes.
 */
import type { Raster } from '../sprite-postprocess';

export interface ChipRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ChipDef {
  /** Stable name — clips key their angle tracks on it. */
  name: string;
  /** Slice region in cell coordinates. */
  rect: ChipRect;
  /** Rotation pivot (joint position) in cell coordinates. */
  pivot: [number, number];
  /** Index of the parent chip in the template's `chips`, or -1 for the root. */
  parent: number;
  /** Paint order — lower paints first (root usually 0). */
  z: number;
}

export interface AnimTemplate {
  /** Template id, e.g. 'lpc-humanoid'. */
  name: string;
  /** Cell size in px (LPC universal sheet = 64). */
  cell: number;
  /**
   * Chip list; index 0 MUST be the root (parent -1). Every non-root chip's
   * rect is cleared out of the root's raster so a lifted limb leaves no ghost.
   */
  chips: ChipDef[];
}

export interface Keyframe {
  /** Normalized clip time in [0, 1]. */
  t: number;
  /** Angle at `t`, degrees. +ve = clockwise in screen space (y-down). */
  deg: number;
}

export interface Clip {
  /** Clip id, e.g. 'pray-raise'. */
  name: string;
  /** Baked frame count (frame i samples t = i / (frames - 1)). */
  frames: number;
  /** Per-chip-name angle tracks; chips without a track stay at 0°. */
  tracks: Record<string, Keyframe[]>;
}

/** Row-major 2×3 affine: [a, b, c, d, e, f] maps (x,y) → (ax+by+c, dx+ey+f). */
export type Affine = [number, number, number, number, number, number];

const IDENTITY: Affine = [1, 0, 0, 0, 1, 0];

export function mulAffine(A: Affine, B: Affine): Affine {
  return [
    A[0] * B[0] + A[1] * B[3],
    A[0] * B[1] + A[1] * B[4],
    A[0] * B[2] + A[1] * B[5] + A[2],
    A[3] * B[0] + A[4] * B[3],
    A[3] * B[1] + A[4] * B[4],
    A[3] * B[2] + A[4] * B[5] + A[5],
  ];
}

export function invertAffine(m: Affine): Affine {
  const [a, b, c, d, e, f] = m;
  const id = 1 / (a * e - b * d);
  return [e * id, -b * id, (b * f - c * e) * id, -d * id, a * id, (c * d - a * f) * id];
}

export function applyAffine(m: Affine, x: number, y: number): [number, number] {
  return [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]];
}

/** Rotation by `deg` about pivot (px, py), y-down screen space. */
function rotAbout(px: number, py: number, deg: number): Affine {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, -s, px - c * px + s * py, s, c, py - s * px - c * py];
}

/** Smoothstep — matches the hand-eased spike motion between keyframes. */
const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Sample one angle track at normalized time `t` (clamped, smoothstep between keys). */
export function sampleTrack(track: readonly Keyframe[] | undefined, t: number): number {
  if (!track || track.length === 0) return 0;
  if (t <= track[0].t) return track[0].deg;
  const last = track[track.length - 1];
  if (t >= last.t) return last.deg;
  for (let i = 1; i < track.length; i++) {
    const k0 = track[i - 1];
    const k1 = track[i];
    if (t <= k1.t) {
      const span = k1.t - k0.t;
      const u = span <= 0 ? 1 : (t - k0.t) / span;
      return k0.deg + (k1.deg - k0.deg) * smooth(u);
    }
  }
  return last.deg;
}

/** Per-chip angles (template order) for clip time `t` ∈ [0,1]. */
export function sampleClip(template: AnimTemplate, clip: Clip, t: number): number[] {
  return template.chips.map((ch) => sampleTrack(clip.tracks[ch.name], t));
}

/** FK: world affine per chip for the given per-chip angles (template order). */
export function chipWorldTransforms(template: AnimTemplate, angles: readonly number[]): Affine[] {
  const world: Affine[] = [];
  template.chips.forEach((ch, i) => {
    const local = angles[i] === 0 ? IDENTITY : rotAbout(ch.pivot[0], ch.pivot[1], angles[i]);
    world[i] = ch.parent < 0 ? local : mulAffine(world[ch.parent], local);
  });
  return world;
}

/**
 * Slice one source layer cell into per-chip rasters. The root chip receives a
 * copy of the whole cell with every other chip's rect cleared (so lifted limbs
 * leave no ghost pixels behind); other chips sample their rect from the cell
 * directly at render time, so no allocation is needed for them here.
 */
export function rootChipRaster(template: AnimTemplate, cell: Raster): Uint8ClampedArray {
  const out = new Uint8ClampedArray(cell.data);
  const n = template.cell;
  for (let i = 1; i < template.chips.length; i++) {
    const r = template.chips[i].rect;
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        out[(y * n + x) * 4 + 3] = 0;
      }
    }
  }
  return out;
}

export interface RenderPoseOptions {
  /** Supersample factor for rotation quality before box-downscale (default 4). */
  supersample?: number;
}

/**
 * Render one pose: every layer's chips, rotated by shared per-chip transforms,
 * painted chip-z outer / layer-order inner (so e.g. the body arm and its sleeve
 * stay stacked correctly inside the "upper arm" slot). Returns a cell-sized
 * premultiplied-free straight-alpha Raster.
 */
export function renderPose(
  template: AnimTemplate,
  layers: readonly Raster[],
  angles: readonly number[],
  opts: RenderPoseOptions = {},
): Raster {
  const n = template.cell;
  const ss = Math.max(1, Math.round(opts.supersample ?? 4));
  const N = n * ss;
  const big = new Uint8ClampedArray(N * N * 4);
  const world = chipWorldTransforms(template, angles);
  const roots = layers.map((l) => rootChipRaster(template, l));
  const order = template.chips
    .map((_, i) => i)
    .sort((a, b) => template.chips[a].z - template.chips[b].z);

  for (const i of order) {
    const ch = template.chips[i];
    const inv = invertAffine(world[i]);
    const r = ch.rect;
    // Transformed-rect bbox in supersampled output space.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [cx, cy] of [
      [r.x, r.y],
      [r.x + r.w, r.y],
      [r.x, r.y + r.h],
      [r.x + r.w, r.y + r.h],
    ] as const) {
      const [px, py] = applyAffine(world[i], cx, cy);
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
    const x0 = Math.max(0, Math.floor(minX * ss));
    const x1 = Math.min(N, Math.ceil(maxX * ss));
    const y0 = Math.max(0, Math.floor(minY * ss));
    const y1 = Math.min(N, Math.ceil(maxY * ss));

    for (let li = 0; li < layers.length; li++) {
      const src = i === 0 ? roots[li] : layers[li].data;
      for (let oy = y0; oy < y1; oy++) {
        for (let ox = x0; ox < x1; ox++) {
          const [sx, sy] = applyAffine(inv, (ox + 0.5) / ss, (oy + 0.5) / ss);
          const ix = Math.floor(sx);
          const iy = Math.floor(sy);
          if (ix < r.x || ix >= r.x + r.w || iy < r.y || iy >= r.y + r.h) continue;
          const si = (iy * n + ix) * 4;
          if (src[si + 3] === 0) continue;
          const di = (oy * N + ox) * 4;
          big[di] = src[si];
          big[di + 1] = src[si + 1];
          big[di + 2] = src[si + 2];
          big[di + 3] = 255;
        }
      }
    }
  }

  // Box-downscale ss→1: color = mean of covered samples, alpha = coverage.
  const out = new Uint8ClampedArray(n * n * 4);
  const total = ss * ss;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let hit = 0;
      for (let yy = 0; yy < ss; yy++) {
        for (let xx = 0; xx < ss; xx++) {
          const si = ((y * ss + yy) * N + (x * ss + xx)) * 4;
          if (big[si + 3] > 0) {
            r += big[si];
            g += big[si + 1];
            b += big[si + 2];
            hit++;
          }
        }
      }
      if (hit > 0) {
        const di = (y * n + x) * 4;
        out[di] = Math.round(r / hit);
        out[di + 1] = Math.round(g / hit);
        out[di + 2] = Math.round(b / hit);
        out[di + 3] = Math.round((hit / total) * 255);
      }
    }
  }
  return { data: out, w: n, h: n };
}

/** Bake every frame of a clip. Frame i samples t = i/(frames-1) (frames ≥ 2). */
export function bakeClip(
  template: AnimTemplate,
  layers: readonly Raster[],
  clip: Clip,
  opts: RenderPoseOptions = {},
): Raster[] {
  const frames: Raster[] = [];
  const denom = Math.max(1, clip.frames - 1);
  for (let f = 0; f < clip.frames; f++) {
    frames.push(renderPose(template, layers, sampleClip(template, clip, f / denom), opts));
  }
  return frames;
}
