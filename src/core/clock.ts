/**
 * Sim-tick clock. Wall-time ms is fed in via advance(); now() returns the
 * integer tick count. Decoupling sim time from wall time lets Spec B scale
 * sim speed without bending the event log.
 */
export class SimClock {
  private ticks = 0;
  private accumMs = 0;
  private readonly msPerTick: number;

  constructor(msPerTick = 16.667) {
    this.msPerTick = msPerTick;
  }

  advance(realMs: number): void {
    if (realMs <= 0) return;
    this.accumMs += realMs;
    if (this.accumMs < this.msPerTick) return;
    // O(1) — division/modulo, not a subtract loop: a future fast-forward can
    // feed a huge dt (a 21600× rate would otherwise spin ~1.3M iterations per
    // frame). Same accumulator semantics: consume whole ticks, keep remainder.
    const n = Math.floor(this.accumMs / this.msPerTick);
    this.ticks += n;
    this.accumMs -= n * this.msPerTick;
  }

  now(): number {
    return this.ticks;
  }

  setNow(t: number): void {
    this.ticks = t;
    this.accumMs = 0;
  }
}
