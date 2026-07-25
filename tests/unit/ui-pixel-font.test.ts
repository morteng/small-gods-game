import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { BuiltinPixelFont, supportedGlyphs } from '@/render/ui/text/pixel-font';
import { UiPage } from '@/render/ui/ui-batcher';

const f = new BuiltinPixelFont();

describe('BuiltinPixelFont', () => {
  it('measures by 6px advance per char (5px glyph + 1px tracking)', () => {
    expect(f.measure('ABC', 1)).toBe(18);
    expect(f.measure('ABC', 2)).toBe(36);
    expect(f.measure('', 1)).toBe(0);
  });

  it('line height is (7+2) px per scale', () => {
    expect(f.lineHeight(1)).toBe(9);
    expect(f.lineHeight(3)).toBe(27);
  });

  it('emits one Solid-page quad per lit pixel', () => {
    // 'I' is a known glyph: top bar (5) + stem (5 rows × 1) + bottom bar (5) = 15 lit px
    const quads = f.layout('I', 0, 0, 1);
    expect(quads.length).toBe(15);
    expect(quads.every((q) => q.page === UiPage.Solid)).toBe(true);
    expect(quads.every((q) => q.w === 1 && q.h === 1)).toBe(true);
  });

  it('scales each lit pixel to scale×scale and offsets by advance', () => {
    const q1 = f.layout('I', 0, 0, 1);
    const q2 = f.layout('I', 0, 0, 2);
    expect(q2.length).toBe(q1.length); // same lit-pixel count
    expect(q2.every((q) => q.w === 2 && q.h === 2)).toBe(true);
    // second char starts one advance (6 px) to the right at scale 1
    const two = f.layout('II', 0, 0, 1);
    const maxX = Math.max(...two.map((q) => q.x));
    expect(maxX).toBeGreaterThanOrEqual(6);
  });

  it('is case-insensitive (lowercase maps to the uppercase glyph)', () => {
    expect(f.layout('a', 0, 0, 1)).toEqual(f.layout('A', 0, 0, 1));
  });

  it('renders the ellipsis glyph (button clip marker) as real pixels', () => {
    // '…' backs the button primitive's label clip — it must be a mapped glyph,
    // not a blank cell, or clipped labels would end in nothing.
    expect(f.layout('…', 0, 0, 1)).toHaveLength(3); // three dots on the baseline
  });

  it('skips spaces and unknown glyphs but still advances the cursor', () => {
    expect(f.layout(' ', 0, 0, 1)).toHaveLength(0);
    expect(f.layout('~~', 0, 0, 1).length).toBeGreaterThan(0); // '~' is now mapped (P1-B); use an unmapped pair
    expect(f.layout('', 0, 0, 1)).toHaveLength(0); // unmapped control char
    // 'A B' — the space contributes no quads but shifts the 'B' to cell index 2
    const ab = f.layout('A B', 0, 0, 1);
    const minX = Math.min(...ab.map((q) => q.x));
    const maxX = Math.max(...ab.map((q) => q.x));
    expect(minX).toBe(0); // 'A' starts at the origin
    expect(maxX).toBeGreaterThanOrEqual(12); // 'B' is at cell index 2 (×6 px)
  });
});

// P1-B (spec §4.1): the chrome used icon glyphs, curly quotes, an em dash, a small
// continue-arrow, inline multiplication/approx marks, and (found live) ordinary
// ASCII punctuation — none of which the table defined, so they rendered BLANK.
// Every one of these must now emit real, in-bounds pixels.
const NEW_GLYPHS = [
  '⚡', '✉', '◎', '🔒', '⏸', '▶', '✦', '“', '”', '‘', '’',
  '—', '▸', '×', '≈',
  ',', ';', '!', '?', "'", '"', '(', ')', '[', ']', '{', '}',
  '<', '>', '=', '*', '%', '&', '#', '@', '$', '_', '|', '~', '\\', '^',
];

