/**
 * Title cue (§6.1) — one hand-authored bed for the instant title screen (design
 * doc §1: "instant title, generation on demand"): devotional, restrained, slow.
 * Hand-authored in TypeScript, matching base-cues.ts's shape and discipline —
 * NO LLM/API call, no spend.
 *
 * Deliberately kept OUT of `BASE_CUES`/`CueLibrary`'s mood-eligibility pool: it
 * must never compete with, or leak into, the in-game mood-driven score. If it
 * were added to the shared library, its unconstrained `mood` window (matches
 * every axis) would make it the ONLY eligible bed whenever nothing else is —
 * i.e. it would silently override the "calm baseline has no eligible bed →
 * silence" rule that `cues/base-cues.ts` deliberately relies on (see that
 * file's header). This module is a standalone export; nothing in this slice
 * calls `CueLibrary.add`/`CueSequencer.addCues` with it — that's for whichever
 * boot-shell screen (a later phase, design doc §3.1/P2) owns the title
 * screen's own CueSequencer/CueLibrary instance to do, keyed by
 * {@link TITLE_CUE_ID}.
 *
 * Design intent ("better silent than boring", base-cues.ts's own rule): one
 * sustained low pad fifth, one far-off bell strike, one breath of choir late
 * in the loop — no melody, no rhythm. The old god of an old world, watching.
 * 8-bar loop at 46bpm (~42s/loop) so the silence between events reads as
 * intentional pacing, not a boot glitch.
 */
import type { MusicCue } from '../cue-types';

export const TITLE_CUE_ID = 'bed_title';

export const TITLE_CUE: MusicCue = {
  id: TITLE_CUE_ID,
  role: 'bed',
  bpm: 46,
  bars: 8,
  loop: true,
  gain: 0.55,
  notes: [
    { voice: 'pad', midi: 48, atBeat: 0, durBeats: 32, vel: 22 },   // C3 — a low held fifth, the whole loop
    { voice: 'pad', midi: 55, atBeat: 0, durBeats: 32, vel: 18 },   // G3
    { voice: 'bell', midi: 79, atBeat: 14, durBeats: 3, vel: 24 },  // G5 — one far-off strike
    { voice: 'choir', midi: 60, atBeat: 20, durBeats: 10, vel: 14 }, // C4 — a breath of choir, barely there
  ],
};
