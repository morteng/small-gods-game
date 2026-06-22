import { describe, it, expect } from 'vitest';
import { WeatherSystem } from '@/sim/systems/weather-system';
import { buildFloodWatch } from '@/world/flood-watch';
import { CausalSiteStore } from '@/world/causal-site';
import { EventLog } from '@/core/events';
import { SimClock } from '@/core/clock';
import { World } from '@/world/world';
import { createRng } from '@/core/rng';
import type { GameMap } from '@/core/types';
import type { SystemContext } from '@/core/scheduler';
import type { WeatherStepper, WeatherSnapshot } from '@/sim/water/weather-stepper';

const emptyWorld = (): World => new World({
  tiles: [], width: W, height: H, villages: [], seed: 1,
  success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
} as GameMap);

const W = 16, H = 16;

/** A controllable stub stepper — the test drives its flood field directly. */
class StubStepper implements WeatherStepper {
  field = new Float32Array(W * H);
  ticks = 0;
  stepTick(_dtMs: number): void { this.ticks++; }
  floodOffsetM(): Float32Array { return this.field; }
  lakeOffsetM(): Float32Array { return new Float32Array(0); }
  floodPoi(): number { return 0; }
  serialize(): WeatherSnapshot { return { bodyOffsetM: [], floodM: Array.from(this.field), humidity: [], cloud: [], temp: [], timeOfDaySec: 0 }; }
  hydrate(): void {}
  reset(): void { this.field.fill(0); }
  /** Test helper: flood a place's center cell to `d` metres. */
  setCell(x: number, y: number, d: number): void { this.field[y * W + x] = d; }
}

function ctxWith(log: EventLog): SystemContext {
  const clock = new SimClock();
  // The WeatherSystem reads ctx.dt + ctx.log + ctx.world (flood belief seeding).
  return { world: emptyWorld(), spirits: new Map(), log, clock, rng: createRng(1), dt: 1000, now: 0 };
}

describe('WeatherSystem (W-G)', () => {
  it('steps the stepper every tick and is a no-op when none is injected', () => {
    const stub = new StubStepper();
    const present = new WeatherSystem(() => stub, () => null);
    const absent = new WeatherSystem(() => null, () => null);
    const log = new EventLog(new SimClock());
    absent.tick(ctxWith(log));   // must not throw with no stepper
    present.tick(ctxWith(log));
    present.tick(ctxWith(log));
    expect(stub.ticks).toBe(2);
  });

  it('writes a place_flooded edge into the log when a watched place floods, once', () => {
    const stub = new StubStepper();
    const watch = buildFloodWatch([{ id: 'town', name: 'Town', x: 8, y: 8, radius: 2 }], W, H);
    const sys = new WeatherSystem(() => stub, () => watch);
    const log = new EventLog(new SimClock());

    sys.tick(ctxWith(log));                       // dry → no event
    expect(log.size()).toBe(0);

    stub.setCell(8, 8, 2.0);                      // flood the town's footprint
    sys.tick(ctxWith(log));
    const flooded = log.since(0).filter((e) => e.event.type === 'place_flooded');
    expect(flooded).toHaveLength(1);
    expect(flooded[0].event).toMatchObject({ type: 'place_flooded', poiId: 'town', name: 'Town' });

    sys.tick(ctxWith(log));                       // still flooded → no repeat
    expect(log.since(0).filter((e) => e.event.type === 'place_flooded')).toHaveLength(1);
  });

  it('writes a place_receded edge when the water drains back out', () => {
    const stub = new StubStepper();
    const watch = buildFloodWatch([{ id: 'town', name: 'Town', x: 8, y: 8, radius: 2 }], W, H);
    const sys = new WeatherSystem(() => stub, () => watch);
    const log = new EventLog(new SimClock());

    stub.setCell(8, 8, 2.0); sys.tick(ctxWith(log));   // flood
    stub.reset();           sys.tick(ctxWith(log));    // drain
    expect(log.since(0).filter((e) => e.event.type === 'place_receded')).toHaveLength(1);
  });

  it('W-I: births a causal site (site_born) for a flood on un-watched land', () => {
    const stub = new StubStepper();
    const sites = new CausalSiteStore(W, H, new Set(), []);
    const sys = new WeatherSystem(() => stub, () => null, () => sites);
    const log = new EventLog(new SimClock());

    // A 5×5 flood (25 cells > min) on empty land, no watch covering it.
    for (let y = 6; y < 11; y++) for (let x = 6; x < 11; x++) stub.setCell(x, y, 1.5);
    sys.tick(ctxWith(log));

    const born = log.since(0).filter((e) => e.event.type === 'site_born');
    expect(born).toHaveLength(1);
    expect(born[0].event).toMatchObject({ type: 'site_born', kind: 'flood', siteId: 'causal:flood:0000' });
    expect(sites.active()).toHaveLength(1);

    sys.tick(ctxWith(log));   // still flooded → renewed, not re-born
    expect(log.since(0).filter((e) => e.event.type === 'site_born')).toHaveLength(1);
  });
});
