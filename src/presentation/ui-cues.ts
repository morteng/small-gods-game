/**
 * ui-cues — subtle synth tick/confirm cues for UI interactions (§6.1: "Subtle
 * UI sound cues"). A small named API (`uiTick()` / `uiConfirm()`) so UI code
 * (the WebGPU ui-runtime, screens) can play a sound without knowing MIDI or
 * channel plumbing. Rides the SFX bus (audio-buses.ts) on channel 9 — kept
 * separate from sfx-director.ts's event stingers (6-8) so a UI tick can never
 * stomp an in-flight event stinger's GM program (both channel GROUPS still
 * share the one SFX bus volume/mute, so they mute/attenuate together).
 *
 * Standalone by design: it must work from the title screen, before any
 * GameState/PresentationDirector exists (design doc §1, §3.1) — it does NOT
 * own a MusicBackend itself. `installUiCues(backend)` wires it to whichever
 * backend the caller already has; until installed, uiTick()/uiConfirm() are
 * silent no-ops (never throw, never queue). PresentationDirector installs its
 * own backend on construction so in-game UI gets this for free; the title
 * screen (a later boot-shell phase) needs its own call once it owns a
 * backend of its own (or is handed the promoted shared one).
 *
 * Autoplay contract: like SfxDirector/CueSequencer, a cue fired before the
 * AudioContext has been unlocked by a user gesture (`backend.now() <= 0`) is
 * dropped silently — never thrown, never queued for a burst at unlock.
 */
import type { MusicBackend } from './music-backend';

const CH = 9;
const PROGRAM = 108; // "Kalimba" — a soft, short pluck; distinct from sfx-director's 6-8 and the music voices.

export class UiCueDirector {
  private readonly backend: MusicBackend;
  private programSet = false;

  constructor(backend: MusicBackend) {
    this.backend = backend;
  }

  /** A quiet tick — focus change / hover-step. */
  uiTick(): void {
    this.play([{ midi: 79, vel: 30, at: 0, dur: 0.07 }]); // G5, brief
  }

  /** A slightly warmer confirm — activate. A small two-note rise. */
  uiConfirm(): void {
    this.play([
      { midi: 72, vel: 42, at: 0, dur: 0.12 },     // C5
      { midi: 79, vel: 40, at: 0.045, dur: 0.16 }, // G5 — the "warmer" rise
    ]);
  }

  private play(notes: readonly { midi: number; vel: number; at: number; dur: number }[]): void {
    const now = this.backend.now();
    if (now <= 0) return; // pre-gesture / suspended: drop silently, don't queue
    this.ensureProgram();
    for (const n of notes) {
      this.backend.scheduleNote({
        channel: CH, midi: n.midi, velocity: n.vel,
        startSec: now + 0.01 + n.at, durationSec: n.dur,
      });
    }
  }

  private ensureProgram(): void {
    if (this.programSet) return;
    this.backend.setProgram(CH, PROGRAM);
    this.programSet = true;
  }
}

let active: UiCueDirector | null = null;

/** Wire uiTick()/uiConfirm() to a live backend (shares its AudioContext — no
 *  new context is ever created here). Safe to call more than once (e.g. a
 *  reload swaps in a new backend); the latest install wins. */
export function installUiCues(backend: MusicBackend): void {
  active = new UiCueDirector(backend);
}

/** Drop the installed backend (tests / teardown). uiTick()/uiConfirm() become no-ops again. */
export function uninstallUiCues(): void {
  active = null;
}

/** A quiet tick — focus change / hover-step. No-op until installed or pre-gesture. */
export function uiTick(): void {
  active?.uiTick();
}

/** A slightly warmer confirm — activate. No-op until installed or pre-gesture. */
export function uiConfirm(): void {
  active?.uiConfirm();
}
