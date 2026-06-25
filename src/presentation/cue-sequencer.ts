/**
 * CueSequencer — plays AUTHORED cues, replacing the old MusicDirector's
 * bar-by-bar note synthesis. It owns one looping BED slot (selected by mood, or
 * none → silence) plus a fire-and-forget bus for one-shot swells / leitmotifs /
 * stingers. The runtime never composes; it schedules composed {@link MusicCue}
 * note data against the backend's look-ahead clock.
 *
 * Determinism note: PRESENTATION, off the sim path. Leitmotif fallback uses a
 * tiny seeded LCG (by theme-key hash) — never `Math.random`, never the sim RNG.
 * Fully testable against a fake backend with a controllable clock.
 */
import type { MusicBackend } from './music-backend';
import type { CueMood } from './cue-library';
import { CueLibrary } from './cue-library';
import type { MusicCue, VoiceName, CueNote } from './cue-types';
import { loopBeats, DEFAULT_BEATS_PER_BAR } from './cue-types';

/** Voice → reserved GM channel (0–5; SFX owns 6–8) + General-MIDI program. */
const VOICE: Record<VoiceName, { ch: number; gm: number }> = {
  pad: { ch: 0, gm: 89 }, // Pad 2 (warm)
  bass: { ch: 1, gm: 32 }, // Acoustic Bass
  pluck: { ch: 2, gm: 11 }, // Music Box
  bell: { ch: 3, gm: 14 }, // Tubular Bells
  lead: { ch: 4, gm: 73 }, // Flute
  choir: { ch: 5, gm: 52 }, // Choir Aahs
};

const LOOKAHEAD_SEC = 0.25;

export interface CueSequencerOptions {
  /** Master volume 0..1. Default 0.32 (subtle — the score sits under play). */
  volume?: number;
  /** Inject a library (tests/Composer); defaults to the hand-authored base set. */
  library?: CueLibrary;
}

export class CueSequencer {
  private readonly backend: MusicBackend;
  private readonly lib: CueLibrary;
  private programsSet = false;

  /** The currently-sounding looping bed (null = silence). */
  private bed: MusicCue | null = null;
  /** Absolute backend-clock time at which the NEXT bed loop iteration begins. */
  private nextLoopSec = 0;

  constructor(backend: MusicBackend, opts: CueSequencerOptions = {}) {
    this.backend = backend;
    this.lib = opts.library ?? new CueLibrary();
    this.backend.setMasterVolume(opts.volume ?? 0.32);
  }

  /** Select the bed for a mood (or silence). Smoothing is the caller's job. */
  setMood(mood: CueMood): void {
    const next = this.lib.eligibleBed(mood);
    if ((next?.id ?? null) === (this.bed?.id ?? null)) return;
    this.setBed(next);
  }

  /** Fire a one-shot cue by id (no-op if unknown / not a one-shot). */
  triggerCue(id: string): void {
    const cue = this.lib.get(id);
    if (cue && cue.role !== 'bed') this.fireOneShot(cue);
  }

  /** Fire the first one-shot cue carrying `tag`, if any. */
  triggerByTag(tag: string): void {
    const cue = this.lib.byTag(tag);
    if (cue && cue.role !== 'bed') this.fireOneShot(cue);
  }

  /** Play a subject's leitmotif: authored if present, else a synth fallback. */
  playLeitmotif(themeKey: string): void {
    const cue = this.lib.leitmotif(themeKey) ?? synthLeitmotif(themeKey);
    this.fireOneShot(cue);
  }

  /** Whether an AUTHORED/warmed leitmotif exists for a theme (vs synth fallback). */
  hasLeitmotif(themeKey: string): boolean {
    return this.lib.leitmotif(themeKey) !== null;
  }

  setVolume(v: number): void {
    this.backend.setMasterVolume(v);
  }

  /** Merge in cues (Composer-produced JSON / on-demand); ids replace. */
  addCues(cues: readonly MusicCue[]): void {
    this.lib.add(cues);
  }

