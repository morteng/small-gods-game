// src/render/ui/ui-batcher.ts
//
// Pure-CPU quad batcher for the WebGPU UI layer (S1). The immediate-mode context
// (`ui-context.ts`) emits draw commands here every frame; `flush()` returns one
// interleaved vertex array per (space, page) group, ready for the UI pass
// (`ui-pass.ts`) to upload + draw. No WebGPU, no DOM — unit-testable in Node.
//
// Geometry is screen/device-pixel space (origin top-left, +y down). The pass'
// vertex shader maps device px → NDC for `Screen` groups and applies the camera
// view-projection for `World` groups; the batcher itself is projection-agnostic.
//
// Vertex layout (triangle-list, 6 verts/quad): x, y, u, v, r, g, b, a.

import type { Rgba } from '@/render/ui/ui-color';

/** Floats per UI vertex: x, y, u, v, r, g, b, a. */
export const UI_VERTEX_FLOATS = 8;
export const UI_VERTEX_STRIDE = UI_VERTEX_FLOATS * 4; // 32 bytes
export const UI_VERTS_PER_QUAD = 6;

/** Which atlas a group samples. `Solid` samples a 1×1 white texel (tint only). */
export enum UiPage {
  Solid = 0,
  Bitmap = 1, // crisp bitmap-font glyph atlas (HUD/chips)
  Msdf = 2, // MSDF glyph atlas (world-anchored labels, smooth under zoom)
  Skin = 3, // painted chrome atlas (S3.5)
}

/** Screen-space HUD vs world-anchored UI — selects the pass' projection. */
export enum UiSpace {
  Screen = 0,
  World = 1,
}

/** A source sub-rect of an atlas page, in 0..1 UV. */
export interface UvRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** One uploadable draw: a vertex run for a single (space, page) pair. */
export interface UiDrawGroup {
  space: UiSpace;
  page: UiPage;
  vertices: Float32Array;
  vertexCount: number;
}

const SOLID_UV: UvRect = { u0: 0, v0: 0, u1: 0, v1: 0 };

/** group key packs (space, page) into one small int for a Map. */
function key(space: UiSpace, page: UiPage): number {
  return space * 16 + page;
}

export class UiBatcher {
  /** Per-(space,page) growable float lists, materialised on flush. */
  private groups = new Map<number, { space: UiSpace; page: UiPage; data: number[] }>();

  /** Clear all accumulated geometry (call at frame start). */
  reset(): void {
    this.groups.clear();
  }

  private bucket(space: UiSpace, page: UiPage): number[] {
    const k = key(space, page);
    let g = this.groups.get(k);
    if (!g) {
      g = { space, page, data: [] };
      this.groups.set(k, g);
    }
    return g.data;
  }

  /** Push one axis-aligned quad (two tris) with per-corner-shared UV + tint. */
  quad(
    x: number,
    y: number,
    w: number,
    h: number,
    color: Rgba,
    page: UiPage = UiPage.Solid,
    space: UiSpace = UiSpace.Screen,
    uv: UvRect = SOLID_UV,
  ): void {
    const data = this.bucket(space, page);
    const x1 = x + w;
    const y1 = y + h;
    const [r, g, b, a] = color;
    const { u0, v0, u1, v1 } = uv;
    // tri 1: TL, TR, BL — tri 2: TR, BR, BL
    push(data, x, y, u0, v0, r, g, b, a);
    push(data, x1, y, u1, v0, r, g, b, a);
    push(data, x, y1, u0, v1, r, g, b, a);
    push(data, x1, y, u1, v0, r, g, b, a);
    push(data, x1, y1, u1, v1, r, g, b, a);
    push(data, x, y1, u0, v1, r, g, b, a);
  }

  /** Solid fill (no texture). */
  rect(x: number, y: number, w: number, h: number, color: Rgba, space: UiSpace = UiSpace.Screen): void {
    this.quad(x, y, w, h, color, UiPage.Solid, space);
  }

  /** A `t`-thick frame (4 solid edges) inside the given rect. */
  border(x: number, y: number, w: number, h: number, t: number, color: Rgba, space: UiSpace = UiSpace.Screen): void {
    this.rect(x, y, w, t, color, space); // top
    this.rect(x, y + h - t, w, t, color, space); // bottom
    this.rect(x, y + t, t, h - 2 * t, color, space); // left
    this.rect(x + w - t, y + t, t, h - 2 * t, color, space); // right
  }

  /**
   * 9-slice: tessellate `dest` (x,y,w,h) into 9 quads whose corners stay at
   * fixed `border` size (in dest px) while the centre + edges stretch. `src` is
   * the page sub-rect (0..1 UV); `srcBorder` is the matching inset in SOURCE
   * pixels and `srcSize` the page dimensions, so corner UVs map 1:1. Used by
   * skinned panels/buttons (S3.5); gray-box S1 uses `rect`+`border` instead.
   */
  nineSlice(
    x: number,
    y: number,
    w: number,
    h: number,
    border: { l: number; t: number; r: number; b: number },
    color: Rgba,
    page: UiPage,
    src: UvRect,
    srcBorder: { l: number; t: number; r: number; b: number },
    srcSize: { w: number; h: number },
    space: UiSpace = UiSpace.Screen,
  ): void {
    // dest column x-edges and row y-edges
    const xs = [x, x + border.l, x + w - border.r, x + w];
    const ys = [y, y + border.t, y + h - border.b, y + h];
    // source UV edges from srcBorder/srcSize within src
    const su = (px: number) => src.u0 + (px / srcSize.w) * (src.u1 - src.u0);
    const sv = (px: number) => src.v0 + (px / srcSize.h) * (src.v1 - src.v0);
    const us = [src.u0, su(srcBorder.l), su(srcSize.w - srcBorder.r), src.u1];
    const vs = [src.v0, sv(srcBorder.t), sv(srcSize.h - srcBorder.b), src.v1];

    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const qx = xs[col];
        const qy = ys[row];
        const qw = xs[col + 1] - qx;
        const qh = ys[row + 1] - qy;
        if (qw <= 0 || qh <= 0) continue;
        this.quad(qx, qy, qw, qh, color, page, space, {
          u0: us[col],
          v0: vs[row],
          u1: us[col + 1],
          v1: vs[row + 1],
        });
      }
    }
  }

  /** Materialise every group into an uploadable vertex array. */
  flush(): UiDrawGroup[] {
    const out: UiDrawGroup[] = [];
    for (const g of this.groups.values()) {
      if (g.data.length === 0) continue;
      out.push({
        space: g.space,
        page: g.page,
        vertices: new Float32Array(g.data),
        vertexCount: g.data.length / UI_VERTEX_FLOATS,
      });
    }
    return out;
  }
}

function push(
  data: number[],
  x: number,
  y: number,
  u: number,
  v: number,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  data.push(x, y, u, v, r, g, b, a);
}
