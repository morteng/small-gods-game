/**
 * MusicBackend — the swappable rendering target for the adaptive score. The
 * MusicDirector emits abstract NoteEvents against the backend's audio clock; the
 * backend turns them into sound. tinysynth is the first concrete backend (GM
 * timbre, embraced — see design doc §3); the interface keeps the door open to
 * Tone.js or shipped stems without touching the director.
 *
 * The director only ever talks to this interface, so it is fully unit-testable
 * against a fake backend with a controllable clock.
 */

/** One scheduled note, timed against the backend's audio clock (seconds). */
export interface NoteEvent {
  /** GM-ish channel; the director assigns one channel per instrument layer. */
  channel: number;
  /** MIDI note number. */
  midi: number;
  /** 0..127. */
  velocity: number;
  /** Absolute backend-clock start time, seconds. */
  startSec: number;
  /** Note length, seconds. */
  durationSec: number;
}

export interface MusicBackend {
  /** Current audio-clock time in seconds. 0 before the context starts. */
  now(): number;
  /**
   * Resume/start the underlying audio context. Browsers block audio until a
   * user gesture, so the director calls this lazily after first interaction.
   * Safe to call repeatedly.
   */
  ensureStarted(): void | Promise<void>;
  /** Whether audio is actually running (context resumed). */
  readonly started: boolean;
  /** Assign a GM program (0..127) to a channel. */
  setProgram(channel: number, gmProgram: number): void;
  /** Schedule a note. No-op if not started. */
  scheduleNote(ev: NoteEvent): void;
  /** Master gain, 0..1. */
  setMasterVolume(v: number): void;
  /** Mute without tearing down (used during scrub/past-veil). */
  setMuted(muted: boolean): void;
  /** Release resources. */
  dispose(): void;
}

/**
 * No-op backend — the default in headless/SSR/test contexts and whenever audio
 * is disabled. The director runs its scheduler against now()===0 and nothing is
 * heard; keeps every other code path identical.
 */
export class NullMusicBackend implements MusicBackend {
  readonly started = false;
  now(): number { return 0; }
  ensureStarted(): void { /* no audio */ }
  setProgram(): void { /* no-op */ }
  scheduleNote(): void { /* no-op */ }
  setMasterVolume(): void { /* no-op */ }
  setMuted(): void { /* no-op */ }
  dispose(): void { /* no-op */ }
}
