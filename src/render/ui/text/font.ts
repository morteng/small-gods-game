// src/render/ui/text/font.ts
//
// Font abstraction for the WebGPU UI layer. `ui-context` measures + lays out text
// through this interface only, so it is agnostic to WHICH backing exists:
//   - S1 (now): `MonospaceFont` — a gray-box fallback that needs no atlas. It
//     emits one Solid-page block per visible glyph ("redacted text"), proving the
//     layout + text path end-to-end before any atlas is generated.
//   - S2: a real bitmap atlas + (S3) MSDF atlas implement the SAME interface,
//     returning real glyph quads on the Bitmap/Msdf pages. No `ui-context` change.
//
// Pure data — no WebGPU, no DOM. Unit-testable.

import { UiPage, type UvRect } from '@/render/ui/ui-batcher';

/** A positioned glyph quad in screen/device px, with its atlas page + source UV. */
export interface GlyphQuad {
  x: number;
  y: number;
  w: number;
  h: number;
  page: UiPage;
  uv: UvRect;
}

export interface FontMetrics {
  /** Line advance (px) at the given integer scale. */
  lineHeight(scale: number): number;
  /** Total advance width (px) of `text` at `scale`. */
  measure(text: string, scale: number): number;
  /** Lay `text` out with its top-left at (x, y); returns one quad per visible glyph. */
  layout(text: string, x: number, y: number, scale: number): GlyphQuad[];
}

const EMPTY_UV: UvRect = { u0: 0, v0: 0, u1: 0, v1: 0 };

/**
 * Fixed-cell gray-box font. `cellW`×`cellH` is the glyph cell at scale 1; the
 * block is inset by `pad` so adjacent glyphs read as separate marks. Whitespace
 * advances without emitting a quad.
 */
export class MonospaceFont implements FontMetrics {
  constructor(
    private readonly cellW = 6,
    private readonly cellH = 9,
    private readonly pad = 1,
  ) {}

  lineHeight(scale: number): number {
    return this.cellH * scale;
  }

  measure(text: string, scale: number): number {
    return text.length * this.cellW * scale;
  }

  layout(text: string, x: number, y: number, scale: number): GlyphQuad[] {
    const out: GlyphQuad[] = [];
    const cw = this.cellW * scale;
    const ch = this.cellH * scale;
    const p = this.pad * scale;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === ' ' || c === '\t' || c === '\n') continue;
      out.push({
        x: x + i * cw + p,
        y: y + p,
        w: cw - 2 * p,
        h: ch - 2 * p,
        page: UiPage.Solid,
        uv: EMPTY_UV,
      });
    }
    return out;
  }
}
