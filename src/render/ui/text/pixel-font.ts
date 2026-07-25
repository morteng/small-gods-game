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
  '…': ['     ', '     ', '     ', '     ', '     ', '     ', '# # #'],
  // Icon glyphs used by the WebGPU chrome (unknown chars render BLANK, so every
  // label glyph must exist here). ✕ = close, ⏭ = skip-to-next (▶|), ⏳ = elapsed.
  '✕': ['     ', '#   #', ' # # ', '  #  ', ' # # ', '#   #', '     '],
  '⏭': ['#   #', '##  #', '### #', '#####', '### #', '##  #', '#   #'],
  '⏳': ['#####', ' ### ', '  #  ', '  #  ', ' ### ', '#####', '     '],

  // P1-B (spec §4.1): the chrome used several icon/quote glyphs the table never
  // defined, so they rendered as invisible gaps ("⚡ POWERS", "✉ INBOX", quoted
  // NPC lines, …). ⚡ = powers panel / cast button, ✉ = inbox panel, ◎ = active
  // -target reticle, 🔒 = locked affordance, ⏸ = pause (transport / rate badge),
  // ▶ = resume (transport), ✦ = omen-block bullet. Curly quotes wrap dialog: “/‘
  // curl down-LEFT into the quoted text (opening), ”/’ curl down-RIGHT out of it
  // (closing) — the two mirror each other so they read as a matched pair; the
  // single marks are the SAME stroke as the doubles but drawn once, per spec.
  '⚡': ['  ## ', ' ##  ', '###  ', ' ### ', '  ## ', ' ##  ', '##   '],
  '✉': ['#####', '## ##', '# # #', '#   #', '#   #', '#   #', '#####'],
  '◎': [' ### ', '#   #', '#   #', '# # #', '#   #', '#   #', ' ### '],
  '🔒': [' ### ', '#   #', '#####', '#   #', '# # #', '#   #', '#####'],
  '⏸': ['## ##', '## ##', '## ##', '## ##', '## ##', '## ##', '## ##'],
  '▶': ['#    ', '##   ', '###  ', '#####', '###  ', '##   ', '#    '],
  '✦': ['  #  ', '  #  ', ' ### ', '#####', ' ### ', '  #  ', '  #  '],
  '“': [' #  #', '#  # ', '     ', '     ', '     ', '     ', '     '],
  '”': ['#  # ', ' #  #', '     ', '     ', '     ', '     ', '     '],
  '‘': ['  #  ', ' #   ', '     ', '     ', '     ', '     ', '     '],
  '’': [' #   ', '  #  ', '     ', '     ', '     ', '     ', '     '],

  // Extras the coverage guard (tests/unit/ui-pixel-font.test.ts) turned up in real
  // ui-runtime.ts labels beyond §4.1's list — a blank glyph here is a build
  // failure, not a shrug, so these got real designs too. — = em dash (msg / choice
  // -hint separator; thicker than '-' since width can't grow), ▸ = small
  // continue-arrow (distinct from the full-height ▶ resume triangle), × = inline
  // multiplication for rate labels ("8×"; smaller than the ✕ close icon), ≈ =
  // approx (effective-rate badge, "≈3×").
  '—': ['     ', '     ', '     ', '#####', '#####', '     ', '     '],
  '▸': ['     ', '     ', '#    ', '##   ', '#    ', '     ', '     '],
  '×': ['     ', '     ', '#   #', '  #  ', '#   #', '     ', '     '],
  '≈': ['     ', ' # # ', '# # #', '     ', ' # # ', '# # #', '     '],

  // Punctuation the whole 5×7 table was missing (found live: prose surfaces like
  // whisper-card paragraphs and dialog quotes render blank wherever there's a
  // comma, an apostrophe, or any bracket/symbol — a pre-existing rendering defect,
  // not just a UI-v3 need). ',' and ';' hang below the baseline like real
  // punctuation; the straight ' and " sit in the TOP rows and are deliberately
  // simpler marks than the curly “ ” ‘ ’ above so the two families read apart.
  ',': ['     ', '     ', '     ', '     ', '  #  ', '  #  ', ' #   '],
  ';': ['     ', '     ', '  #  ', '     ', '  #  ', '  #  ', ' #   '],
  '!': ['  #  ', '  #  ', '  #  ', '  #  ', '     ', '  #  ', '     '],
  '?': [' ### ', '#   #', '    #', '   # ', '  #  ', '     ', '  #  '],
  "'": ['  #  ', '  #  ', '     ', '     ', '     ', '     ', '     '],
  '"': [' # # ', ' # # ', '     ', '     ', '     ', '     ', '     '],
  '(': ['  ## ', ' #   ', '#    ', '#    ', '#    ', ' #   ', '  ## '],
  ')': [' ##  ', '   # ', '    #', '    #', '    #', '   # ', ' ##  '],
  '[': ['#### ', '#    ', '#    ', '#    ', '#    ', '#    ', '#### '],
  ']': [' ####', '    #', '    #', '    #', '    #', '    #', ' ####'],
  '{': ['  ## ', '  #  ', '  #  ', '##   ', '  #  ', '  #  ', '  ## '],
  '}': [' ##  ', '  #  ', '  #  ', '   ##', '  #  ', '  #  ', ' ##  '],
  '<': ['   # ', '  #  ', ' #   ', '#    ', ' #   ', '  #  ', '   # '],
  '>': [' #   ', '  #  ', '   # ', '    #', '   # ', '  #  ', ' #   '],
  '=': ['     ', '     ', '#####', '     ', '#####', '     ', '     '],
  '*': ['     ', '# # #', ' ### ', '# # #', '     ', '     ', '     '],
  '%': ['##  #', '## # ', '   # ', '  #  ', ' #   ', ' # ##', '#  ##'],
  '&': [' ##  ', '#  # ', ' ##  ', '#  ##', '#   #', '#  # ', ' ## #'],
  '#': [' # # ', ' # # ', '#####', ' # # ', '#####', ' # # ', ' # # '],
  '@': [' ### ', '#   #', '# ###', '# # #', '# ###', '#    ', ' ### '],
  '$': ['  #  ', ' ####', '# #  ', ' ### ', '  # #', '#### ', '  #  '],
  '_': ['     ', '     ', '     ', '     ', '     ', '     ', '#####'],
  '|': ['  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '  #  '],
  '~': ['     ', '     ', ' #  #', '# ## ', '     ', '     ', '     '],
  '\\': ['#    ', '#    ', ' #   ', '  #  ', '   # ', '    #', '    #'],
  '^': ['  #  ', ' # # ', '#   #', '     ', '     ', '     ', '     '],
};

