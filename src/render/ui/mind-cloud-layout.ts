// src/render/ui/mind-cloud-layout.ts
//
// Deterministic layout for the PROBE MIND word cloud (B, mind-reading).
//
// Pure: it takes the weighted tokens + a box + a text-measuring seam, and returns
// placed words. No WebGPU, no sim — so it unit-tests without a device, and the
// ui-runtime just draws what it returns. Two rules make it "honest" not cliche:
//   • size is BANDED — four native tiers keyed to weight (the pixel-perfect rule:
//     a few real sizes, never continuous fractional scaling); and
//   • layout is a deterministic Archimedean spiral (biggest thought settles at the
//     centre, the rest orbit) with NO rotation and NO randomness — so the same
//     mind always resolves to the same picture and never jitters frame to frame.
// Words that can't fit the box are dropped, not shrunk — legibility over coverage.

import type { CloudToken, CloudTone } from '@/story/uispec';

export interface PlacedWord {
  text: string;
  tone: CloudTone;
  /** Font size in device px (a banded tier of `base`). */
  fs: number;
  /** 0–1 opacity — louder thoughts read brighter. */
  alpha: number;
  /** Top-left device-px anchor for the glyph run. */
  x: number;
  y: number;
}

export interface CloudBox { x: number; y: number; w: number; h: number; }

/** The measuring seam the ui-runtime fills with `c.measure` / `c.lineHeight`. */
export interface CloudMeasure {
  /** Base font unit (device px) — the tiers scale off this. */
  base: number;
  measure(text: string, fs: number): number;
  lineHeight(fs: number): number;
}

/** Four native size tiers as multiples of the base unit, keyed to weight bands.
 *  Mirrors the banded-lighting aesthetic and the "native sizes over fractional
 *  scaling" rule — a token is one of exactly four sizes, never in between. */
function bandFs(weight: number, base: number): number {
  const mult = weight >= 0.8 ? 2.3 : weight >= 0.6 ? 1.65 : weight >= 0.4 ? 1.2 : 0.92;
  return base * mult;
}

function overlaps(a: CloudBox, b: CloudBox, pad: number): boolean {
  return a.x < b.x + b.w + pad && a.x + a.w + pad > b.x &&
         a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
}

/**
 * Place the tokens in `box`, biggest-weight first, along an expanding spiral from
 * the centre, skipping any position that collides with an already-placed word or
 * leaves the box. Deterministic: tokens are sorted by weight desc (text asc
 * tiebreak) and no RNG is used, so a given mind lays out identically every time.
 */
export function layoutMindCloud(tokens: CloudToken[], box: CloudBox, m: CloudMeasure): PlacedWord[] {
  const sorted = [...tokens].sort((a, b) => b.weight - a.weight || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const pad = Math.max(2, m.base * 0.35); // small breathing gap between words
  const placed: CloudBox[] = [];
  const out: PlacedWord[] = [];

  for (const t of sorted) {
    const fs = bandFs(t.weight, m.base);
    const tw = m.measure(t.text, fs);
    const th = m.lineHeight(fs);
    if (tw > box.w || th > box.h) continue; // never going to fit — drop it

    // Archimedean spiral: r grows with the angle. `aspect` < 1 makes a landscape
    // cloud (wider than tall), which reads better in a card.
    const aspect = 0.62;
    const growth = m.base * 0.11;
    let px: number | null = null, py: number | null = null;
    for (let a = 0; a < 240; a += 0.35) {
      const r = 2 + a * growth;
      const x = cx + r * Math.cos(a) - tw / 2;
      const y = cy + r * Math.sin(a) * aspect - th / 2;
      if (x < box.x || y < box.y || x + tw > box.x + box.w || y + th > box.y + box.h) continue;
      const cand: CloudBox = { x, y, w: tw, h: th };
      if (!placed.some((p) => overlaps(cand, p, pad))) { px = x; py = y; placed.push(cand); break; }
    }
    if (px === null || py === null) continue; // couldn't seat it in the box — drop

    out.push({
      text: t.text,
      tone: t.tone,
      fs,
      alpha: Math.min(1, 0.5 + t.weight * 0.5),
      x: Math.round(px),
      y: Math.round(py),
    });
  }
  return out;
}
