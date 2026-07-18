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
import { buildSkinField, rigidSkinField, type SkinField } from './skin';
import { activeStampIndex, applyStamps, type DonorSheets, type StampKey } from './stamp';

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
  /**
   * Optional translation (px, parent space) — the 2D stand-in for OUT-OF-PLANE
   * motion. A front-facing bow must NOT rotate (that reads as a sideways ear-to-
   * shoulder tilt); the head translates down (chin tuck) / up (facing the sky).
   */
  dx?: number;
  dy?: number;
}

/** Sampled pose of one chip at a clip time. */
export interface ChipPose {
  deg: number;
  dx: number;
  dy: number;
}

export type PoseProp = 'deg' | 'dx' | 'dy';

/**
 * Secondary-motion coupling — a touch of reverse IK without a solver. The
 * destination chip's pose gains `gain × (source chip's KEYED track value)`,
 * optionally sampled a beat late (`lag`) for follow-through. Sources read raw
 * tracks only (derived motion never chains), so couplings stay acyclic and
 * order-independent. Typical uses: trunk sway → lagged knee flex; thigh angle
 * → shin counter-rotation that keeps the foot planted.
 */
export interface Couple {
  /** Chip whose keyed track drives the coupling. */
  from: string;
  /** Component of the source track to read. */
  prop: PoseProp;
  /** Chip receiving the derived motion. */
  to: string;
  /** Component written on the destination (default 'deg'). */
  toProp?: PoseProp;
  /** dst += gain × src — cross-unit gains are fine (trunk px → thigh degrees). */
  gain: number;
  /** Normalized-time follow-through delay; source sampled at t−lag (clamped to 0). */
  lag?: number;
}

