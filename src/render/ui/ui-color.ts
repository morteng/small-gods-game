// src/render/ui/ui-color.ts
//
// Colour parsing for the WebGPU UI layer (S1). The batcher stores STRAIGHT
// (non-premultiplied) RGBA 0..1 — the UI fragment shader premultiplies, matching
// the entity/shape passes' premultiplied src-over blend.
//
// We parse the SAME oklch source strings the canvas palette already uses
// (`src/render/canvas-palette.ts`) so chrome and world share one colour source.
// Plain `#hex` / `rgb()` / `rgba()` are accepted too for convenience. Pure data,
// no DOM, no Canvas2D `getComputedStyle` round-trip — unit-testable in Node.

import { clamp01 } from '@/core/math';

/** Straight (non-premultiplied) RGBA, each channel 0..1. */
export type Rgba = readonly [number, number, number, number];

/** Linear-light → gamma-encoded sRGB (per channel). */
function linearToSrgb(x: number): number {
  const c = clamp01(x);
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/**
 * oklch → straight sRGB 0..1 (Björn Ottosson's transform). `L` 0..1, `C` chroma,
 * `h` hue degrees, `alpha` 0..1. Deterministic; out-of-gamut results are clamped
 * per channel (good enough for UI chrome).
 */
export function oklchToRgba(L: number, C: number, h: number, alpha = 1): Rgba {
  const hr = (h * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return [linearToSrgb(r), linearToSrgb(g), linearToSrgb(bl), clamp01(alpha)];
}

function parseHex(hex: string): Rgba {
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

/**
 * Parse a CSS colour string the UI uses: `oklch(L C h)` / `oklch(L C h / a)`,
 * `#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa`, `rgb()`/`rgba()`. Unknown ⇒ opaque
 * magenta so mistakes are loud, not silently black.
 */
export function parseUiColor(css: string): Rgba {
  const s = css.trim();

  const ok = /^oklch\(\s*([^)]+)\)$/i.exec(s);
  if (ok) {
    // "L C h" or "L C h / a"; L may be a percentage.
    const [coords, alphaStr] = ok[1].split('/').map((x) => x.trim());
    const parts = coords.split(/\s+/);
    const L = parts[0].endsWith('%') ? parseFloat(parts[0]) / 100 : parseFloat(parts[0]);
    const C = parseFloat(parts[1]);
    const h = parseFloat(parts[2]);
    const alpha =
      alphaStr == null ? 1 : alphaStr.endsWith('%') ? parseFloat(alphaStr) / 100 : parseFloat(alphaStr);
    return oklchToRgba(L || 0, C || 0, h || 0, Number.isNaN(alpha) ? 1 : alpha);
  }

  if (s[0] === '#') return parseHex(s.slice(1));

  const rgb = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (rgb) {
    const p = rgb[1].split(',').map((x) => parseFloat(x.trim()));
    return [(p[0] || 0) / 255, (p[1] || 0) / 255, (p[2] || 0) / 255, p[3] == null ? 1 : p[3]];
  }

  return [1, 0, 1, 1]; // unknown ⇒ loud magenta
}

/** Multiply a colour's lightness toward white (`t`>0) or black (`t`<0), keeping alpha. */
export function shade([r, g, b, a]: Rgba, t: number): Rgba {
  if (t >= 0) return [r + (1 - r) * t, g + (1 - g) * t, b + (1 - b) * t, a];
  const k = 1 + t; // t in [-1,0]
  return [r * k, g * k, b * k, a];
}

/** Replace a colour's alpha. */
export function withAlpha([r, g, b]: Rgba, a: number): Rgba {
  return [r, g, b, clamp01(a)];
}
