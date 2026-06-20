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
// (greater = front).
//
// Vertices are emitted in WORLD px — the camera transform is applied by the shape
// VS (uXform), exactly as the image batches apply it. Keeping the xform out of the
// CPU geometry is what lets the static shape layer (~15k flora trunks/canopies) be
// triangulated ONCE and cached, instead of re-baked every frame on pan/zoom.
//
// Pure data — no GPU, no DOM. Triangulation + colour parsing are unit-tested.

import type { DrawItem } from '@/render/iso/draw-list';

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

/**
 * Triangulate every `poly`/`circle` item of a draw list into one interleaved
 * vertex array (x, y, depth, r, g, b, a per vertex) ready for an instanced-less
 * `triangle-list` draw. Image items contribute only to the depth counter (so
 * shape depths line up with the image-pass depths). Returns an empty buffer when
 * there are no shapes.
 *
 * Vertices are in WORLD px — the shape VS applies the camera xform (uXform), so a
 * caller can triangulate a static layer ONCE and re-draw it across pan/zoom.
 */
export function buildShapeVertices(
  items: readonly DrawItem[],
): { vertices: Float32Array; vertexCount: number } {
  const out: number[] = [];
  const count = items.length;

  const pushTri = (
    p0x: number, p0y: number, p1x: number, p1y: number, p2x: number, p2y: number,
    depth: number, c: [number, number, number, number],
  ) => {
    out.push(p0x, p0y, depth, c[0], c[1], c[2], c[3]);
    out.push(p1x, p1y, depth, c[0], c[1], c[2], c[3]);
    out.push(p2x, p2y, depth, c[0], c[1], c[2], c[3]);
  };

  items.forEach((it, i) => {
    if (it.t === 'image') return;
    const depth = (i + 1) / (count + 1);
    const c = parseColor(it.color);

    if (it.t === 'poly') {
      if (it.points.length < 3) return;
      const p0 = it.points[0];
      // Fan triangulation from the first vertex (matches a Canvas2D convex fill).
      for (let k = 1; k < it.points.length - 1; k++) {
        const p1 = it.points[k];
        const p2 = it.points[k + 1];
        pushTri(p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, depth, c);
      }
    } else {
      // circle ⇒ triangle fan around the centre. Segment count keys off the WORLD
      // radius (xform-independent) so the buffer stays cacheable across zoom.
      const segs = circleSegments(it.r);
      let prevx = it.cx + it.r, prevy = it.cy;
      for (let s = 1; s <= segs; s++) {
        const ang = (s / segs) * Math.PI * 2;
        const curx = it.cx + Math.cos(ang) * it.r, cury = it.cy + Math.sin(ang) * it.r;
        pushTri(it.cx, it.cy, prevx, prevy, curx, cury, depth, c);
        prevx = curx; prevy = cury;
      }
    }
  });

  return { vertices: new Float32Array(out), vertexCount: out.length / SHAPE_VERTEX_FLOATS };
}
