// src/render/ui/shell/text-layout.ts
//
// Shared pure text layout for the shell screens.
//
// `ui-runtime.ts` has private `drawWrapped`/`drawWrappedClamped` helpers that
// wrap LEFT-aligned prose into a card. The shell needs the same greedy wrap but
// as a REUSABLE, PURE function that returns the lines instead of drawing them —
// because the shell centres its prose (so it needs each line's width before it
// can place it) and because a pure "text in, lines out" function is directly
// unit-testable against a measured width, which a draw call is not.
//
// No UiContext dependency beyond a measure callback, so tests can drive it with
// a trivial fixed-advance stub.

/** Measures a run at a given scale — satisfied by `UiContext.measure`. */
export type MeasureFn = (text: string, scale: number) => number;

/**
 * Greedy word-wrap `text` into lines no wider than `maxW` at `scale`.
 *
 * A single word longer than `maxW` is NOT broken mid-word — it goes on its own
 * over-long line. That is deliberate: hard-breaking a word is worse to read
 * than one line overhanging, and the callers here (a chronicle excerpt, a
 * status label) draw centred over a full-bleed backdrop where a slight
 * overhang is invisible. Callers who cannot overhang should `ellipsize` instead.
 *
 * Whitespace is collapsed; empty input yields an empty array (never `['']`).
 */
export function wrapLines(text: string, maxW: number, scale: number, measure: MeasureFn): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const probe = line ? `${line} ${word}` : word;
    if (line && measure(probe, scale) > maxW) {
      lines.push(line);
      line = word;
    } else {
      line = probe;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Which entry of `texts` to show at `elapsedMs`, rotating every `periodMs`.
 *
 * Pure arithmetic rather than a `setInterval`: the shell is an immediate-mode
 * surface redrawn from the render frame's own clock, so a rotation TIMER would
 * be a second source of truth that a paused/idle loop desynchronises from (and
 * a timer the shell would then have to own, clear and leak-check). Deriving the
 * index from elapsed time means the rotation is correct on any frame, replayable,
 * and testable without fake timers.
 *
 * Starts on the LAST entry (the most recent annal, matching the DOM loader it
 * replaces) and walks forward from there.
 */
export function rotationIndex(count: number, elapsedMs: number, periodMs: number): number {
  if (count <= 0) return 0;
  if (count === 1 || periodMs <= 0) return count - 1;
  const steps = Math.floor(Math.max(0, elapsedMs) / periodMs);
  return (count - 1 + steps) % count;
}
