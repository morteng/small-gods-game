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
    while (this.accumMs >= this.msPerTick) {
      this.accumMs -= this.msPerTick;
      this.ticks++;
    }
  }

  now(): number {
    return this.ticks;
  }
}
