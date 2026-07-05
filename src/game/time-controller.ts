/**
 * time-controller.ts — R9 Time Controls: fastforward + "jump to next event".
 *
 * WHY THIS EXISTS. Under TRUE 1:1 realtime (a calendar day = 24 real hours) the
 * game is ambient; the player wants to skip ahead. The naive lever — `scheduler
 * .setRate(3600)` — freezes the frame: `Scheduler.tick` multiplies the real frame
 * dt by the rate and runs each system's `while (acc >= interval)` catch-up loop
 * synchronously, so the 60 Hz systems (movement, command executor) run 60·rate
 * times per real second inside ONE frame. The 50 ms frame-dt clamp bounds REAL dt
 * BEFORE the multiply, so it does not bound sim work. Determinism is
 * rate-independent (systems fire off sim-time accumulators), but CPU is not.
 *
 * WHAT THIS DOES. TimeController owns the requested rate and the seek state and
 * advances the scheduler in BUDGETED SLICES: each frame it computes the desired
 * sim-ms (realDt × requestedRate) and runs `scheduler.tick` in bounded chunks
 * while `now() - frameStart < SIM_BUDGET_MS`. If the budget runs out, the
 * remainder is DROPPED (never accrued) — the effective rate degrades gracefully
 * instead of freezing. `getEffectiveRate()` reports the measured sim/real ratio.
 *
 * DETERMINISM. The chunk size changes only HOW MUCH sim runs per real frame — it
 * never changes sim OUTCOMES. A chunk is fed to the scheduler as `chunkSim/rate`
 * so, after the scheduler's own `× rateScale`, exactly `chunkSim` sim-ms elapse —
 * outcome-identical to a rate-1 `tick(chunkSim)`. The rate ≤ 1 path is a SINGLE
 * `scheduler.tick(realDt)` call, byte-identical to the pre-R9 direct call site, so
 * replay/scrub stay green. `performance.now()` is read ONLY to bound the budget;
 * budget-based dropping affects only how much sim time elapses per real frame,
 * which is already nondeterministic real-time (identical in kind to frame dt).
 *
 * SEEK. `requestSeek` enters seek mode: max-throughput budgeted advance while
 * subscribed to the EventLog with the shared interest predicate. It stops on
 * (a) an interesting event → land on it; (b) the horizon (default 24 game-hours)
 * → land quiet; (c) `cancelSeek()` → land immediately. Landing restores the
 * pre-seek rate and fires `onLanded` with a `SeekSummary`. It NEVER uses timeline
 * `forwardSilent` (O(ticks)) or closed-form `applySkip` (wrong tool — no
 * fine-grained events); it advances the LIVE world, so the existing event-driven
 * autosnapshot/autosave ride along unchanged.
 */
import type { Scheduler, SystemContext } from '@/core/scheduler';
import type { SimClock } from '@/core/clock';
import type { EventLog, AppendedEvent } from '@/core/events';
import type { GameState } from '@/core/state';
import { TICKS_PER_HOUR } from '@/core/calendar';
import { isInterestingEvent } from './interest-predicate';

/** Per-frame sim budget: at most this many wall-ms are spent advancing the sim,
 *  so a fast-forward (or seek) never freezes the frame. ~24 ms leaves headroom
 *  under a 60 Hz frame for render + UI. */
export const SIM_BUDGET_MS = 24;

/** Fast-forward slice size (sim-ms per scheduler.tick during a rate > 1 advance).
 *  Chosen from scripts/bench-sim-rate.ts: big enough to amortize per-call
 *  overhead, small enough that one slice's work stays near the budget on a busy
 *  world (bounding the worst-case single-frame hitch). Outcome-neutral — the chunk
 *  size changes only HOW MUCH sim runs per frame, never the sim result. */
export const RATE_CHUNK_SIM_MS = 250;

/** Seek slice size (sim-ms per scheduler.tick while jumping to the next event).
 *  Smaller than the fast-forward chunk so we land closer to the triggering event
 *  (we can only stop at chunk boundaries — see advanceSeek). Outcome-neutral. */
export const SEEK_CHUNK_SIM_MS = 250;

/** Default seek horizon: a quiet day. */
export const DEFAULT_SEEK_HORIZON_HOURS = 24;

