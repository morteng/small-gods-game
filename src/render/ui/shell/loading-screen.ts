// src/render/ui/shell/loading-screen.ts
//
// The WebGPU loading screen — heir to the DOM overlay `src/ui/loading-screen.ts`.
//
// Parity with what it replaces: a wordmark, a determinate progress track, a
// status label, and the rotating chronicle excerpt a RESTORED world reads out
// while its art settles. What changes is only where it draws: this is one pure
// function over `UiContext`, so it composites in the same WebGPU pass as the
// rest of the chrome (no DOM overlay, no injected <style>, no z-index) and it is
// directly pixel-testable in Node.
//
// THE ART-SETTLE RULE IS UNCHANGED AND LIVES ELSEWHERE. This module only paints;
// `boot-sequence.ts`'s `holdLoadingUntilArtSettled` decides WHEN the screen goes
// away, and it still holds with no wall-clock cap until every building/barrier/
// sheet has settled (`art-settle-gate.ts`, `maxWaitMs` defaults to Infinity).
// Never add a timeout here.

import type { UiContext } from '@/render/ui/ui-context';
import { UI_PALETTE } from '@/render/ui/ui-palette';
import { shade, withAlpha } from '@/render/ui/ui-color';
import { wrapLines, rotationIndex } from '@/render/ui/shell/text-layout';

/** How long each chronicle excerpt holds before rotating (real ms) — carried
 *  over verbatim from the DOM loader it replaces. */
export const CHRONICLE_ROTATE_MS = 9000;

/** Everything the screen needs to paint one frame. Plain data: the caller (the
 *  `Shell`) owns the mutable progress/chronicle state, so this stays pure. */
export interface LoadingView {
  /** 0..1, clamped by the drawer (a caller feeding 1.4 must not overflow the bar). */
  progress: number;
  /** The phase line under the bar ("Carving rivers…"). Uppercased when drawn. */
  label: string;
  /** Annal excerpts to read while the world wakes; empty on a fresh world. */
  chronicle: readonly string[];
  /** Real ms since the screen was shown — drives the chronicle rotation. Pure
   *  input, so a test can step the rotation without fake timers. */
  elapsedMs: number;
}

/** The wordmark, and the caption under the chronicle block. Static chrome text,
 *  so every glyph is guaranteed present in the pixel font. */
const WORDMARK = 'SMALL GODS';
const CHRONICLE_CAPTION = 'FROM THE CHRONICLE OF THIS WORLD';

/**
 * Paint the loading screen over the whole target.
 *
 * The layout is a single centred column, measured from the middle outward so it
 * reads the same at any window size: wordmark, bar, status, then the chronicle
 * block. Everything is integer-snapped (`Math.round`) — this is a pixel-art UI
 * and a half-pixel bar edge shimmers as the fill grows.
 *
 * `s` is the integer HUD scale (`uiScaleFor(dpr)`); every dimension below is in
 * unscaled design px multiplied by it, the same idiom the HUD uses.
 */
export function drawLoadingScreen(c: UiContext, w: number, h: number, s: number, view: LoadingView): void {
  // A dark wash over the animated sky backdrop. The backdrop is deliberately
  // low-contrast, but a rising cloud band can still drift behind the status
  // label — the wash guarantees the text reads regardless of what the shader
  // is doing this second.
  c.rect(0, 0, w, h, withAlpha([0, 0, 0, 1], 0.55));

  const fsWord = 6 * s;   // display scale — the wordmark is the largest text on screen
  const fsBody = 2 * s;
  const fsCaption = Math.max(1, Math.round(1.5 * s)); // integer-snapped: no fractional glyph cells

  // The column is centred on the viewport's midline, biased slightly ABOVE
  // centre so the chronicle block below doesn't push the wordmark off-centre
  // on a short window.
  const cx = Math.round(w / 2);
  let y = Math.round(h * 0.34);

  // ── wordmark ──
  const wordW = c.measure(WORDMARK, fsWord);
  c.label(WORDMARK, Math.round(cx - wordW / 2), y, fsWord, UI_PALETTE.text);
  y += Math.round(c.lineHeight(fsWord) + 26 * s);

  // ── progress track + fill ──
  // Track width tracks the window (60% at narrow sizes) but caps out, so it
  // never becomes a hairline stretched across an ultrawide display.
  const trackW = Math.round(Math.min(340 * s, w * 0.6));
  const trackH = Math.max(2, Math.round(4 * s));
  const trackX = Math.round(cx - trackW / 2);
  c.rect(trackX, y, trackW, trackH, withAlpha(shade(UI_PALETTE.panelBg, -0.3), 0.9));
  const frac = Math.max(0, Math.min(1, view.progress));
  const fillW = Math.round(trackW * frac);
  // A non-zero fraction always paints at least one pixel column: a bar that
  // reads as empty at 0.2% looks like a hung boot.
  if (frac > 0) c.rect(trackX, y, Math.max(1, fillW), trackH, UI_PALETTE.accent);
  y += trackH + Math.round(16 * s);

  // ── status label ──
  if (view.label) {
    const label = view.label.toUpperCase();
    const clipped = c.ellipsize(label, fsBody, w - 48 * s);
    const lw = c.measure(clipped, fsBody);
    c.label(clipped, Math.round(cx - lw / 2), y, fsBody, UI_PALETTE.textDim);
  }
  y += Math.round(c.lineHeight(fsBody) + 40 * s);

  // ── chronicle excerpt (restored worlds only) ──
  if (view.chronicle.length === 0) return;
  const idx = rotationIndex(view.chronicle.length, view.elapsedMs, CHRONICLE_ROTATE_MS);
  const text = view.chronicle[idx] ?? '';
  if (!text) return;

  const maxW = Math.round(Math.min(520 * s, w * 0.78));
  const lines = wrapLines(text, maxW, fsBody, (t, sc) => c.measure(t, sc));
  const lineGap = Math.round(c.lineHeight(fsBody) + 4 * s);
  // Bail rather than overflow if the window is too short for the block — the
  // excerpt is flavour, the bar above it is the information.
  if (y + lines.length * lineGap > h - 24 * s) return;

  const quiet = withAlpha(UI_PALETTE.text, 0.72);
  for (const line of lines) {
    const lw = c.measure(line, fsBody);
    c.label(line, Math.round(cx - lw / 2), y, fsBody, quiet);
    y += lineGap;
  }
  y += Math.round(10 * s);
  const capW = c.measure(CHRONICLE_CAPTION, fsCaption);
  c.label(CHRONICLE_CAPTION, Math.round(cx - capW / 2), y, fsCaption, UI_PALETTE.textDim);
}