describe('P1-B: newly added glyphs', () => {
  for (const g of NEW_GLYPHS) {
    it(`"${g}" renders a non-zero, in-bounds 5×7 cell`, () => {
      const quads = f.layout(g, 0, 0, 1);
      expect(quads.length).toBeGreaterThan(0);
      for (const q of quads) {
        expect(q.x).toBeGreaterThanOrEqual(0);
        expect(q.x).toBeLessThan(5); // GW
        expect(q.y).toBeGreaterThanOrEqual(0);
        expect(q.y).toBeLessThan(7); // GH
        expect(q.w).toBe(1);
        expect(q.h).toBe(1);
        expect(q.page).toBe(UiPage.Solid);
      }
    });
  }

  it('every glyph in the live table (not just the new ones) renders in-bounds', () => {
    // Whole-table sweep: catches a future glyph added with a mis-sized row string
    // (e.g. 4 or 6 chars) that would otherwise only show up as a subtly wrong
    // shape on screen, never a test failure.
    for (const g of supportedGlyphs()) {
      const quads = f.layout(g, 0, 0, 1);
      expect(quads.length, `glyph "${g}" must render at least one pixel`).toBeGreaterThan(0);
      for (const q of quads) {
        expect(q.x, `glyph "${g}" x out of bounds`).toBeGreaterThanOrEqual(0);
        expect(q.x, `glyph "${g}" x out of bounds`).toBeLessThan(5);
        expect(q.y, `glyph "${g}" y out of bounds`).toBeGreaterThanOrEqual(0);
        expect(q.y, `glyph "${g}" y out of bounds`).toBeLessThan(7);
      }
    }
  });

  it('opening and closing curly quotes are mirror images, not the same mark', () => {
    const open = f.layout('“', 0, 0, 1);
    const close = f.layout('”', 0, 0, 1);
    expect(open).not.toEqual(close);
    expect(open.length).toBe(close.length); // same ink weight, different shape
    const openSingle = f.layout('‘', 0, 0, 1);
    const closeSingle = f.layout('’', 0, 0, 1);
    expect(openSingle).not.toEqual(closeSingle);
    // The doubles use two marks, the singles one — so the singles carry roughly
    // half the ink of the doubles.
    expect(openSingle.length).toBeLessThan(open.length);
  });
});

describe('BuiltinPixelFont bold mode (spec §4.1: title wordmark)', () => {
  it('non-bold behaviour is unchanged (bold defaults to off)', () => {
    const implicit = f.layout('SMALL GODS', 0, 0, 2);
    const explicit = f.layout('SMALL GODS', 0, 0, 2, false);
    expect(implicit).toEqual(explicit);
    expect(f.measure('SMALL GODS', 2)).toBe(f.measure('SMALL GODS', 2, false));
  });

  it('bold emits exactly 2x the quads of non-bold for the same text', () => {
    const text = 'FATE';
    const plain = f.layout(text, 0, 0, 3, false);
    const bold = f.layout(text, 0, 0, 3, true);
    expect(bold.length).toBe(plain.length * 2);
  });

  it('bold redraws each lit pixel offset by exactly +1 scale unit in x', () => {
    const plain = f.layout('I', 0, 0, 2, false);
    const bold = f.layout('I', 0, 0, 2, true);
    // For every plain quad there is a bold quad at the same (y) and x+scale.
    for (const p of plain) {
      const shifted = bold.find((b) => b.y === p.y && b.x === p.x + 2);
      expect(shifted).toBeDefined();
    }
    // And the original (unshifted) pixel is also still present in the bold set.
    for (const p of plain) {
      const same = bold.find((b) => b.y === p.y && b.x === p.x);
      expect(same).toBeDefined();
    }
  });

  it('measure(bold) is a safe upper bound of the actual bold ink extent, growing by one scale unit (not a whole cell)', () => {
    const text = 'WORDMARK';
    const scale = 3;
    const plainMeasure = f.measure(text, scale, false);
    const boldMeasure = f.measure(text, scale, true);
    expect(boldMeasure - plainMeasure).toBe(scale); // grows by ONE scale unit, not ADVANCE*scale
    const boldQuads = f.layout(text, 0, 0, scale, true);
    const rightmost = Math.max(...boldQuads.map((q) => q.x + q.w));
    expect(rightmost).toBeLessThanOrEqual(boldMeasure); // never clips
  });

  it('bold on an astral glyph (🔒) still advances by one code point, not two UTF-16 units', () => {
    // 🔒 is U+1F512 — a surrogate pair in JS strings. `text.length`/`text[i]`
    // indexing would split it into two lone-surrogate "characters"; `layout`
    // and `measure` must treat it as ONE glyph (Array.from is code-point aware).
    const solo = f.layout('🔒', 0, 0, 1, false);
    const pair = f.layout('🔒A', 0, 0, 1, false);
    expect(solo.length).toBeGreaterThan(0);
    // 'A' in the pair starts exactly one ADVANCE cell after 🔒, not two.
    const aQuads = pair.filter((q) => q.x >= 6);
    const lockQuads = pair.filter((q) => q.x < 6);
    expect(lockQuads.length).toBe(solo.length);
    expect(aQuads.length).toBeGreaterThan(0);
    expect(f.measure('🔒', 1)).toBe(6); // one ADVANCE cell, not two
  });
});

// ---------------------------------------------------------------------------
// Coverage guard: every non-ASCII character literal that the WebGPU chrome
// actually renders through BuiltinPixelFont must exist in the glyph table, or
// it silently draws a blank gap (this is exactly how ⚡/✉/◎/🔒/⏸/▶/✦/curly-quotes
// went missing for a whole round). Scans the REAL source on disk — a future
// label with a new glyph fails THIS test, not a live screenshot nobody looks at.
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const UI_DIR = join(ROOT, 'src', 'render', 'ui');