/** The set of glyphs `BuiltinPixelFont` can render (uppercase for letters, the
 *  symbols/digits as themselves). Exported so drift guards (e.g. the
 *  ui-runtime.ts coverage scan in `tests/unit/ui-pixel-font.test.ts`) can check
 *  against the REAL table instead of re-declaring their own copy of it. */
export function supportedGlyphs(): ReadonlySet<string> {
  return new Set(Object.keys(G));
}

const EMPTY_UV: UvRect = { u0: 0, v0: 0, u1: 0, v1: 0 };

/** 5×7 solid-pixel font: each lit pixel → one Solid-page quad. */
export class BuiltinPixelFont implements FontMetrics {
  lineHeight(scale: number): number {
    return (GH + 2) * scale;
  }

  measure(text: string, scale: number, bold = false): number {
    // Array.from splits by CODE POINT, not UTF-16 unit — required so an astral
    // glyph like 🔒 (U+1F512, a surrogate pair) counts as ONE character, matching
    // `layout`'s per-glyph advance instead of double-counting its two units.
    const len = Array.from(text).length;
    // Bold redraws each lit pixel offset +1px in x (see `layout`); every glyph in
    // `G` is confined to its GW=5 columns, and ADVANCE=GW+1 already reserves a
    // trailing 1px tracking column that's normally blank — bold's shifted copy of
    // a rightmost-column (c=GW-1) pixel lands exactly in that reserved slot, so
    // the advance only needs to grow by one `scale` for the whole string (the
    // last glyph's overhang), never a whole extra cell per character.
    return len * ADVANCE * scale + (bold ? scale : 0);
  }

  /** The visible-ink advance of `text` — `measure` minus the blank trailing
   *  tracking column. Centring by `measure` sat every label ~half a font-pixel
   *  left of optical centre (visible as a full pixel of slack on the RIGHT of
   *  the title wordmark); anything that CENTRES text must centre this. `bold`'s
   *  +1px overhang lands in the tracking column, so the subtraction holds. */
  inkWidth(text: string, scale: number, bold = false): number {
    const m = this.measure(text, scale, bold);
    return m === 0 ? 0 : m - scale;
  }

  /** Lay out `text`. `bold` (title wordmark only, spec §4.1) redraws every lit
   *  pixel a second time, offset +1px in x, for a heavier stroke — no second
   *  font, no atlas.
   *
   *  Ink is drawn ONE leading row down (`+1`): `lineHeight` is GH+2, and with
   *  both leading pixels below the ink every box-centred label sat a full
   *  font-pixel high of true centre. Symmetric leading (1 above, 1 below)
   *  makes box-centring optically correct for every widget at once. */
  layout(text: string, x: number, y: number, scale: number, bold = false): GlyphQuad[] {
    const out: GlyphQuad[] = [];
    const chars = Array.from(text); // code-point-aware split — see `measure`
    for (let ci = 0; ci < chars.length; ci++) {
      const rows = G[chars[ci].toUpperCase()];
      if (!rows) continue; // space + unknown ⇒ blank cell, advance only
      const gx = x + ci * ADVANCE * scale;
      for (let r = 0; r < GH; r++) {
        const row = rows[r];
        for (let c = 0; c < GW; c++) {
          if (row[c] !== '#') continue;
          out.push({
            x: gx + c * scale,
            y: y + (r + 1) * scale,
            w: scale,
            h: scale,
            page: UiPage.Solid,
            uv: EMPTY_UV,
          });
          if (bold) {
            out.push({
              x: gx + (c + 1) * scale,
              y: y + (r + 1) * scale,
              w: scale,
              h: scale,
              page: UiPage.Solid,
              uv: EMPTY_UV,
            });
          }
        }
      }
    }
    return out;
  }
}
