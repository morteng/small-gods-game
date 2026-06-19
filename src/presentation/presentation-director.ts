/**
 * PresentationDirector — the observer that bridges the deterministic sim to the
 * (non-deterministic, wall-clock) presentation layer. It READS GameState on a
 * throttle, subscribes to the EventLog, and drives four sub-directors:
 *   • MusicDirector — adaptive score (P-A)
 *   • SfxDirector   — event stingers (P-B)
 *   • CameraDirector— cinematic framing on staged beats (P-C)
 *   • VoiceDirector — optional spoken narration (P-E)
 * It mutates NOTHING in the sim — turning it off leaves the game bit-identical
 * (design doc §2). Scrub/past-veil ducks the score; user input cancels the
 * cinematic camera (player agency wins).
 */
import type { GameState } from '@/core/state';
import type { AppendedEvent } from '@/core/events';
import { computeMood, eventMoodNudge } from './mood';
import { MusicDirector, leitmotifFor } from './music-director';
import { SfxDirector } from './sfx-director';
import { CameraDirector } from './camera-director';
import { VoiceDirector } from './voice-director';
import type { MusicBackend } from './music-backend';
import { NullMusicBackend } from './music-backend';
import { TinySynthBackend } from './tinysynth-backend';

const STORAGE_KEY = 'small-gods-music';
const MOOD_INTERVAL_MS = 750;
const BASE_VOLUME = 0.35;
const DUCK_VOLUME = 0.12; // while a story card is up

export interface PresentationDirectorOptions {
  /** Inject a backend (tests pass a fake). Defaults to tinysynth in a browser. */
  backend?: MusicBackend;
  /** Override the persisted enabled flag. */
  enabled?: boolean;
  /** Current viewport (CSS px) — needed to frame cinematic camera targets. */
  viewport?: () => { width: number; height: number };
}

export interface FrameContext {
  /** Sim is advancing this frame. */
  live: boolean;
  /** Time is being scrubbed / past-veil is up → duck the score. */
  scrubbed: boolean;
}

export class PresentationDirector {
  private readonly state: GameState;
  private readonly backend: MusicBackend;
  private readonly music: MusicDirector;
  private readonly sfx: SfxDirector;
  private readonly camera = new CameraDirector();
  private readonly voice = new VoiceDirector();
  private readonly viewport: () => { width: number; height: number };
  private enabled: boolean;
  private cameraEnabled = true;
  private musicVolume = BASE_VOLUME;

  private moodAccum = MOOD_INTERVAL_MS;
  private lastFocalNpc: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private gestureHandler: (() => void) | null = null;
  private cancelHandler: (() => void) | null = null;

  constructor(state: GameState, opts: PresentationDirectorOptions = {}) {
    this.state = state;
    this.backend = opts.backend ?? defaultBackend();
    this.music = new MusicDirector(this.backend, { volume: this.musicVolume });
    this.sfx = new SfxDirector(this.backend);
    this.viewport = opts.viewport ?? (() => ({ width: 0, height: 0 }));
    this.enabled = opts.enabled ?? loadEnabled();
  }

  /** Subscribe to events + arm the audio-unlock + cinematic-cancel listeners. */
  attach(): void {
    this.unsubscribe = this.state.eventLog.subscribe((e) => this.onEvent(e));
    if (this.enabled) this.armGesture();
    this.armCancel();
  }

  /** Per-frame tick. `dtMs` is wall-clock ms; never advances the sim. */
  update(dtMs: number, ctx: FrameContext): void {
    // Camera cinematic runs even when audio is off (it's visual).
    if (this.cameraEnabled) this.camera.update(dtMs, this.state.camera);
    if (!this.enabled) return;

    this.moodAccum += dtMs;
    if (this.moodAccum >= MOOD_INTERVAL_MS) {
      this.moodAccum = 0;
      this.music.setMood(computeMood(this.state));
    }

    // Focal subject change = a leitmotif cue.
    const focal = this.state.selectedNpcId;
    if (focal && focal !== this.lastFocalNpc) {
      this.lastFocalNpc = focal;
      this.music.playLeitmotif(leitmotifFor(focal));
    } else if (!focal) {
      this.lastFocalNpc = null;
    }

    this.backend.setMuted(ctx.scrubbed);
    this.music.update(dtMs);
  }

