import type { SimClock } from '@/core/clock';
import type { EventLog } from '@/core/events';
import type { Spirit, SpiritId } from '@/core/spirit';
import type { World } from '@/world/world';
import type { Rng } from '@/core/rng';

export interface SystemContext {
  world: World;
  spirits: Map<SpiritId, Spirit>;
  log: EventLog;
  clock: SimClock;
  rng: Rng;
  dt: number;   // sim ms accumulated since this system last ticked
  now: number;  // current sim tick (clock.now() after advance)
}

export interface System {
  name: string;
  tickHz: number;   // 0 = manual / disabled; positive = scheduled
  tick(ctx: SystemContext): void;
}

type BaseCtx = Omit<SystemContext, 'dt' | 'now'>;

export class Scheduler {
  private systems: System[] = [];
  private accumulators = new Map<string, number>();
  private rateScale = 1;

  register(s: System): void {
    if (this.systems.some(x => x.name === s.name)) {
      throw new Error(`System already registered: ${s.name}`);
    }
    this.systems.push(s);
    this.accumulators.set(s.name, 0);
  }

  /** Called once per RAF from game.ts with wall-clock dt. */
  tick(realDtMs: number, ctxBase: BaseCtx): void {
    const simDtMs = realDtMs * this.rateScale;
    ctxBase.clock.advance(simDtMs);
    const now = ctxBase.clock.now();

    for (const s of this.systems) {
      if (s.tickHz <= 0) continue;
      const interval = 1000 / s.tickHz;
      let acc = (this.accumulators.get(s.name) ?? 0) + simDtMs;
      // While loop so fast systems can tick multiple times within one frame
      while (acc >= interval) {
        try {
          s.tick({ ...ctxBase, dt: acc, now });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          ctxBase.log.append({ type: 'system_error', system: s.name, message });
          console.error(`[scheduler] ${s.name} threw:`, err);
        }
        acc -= interval;
      }
      this.accumulators.set(s.name, acc);
    }
  }

  setRate(scale: number): void {
    this.rateScale = Math.max(0, scale);
  }

  getRate(): number {
    return this.rateScale;
  }
}
