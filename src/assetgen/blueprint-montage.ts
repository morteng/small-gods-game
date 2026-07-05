// src/assetgen/blueprint-montage.ts
// The visual half of the building-authoring loop. Renders a ResolvedBlueprint from N
// turntable yaws into ONE contact-sheet buffer, overlaid with numbered "Set-of-Mark"
// part labels keyed to the blueprint's part ids, and returns a legend mapping each mark
// back to its part. A vision-capable LLM reads the montage + legend together and can say
// "mark 3 (the dormer) reads as a sunken pit" — grounding a critique to an editable field.
//
// It composes through the SAME toGeometry → composeStructure path the runtime uses (per
// [[feedback-offline-sprite-render-dev-loop]]): deterministic, browserless, no paid gen.
// The fixed 2:1 dimetric projection has no free camera, so "different angles" == turntable
// yaw (composeStructure({ yaw })); 4 quarter-turns show all four corners of the massing.
import type { ResolvedBlueprint } from '@/blueprint/types';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { composeStructure, type LabelPoint, type StructureResult } from '@/assetgen/compose';
import { STOREY } from '@/assetgen/geometry/building';

export interface MontageLegendEntry {
  mark: number;          // the number stamped on the sprite
  id: string;            // blueprint part id (the editable handle)
  type: string;          // part type (body/wing/tower/…)
  params: Record<string, unknown>;
}
export interface MontageResult {
  /** RGBA pixel buffer, `width`×`height`, row-major. */
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  cell: number;          // per-view cell size (px)
  yaws: number[];        // the yaws rendered, in grid order (row-major)
  legend: MontageLegendEntry[];
}

export interface MontageOpts {
  /** Turntable yaws (radians). Default = 4 quarter-turns (all four corners). */
  yaws?: number[];
  /** Per-view cell size in px (fit-to-box, so every cell is uniform). Default 256. */
  cell?: number;
  /** Gutter between cells (px). Default 8. */
  gutter?: number;
}

const DEFAULT_YAWS = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];

/** Part-centroid label points in the geometry tile frame (canonical / pre-yaw — compose
 *  rotates them with the sprite). z rides ~one storey up so the mark sits on the wall face. */
function partLabelPoints(rb: ResolvedBlueprint): { points: LabelPoint[]; legend: MontageLegendEntry[] } {
  const points: LabelPoint[] = [];
  const legend: MontageLegendEntry[] = [];
  rb.parts.forEach((p, i) => {
    const mark = i + 1;
    const levels = Math.max(1, (p.params?.levels as number) ?? 1);
    points.push({ id: p.id, x: p.at.x + p.size.w / 2, y: p.at.y + p.size.h / 2, z: levels * STOREY * 0.9 });
    legend.push({ mark, id: p.id, type: p.type, params: p.params });
  });
  return { points, legend };
}

// ── tiny 3×5 bitmap font for the mark numbers (0-9) ─────────────────────────────────
const GLYPHS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'], '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'], '9': ['111', '101', '111', '001', '111'],
};

function setPx(buf: Uint8ClampedArray, W: number, H: number, x: number, y: number, r: number, g: number, b: number): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const o = (y * W + x) * 4;
  buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = 255;
}

/** A filled disc (marker background) so the number reads over any sprite. */
function disc(buf: Uint8ClampedArray, W: number, H: number, cx: number, cy: number, rad: number, r: number, g: number, b: number): void {
  for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
    if (dx * dx + dy * dy <= rad * rad) setPx(buf, W, H, cx + dx, cy + dy, r, g, b);
  }
}

/** Stamp a number centred at (cx,cy) with `scale`-px font pixels, in the given colour. */
function stampNumber(buf: Uint8ClampedArray, W: number, H: number, cx: number, cy: number, n: number, scale: number, r: number, g: number, b: number): void {
  const s = String(n);
  const glyphW = 3 * scale, gap = scale;
  const totalW = s.length * glyphW + (s.length - 1) * gap;
  let ox = Math.round(cx - totalW / 2);
  const oy = Math.round(cy - (5 * scale) / 2);
  for (const ch of s) {
    const rows = GLYPHS[ch]; if (!rows) { ox += glyphW + gap; continue; }
    for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++) {
      if (rows[gy][gx] === '1') for (let py = 0; py < scale; py++) for (let px = 0; px < scale; px++)
        setPx(buf, W, H, ox + gx * scale + px, oy + gy * scale + py, r, g, b);
    }
    ox += glyphW + gap;
  }
}

/** Alpha-copy a per-view sprite into the montage cell (only opaque pixels). */
function blitInto(dst: Uint8ClampedArray, DW: number, src: Uint8ClampedArray, SW: number, SH: number, ox: number, oy: number): void {
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
    const so = (y * SW + x) * 4;
    if (src[so + 3] === 0) continue;
    const do_ = ((oy + y) * DW + (ox + x)) * 4;
    dst[do_] = src[so]; dst[do_ + 1] = src[so + 1]; dst[do_ + 2] = src[so + 2]; dst[do_ + 3] = 255;
  }
}

/**
 * Render `rb` to a labelled multi-yaw montage. Deterministic; Node-safe.
 */
export async function renderBlueprintMontage(rb: ResolvedBlueprint, opts: MontageOpts = {}): Promise<MontageResult> {
  const yaws = opts.yaws ?? DEFAULT_YAWS;
  const cell = opts.cell ?? 256;
  const gutter = opts.gutter ?? 8;
  const { points, legend } = partLabelPoints(rb);

  // Force a uniform per-view canvas (fit-to-box) so every cell is `cell`×`cell`. Pass an
  // (ignored) diagnostics sink so the compile stays quiet here — lint is where diagnostics
  // are meant to surface, not montage stdout.
  const baseSpec = toGeometry(rb, { diagnostics: [] });
  const views: StructureResult[] = [];
  for (const yaw of yaws) {
    views.push(await composeStructure({ ...baseSpec, size: cell }, undefined, {
      ...(yaw ? { yaw } : {}), labelPoints: points,
    }));
  }

  const cols = Math.ceil(Math.sqrt(yaws.length));
  const rows = Math.ceil(yaws.length / cols);
  const W = cols * cell + (cols + 1) * gutter;
  const H = rows * cell + (rows + 1) * gutter;
  const rgba = new Uint8ClampedArray(W * H * 4);
  // Dark neutral backdrop so grey massing + bright marks both read.
  for (let i = 0; i < W * H; i++) { const o = i * 4; rgba[o] = 28; rgba[o + 1] = 30; rgba[o + 2] = 34; rgba[o + 3] = 255; }

  views.forEach((v, vi) => {
    const c = vi % cols, r = Math.floor(vi / cols);
    const ox = gutter + c * (cell + gutter), oy = gutter + r * (cell + gutter);
    blitInto(rgba, W, v.grey, v.size, v.size, ox, oy);
    // Set-of-Mark labels: project position sits in v.labels (normalised to the opaque bbox).
    for (const lab of v.labels ?? []) {
      const mark = legend.find(l => l.id === lab.id)?.mark ?? 0;
      const px = ox + Math.round(v.bbox.x + lab.x * v.bbox.w);
      const py = oy + Math.round(v.bbox.y + lab.y * v.bbox.h);
      disc(rgba, W, H, px, py, 9, 240, 90, 40);          // amber-red marker
      stampNumber(rgba, W, H, px, py, mark, 2, 255, 255, 255);
    }
  });

  return { rgba, width: W, height: H, cell, yaws, legend };
}
