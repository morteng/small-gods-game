/**
 * MusicDirector — the adaptive score's brain. It maps a smoothed
 * {@link MoodVector} onto musical parameters (key, mode, tempo, active
 * instrument layers) and renders them as a layered, pentatonic, look-ahead
 * generative sequence against a {@link MusicBackend}. Pentatonic scales mean
 * notes never clash, so the bed stays "subtle, never wrong" as the mood drifts.
 *
 * Determinism note: this is PRESENTATION, off the sim path. It uses its own tiny
 * LCG (seeded by bar index) for variation — never `Math.random` into sim, never
 * the sim RNG. It is fully testable against a fake backend with a controllable
 * clock (see tests/unit/presentation-music-director.test.ts).
 */
import type { MoodVector } from './mood';
import { NEUTRAL_MOOD } from './mood';
import type { MusicBackend } from './music-backend';

const CH = { PAD: 0, BASS: 1, PLUCK: 2, BELL: 3, LEAD: 4 } as const;
// General-MIDI programs (0-based) chosen for a gentle folk/pixel feel.
const PROGRAMS: Record<number, number> = {
  [CH.PAD]: 89,    // Pad 2 (warm)
  [CH.BASS]: 32,   // Acoustic Bass
  [CH.PLUCK]: 11,  // Music Box
  [CH.BELL]: 14,   // Tubular Bells
  [CH.LEAD]: 73,   // Flute
};

const MAJOR_PENTA = [0, 2, 4, 7, 9];
const MINOR_PENTA = [0, 3, 5, 7, 10];

/** Key center (root MIDI note) per season — a subtle seasonal colour shift. */
const SEASON_ROOT: Record<MoodVector['season'], number> = {
  spring: 62, // D
  summer: 60, // C
  autumn: 57, // A
  winter: 55, // G
};

const STEPS_PER_BAR = 8; // two beats of 8th notes
const LOOKAHEAD_SEC = 0.25;

export interface MusicDirectorOptions {
  /** Master volume 0..1 applied to the backend. Default 0.35 (subtle). */
  volume?: number;
}

interface BarPlan {
  scale: number[];
  root: number;
  bpm: number;
  layers: { pad: boolean; bass: boolean; pluck: boolean; bell: boolean };
  vel: { pad: number; bass: number; pluck: number; bell: number };
}

export class MusicDirector {
  private readonly backend: MusicBackend;
  private target: MoodVector = NEUTRAL_MOOD;
  private smoothed: MoodVector = { ...NEUTRAL_MOOD };
  /** Transient event accents, decaying toward zero each update. */
  private accent = { tension: 0, reverence: 0, liveliness: 0 };

  private nextStepTime = 0;
  private stepIndex = 0;
  private plan: BarPlan | null = null;
  private programsSet = false;
  /** Queued leitmotif scale-degrees, played one-per-step on the LEAD channel. */
  private leitmotif: number[] = [];

  constructor(backend: MusicBackend, opts: MusicDirectorOptions = {}) {
    this.backend = backend;
    this.backend.setMasterVolume(opts.volume ?? 0.35);
  }

  /** Set the target mood; the director eases toward it (no abrupt jumps). */
  setMood(mood: MoodVector): void {
    this.target = mood;
  }

  /** Apply a transient accent (from a sim event); decays over a few seconds. */
  nudge(delta: Partial<MoodVector>): void {
    if (delta.tension) this.accent.tension += delta.tension;
    if (delta.reverence) this.accent.reverence += delta.reverence;
    if (delta.liveliness) this.accent.liveliness += delta.liveliness;
  }

  /** Queue a short motif (scale-degree indices) to play on the lead voice. */
  playLeitmotif(degrees: number[]): void {
    if (degrees.length) this.leitmotif = degrees.slice(0, 8);
  }

  setVolume(v: number): void {
    this.backend.setMasterVolume(v);
  }

  /** Advance the smoothing + look-ahead scheduler by `dtMs` wall-clock ms. */
  update(dtMs: number): void {
    const dt = Math.max(0, Math.min(dtMs, 100)) / 1000;
    this.ease(dt);

    const now = this.backend.now();
    // Clock not advancing (no context / suspended / null backend): hold the
    // baseline and emit nothing. Re-anchor when it starts running again.
    if (now <= 0) { this.nextStepTime = 0; return; }
    if (this.nextStepTime <= 0 || this.nextStepTime < now) {
      this.nextStepTime = now;
      this.stepIndex = 0;
      this.plan = null;
    }
    if (!this.programsSet) {
      for (const ch of Object.values(CH)) this.backend.setProgram(ch, PROGRAMS[ch]);
      this.programsSet = true;
    }

    let guard = 0;
    while (this.nextStepTime < now + LOOKAHEAD_SEC && guard++ < 64) {
      if (this.stepIndex % STEPS_PER_BAR === 0) this.plan = this.planBar();
      this.scheduleStep(this.stepIndex, this.nextStepTime, this.plan!);
      const stepDur = 60 / this.plan!.bpm / 2; // 8th note
      this.nextStepTime += stepDur;
      this.stepIndex++;
    }
  }

  // — internals —————————————————————————————————————————————————

