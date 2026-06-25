/**
 * Base cue library (M-0, hand-authored) — the deterministic fallback set so the
 * game has a real composed score with NO LLM key and NO paid generation (mirrors
 * the story system's DumbDirector fallbacks). The Composer (M-2) later REPLACES
 * this with a richer generated library committed under public/asset-library/cues/.
 *
 * Design intent (user: "better silent than boring"): beds cover only ELEVATED
 * mood, so the calm baseline has NO eligible bed → silence. Sound is earned.
 */
import type { MusicCue } from '../cue-types';

/**
 * The three mood beds + a few one-shot cues beats can request by tag/theme.
 * Pentatonic-ish, consonant; velocities are gentle (the score sits under play).
 */
export const BASE_CUES: MusicCue[] = [
  // — Beds (looping; selected by mood; silence when none eligible) —————————————

  // Lively: a bright music-box arpeggio over a soft walking bass. Bustling town.
  {
    id: 'bed_lively',
    role: 'bed',
    bpm: 96,
    bars: 2,
    loop: true,
    mood: { liveliness: [0.6, 1] },
    gain: 0.8,
    notes: [
      { voice: 'bass', midi: 36, atBeat: 0, durBeats: 1.5, vel: 40 }, // C2
      { voice: 'bass', midi: 43, atBeat: 2, durBeats: 1.5, vel: 38 }, // G2
      { voice: 'bass', midi: 41, atBeat: 4, durBeats: 1.5, vel: 38 }, // F2
      { voice: 'bass', midi: 43, atBeat: 6, durBeats: 1.5, vel: 38 }, // G2
      { voice: 'pluck', midi: 72, atBeat: 0, durBeats: 0.4, vel: 34 }, // C5
      { voice: 'pluck', midi: 76, atBeat: 1, durBeats: 0.4, vel: 32 }, // E5
      { voice: 'pluck', midi: 79, atBeat: 2, durBeats: 0.4, vel: 34 }, // G5
      { voice: 'pluck', midi: 76, atBeat: 3, durBeats: 0.4, vel: 30 }, // E5
      { voice: 'pluck', midi: 77, atBeat: 4, durBeats: 0.4, vel: 32 }, // F5
      { voice: 'pluck', midi: 81, atBeat: 5, durBeats: 0.4, vel: 30 }, // A5
      { voice: 'pluck', midi: 79, atBeat: 6, durBeats: 0.4, vel: 32 }, // G5
      { voice: 'pluck', midi: 74, atBeat: 7, durBeats: 0.4, vel: 30 }, // D5
    ],
  },

  // Reverence: a warm sustained pad with a sparse bell. Sacred, still.
  {
    id: 'bed_reverence',
    role: 'bed',
    bpm: 60,
    bars: 2,
    loop: true,
    mood: { reverence: [0.55, 1] },
    gain: 0.75,
    notes: [
      { voice: 'pad', midi: 60, atBeat: 0, durBeats: 4, vel: 30 }, // C4
      { voice: 'pad', midi: 64, atBeat: 0, durBeats: 4, vel: 28 }, // E4
      { voice: 'pad', midi: 67, atBeat: 0, durBeats: 4, vel: 28 }, // G4
      { voice: 'pad', midi: 57, atBeat: 4, durBeats: 4, vel: 30 }, // A3
      { voice: 'pad', midi: 60, atBeat: 4, durBeats: 4, vel: 28 }, // C4
      { voice: 'pad', midi: 64, atBeat: 4, durBeats: 4, vel: 28 }, // E4
      { voice: 'bell', midi: 84, atBeat: 2, durBeats: 2, vel: 30 }, // C6
      { voice: 'bell', midi: 79, atBeat: 6, durBeats: 2, vel: 26 }, // G5
    ],
  },

  // Tension: a low minor drone with a slow heartbeat bass. Dread, unrest.
  {
    id: 'bed_tension',
    role: 'bed',
    bpm: 72,
    bars: 2,
    loop: true,
    mood: { tension: [0.5, 1] },
    gain: 0.7,
    notes: [
      { voice: 'pad', midi: 57, atBeat: 0, durBeats: 8, vel: 28 }, // A3 drone
      { voice: 'pad', midi: 60, atBeat: 0, durBeats: 8, vel: 24 }, // C4
      { voice: 'bass', midi: 33, atBeat: 0, durBeats: 0.6, vel: 44 }, // A1
      { voice: 'bass', midi: 33, atBeat: 2, durBeats: 0.6, vel: 36 },
      { voice: 'bass', midi: 33, atBeat: 4, durBeats: 0.6, vel: 44 },
      { voice: 'bass', midi: 32, atBeat: 6, durBeats: 0.6, vel: 36 }, // G#1 — a sour step
    ],
  },

  // — One-shot cues beats can request by tag/theme (M-1) ————————————————————

  // Miracle: a bright pad swell capped with a rising bell pair.
  {
    id: 'swell_miracle',
    role: 'swell',
    bpm: 60,
    bars: 1,
    loop: false,
    tags: ['miracle', 'ascension'],
    gain: 0.9,
    notes: [
      { voice: 'pad', midi: 60, atBeat: 0, durBeats: 4, vel: 38 }, // C4
      { voice: 'pad', midi: 64, atBeat: 0, durBeats: 4, vel: 36 }, // E4
      { voice: 'pad', midi: 67, atBeat: 0, durBeats: 4, vel: 36 }, // G4
      { voice: 'bell', midi: 84, atBeat: 0.5, durBeats: 1, vel: 46 }, // C6
      { voice: 'bell', midi: 88, atBeat: 1.0, durBeats: 1.5, vel: 50 }, // E6
    ],
  },

  // Death: a low descending two-note dirge.
  {
    id: 'dirge_death',
    role: 'swell',
    bpm: 50,
    bars: 1,
    loop: false,
    tags: ['death', 'npc_death', 'loss'],
    gain: 0.85,
    notes: [
      { voice: 'pad', midi: 57, atBeat: 0, durBeats: 2.5, vel: 34 }, // A3
      { voice: 'pad', midi: 60, atBeat: 0, durBeats: 2.5, vel: 30 }, // C4
      { voice: 'bass', midi: 33, atBeat: 0, durBeats: 2, vel: 40 }, // A1
      { voice: 'pad', midi: 55, atBeat: 2, durBeats: 2, vel: 32 }, // G3
      { voice: 'bass', midi: 31, atBeat: 2, durBeats: 2, vel: 38 }, // G1
    ],
  },

  // Settlement founded/grown: a gentle ascending fanfare.
  {
    id: 'fanfare_settlement',
    role: 'swell',
    bpm: 100,
    bars: 1,
    loop: false,
    tags: ['settlement_founded', 'settlement_grown', 'arrival'],
    gain: 0.85,
    notes: [
      { voice: 'pluck', midi: 72, atBeat: 0, durBeats: 0.5, vel: 40 }, // C5
      { voice: 'pluck', midi: 76, atBeat: 0.5, durBeats: 0.5, vel: 42 }, // E5
      { voice: 'pluck', midi: 79, atBeat: 1, durBeats: 0.5, vel: 44 }, // G5
      { voice: 'bell', midi: 84, atBeat: 1.5, durBeats: 1.5, vel: 46 }, // C6
    ],
  },
];
