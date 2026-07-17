/**
 * fate-pulse.ts — Fate's heartbeat (Track 4, Proactive Fate F2).
 *
 * A low-frequency, clock-driven pulse (default: once per game-day) that wakes the
 * brain EVEN WHEN NOTHING HAPPENED — the entire mechanical difference between a
 * reactive Fate and a proactive one. Where `FateTrigger` asks "something happened,
 * what do you make of it?", the pulse asks "nothing happened — what are you
 * *building toward*?" (`FateFocus.kind === 'pulse'`).
 *
 * Two throttles, deliberately not merged:
 *  - DAY CADENCE (this class): at most one pulse attempt per `intervalTicks`. This
 *    MUST be a `TICKS_PER_DAY` multiple — fiction pacing under 1:1 realtime; never a
 *    raw tick literal.
 *  - SHARED COOLDOWN (FateTrigger): the actual deliberation runs through
 *    `FateTrigger.pulse()` → the same readiness+cooldown gate the event path uses,
 *    so a pulse cannot pile onto a just-fired event deliberation. NOT duplicated.
 *
 * IDLE: the pulse SKIPS entirely — without consuming the day cadence — when no arc
 * is live AND no seed condition is met. Fate is allowed to do nothing. The F5
 * dispositions sweep (land / precondition-abandon, `arc-sweep.ts`) runs BEFORE the
 * idle check, so a dead-premise arc folds within one pulse even on an idle day.
 *
 * OFFLINE (no capable LLM): a deterministic stub arc is seeded (spec §8.5, the
 * permanent fallback) so the plumbing works with no LLM; the gated deliberation
 * then simply no-ops because the brain isn't ready. ONLINE: the LLM seeds arcs
 * via `seed_arc` (F3) — the pulse just delivers the pulse-framed deliberation,
 * and its idle-skip asks the library's own seedWhen gate.
 *
 * `lastPulseTick` is RUNTIME throttle state, not sim truth — reset on timeline
 * restore (same scrub-ghost discipline as `FateTrigger.reset()`).
 */
import type { GameState } from '@/core/state';
import { TICKS_PER_DAY } from '@/core/calendar';
import { stubSeedCondition, seedStubArc } from '@/sim/fate/arc-stub';
import { anySeedableShape } from '@/sim/fate/arc-library';
import { sweepArcs } from '@/sim/fate/arc-sweep';
import type { FateFocus } from './fate-context';

export interface FatePulseDeps {
  getState: () => GameState;
  /** Run a deliberation through FateTrigger's SHARED readiness+cooldown gate. */
  fire: (focus: FateFocus) => void;
  /** True when no capable LLM is configured — enables the deterministic stub seeder. */
  isOffline: () => boolean;
  /** Pulse cadence. Default one game-day. MUST be a `TICKS_PER_DAY` multiple. */
  intervalTicks?: number;
}

export class FatePulse {
  private lastPulseTick = -Infinity;

  constructor(private readonly deps: FatePulseDeps) {}

  private get intervalTicks(): number { return this.deps.intervalTicks ?? TICKS_PER_DAY; }

  /** Runtime-throttle reset (scrub-ghost): a scrub can move the clock BEFORE
   *  `lastPulseTick`, wedging the day cadence shut; clear it. Called from the
   *  game's timeline `onRestore` hook, alongside `FateTrigger.reset()`. */
  reset(): void {
    this.lastPulseTick = -Infinity;
  }

  /** Call once per live sim frame with the current tick. Cheap when idle. */
  tick(now: number): void {
    if (now - this.lastPulseTick < this.intervalTicks) return;   // day cadence gate
    const state = this.deps.getState();
    const arcs = state.fateArcs;
    if (!arcs) return;
    // F5 dispositions sweep (spec §3, checked EVERY pulse): recomputes goal truth
    // (never trusted from disk), LANDS a worked arc whose goals all hold, and
    // ABANDONS an arc whose seedWhen preconditions collapsed — expiring its
    // still-armed beats so an unreachable arc never fires its blow.
    sweepArcs(state);
    const anyLive = arcs.live().length > 0;
    // Seedability is path-honest (F3): offline, the deterministic stub's own
    // condition; online, whether ANY library shape's `seedWhen` currently holds
    // (the same gate seed_arc will apply) — spec §8.2's "no seedWhen met ⇒ skip".
    const canSeed = this.deps.isOffline() ? stubSeedCondition(state) : anySeedableShape(state);
    // IDLE: nothing to build toward, nothing to seed → skip WITHOUT consuming the
    // cadence, so the check stays cheap and Fate wakes the instant work appears.
    if (!anyLive && !canSeed) return;
    this.lastPulseTick = now;   // consume this day's pulse
    // OFFLINE fallback: deterministically seed one dull arc so a no-LLM Fate still
    // holds an intention. Online, the LLM opens arcs via seed_arc (F3).
    if (this.deps.isOffline() && !anyLive && canSeed) {
      seedStubArc(state, now);
    }
    // Wake the brain with the pulse framing. Through the shared gate: offline this
    // no-ops (brain not ready); online it deliberates.
    this.deps.fire({ kind: 'pulse' });
  }
}
