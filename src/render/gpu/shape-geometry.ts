// src/render/gpu/shape-geometry.ts
//
// GPU parity for the draw list's solid-colour shapes — the `poly` and `circle`
// items (barrier/building fallback fills, NPC fallback diamonds, tree trunks +
// canopies). The Canvas2D/Pixi paths fill these directly; the WebGPU scene needs
// them triangulated into a vertex stream it can draw in the entity pass.
//
// Painter order: each item's depth is its position in the ORIGINAL draw list
// (`(i+1)/(count+1)`, the SAME encoding `instance-batch.ts` gives image items),
// so shapes interleave correctly with sprites under the shared depth test
// (greater = front). World→device is the same `ViewTransform` the image batches
// bake in, applied per vertex so non-uniform scale degrades gracefully.
//
// Pure data — no GPU, no DOM. Triangulation + colour parsing are unit-tested.

import type { DrawItem } from '@/render/iso/draw-list';
import type { ViewTransform } from '@/render/gpu/instance-batch';

/** Floats per shape vertex: x, y, depth, r, g, b, a. */
export const SHAPE_VERTEX_FLOATS = 7;
export const SHAPE_VERTEX_STRIDE = SHAPE_VERTEX_FLOATS * 4; // 28 bytes

/** Triangle-fan segment count for a circle of (device-px) radius `r`. */
export function circleSegments(r: number): number {
  return Math.max(8, Math.min(64, Math.ceil(r * 1.5)));
}

/** Parse a CSS colour (`#rgb`/`#rrggbb`/`#rrggbbaa`/`rgb()`/`rgba()`) to 0..1 RGBA. */
export function parseColor(s: string): [number, number, number, number] {
  const str = s.trim();
  if (str[0] === '#') {
    const hex = str.slice(1);
    const exp =
      hex.length === 3 || hex.length === 4
        ? hex.split('').map((c) => c + c).join('')
        : hex;
    const r = parseInt(exp.slice(0, 2), 16) || 0;
    const g = parseInt(exp.slice(2, 4), 16) || 0;
    const b = parseInt(exp.slice(4, 6), 16) || 0;
    const a = exp.length >= 8 ? (parseInt(exp.slice(6, 8), 16) || 0) / 255 : 1;
    return [r / 255, g / 255, b / 255, a];
  }
  const m = /^rgba?\(([^)]+)\)$/i.exec(str);
  if (m) {
    const p = m[1].split(',').map((x) => parseFloat(x.trim()));
    return [(p[0] || 0) / 255, (p[1] || 0) / 255, (p[2] || 0) / 255, p[3] == null ? 1 : p[3]];
  }
  return [0, 0, 0, 1]; // unknown ⇒ opaque black, like an unstyled fill
}

function tx(x: number, y: number, xf?: ViewTransform): [number, number] {
  return xf ? [x * xf.sx + xf.ox, y * xf.sy + xf.oy] : [x, y];
}

/**
 * Triangulate every `poly`/`circle` item of a draw list into one interleaved
 * vertex array (x, y, depth, r, g, b, a per vertex) ready for an instanced-less
 * `triangle-list` draw. Image items contribute only to the depth counter (so
 * shape depths line up with the image-pass depths). Returns an empty buffer when
 * there are no shapes.
 */
export function buildShapeVertices(
  items: readonly DrawItem[],
  xform?: ViewTransform,
): { vertices: Float32Array; vertexCount: number } {
  const out: number[] = [];
  const count = items.length;

  const pushTri = (
    p0: [number, number], p1: [number, number], p2: [number, number],
    depth: number, c: [number, number, number, number],
  ) => {
    for (const p of [p0, p1, p2]) out.push(p[0], p[1], depth, c[0], c[1], c[2], c[3]);
  };

  items.forEach((it, i) => {
    if (it.t === 'image') return;
    const depth = (i + 1) / (count + 1);
    const c = parseColor(it.color);

    if (it.t === 'poly') {
      if (it.points.length < 3) return;
      const p0 = tx(it.points[0].x, it.points[0].y, xform);
      // Fan triangulation from the first vertex (matches a Canvas2D convex fill).
      for (let k = 1; k < it.points.length - 1; k++) {
        const p1 = tx(it.points[k].x, it.points[k].y, xform);
        const p2 = tx(it.points[k + 1].x, it.points[k + 1].y, xform);
        pushTri(p0, p1, p2, depth, c);
      }
    } else {
      // circle ⇒ triangle fan around the centre; transform each rim point so a
      // non-uniform xform yields the correct ellipse.
      const segs = circleSegments(it.r * (xform ? Math.max(Math.abs(xform.sx), Math.abs(xform.sy)) : 1));
      const ctr = tx(it.cx, it.cy, xform);
      let prev = tx(it.cx + it.r, it.cy, xform);
      for (let s = 1; s <= segs; s++) {
        const ang = (s / segs) * Math.PI * 2;
        const cur = tx(it.cx + Math.cos(ang) * it.r, it.cy + Math.sin(ang) * it.r, xform);
        pushTri(ctr, prev, cur, depth, c);
        prev = cur;
      }
    }
  });

  return { vertices: new Float32Array(out), vertexCount: out.length / SHAPE_VERTEX_FLOATS };
}
