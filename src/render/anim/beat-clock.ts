/**
 * Music beat clock — the single source of tempo/phase truth for beat-authored
 * animation clips (dance, march, procession sway, …).
 *
 * WHY THIS NEVER READS TIME ITSELF: the project bans wall-clock reads and
 * Math.random() from logic (see `tests/unit/no-random-in-sim.test.ts` for the
 * sim-side guard) so that a frame's output is a pure function of its inputs
 * and replays deterministically. The audio layer owns the ONE legitimate
 * clock — `AudioContext.currentTime` — and is the caller's authority on "now".
 * Every query here therefore takes `now: number` (seconds, same timebase as
 * `AudioContext.currentTime`) explicitly rather than sampling `Date.now()` or
 * `performance.now()` internally. This keeps the clock pure, testable without
 * fake timers, and safe to call from render code, sim snapshots, or a studio
 * scrubber alike.
 */

/** Tempo reference: beat b occurs at time `anchorTime + b * (60 / bpm)`. */
export interface BeatSpec {
  /** Tempo in beats per minute. Must be finite and > 0. */
  bpm: number;
  /** The time (seconds) at which beat 0 lands. */
  anchorTime: number;
}

function assertValidBpm(bpm: number): void {
  if (!Number.isFinite(bpm) || bpm <= 0) {
    throw new RangeError(`BeatClock: bpm must be finite and > 0, got ${bpm}`);
  }
}

/**
 * Converts real time (seconds, `AudioContext.currentTime` timebase) into a
 * continuous beat position, and back into beat-grid boundaries. Re-anchoring
 * on tempo change preserves beat PHASE so a tempo ramp never pops a clip mid-loop.
 */
export class BeatClock {
  private _spec: BeatSpec;

  constructor(spec: BeatSpec) {
    assertValidBpm(spec.bpm);
    if (!Number.isFinite(spec.anchorTime)) {
      throw new RangeError(`BeatClock: anchorTime must be finite, got ${spec.anchorTime}`);
    }
    this._spec = { bpm: spec.bpm, anchorTime: spec.anchorTime };
  }

  /** Current spec (read-only snapshot; mutate via `setTempo`). */
  get spec(): BeatSpec {
    return this._spec;
  }

  /** Seconds occupied by one beat at the current tempo. */
  secondsPerBeat(): number {
    return 60 / this._spec.bpm;
  }

  /** Continuous beat position at `now` (negative before the anchor). */
  beatAt(now: number): number {
    return (now - this._spec.anchorTime) / this.secondsPerBeat();
  }

  /** Fractional phase within the current beat, in [0, 1). */
  phaseAt(now: number): number {
    const b = this.beatAt(now);
    const frac = b - Math.floor(b);
    // Guard the (extremely rare) floating-point edge where the subtraction
    // rounds back up to exactly 1.
    return frac >= 1 ? 0 : frac;
  }

  /**
   * Re-anchor to a new tempo such that the beat PHASE is continuous at time
   * `now` — i.e. `beatAt(now)` is identical immediately before and after the
   * call, so a tempo change never pops a currently-playing clip.
   */
  setTempo(bpm: number, now: number): void {
    assertValidBpm(bpm);
    const b = this.beatAt(now);
    const newSecondsPerBeat = 60 / bpm;
    this._spec = { bpm, anchorTime: now - b * newSecondsPerBeat };
  }

  /**
   * Earliest time >= `now` that lands on a beat-grid boundary of size
   * `quantum` beats (default 1; e.g. 4 = next bar in 4/4). If `now` already
   * sits on a boundary (within a 1e-9 epsilon), returns `now` unchanged.
   */
  nextBoundary(now: number, quantum = 1): number {
    if (!Number.isFinite(quantum) || quantum <= 0) {
      throw new RangeError(`BeatClock: quantum must be finite and > 0, got ${quantum}`);
    }
    const spb = this.secondsPerBeat();
    const b = this.beatAt(now);
    const units = b / quantum;
    const roundedUnits = Math.round(units);
    // Already on (or within floating-point epsilon of) a boundary.
    if (Math.abs(units - roundedUnits) < 1e-9) {
      return now;
    }
    const nextUnits = Math.ceil(units);
    const nextBeat = nextUnits * quantum;
    return this._spec.anchorTime + nextBeat * spb;
  }
}

/**
 * Normalized playback position `u` in [0, 1) for a clip authored in beats:
 * loops every `durationBeats`, starting from beat `startBeat` (default 0).
 * Use this to drive a clip's frame/pose index each render tick.
 */
export function clipPhase(
  clock: BeatClock,
  now: number,
  durationBeats: number,
  startBeat = 0
): number {
  const b = clock.beatAt(now) - startBeat;
  const u = (b / durationBeats) % 1;
  return ((u % 1) + 1) % 1;
}
