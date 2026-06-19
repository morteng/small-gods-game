/**
 * SfxDirector — one-shot stingers keyed to sim events, the percussive half of
 * the score (design doc §4, slice P-B). It shares the MusicBackend (one
 * AudioContext, already gesture-unlocked) and plays on reserved channels 6–8 so
 * it never collides with the MusicDirector's voices (0–4). GM timbre, embraced.
 *
 * Pure scheduling against the backend clock — testable with a fake backend.
 */
import type { MusicBackend } from './music-backend';
import type { SimEvent } from '@/core/events';

const CH = { BELL: 6, IMPACT: 7, CHOIR: 8 } as const;
// GM programs for the SFX voices.
const PROGRAMS: Record<number, number> = {
  [CH.BELL]: 9,    // Glockenspiel — shimmer / chime
  [CH.IMPACT]: 47, // Timpani — crack / impact
  [CH.CHOIR]: 52,  // Choir Aahs — swell / dread
};

interface Hit { ch: number; midi: number; vel: number; at: number; dur: number }

/** Event → stinger. `at` is seconds after the cue; built per-fire from the clock. */
function patchFor(type: SimEvent['type']): Hit[] | null {
  const B = CH.BELL, I = CH.IMPACT, C = CH.CHOIR;
  switch (type) {
    case 'omen': // rising shimmer
      return [
        { ch: B, midi: 72, vel: 54, at: 0.0, dur: 0.3 },
        { ch: B, midi: 76, vel: 56, at: 0.09, dur: 0.3 },
        { ch: B, midi: 79, vel: 60, at: 0.18, dur: 0.45 },
      ];
    case 'miracle': // bright swell + chime
      return [
        { ch: C, midi: 60, vel: 48, at: 0, dur: 1.4 },
        { ch: C, midi: 64, vel: 48, at: 0, dur: 1.4 },
        { ch: C, midi: 67, vel: 48, at: 0, dur: 1.4 },
        { ch: B, midi: 84, vel: 58, at: 0.12, dur: 0.6 },
      ];
    case 'answer_prayer':
    case 'dream': // soft single chime
      return [{ ch: B, midi: 79, vel: 50, at: 0, dur: 0.6 }];
    case 'smite': // low crack
      return [
        { ch: I, midi: 36, vel: 100, at: 0, dur: 0.55 },
        { ch: I, midi: 43, vel: 72, at: 0.02, dur: 0.4 },
      ];
    case 'npc_death': // descending low choir
      return [
        { ch: C, midi: 55, vel: 42, at: 0, dur: 1.3 },
        { ch: C, midi: 51, vel: 38, at: 0.25, dur: 1.4 },
      ];
    case 'npc_birth':
    case 'settlement_grown': // gentle up-chime
      return [
        { ch: B, midi: 72, vel: 46, at: 0, dur: 0.35 },
        { ch: B, midi: 79, vel: 50, at: 0.12, dur: 0.4 },
      ];
    case 'settlement_begin': // ominous low hit
      return [
        { ch: I, midi: 41, vel: 66, at: 0, dur: 0.5 },
        { ch: C, midi: 48, vel: 40, at: 0.05, dur: 0.9 },
      ];
    default:
      return null;
  }
}

export class SfxDirector {
  private readonly backend: MusicBackend;
  private programsSet = false;

  constructor(backend: MusicBackend) {
    this.backend = backend;
  }

  /** Schedule the stinger for `type`, if any. No-op when audio isn't running. */
  playFor(type: SimEvent['type']): void {
    const patch = patchFor(type);
    if (!patch) return;
    const now = this.backend.now();
    if (now <= 0) return; // context suspended / null backend
    if (!this.programsSet) {
      for (const ch of Object.values(CH)) this.backend.setProgram(ch, PROGRAMS[ch]);
      this.programsSet = true;
    }
    for (const h of patch) {
      this.backend.scheduleNote({
        channel: h.ch, midi: h.midi, velocity: h.vel,
        startSec: now + 0.02 + h.at, durationSec: h.dur,
      });
    }
  }
}
