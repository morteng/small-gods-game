import { describe, it, expect } from 'vitest';
import { firstRunTidings, FIRST_RUN_TIDING_HORIZON_TICKS } from '@/game/first-run-tidings';
import { supportedGlyphs } from '@/render/ui/text/pixel-font';

describe('first-run tidings', () => {
  it('offers a non-empty sequence at world start (tick 0)', () => {
    const items = firstRunTidings(0);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every(i => i.kind === 'tiding')).toBe(true);
    expect(items.every(i => i.target.kind === 'none')).toBe(true);
  });

  it('has deterministic, stable ids', () => {
    const a = firstRunTidings(0).map(i => i.id);
    const b = firstRunTidings(0).map(i => i.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length); // no duplicate ids
    for (const id of a) expect(id.startsWith('firstrun:')).toBe(true);
  });

  it('every item sorts below an ordinary threat/prayer salience floor', () => {
    // The `tiding` kind's own floor in `salience.ts` is 0.1 (never above 0.4,
    // an ordinary threat's floor) — guidance must never outrank real news.
    for (const item of firstRunTidings(0)) {
      expect(item.salience).toBeGreaterThan(0);
      expect(item.salience).toBeLessThan(0.4);
    }
  });

  it('auto-expires once the horizon has passed — no stored per-item state', () => {
    expect(firstRunTidings(FIRST_RUN_TIDING_HORIZON_TICKS - 1).length).toBeGreaterThan(0);
    expect(firstRunTidings(FIRST_RUN_TIDING_HORIZON_TICKS)).toEqual([]);
    expect(firstRunTidings(FIRST_RUN_TIDING_HORIZON_TICKS + 1_000_000)).toEqual([]);
  });

  it('drops the dev-mode step (the shipped game stays clean of dev overlays)', () => {
    const items = firstRunTidings(0);
    expect(items.some(i => /debug|backquote|dev mode/i.test(i.title + i.detail))).toBe(false);
  });

  it('every glyph in the ported prose is in the pixel font (ASCII-only law for dynamic text)', () => {
    const glyphs = supportedGlyphs();
    for (const item of firstRunTidings(0)) {
      for (const ch of (item.title + item.detail).toUpperCase()) {
        if (ch === ' ') continue;
        expect(glyphs.has(ch), `"${ch}" in "${item.title}" / "${item.detail}"`).toBe(true);
      }
    }
  });
});