  /** True while the cinematic camera owns the view (loop skips follow then). */
  cameraActive(): boolean {
    return this.cameraEnabled && this.camera.isActive();
  }

  /**
   * A staged beat fired on a subject: play its leitmotif and, if we have a tile,
   * frame it cinematically. Called from the storylet-beat callback.
   */
  cueBeat(subjectKey: string | null, tile: { x: number; y: number } | null): void {
    if (this.enabled && subjectKey) this.music.playLeitmotif(leitmotifFor(subjectKey));
    if (this.cameraEnabled && tile) {
      this.camera.focusTile(this.state.camera, tile.x, tile.y, this.viewport(), { map: this.state.map });
    }
  }

  /** A story card opened/closed — duck the score and (re)enable voice while up. */
  setStoryActive(active: boolean): void {
    this.musicVolume = active ? DUCK_VOLUME : BASE_VOLUME;
    this.music.setVolume(this.musicVolume);
    if (!active) this.voice.cancel();
  }

  /** Speak a line of narration (no-op unless voice is enabled). */
  speakLine(text: string): void {
    this.voice.speak(text);
  }

  isEnabled(): boolean { return this.enabled; }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    saveEnabled(on);
    if (on) {
      this.armGesture();
      void this.backend.ensureStarted();
    } else {
      this.backend.setMuted(true);
    }
  }

  setCameraEnabled(on: boolean): void { this.cameraEnabled = on; if (!on) this.camera.cancel(); }
  setVoiceEnabled(on: boolean): void { this.voice.setEnabled(on); }

  /** Master volume 0..1. */
  setVolume(v: number): void { this.musicVolume = v; this.music.setVolume(v); }

  /** Diagnostics for the dev overlay / __debug. */
  debug(): object {
    return {
      enabled: this.enabled, started: this.backend.started,
      camera: this.cameraEnabled, cameraActive: this.camera.isActive(),
      voice: this.voice.isEnabled(),
      ...this.music.debugState(),
    };
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.removeGesture();
    this.removeCancel();
    this.voice.cancel();
    this.backend.dispose();
  }

  // — internals —————————————————————————————————————————————————

  private onEvent(e: AppendedEvent): void {
    if (!this.enabled) return;
    const nudge = eventMoodNudge(e.event.type);
    if (nudge) this.music.nudge(nudge);
    this.sfx.playFor(e.event.type);
  }

  /** AudioContext resume needs a user gesture; unlock on the first one. */
  private armGesture(): void {
    if (this.gestureHandler || typeof window === 'undefined') return;
    if (this.backend.started) return;
    const handler = () => { void this.backend.ensureStarted(); this.removeGesture(); };
    this.gestureHandler = handler;
    window.addEventListener('pointerdown', handler);
    window.addEventListener('keydown', handler);
  }

  private removeGesture(): void {
    if (!this.gestureHandler || typeof window === 'undefined') return;
    window.removeEventListener('pointerdown', this.gestureHandler);
    window.removeEventListener('keydown', this.gestureHandler);
    this.gestureHandler = null;
  }

  /** Any deliberate camera input cancels the cinematic — player agency wins. */
  private armCancel(): void {
    if (this.cancelHandler || typeof window === 'undefined') return;
    const handler = () => this.camera.cancel();
    this.cancelHandler = handler;
    window.addEventListener('wheel', handler, { passive: true });
    window.addEventListener('pointerdown', handler);
  }

  private removeCancel(): void {
    if (!this.cancelHandler || typeof window === 'undefined') return;
    window.removeEventListener('wheel', this.cancelHandler);
    window.removeEventListener('pointerdown', this.cancelHandler);
    this.cancelHandler = null;
  }
}

function defaultBackend(): MusicBackend {
  return typeof window !== 'undefined' ? new TinySynthBackend() : new NullMusicBackend();
}

function loadEnabled(): boolean {
  if (typeof localStorage === 'undefined') return true;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === null ? true : v === '1';
  } catch { return true; }
}

function saveEnabled(on: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); } catch { /* ignore */ }
}
