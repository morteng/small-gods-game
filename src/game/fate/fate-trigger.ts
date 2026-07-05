/**
 * fate-trigger.ts — decides WHEN to wake the Fate brain.
 *
 * Subscribes to the EventLog and schedules a deliberation only on a SIGNIFICANT
 * recognized-story event (a thread opening, climaxing, or resolving) — so Fate
 * reacts to recognized story, not raw sim noise — throttled by a cooldown so it
 * cannot spam. Stateless beyond `lastTick` (transient runtime state; not sim
 * state). After a reload Fate may deliberate one cycle sooner — harmless.
 *
 * WP-L: SUSTAINED RIVAL PRESSURE also wakes Fate. A rival answering a prayer the
 * player left unanswered (`answer_prayer` with a non-player spiritId) is not a
 * single dramatic beat but an accumulating one — so a lone claim does NOT fire;
 * instead we count claims inside a sliding window and wake the brain once the
 * count clears a small threshold (default ≥2 within one sim-day). The player's
 * OWN answers never count. Firing still passes the shared readiness + cooldown
 * gates, so rival pressure cannot spam any more than story events can.
 */
import type { AppendedEvent, SimEvent } from '@/core/events';
import type { SimClock } from '@/core/clock';
import { TICKS_PER_DAY } from '@/core/calendar';
import { PLAYER_SPIRIT_ID } from '@/sim/believers';
import type { FateFocus } from './fate-context';

export interface FateTriggerDeps {
  clock: SimClock;
  cooldownTicks: number;
  isReady: () => boolean;
  onTrigger: (focus: FateFocus) => void;
  /** How many rival prayer-claims within the window wake Fate. Default 2. */
  rivalClaimThreshold?: number;
  /** The sliding window (ticks) over which rival claims accumulate. Default 240
   *  (one sim-day) — shorter than a typical cooldown, so pressure lapses cleanly. */
  rivalClaimWindowTicks?: number;
}

function isSignificant(ev: SimEvent): boolean {
  if (ev.type === 'thread_opened' || ev.type === 'thread_resolved') return true;
  if (ev.type === 'thread_advanced') return ev.weight === 'climax';
  // W-H: a settlement going under water is a dramatic beat — wake Fate to respond
  // (a tale of divine wrath, a refugee, a rival's counter-claim…).
  if (ev.type === 'place_flooded') return true;
  // W-I: the waters making a NEW place (a drowned plain) is likewise beat-worthy —
  // wake Fate so it can prime atmosphere there before it fades.
  if (ev.type === 'site_born') return true;
  return false;
}

/** A rival (non-player) claiming a prayer via the shared `answer_prayer` path. */
function isRivalClaim(ev: SimEvent): boolean {
  return ev.type === 'answer_prayer' && ev.spiritId !== PLAYER_SPIRIT_ID;
}

function threadIdOf(ev: SimEvent): number | undefined {
  if (ev.type === 'thread_opened' || ev.type === 'thread_advanced' || ev.type === 'thread_resolved') {
    return ev.threadId;
  }
  return undefined;
}

export class FateTrigger {
  private lastTick = -Infinity;
  /** Ticks of recent rival prayer-claims, pruned to the sliding window. */
  private claimTicks: number[] = [];

  constructor(private readonly deps: FateTriggerDeps) {}

  private get rivalClaimThreshold(): number { return this.deps.rivalClaimThreshold ?? 2; }
  /** Sustained-pressure window: ≥threshold claims within ONE DAY. Claims are
   *  themselves day-gated (a plea must age half a day to be claimable), so a
   *  sub-day window would never accumulate two under 1:1 realtime. */
  private get rivalClaimWindowTicks(): number { return this.deps.rivalClaimWindowTicks ?? TICKS_PER_DAY; }

  /** Wire to an EventLog: `attach((fn) => eventLog.subscribe(fn))`. Returns unsubscribe. */
  attach(subscribe: (fn: (e: AppendedEvent) => void) => () => void): () => void {
    return subscribe((e) => this.onEvent(e));
  }

  /** WP-D scrub-ghost pattern (onRestore reset, not serialize): claim pressure
   *  and the cooldown anchor are throttle state, not sim truth — after a
   *  timeline scrub/commit the clock may sit BEFORE `lastTick` (a discarded
   *  future), which would wedge the cooldown gate shut for real time. Reset
   *  both; the documented worst case ("Fate may deliberate one cycle sooner")
   *  is harmless. Called from the game's timeline `onRestore` hook — this class
   *  lives in src/game/, outside the sim-side SystemStateRegistry seam. */
  reset(): void {
    this.lastTick = -Infinity;
    this.claimTicks = [];
  }

  onEvent(e: AppendedEvent): void {
    const ev = e.event;
    const now = this.deps.clock.now();
    if (isSignificant(ev)) {
      this.maybeFire({ event: ev, threadId: threadIdOf(ev) }, now);
      return;
    }
    if (isRivalClaim(ev)) {
      // Accumulate pressure even while not-ready/on-cooldown, then fire once the
      // window holds enough claims (the maybeFire gates still throttle firing).
      this.claimTicks.push(now);
      const cutoff = now - this.rivalClaimWindowTicks;
      this.claimTicks = this.claimTicks.filter((t) => t >= cutoff);
      if (this.claimTicks.length >= this.rivalClaimThreshold) {
        this.maybeFire({ event: ev }, now);
      }
    }
  }

  /** Shared readiness + cooldown gate; records lastTick only after all gates pass. */
  private maybeFire(focus: FateFocus, now: number): void {
    if (!this.deps.isReady()) return;
    if (now - this.lastTick < this.deps.cooldownTicks) return;
    this.lastTick = now;
    this.deps.onTrigger(focus);
  }
}