export interface Clip {
  /** Clip id, e.g. 'pray-raise'. */
  name: string;
  /** Baked frame count (frame i samples t = i / (frames - 1)). */
  frames: number;
  /** Per-chip-name angle tracks; chips without a track stay at 0°. */
  tracks: Record<string, Keyframe[]>;
  /** Secondary-motion couplings, applied on top of the sampled tracks. */
  couple?: readonly Couple[];
  /**
   * Keyframed pixel stamps (donor hand/face poses) — applied to each layer's
   * rest cell BEFORE the FK/skin path so chip rotation carries the swapped
   * pixels. Step-switched, never interpolated. See `stamp.ts`.
   */
  stamps?: readonly StampKey[];
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

const poseOf = (k: Keyframe): ChipPose => ({ deg: k.deg, dx: k.dx ?? 0, dy: k.dy ?? 0 });

const lerpPose = (a: ChipPose, b: ChipPose, u: number): ChipPose => ({
  deg: a.deg + (b.deg - a.deg) * u,
  dx: a.dx + (b.dx - a.dx) * u,
  dy: a.dy + (b.dy - a.dy) * u,
});

/** Sample one track at normalized time `t` (clamped, smoothstep between keys). */
export function sampleTrack(track: readonly Keyframe[] | undefined, t: number): ChipPose {
  if (!track || track.length === 0) return { deg: 0, dx: 0, dy: 0 };
  if (t <= track[0].t) return poseOf(track[0]);
  const last = track[track.length - 1];
  if (t >= last.t) return poseOf(last);
  for (let i = 1; i < track.length; i++) {
    const k0 = track[i - 1];
    const k1 = track[i];
    if (t <= k1.t) {
      const span = k1.t - k0.t;
      const u = span <= 0 ? 1 : (t - k0.t) / span;
      return lerpPose(poseOf(k0), poseOf(k1), smooth(u));
    }
  }
  return poseOf(last);
}

/** Per-chip poses (template order) for clip time `t` ∈ [0,1]. */
export function sampleClip(template: AnimTemplate, clip: Clip, t: number): ChipPose[] {
  const poses = template.chips.map((ch) => sampleTrack(clip.tracks[ch.name], t));
  if (clip.couple) {
    for (const c of clip.couple) {
      const di = template.chips.findIndex((ch) => ch.name === c.to);
      if (di < 0) continue;
      const src = sampleTrack(clip.tracks[c.from], Math.max(0, t - (c.lag ?? 0)));
      poses[di][c.toProp ?? 'deg'] += c.gain * src[c.prop];
    }
  }
  return poses;
}

/** FK: world affine per chip for the given per-chip poses (template order). */
export function chipWorldTransforms(template: AnimTemplate, poses: readonly ChipPose[]): Affine[] {
  const world: Affine[] = [];
  template.chips.forEach((ch, i) => {
    const p = poses[i];
    let local: Affine;
    if (p.deg === 0 && p.dx === 0 && p.dy === 0) local = IDENTITY;
    else {
      // Rotate about the pivot, THEN offset — translation is the out-of-plane fake.
      local = rotAbout(ch.pivot[0], ch.pivot[1], p.deg);
      if (p.dx !== 0 || p.dy !== 0) local = mulAffine([1, 0, p.dx, 0, 1, p.dy], local);
    }
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
  /**
   * Chip names to skip painting. A hidden chip's rect is STILL cleared from the
   * root, so hiding a limb leaves a hole rather than a baked-in copy — the
   * behavior both studio isolation and out-of-plane pose fakes (a front-facing
   * kneel hides the shins) need.
   */
  hide?: ReadonlySet<string>;
  /**
   * Contour-aware joint skinning (spike): pixels within `band` px of a joint
   * interface (geodesic, through opaque pixels only) follow a weighted blend
   * of the parent and child transforms instead of a rigid chip. Switches to a
   * forward mesh-warp rasterizer; omit for the legacy rigid path.
   */
  skin?: { band: number };
}

/**
 * One source layer for a pose render. `assign` names a chip this layer follows
 * WHOLESALE: every pixel of the layer moves with that chip's transform and the
 * layer is never rect-sliced (e.g. LPC head/face/hair layers ride the `head`
 * bone — cropping them at the head rect cut chins and hair in half). Layers
 * without `assign` are sliced by the template's chip rects as usual.
 */
export interface PoseLayer {
  raster: Raster;
  assign?: string;
  /**
   * This layer's donor sheets by anim name (full sheet rasters) — the material
   * clip stamps harvest from. Each layer resolves stamps against its OWN
   * sheets (a glove layer supplies its own palm); a layer without the stamped
   * anim keeps its rest pixels.
   */
  donors?: DonorSheets;
}

export type PoseLayerInput = Raster | PoseLayer;

const toPoseLayer = (l: PoseLayerInput): PoseLayer => ('raster' in l ? l : { raster: l });

/**
 * Render one pose: every layer's chips, moved by shared per-chip transforms,
 * painted chip-z outer / layer-order inner (so e.g. the body arm and its sleeve
 * stay stacked correctly inside the "upper arm" slot). Whole-chip layers
 * (`PoseLayer.assign`) render only under their chip, un-sliced. Returns a
 * cell-sized straight-alpha Raster.
 */
export function renderPose(
  template: AnimTemplate,
  layers: readonly PoseLayerInput[],
  poses: readonly ChipPose[],
  opts: RenderPoseOptions = {},
): Raster {
  if (opts.skin) return renderPoseSkinned(template, layers.map(toPoseLayer), poses, opts);
  const n = template.cell;
  const ss = Math.max(1, Math.round(opts.supersample ?? 4));
  const N = n * ss;
  const big = new Uint8ClampedArray(N * N * 4);
  const world = chipWorldTransforms(template, poses);
  const L = layers.map(toPoseLayer);
  // Root-chip rasters (limb rects cleared) — only sliced layers need one.
  const roots = L.map((l) => (l.assign ? null : rootChipRaster(template, l.raster)));
  const order = template.chips
    .map((_, i) => i)
    .sort((a, b) => template.chips[a].z - template.chips[b].z);
  const FULL: ChipRect = { x: 0, y: 0, w: n, h: n };

  for (const i of order) {
    const ch = template.chips[i];
    if (opts.hide?.has(ch.name)) continue;
    const inv = invertAffine(world[i]);

    for (let li = 0; li < L.length; li++) {
      const layer = L[li];
      let r: ChipRect;
      let src: Uint8ClampedArray;
      if (layer.assign !== undefined) {
        if (layer.assign !== ch.name) continue; // whole layer rides ONE chip
        r = FULL;
        src = layer.raster.data;
      } else {
        r = ch.rect;
        src = i === 0 ? roots[li]! : layer.raster.data;
      }

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

/**
 * Skinned render path (spike): forward mesh-warp. Every opaque source pixel
 * becomes a quad whose corners move by per-VERTEX transforms — the average of
 * the (blend-weighted) matrices of the adjacent opaque pixels — so the mesh
 * stays watertight where weights vary and joints stretch instead of tearing.
 * Painted pixel-color-flat in chip-z order (a pixel keeps its slice
 * assignment for ordering), then box-downscaled like the rigid path.
 */
function renderPoseSkinned(
  template: AnimTemplate,
  L: readonly PoseLayer[],
  poses: readonly ChipPose[],
  opts: RenderPoseOptions,
): Raster {
  const n = template.cell;
  const ss = Math.max(1, Math.round(opts.supersample ?? 4));
  const N = n * ss;
  const big = new Uint8ClampedArray(N * N * 4);
  const world = chipWorldTransforms(template, poses);
  const band = opts.skin!.band;

  interface LayerSkin {
    field: SkinField;
    pix: Float32Array; // n² × 6 per-pixel blended matrices
  }
  const skins: (LayerSkin | null)[] = L.map((layer) => {
    let field: SkinField;
    if (layer.assign !== undefined) {
      const ci = template.chips.findIndex((c) => c.name === layer.assign);
      if (ci < 0) return null;
      field = rigidSkinField(template, ci);
    } else {
      field = buildSkinField(template, layer.raster, band);
    }
    // Per-pixel blended matrices (opaque pixels only).
    const pix = new Float32Array(n * n * 6);
    const alpha = layer.raster.data;
    for (let i = 0; i < n * n; i++) {
      if (alpha[i * 4 + 3] === 0) continue;
      const A = world[field.boneA[i]];
      const B = world[field.boneB[i]];
      const t = field.w[i];
      for (let k = 0; k < 6; k++) pix[i * 6 + k] = A[k] + (B[k] - A[k]) * t;
    }
    return { field, pix };
  });

  // Two pixels WELD at a shared vertex only when their bone records are
  // compatible — same rigid bone, same blend pair, or a blend-band pixel next
  // to a pixel rigid to one of its two bones. Incompatible neighbors (a fist
  // sweeping past a thigh, an arm's distal seam alongside the torso) TEAR:
  // each keeps its own transform, so unrelated limbs never drag each other.
  const compatible = (f: SkinField, i: number, j: number): boolean => {
    const ra = f.boneA[i] === f.boneB[i];
    const rb = f.boneA[j] === f.boneB[j];
    if (ra && rb) return f.boneA[i] === f.boneA[j];
    if (ra) return f.boneA[i] === f.boneA[j] || f.boneA[i] === f.boneB[j];
    if (rb) return f.boneA[j] === f.boneA[i] || f.boneA[j] === f.boneB[i];
    return f.boneA[i] === f.boneA[j] && f.boneB[i] === f.boneB[j];
  };

  const order = template.chips
    .map((_, i) => i)
    .sort((a, b) => template.chips[a].z - template.chips[b].z);

  const fillTri = (
    ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
    r: number, g: number, b: number,
  ): void => {
    // consistent winding so the inside test is sign-stable
    if ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax) < 0) {
      const tx = bx; const ty = by;
      bx = cx; by = cy; cx = tx; cy = ty;
    }
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) - 0.5));
    const x1 = Math.min(N - 1, Math.ceil(Math.max(ax, bx, cx) + 0.5));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy) - 0.5));
    const y1 = Math.min(N - 1, Math.ceil(Math.max(ay, by, cy) + 0.5));
    const EPS = 1e-7;
    for (let oy = y0; oy <= y1; oy++) {
      const sy = oy + 0.5;
      for (let ox = x0; ox <= x1; ox++) {
        const sx = ox + 0.5;
        if (
          (bx - ax) * (sy - ay) - (by - ay) * (sx - ax) < -EPS ||
          (cx - bx) * (sy - by) - (cy - by) * (sx - bx) < -EPS ||
          (ax - cx) * (sy - cy) - (ay - cy) * (sx - cx) < -EPS
        )
          continue;
        const di = (oy * N + ox) * 4;
        big[di] = r;
        big[di + 1] = g;
        big[di + 2] = b;
        big[di + 3] = 255;
      }
    }
  };

  for (const ci of order) {
    if (opts.hide?.has(template.chips[ci].name)) continue;
    for (let li = 0; li < L.length; li++) {
      const skin = skins[li];
      if (!skin) continue;
      const src = L[li].raster.data;
      const m = new Float32Array(6);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const i = y * n + x;
          if (skin.field.assign[i] !== ci || src[i * 4 + 3] === 0) continue;
          // Corner positions: at each of the pixel's 4 corners, average the
          // matrices of the adjacent opaque pixels COMPATIBLE with this one
          // (always including itself) — welded seams share corner positions,
          // incompatible neighbors tear.
          const pos: number[] = [];
          for (const [vx, vy] of [
            [x, y],
            [x + 1, y],
            [x, y + 1],
            [x + 1, y + 1],
          ] as const) {
            m.fill(0);
            let cnt = 0;
            for (const [qx, qy] of [
              [vx - 1, vy - 1],
              [vx, vy - 1],
              [vx - 1, vy],
              [vx, vy],
            ] as const) {
              if (qx < 0 || qy < 0 || qx >= n || qy >= n) continue;
              const j = qy * n + qx;
              if (src[j * 4 + 3] === 0 || !compatible(skin.field, i, j)) continue;
              cnt++;
              for (let k = 0; k < 6; k++) m[k] += skin.pix[j * 6 + k];
            }
            for (let k = 0; k < 6; k++) m[k] /= cnt;
            pos.push((m[0] * vx + m[1] * vy + m[2]) * ss, (m[3] * vx + m[4] * vy + m[5]) * ss);
          }
          const r = src[i * 4];
          const g = src[i * 4 + 1];
          const b = src[i * 4 + 2];
          fillTri(pos[0], pos[1], pos[2], pos[3], pos[6], pos[7], r, g, b);
          fillTri(pos[0], pos[1], pos[6], pos[7], pos[4], pos[5], r, g, b);
        }
      }
    }
  }

  // Box-downscale ss→1 — identical to the rigid path.
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
  layers: readonly PoseLayerInput[],
  clip: Clip,
  opts: RenderPoseOptions = {},
): Raster[] {
  const frames: Raster[] = [];
  const denom = Math.max(1, clip.frames - 1);
  const L = layers.map(toPoseLayer);
  // Stamps are step-switched, so all frames sharing a stamp key share the same
  // stamped layer set — build each variant once.
  const stamped = new Map<number, PoseLayer[]>();
  for (let f = 0; f < clip.frames; f++) {
    const t = f / denom;
    let use: readonly PoseLayer[] = L;
    const si = activeStampIndex(clip.stamps, t);
    if (si >= 0) {
      let v = stamped.get(si);
      if (!v) {
        const refs = clip.stamps![si].refs;
        v = L.map((l) => ({ ...l, raster: applyStamps(l.raster, refs, l.donors, template.cell) }));
        stamped.set(si, v);
      }
      use = v;
    }
    frames.push(renderPose(template, use, sampleClip(template, clip, t), opts));
  }
  return frames;
}
