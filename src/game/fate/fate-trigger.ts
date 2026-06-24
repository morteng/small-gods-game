/**
 * fate-trigger.ts — decides WHEN to wake the Fate brain.
 *
 * Subscribes to the EventLog and schedules a deliberation only on a SIGNIFICANT
 * recognized-story event (a thread opening, climaxing, or resolving) — so Fate
 * reacts to recognized story, not raw sim noise — throttled by a cooldown so it
 * cannot spam. Stateless beyond `lastTick` (transient runtime state; not sim
 * state). After a reload Fate may deliberate one cycle sooner — harmless.
 */
import type { AppendedEvent, SimEvent } from '@/core/events';
import type { SimClock } from '@/core/clock';
import type { FateFocus } from './fate-context';

export interface FateTriggerDeps {
  clock: SimClock;
  cooldownTicks: number;
  isReady: () => boolean;
  onTrigger: (focus: FateFocus) => void;
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

function threadIdOf(ev: SimEvent): number | undefined {
  if (ev.type === 'thread_opened' || ev.type === 'thread_advanced' || ev.type === 'thread_resolved') {
    return ev.threadId;
  }
  return undefined;
}

export class FateTrigger {
  private lastTick = -Infinity;

  constructor(private readonly deps: FateTriggerDeps) {}

  /** Wire to an EventLog: `attach((fn) => eventLog.subscribe(fn))`. Returns unsubscribe. */
  attach(subscribe: (fn: (e: AppendedEvent) => void) => () => void): () => void {
    return subscribe((e) => this.onEvent(e));
  }

  onEvent(e: AppendedEvent): void {
    if (!isSignificant(e.event)) return;
    if (!this.deps.isReady()) return;
    const now = this.deps.clock.now();
    if (now - this.lastTick < this.deps.cooldownTicks) return;
    this.lastTick = now;
    this.deps.onTrigger({ event: e.event, threadId: threadIdOf(e.event) });
  }
}