/**
 * The rate ladder the UI presets pick from. MEASURED, not guessed
 * (scripts/bench-sim-rate.ts, 2026-07-05): on a 60-NPC "mature settlement" world
 * the budgeted advance sustains ~152× sim/real with 250 ms chunks; a sparse fresh
 * world sustains far more (~370×). Ladder = 1×, ~8×, ~60×, and a friendly
 * round-down of the busy-world ceiling (120×). Every rung is reachable even on the
 * busy world; beyond the top the effective rate simply degrades — never a freeze
 * (the HUD's effective-rate badge shows the truth).
 */
export const TIME_RATE_LADDER = [1, 8, 60, 120] as const;

/** SimClock's default ms-per-tick (see core/clock.ts). Used only to cap a seek
 *  chunk near the horizon; the horizon itself is compared in exact ticks. */
const SIM_MS_PER_TICK = 16.667;

export interface SeekSummary {
  /** Clock tick when the seek began. */
  fromTick: number;
  /** Clock tick when it landed. */
  toTick: number;
  /** toTick − fromTick. */
  elapsedTicks: number;
  /** The event that tripped the interest predicate, or null (horizon / cancel). */
  trigger: AppendedEvent | null;
  /** True when landing was NOT caused by an interesting event (horizon or cancel)
   *  — "a quiet day passed". */
  quiet: boolean;
  /** Counts of every event kind appended during the seek (incl. the trigger). */
  passedCounts: Record<string, number>;
}

export interface TimeControllerDeps {
  scheduler: Scheduler;
  clock: SimClock;
  eventLog: EventLog;
  state: GameState;
  /** Injectable wall clock (budget only) — defaults to performance.now. Tests
   *  inject a fake to force budget degradation deterministically. */
  now?: () => number;
}

/** The base context game.ts hands the scheduler each frame (no dt/now — the
 *  scheduler stamps those). */
type BaseCtx = Omit<SystemContext, 'dt' | 'now'>;

interface SeekState {
  fromTick: number;
  horizonTicks: number;
  preRate: number;
  passedCounts: Record<string, number>;
  hit: AppendedEvent | null;
  unsub: (() => void) | null;
}

export class TimeController {
  private readonly scheduler: Scheduler;
  private readonly clock: SimClock;
  private readonly eventLog: EventLog;
  private readonly state: GameState;
  private readonly now: () => number;

  private seek: SeekState | null = null;
  private landedCbs: Array<(s: SeekSummary) => void> = [];

  /** EMA of measured sim-ms / real-ms, for the HUD's effective-rate badge. */
  private effRate = 1;

  constructor(deps: TimeControllerDeps) {
    this.scheduler = deps.scheduler;
    this.clock = deps.clock;
    this.eventLog = deps.eventLog;
    this.state = deps.state;
    this.now = deps.now ?? (() => performance.now());
  }

  // ── Rate ────────────────────────────────────────────────────────────────────

  /** Set the requested sim rate. The scheduler's rateScale stays the single source
   *  of truth (so the existing `getRate()` consumers — the live-frame gate, the DOM
   *  bar — keep working). Setting a rate cancels any in-flight seek. */
  setRate(r: number): void {
    if (this.seek) this.cancelSeek();
    this.scheduler.setRate(Math.max(0, r));
  }

  getRequestedRate(): number {
    return this.scheduler.getRate();
  }

  /** Smoothed measured sim-ms/real-ms — what the clock is ACTUALLY doing (≤
   *  requested when the budget can't keep up). */
  getEffectiveRate(): number {
    return this.effRate;
  }

  private recordEffective(realMs: number, simMs: number): void {
    if (realMs <= 0) return;
    const inst = simMs / realMs;
    // Light EMA so the badge is readable, not jittery.
    this.effRate = this.effRate * 0.8 + inst * 0.2;
  }

  // ── Per-frame advance ─────────────────────────────────────────────────────────

  /**
   * Advance the sim for one real frame. Drop-in replacement for the old
   * `scheduler.tick(realDt, ctx)` call site in game.ts (called only while the frame
   * is "live" — world present, not hard-paused, not scrubbed, rate > 0).
   */
  advance(realDtMs: number, ctxBase: BaseCtx): void {
    if (this.seek) { this.advanceSeek(ctxBase); return; }

    const rate = this.scheduler.getRate();
    if (rate <= 0) { return; }                 // soft-paused: no advance

    if (rate <= 1) {
      // Byte-identical to the pre-R9 direct call: one tick, real dt, rateScale = rate.
      this.scheduler.tick(realDtMs, ctxBase);
      this.recordEffective(realDtMs, realDtMs * rate);
      return;
    }

    // rate > 1: budgeted, chunked fast-forward.
    const desiredSim = realDtMs * rate;
    const frameStart = this.now();
    let advancedSim = 0;
    let remaining = desiredSim;
    while (remaining > 0.5 && this.now() - frameStart < SIM_BUDGET_MS) {
      const chunkSim = Math.min(RATE_CHUNK_SIM_MS, remaining);
      // scheduler multiplies its arg by rateScale (= rate); feed chunkSim/rate so
      // exactly chunkSim sim-ms elapse — outcome-identical to a rate-1 tick(chunkSim).
      this.scheduler.tick(chunkSim / rate, ctxBase);
      remaining -= chunkSim;
      advancedSim += chunkSim;
    }
    // remaining is DROPPED (not accrued) → effective rate degrades gracefully.
    this.recordEffective(realDtMs, advancedSim);
  }

