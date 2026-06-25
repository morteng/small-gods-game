/**
 * Music cue model — the authored unit of score (design doc:
 * docs/superpowers/specs/2026-06-25-authored-music-cues-composer-director-design.md).
 *
 * A {@link MusicCue} is short, COMPOSED note data plus routing metadata. The
 * runtime never synthesizes notes bar-by-bar (the old MusicDirector model);
 * it SELECTS, schedules and triggers authored cues. Cues are tiny, diff-able,
 * deterministic, and either hand-written (M-0), produced by the LLM Composer at
 * author-time (M-2), or warmed on demand (M-3).
 *
 * Voices are NAMED (not raw channels) so cues stay readable and the sequencer
 * owns channel/program allocation — keeping music on channels 0–5 clear of the
 * SfxDirector's reserved 6–8.
 */

/** Named instrument voices. Mapped to GM channel+program by the sequencer. */
export type VoiceName = 'pad' | 'bass' | 'pluck' | 'bell' | 'lead' | 'choir';

export type CueRole =
  /** Sustained/looping ambient layer. The resting state is NO bed → silence. */
  | 'bed'
  /** One-shot accent on an event. */
  | 'stinger'
  /** A phrase that rises then recedes (one-shot). */
  | 'swell'
  /** A subject/theme motif (one-shot), keyed by {@link MusicCue.themeKey}. */
  | 'leitmotif';

/** One composed note, timed in BEATS relative to the cue's start. */
export interface CueNote {
  voice: VoiceName;
  /** Absolute MIDI note number (cues are composed, not transposed at runtime). */
  midi: number;
  /** Onset, in beats from cue start. */
  atBeat: number;
  /** Length, in beats. */
  durBeats: number;
  /** 0..127. */
  vel: number;
}

/** Inclusive [min,max] window on a mood axis that makes a bed eligible. */
export type MoodRange = [number, number];

export interface MusicCue {
  id: string;
  role: CueRole;
  /** Tempo for beat→seconds conversion. */
  bpm: number;
  /** Length in bars (loop length for beds). */
  bars: number;
  /** Beats per bar (default 4). */
  beatsPerBar?: number;
  /** Beds loop; swells/stingers/leitmotifs play once. */
  loop: boolean;
  notes: CueNote[];
  /**
   * Eligibility window for beds: the current mood must fall inside every
   * specified axis. Omitted axes are unconstrained. A bed deliberately covering
   * only ELEVATED arousal leaves the calm baseline uncovered → silence.
   */
  mood?: { tension?: MoodRange; reverence?: MoodRange; liveliness?: MoodRange };
  /** Free tags a beat/event can request a cue by ('miracle','death',…). */
  tags?: string[];
  /** For leitmotifs: which subject/theme this motif belongs to. */
  themeKey?: string;
  /** How to leave the previous bed. Default 'crossfade' (handover at bar). */
  transition?: 'crossfade' | 'cut';
  /** Per-cue relative gain 0..1 applied to velocities. Default 1. */
  gain?: number;
}

export const DEFAULT_BEATS_PER_BAR = 4;

/** Total beats in one loop iteration. */
export function loopBeats(cue: MusicCue): number {
  return cue.bars * (cue.beatsPerBar ?? DEFAULT_BEATS_PER_BAR);
}