  private ease(dt: number): void {
    // Exponential approach: ~63% of the gap closed per second.
    const k = 1 - Math.exp(-dt);
    const s = this.smoothed;
    s.tension += (this.target.tension - s.tension) * k;
    s.reverence += (this.target.reverence - s.reverence) * k;
    s.liveliness += (this.target.liveliness - s.liveliness) * k;
    s.timeOfDay = this.target.timeOfDay;
    s.season = this.target.season;
    // Accents decay (~half-life 1.4s).
    const decay = Math.exp(-dt / 2);
    this.accent.tension *= decay;
    this.accent.reverence *= decay;
    this.accent.liveliness *= decay;
  }

  /** Effective mood the music reacts to = smoothed bed + decaying accents. */
  private eff(): { tension: number; reverence: number; liveliness: number } {
    const c = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
    return {
      tension: c(this.smoothed.tension + this.accent.tension),
      reverence: c(this.smoothed.reverence + this.accent.reverence),
      liveliness: c(this.smoothed.liveliness + this.accent.liveliness),
    };
  }

  private planBar(): BarPlan {
    const m = this.eff();
    const minor = m.tension > 0.5 || (m.reverence > 0.6 && m.liveliness < 0.3);
    return {
      scale: minor ? MINOR_PENTA : MAJOR_PENTA,
      root: SEASON_ROOT[this.smoothed.season] - (m.tension > 0.7 ? 2 : 0),
      bpm: 56 + m.liveliness * 36,
      layers: {
        pad: true,
        bass: m.tension > 0.25 || m.reverence > 0.4,
        pluck: m.liveliness > 0.35,
        bell: m.reverence > 0.5,
      },
      vel: {
        pad: 30 + Math.round(m.reverence * 14),
        bass: 38 + Math.round(m.tension * 16),
        pluck: 28 + Math.round(m.liveliness * 18),
        bell: 34 + Math.round(m.reverence * 16),
      },
    };
  }

  /** Map a scale degree (can exceed scale length → octave up) to a MIDI note. */
  private noteFor(plan: BarPlan, degree: number, octaveShift = 0): number {
    const len = plan.scale.length;
    const within = ((degree % len) + len) % len;
    const octave = Math.floor(degree / len) + octaveShift;
    return plan.root + plan.scale[within] + 12 * octave;
  }

  private scheduleStep(step: number, when: number, plan: BarPlan): void {
    const inBar = step % STEPS_PER_BAR;
    const barSeed = Math.floor(step / STEPS_PER_BAR);
    const rnd = lcg(barSeed * 2654435761 + 1);
    const beat = 60 / plan.bpm;

    // Pad: a sustained triad at the top of each bar.
    if (plan.layers.pad && inBar === 0) {
      for (const d of [0, 2, 4]) {
        this.backend.scheduleNote({
          channel: CH.PAD, midi: this.noteFor(plan, d, 0), velocity: plan.vel.pad,
          startSec: when, durationSec: beat * 4,
        });
      }
    }
    // Bass: root pulse on the two beats.
    if (plan.layers.bass && inBar % 4 === 0) {
      this.backend.scheduleNote({
        channel: CH.BASS, midi: this.noteFor(plan, 0, -1), velocity: plan.vel.bass,
        startSec: when, durationSec: beat * 1.5,
      });
    }
    // Pluck: gentle arpeggio, denser when lively; occasional rest.
    if (plan.layers.pluck) {
      const dense = this.eff().liveliness > 0.6;
      if (dense || inBar % 2 === 0) {
        if (rnd() > 0.15) {
          const d = inBar % 5;
          this.backend.scheduleNote({
            channel: CH.PLUCK, midi: this.noteFor(plan, d, 1), velocity: plan.vel.pluck,
            startSec: when, durationSec: beat * 0.4,
          });
        }
      }
    }
    // Bell: rare high accent for the sacred.
    if (plan.layers.bell && inBar === 4 && rnd() > 0.4) {
      this.backend.scheduleNote({
        channel: CH.BELL, midi: this.noteFor(plan, 4, 1), velocity: plan.vel.bell,
        startSec: when, durationSec: beat * 2,
      });
    }
    // Leitmotif: one queued degree per step on the lead voice, then clears.
    if (this.leitmotif.length) {
      const d = this.leitmotif.shift()!;
      this.backend.scheduleNote({
        channel: CH.LEAD, midi: this.noteFor(plan, d, 1), velocity: 52,
        startSec: when, durationSec: beat * 0.6,
      });
    }
  }

  /** Diagnostics for tests / dev overlay. */
  debugState(): { bpm: number; layers: BarPlan['layers'] | null; mood: { tension: number; reverence: number; liveliness: number } } {
    return { bpm: this.plan?.bpm ?? 0, layers: this.plan?.layers ?? null, mood: this.eff() };
  }
}

/** Tiny deterministic LCG → [0,1) for per-bar variation (never touches sim RNG). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/**
 * Deterministic short motif (3–4 scale-degrees) derived from a string key, so
 * each focal subject gets a recognizable-but-generated leitmotif (no hand
 * authoring; design doc §6).
 */
export function leitmotifFor(key: string): number[] {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const rnd = lcg(h);
  const len = 3 + Math.floor(rnd() * 2); // 3 or 4 notes
  const out: number[] = [0];
  for (let i = 1; i < len; i++) out.push(Math.floor(rnd() * 5)); // degrees 0..4
  return out;
}