  // ── Seek ("jump to next interesting event") ───────────────────────────────────

  /** Enter seek mode. No-op if already seeking. */
  requestSeek(opts?: { horizonHours?: number }): void {
    if (this.seek) return;
    const preRate = this.scheduler.getRate();
    const horizonHours = opts?.horizonHours ?? DEFAULT_SEEK_HORIZON_HOURS;
    const s: SeekState = {
      fromTick: this.clock.now(),
      horizonTicks: Math.round(horizonHours * TICKS_PER_HOUR),
      preRate: preRate > 0 ? preRate : 1,       // restore to 1 if we were paused
      passedCounts: {},
      hit: null,
      unsub: null,
    };
    s.unsub = this.eventLog.subscribe((e) => this.onSeekEvent(e));
    this.seek = s;
    // Pin the scheduler to rate 1 during seek so a chunk arg == sim-ms elapsed and
    // the live-frame gate (getRate() > 0) keeps calling advance() so the seek runs.
    this.scheduler.setRate(1);
  }

  /** Land immediately (user hit any transport control). Quiet, no trigger. */
  cancelSeek(): void {
    if (this.seek) this.land(true, null);
  }

  /** Null when not seeking; else the live progress toward the horizon. */
  seekStatus(): null | { elapsedTicks: number; horizonTicks: number } {
    if (!this.seek) return null;
    return {
      elapsedTicks: this.clock.now() - this.seek.fromTick,
      horizonTicks: this.seek.horizonTicks,
    };
  }

  isSeeking(): boolean {
    return this.seek !== null;
  }

  /** Register a landing callback (the UI renders the summary as a card). */
  onLanded(cb: (summary: SeekSummary) => void): () => void {
    this.landedCbs.push(cb);
    return () => { this.landedCbs = this.landedCbs.filter((c) => c !== cb); };
  }

  private onSeekEvent(e: AppendedEvent): void {
    const s = this.seek;
    if (!s) return;
    const kind = e.event.type;
    s.passedCounts[kind] = (s.passedCounts[kind] ?? 0) + 1;
    // First interesting event wins; we land on it after the current chunk completes.
    if (!s.hit && isInterestingEvent(e.event, this.state)) s.hit = e;
  }

  private advanceSeek(ctxBase: BaseCtx): void {
    const s = this.seek!;
    const frameStart = this.now();
    while (this.now() - frameStart < SIM_BUDGET_MS) {
      if (s.hit) { this.land(false, s.hit); return; }
      const toHorizon = s.horizonTicks - (this.clock.now() - s.fromTick);
      if (toHorizon <= 0) { this.land(true, null); return; }
      // Don't overshoot the horizon by more than a chunk.
      const chunkSim = Math.min(SEEK_CHUNK_SIM_MS, toHorizon * SIM_MS_PER_TICK);
      this.scheduler.tick(chunkSim, ctxBase);   // rate pinned to 1 → chunkSim sim-ms
      // The subscription may have flagged an interesting event during that tick.
      if (s.hit) { this.land(false, s.hit); return; }
    }
    // Budget spent this frame; still seeking — resume next frame.
  }

  private land(quiet: boolean, trigger: AppendedEvent | null): void {
    const s = this.seek;
    if (!s) return;
    s.unsub?.();
    this.scheduler.setRate(s.preRate);
    const toTick = this.clock.now();
    const summary: SeekSummary = {
      fromTick: s.fromTick,
      toTick,
      elapsedTicks: toTick - s.fromTick,
      trigger,
      quiet,
      passedCounts: s.passedCounts,
    };
    this.seek = null;
    for (const cb of this.landedCbs) {
      try { cb(summary); } catch (err) { console.error('[time-controller] onLanded threw:', err); }
    }
  }
}
