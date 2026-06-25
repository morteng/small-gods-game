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
import { computeMood, eventMoodNudge, NEUTRAL_MOOD } from './mood';
import { CueSequencer } from './cue-sequencer';
import type { CueMood } from './cue-library';
import { loadComposedCues } from './composer/load-cues';
import type { CueComposer } from './composer/composer-service';
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
  /**
   * Optional on-demand Composer (M-3). When present, the first time a subject's
   * leitmotif is wanted and none is authored, it's warmed in the background and
   * cached for next time (synth fallback plays meanwhile). Advisory: any failure
   * is silently ignored. Default OFF — the capable-tier client costs money, so
   * wiring a real one is an explicit, funded opt-in (mirrors paid building gen).
   */
  composer?: CueComposer;
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
  private readonly seq: CueSequencer;
  private readonly sfx: SfxDirector;
  private readonly camera = new CameraDirector();
  private readonly voice = new VoiceDirector();
  private readonly viewport: () => { width: number; height: number };
  private enabled: boolean;
  private cameraEnabled = true;
  private musicVolume = BASE_VOLUME;

  // Mood smoothing (moved up from the old MusicDirector). `target` is sampled on
  // a throttle; `smoothed` eases toward it every frame; `accent` is a decaying
  // colouring from events; the sum (clamped) drives bed selection.
  private moodTarget: CueMood = moodAxes(NEUTRAL_MOOD);
  private smoothed: CueMood = moodAxes(NEUTRAL_MOOD);
  private accent: CueMood = { tension: 0, reverence: 0, liveliness: 0 };

  private readonly composer: CueComposer | null;
  private readonly warmRequested = new Set<string>();

  private moodAccum = MOOD_INTERVAL_MS;
  private lastFocalNpc: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private gestureHandler: (() => void) | null = null;
  private cancelHandler: (() => void) | null = null;

  constructor(state: GameState, opts: PresentationDirectorOptions = {}) {
    this.state = state;
    this.backend = opts.backend ?? defaultBackend();
    this.seq = new CueSequencer(this.backend, { volume: this.musicVolume });
    this.sfx = new SfxDirector(this.backend);
    this.viewport = opts.viewport ?? (() => ({ width: 0, height: 0 }));
    this.composer = opts.composer ?? null;
    this.enabled = opts.enabled ?? loadEnabled();
  }

  /** Subscribe to events + arm the audio-unlock + cinematic-cancel listeners. */
  attach(): void {
    this.unsubscribe = this.state.eventLog.subscribe((e) => this.onEvent(e));
    if (this.enabled) this.armGesture();
    this.armCancel();
    // Extend the hand-authored base set with the committed Composer cue pack, if
    // present (keyless players get it for free). Fire-and-forget; degrades to [].
    void loadComposedCues().then((cues) => { if (cues.length) this.seq.addCues(cues); });
  }

  /** Per-frame tick. `dtMs` is wall-clock ms; never advances the sim. */
  update(dtMs: number, ctx: FrameContext): void {
    // Camera cinematic runs even when audio is off (it's visual).
    if (this.cameraEnabled) this.camera.update(dtMs, this.state.camera);
    if (!this.enabled) return;

    // Re-sample the (O(npcs)) mood on a throttle; ease + select a bed every frame.
    this.moodAccum += dtMs;
    if (this.moodAccum >= MOOD_INTERVAL_MS) {
      this.moodAccum = 0;
      this.moodTarget = moodAxes(computeMood(this.state));
    }
    this.seq.setMood(this.easeMood(dtMs));

    // Focal subject change = a leitmotif cue.
    const focal = this.state.selectedNpcId;
    if (focal && focal !== this.lastFocalNpc) {
      this.lastFocalNpc = focal;
      this.warmLeitmotif(focal);
      this.seq.playLeitmotif(focal);
    } else if (!focal) {
      this.lastFocalNpc = null;
    }

    this.backend.setMuted(ctx.scrubbed);
    this.seq.update(dtMs);
  }

  /** Ease `smoothed` toward target, decay accents, return the effective mood. */
  private easeMood(dtMs: number): CueMood {
    const dt = Math.max(0, Math.min(dtMs, 100)) / 1000;
    const k = 1 - Math.exp(-dt);       // ~63% of the gap closed per second
    const decay = Math.exp(-dt / 2);   // accent half-life ~1.4s
    const s = this.smoothed, t = this.moodTarget, a = this.accent;
    s.tension += (t.tension - s.tension) * k;
    s.reverence += (t.reverence - s.reverence) * k;
    s.liveliness += (t.liveliness - s.liveliness) * k;
    a.tension *= decay; a.reverence *= decay; a.liveliness *= decay;
    const c = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
    return {
      tension: c(s.tension + a.tension),
      reverence: c(s.reverence + a.reverence),
      liveliness: c(s.liveliness + a.liveliness),
    };
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
    if (this.enabled && subjectKey) {
      this.warmLeitmotif(subjectKey);
      this.seq.playLeitmotif(subjectKey);
    }
    if (this.cameraEnabled && tile) {
      this.camera.focusTile(this.state.camera, tile.x, tile.y, this.viewport(), { map: this.state.map });
    }
  }

  /**
   * On-demand Composer warm (M-3): if a subject has no authored leitmotif yet,
   * request one in the background and cache it for next time. The synth fallback
   * plays this time. No-op without a composer / once requested / once warmed.
   */
  private warmLeitmotif(themeKey: string): void {
    if (!this.composer || this.warmRequested.has(themeKey)) return;
    if (this.seq.hasLeitmotif(themeKey)) return;
    this.warmRequested.add(themeKey);
    void this.composer.composeLeitmotif(themeKey).then((cue) => {
      if (cue) this.seq.addCues([cue]);
    }).catch(() => { /* advisory — synth fallback stands */ });
  }

  /** A story card opened/closed — duck the score and (re)enable voice while up. */
  setStoryActive(active: boolean): void {
    this.musicVolume = active ? DUCK_VOLUME : BASE_VOLUME;
    this.seq.setVolume(this.musicVolume);
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
  setVolume(v: number): void { this.musicVolume = v; this.seq.setVolume(v); }

  /** Diagnostics for the dev overlay / __debug. */
  debug(): object {
    return {
      enabled: this.enabled, started: this.backend.started,
      camera: this.cameraEnabled, cameraActive: this.camera.isActive(),
      voice: this.voice.isEnabled(),
      ...this.seq.debugState(),
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
    if (nudge) {
      if (nudge.tension) this.accent.tension += nudge.tension;
      if (nudge.reverence) this.accent.reverence += nudge.reverence;
      if (nudge.liveliness) this.accent.liveliness += nudge.liveliness;
    }
    // A fired beat may carry an explicit Composer-chosen cue — trigger it off the
    // SAME event substrate that drives prose/camera (M-1 unification). Leitmotifs
    // stay subject-focus-driven (cueBeat / focal change); this is the dramatic cue.
    if (e.event.type === 'beat_fired' && e.event.musicCue) {
      this.seq.triggerCue(e.event.musicCue);
    }
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

/** Project a full MoodVector onto the three axes the cue sequencer reacts to. */
function moodAxes(m: { tension: number; reverence: number; liveliness: number }): CueMood {
  return { tension: m.tension, reverence: m.reverence, liveliness: m.liveliness };
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