  /** Advance the bed scheduler by `dtMs` wall-clock ms (one-shots self-schedule). */
  update(_dtMs: number): void {
    const now = this.backend.now();
    // Clock not running (no context / suspended): emit nothing, re-anchor later.
    if (now <= 0) { this.nextLoopSec = 0; return; }
    this.ensurePrograms();
    if (!this.bed) return;

    if (this.nextLoopSec <= 0 || this.nextLoopSec < now) this.nextLoopSec = now;
    // Schedule whole loop iterations up to the look-ahead horizon. Loops are
    // short (1–4 bars), so a few iterations max — the guard caps runaway.
    let guard = 0;
    while (this.nextLoopSec < now + LOOKAHEAD_SEC && guard++ < 8) {
      this.scheduleLoop(this.bed, this.nextLoopSec);
      this.nextLoopSec += loopDurSec(this.bed);
    }
  }

  /** Diagnostics for tests / dev overlay. */
  debugState(): { bed: string | null } {
    return { bed: this.bed?.id ?? null };
  }

  // — internals —————————————————————————————————————————————————

  private setBed(next: MusicCue | null): void {
    this.bed = next;
    // Start the new bed promptly (update() re-anchors nextLoopSec to `now`). The
    // outgoing bed's notes were already scheduled into the synth with finite
    // durations, so they ring out on their own — a clean handover, no abrupt cut.
    this.nextLoopSec = 0;
  }

  private fireOneShot(cue: MusicCue): void {
    const now = this.backend.now();
    if (now <= 0) return; // context suspended → drop (matches SfxDirector)
    this.ensurePrograms();
    this.scheduleLoop(cue, now + 0.02);
  }

  /** Schedule every note of `cue` once, anchored at `startSec`. */
  private scheduleLoop(cue: MusicCue, startSec: number): void {
    const beat = 60 / cue.bpm;
    const gain = cue.gain ?? 1;
    for (const n of cue.notes) {
      const v = VOICE[n.voice];
      this.backend.scheduleNote({
        channel: v.ch,
        midi: n.midi,
        velocity: clampVel(n.vel * gain),
        startSec: startSec + n.atBeat * beat,
        durationSec: n.durBeats * beat,
      });
    }
  }

  private ensurePrograms(): void {
    if (this.programsSet) return;
    for (const v of Object.values(VOICE)) this.backend.setProgram(v.ch, v.gm);
    this.programsSet = true;
  }
}

function loopDurSec(cue: MusicCue): number {
  return loopBeats(cue) * (60 / cue.bpm);
}

function clampVel(v: number): number {
  const r = Math.round(v);
  return r < 1 ? 1 : r > 127 ? 127 : r;
}

/**
 * Deterministic leitmotif fallback — a short 3–4 note flute motif derived from a
 * theme key, so an unnamed subject still gets a recognizable-but-generated cue
 * (ported from the old MusicDirector.leitmotifFor). C-major pentatonic, gentle.
 */
const PENTA = [0, 2, 4, 7, 9];
export function synthLeitmotif(themeKey: string): MusicCue {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < themeKey.length; i++) {
    h ^= themeKey.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const rnd = lcg(h);
  const len = 3 + Math.floor(rnd() * 2); // 3 or 4 notes
  const notes: CueNote[] = [];
  for (let i = 0; i < len; i++) {
    const degree = i === 0 ? 0 : Math.floor(rnd() * PENTA.length);
    notes.push({
      voice: 'lead',
      midi: 72 + PENTA[degree], // C5 + degree
      atBeat: i * 0.5,
      durBeats: 0.45,
      vel: 52,
    });
  }
  return {
    id: `leitmotif:${themeKey}`,
    role: 'leitmotif',
    bpm: 100,
    bars: Math.ceil((len * 0.5) / DEFAULT_BEATS_PER_BAR),
    loop: false,
    themeKey,
    notes,
  };
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}