// Two "DOM islands" (`ui-whisper-island.ts`, `ui-settings-island.ts`) intentionally
// render real `<input>`/`<button>` DOM text via the browser's own font stack — by
// design (see their file-header comments), never through BuiltinPixelFont. The
// `wgsl/` dir holds WGSL SHADER SOURCE strings, not UI text. None of these need
// glyph-table coverage; ui-cpu-purity.test.ts draws the same wgsl/ line.
const NOT_PIXEL_FONT_TEXT = new Set(['ui-whisper-island.ts', 'ui-settings-island.ts']);

function tsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'wgsl' ? [] : tsFiles(p);
    if (!name.endsWith('.ts')) return [];
    return NOT_PIXEL_FONT_TEXT.has(name) ? [] : [p];
  });
}

/**
 * Walks TS source char-by-char with a tiny state machine (normal code / line
 * comment / block comment / '…' string / "…" string / `…` template, including
 * `${ }` interpolation which re-enters "code") and collects every character
 * found INSIDE a string/template literal (never inside a comment or bare code)
 * that falls outside printable ASCII space-through-tilde (0x20–0x7E) or is a
 * whitespace control character (tab/CR/LF — formatting, not a glyph; e.g. WGSL
 * source embedded in a template literal elsewhere in the tree).
 */
function nonAsciiStringLiteralChars(src: string): Set<string> {
  const found = new Set<string>();
  type Frame = { type: 'normal' | 'line-comment' | 'block-comment' | 'sq' | 'dq' | 'template' | 'expr'; depth?: number };
  const frames: Frame[] = [{ type: 'normal' }];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const top = frames[frames.length - 1];
    const ch = src[i];

    if (top.type === 'line-comment') {
      if (ch === '\n') frames.pop();
      i++;
      continue;
    }
    if (top.type === 'block-comment') {
      if (ch === '*' && src[i + 1] === '/') {
        frames.pop();
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (top.type === 'sq' || top.type === 'dq') {
      const quote = top.type === 'sq' ? "'" : '"';
      if (ch === '\\') {
        i += 2; // skip the escape entirely (e.g. \n, \', \\) — never a real glyph
        continue;
      }
      if (ch === quote) {
        frames.pop();
        i++;
        continue;
      }
      if (ch === '\n') {
        frames.pop(); // unterminated (shouldn't happen in valid TS) — bail safely
        i++;
        continue;
      }
      recordIfGlyph(src, i, found);
      i += charLen(src, i);
      continue;
    }
    if (top.type === 'template') {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '`') {
        frames.pop();
        i++;
        continue;
      }
      if (ch === '$' && src[i + 1] === '{') {
        frames.push({ type: 'expr', depth: 1 });
        i += 2;
        continue;
      }
      recordIfGlyph(src, i, found);
      i += charLen(src, i);
      continue;
    }

    // 'normal' (top-level code) or 'expr' (code inside a `${ }` interpolation)
    if (ch === '/' && src[i + 1] === '/') {
      frames.push({ type: 'line-comment' });
      i += 2;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      frames.push({ type: 'block-comment' });
      i += 2;
      continue;
    }
    if (ch === "'") {
      frames.push({ type: 'sq' });
      i++;
      continue;
    }
    if (ch === '"') {
      frames.push({ type: 'dq' });
      i++;
      continue;
    }
    if (ch === '`') {
      frames.push({ type: 'template' });
      i++;
      continue;
    }
    if (top.type === 'expr') {
      if (ch === '{') {
        top.depth = (top.depth ?? 1) + 1;
        i++;
        continue;
      }
      if (ch === '}') {
        top.depth = (top.depth ?? 1) - 1;
        i++;
        if (top.depth === 0) frames.pop(); // back to the enclosing template
        continue;
      }
    }
    i++;
  }
  return found;
}

function charLen(src: string, i: number): number {
  const cp = src.codePointAt(i)!;
  return cp > 0xffff ? 2 : 1; // surrogate pairs (e.g. 🔒) are one code point, two units
}

function recordIfGlyph(src: string, i: number, found: Set<string>): void {
  const cp = src.codePointAt(i)!;
  if (cp < 0x20 || (cp >= 0x20 && cp <= 0x7e)) return; // ASCII printable, or whitespace control (\n/\t/\r) — never a glyph gap
  found.add(String.fromCodePoint(cp));
}

describe('coverage guard: every glyph the WebGPU UI source renders is in the pixel font', () => {
  const glyphs = supportedGlyphs();
  const files = tsFiles(UI_DIR);

  it('scans a non-trivial file set (guards against a silently-empty walk)', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of files) {
    const rel = file.slice(ROOT.length + 1);
    it(`${rel}: every string-literal glyph is renderable`, () => {
      const src = readFileSync(file, 'utf8');
      const used = nonAsciiStringLiteralChars(src);
      const missing = [...used].filter((c) => !glyphs.has(c.toUpperCase()) && !glyphs.has(c));
      expect(missing, `${rel} uses glyph(s) not in pixel-font.ts's table: ${missing.join(' ')}`).toEqual([]);
    });
  }
});
