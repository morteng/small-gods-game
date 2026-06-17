// src/render/ui/text/pixel-font.ts
//
// Built-in 5×7 bitmap pixel font for the WebGPU UI (S1). Each lit glyph pixel is
// emitted as a tiny SOLID-page quad, so readable text renders with NO atlas and
// NO texture upload — it rides the same Solid draw the panels/buttons use. Perfect
// for short HUD/chip text; a real packed atlas (S2) can replace it for heavier
// text without changing `ui-context` (same `FontMetrics` interface).
//
// Uppercase + digits + the symbols the HUD needs. Pure data — Node-testable.

import { UiPage, type UvRect } from '@/render/ui/ui-batcher';
import type { FontMetrics, GlyphQuad } from '@/render/ui/text/font';

const GW = 5; // glyph pixel width
const GH = 7; // glyph pixel height
const ADVANCE = GW + 1; // 1px tracking

// '#' = lit, ' ' = empty. 7 rows × 5 cols.
const G: Record<string, string[]> = {
  A: [' ### ', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'],
  B: ['#### ', '#   #', '#   #', '#### ', '#   #', '#   #', '#### '],
  C: [' ####', '#    ', '#    ', '#    ', '#    ', '#    ', ' ####'],
  D: ['#### ', '#   #', '#   #', '#   #', '#   #', '#   #', '#### '],
  E: ['#####', '#    ', '#    ', '#### ', '#    ', '#    ', '#####'],
  F: ['#####', '#    ', '#    ', '#### ', '#    ', '#    ', '#    '],
  G: [' ####', '#    ', '#    ', '#  ##', '#   #', '#   #', ' ####'],
  H: ['#   #', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'],
  I: ['#####', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '#####'],
  J: ['#####', '    #', '    #', '    #', '#   #', '#   #', ' ### '],
  K: ['#   #', '#  # ', '# #  ', '##   ', '# #  ', '#  # ', '#   #'],
  L: ['#    ', '#    ', '#    ', '#    ', '#    ', '#    ', '#####'],
  M: ['#   #', '## ##', '# # #', '# # #', '#   #', '#   #', '#   #'],
  N: ['#   #', '##  #', '# # #', '# # #', '#  ##', '#   #', '#   #'],
  O: [' ### ', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '],
  P: ['#### ', '#   #', '#   #', '#### ', '#    ', '#    ', '#    '],
  Q: [' ### ', '#   #', '#   #', '#   #', '# # #', '#  # ', ' ## #'],
  R: ['#### ', '#   #', '#   #', '#### ', '# #  ', '#  # ', '#   #'],
  S: [' ####', '#    ', '#    ', ' ### ', '    #', '    #', '#### '],
  T: ['#####', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '  #  '],
  U: ['#   #', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '],
  V: ['#   #', '#   #', '#   #', '#   #', '#   #', ' # # ', '  #  '],
  W: ['#   #', '#   #', '#   #', '# # #', '# # #', '## ##', '#   #'],
  X: ['#   #', '#   #', ' # # ', '  #  ', ' # # ', '#   #', '#   #'],
  Y: ['#   #', '#   #', ' # # ', '  #  ', '  #  ', '  #  ', '  #  '],
  Z: ['#####', '    #', '   # ', '  #  ', ' #   ', '#    ', '#####'],
  '0': [' ### ', '#   #', '#  ##', '# # #', '##  #', '#   #', ' ### '],
  '1': ['  #  ', ' ##  ', '  #  ', '  #  ', '  #  ', '  #  ', ' ### '],
  '2': [' ### ', '#   #', '    #', '   # ', '  #  ', ' #   ', '#####'],
  '3': ['#####', '   # ', '  #  ', '   # ', '    #', '#   #', ' ### '],
  '4': ['   # ', '  ## ', ' # # ', '#  # ', '#####', '   # ', '   # '],
  '5': ['#####', '#    ', '#### ', '    #', '    #', '#   #', ' ### '],
  '6': [' ### ', '#    ', '#    ', '#### ', '#   #', '#   #', ' ### '],
  '7': ['#####', '    #', '   # ', '  #  ', ' #   ', ' #   ', ' #   '],
  '8': [' ### ', '#   #', '#   #', ' ### ', '#   #', '#   #', ' ### '],
  '9': [' ### ', '#   #', '#   #', ' ####', '    #', '    #', ' ### '],
  '-': ['     ', '     ', '     ', '#####', '     ', '     ', '     '],
  '+': ['     ', '  #  ', '  #  ', '#####', '  #  ', '  #  ', '     '],
  '/': ['    #', '    #', '   # ', '  #  ', ' #   ', '#    ', '#    '],
  '.': ['     ', '     ', '     ', '     ', '     ', '     ', '  #  '],
  ':': ['     ', '  #  ', '     ', '     ', '     ', '  #  ', '     '],
  '·': ['     ', '     ', '     ', '  #  ', '     ', '     ', '     '],
};

const EMPTY_UV: UvRect = { u0: 0, v0: 0, u1: 0, v1: 0 };

/** 5×7 solid-pixel font: each lit pixel → one Solid-page quad. */
export class BuiltinPixelFont implements FontMetrics {
  lineHeight(scale: number): number {
    return (GH + 2) * scale;
  }

  measure(text: string, scale: number): number {
    return text.length * ADVANCE * scale;
  }

  layout(text: string, x: number, y: number, scale: number): GlyphQuad[] {
    const out: GlyphQuad[] = [];
    for (let ci = 0; ci < text.length; ci++) {
      const rows = G[text[ci].toUpperCase()];
      if (!rows) continue; // space + unknown ⇒ blank cell, advance only
      const gx = x + ci * ADVANCE * scale;
      for (let r = 0; r < GH; r++) {
        const row = rows[r];
        for (let c = 0; c < GW; c++) {
          if (row[c] !== '#') continue;
          out.push({
            x: gx + c * scale,
            y: y + r * scale,
            w: scale,
            h: scale,
            page: UiPage.Solid,
            uv: EMPTY_UV,
          });
        }
      }
    }
    return out;
  }
}
