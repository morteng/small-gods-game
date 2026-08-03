// Who gets the credit when the waters rise.
//
// The defect these pin: `WeatherSystem` used to credit a hardcoded `'player'` for
// EVERY flood in the world, so a rival's `summon_storm` seeded the player's flood
// domain — the rival paid the power and the player's believers learned that the
// player commands the deluge.

import { describe, it, expect } from 'vitest';
import { EventLog, SilentEventLog } from '@/core/events';
import { SimClock } from '@/core/clock';
import { World } from '@/world/world';
import { createRng } from '@/core/rng';
import { WeatherSystem } from '@/sim/systems/weather-system';
import { buildFloodWatch } from '@/world/flood-watch';
import { seedFloodBelief } from '@/sim/divine-actions';
import { initNpcProps } from '@/world/npc-helpers';
import { getDomainBelief } from '@/sim/belief-domains';
import {
  FLOOD_CREDIT_WINDOW_TICKS, NATURAL_CAUSE,
  creditForPlaceFlood, creditForSiteFlood, stormCastsIn,
} from '@/sim/water/flood-attribution';
import type { GameMap, NpcProperties } from '@/core/types';
import type { SystemContext } from '@/core/scheduler';
import type { WeatherStepper, WeatherSnapshot } from '@/sim/water/weather-stepper';

const W = 32, H = 32;

const emptyWorld = (): World => new World({
  tiles: [], width: W, height: H, villages: [], seed: 1,
  success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
} as GameMap);

class StubStepper implements WeatherStepper {
  field = new Float32Array(W * H);
  stepTick(): void {}
  floodOffsetM(): Float32Array { return this.field; }
  hasFlood(): boolean { return this.field.some((v) => v > 0); }
  lakeOffsetM(): Float32Array { return new Float32Array(0); }
  floodPoi(): number { return 0; }
  floodArea(): number { return 0; }
  serialize(): WeatherSnapshot {
    return { bodyOffsetM: [], floodM: Array.from(this.field), humidity: [], cloud: [], temp: [], timeOfDaySec: 0 };
  }
  hydrate(): void {}
  reset(): void { this.field.fill(0); }
  /** Flood a disc so a watched place crosses the coverage threshold. */
  floodDisc(cx: number, cy: number, r: number, d: number): void {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        this.field[y * W + x] = d;
      }
    }
  }
}

/** A soul living at `poiId` who already believes in `sid`. */
function resident(world: World, id: string, poiId: string, sid: string | null): NpcProperties {
  const p = initNpcProps(id, 'farmer', 1);
  p.homePoiId = poiId;
  p.beliefs = sid ? { [sid]: { faith: 0.8, understanding: 0.5, devotion: 0.5 } } : {};
  world.addEntity({ id, kind: 'npc', x: 1, y: 1, properties: p as unknown as Record<string, unknown> });
  return p;
}

describe('flood attribution — which god the waters credit', () => {
  describe('creditForPlaceFlood', () => {
    const noPos = () => null;

    it('credits the god that named the settlement in its cast', () => {
      const casts = stormCastsIn([
        { id: 1, t: 0, event: { type: 'summon_storm', spiritId: 'rival-a', poiId: 'oakshire', depthM: 1, cells: 9 } },
      ]);
      expect(creditForPlaceFlood(casts, 'oakshire', noPos)).toBe('rival-a');
    });

    it('credits nobody when no god cast anything — a natural flood has no hand behind it', () => {
      expect(creditForPlaceFlood([], 'oakshire', noPos)).toBeNull();
    });

    it('does not credit a god that flooded a DIFFERENT settlement', () => {
      const casts = stormCastsIn([
        { id: 1, t: 0, event: { type: 'summon_storm', spiritId: 'rival-a', poiId: 'elsewhere', depthM: 1, cells: 9 } },
      ]);
      expect(creditForPlaceFlood(casts, 'oakshire', noPos)).toBeNull();
    });

    it('credits an AREA cast whose disc covers the settlement — the believers cannot tell the verbs apart', () => {
      const casts = stormCastsIn([
        { id: 1, t: 0, event: { type: 'summon_storm', spiritId: 'rival-a', x: 10, y: 10, radius: 6, depthM: 1, cells: 90 } },
      ]);
      expect(creditForPlaceFlood(casts, 'oakshire', () => ({ x: 12, y: 12 }))).toBe('rival-a');
      // ...and not one that falls well outside it.
      expect(creditForPlaceFlood(casts, 'oakshire', () => ({ x: 28, y: 28 }))).toBeNull();
    });

    it('the LATEST cast wins when two gods flood the same place in one window', () => {
      const casts = stormCastsIn([
        { id: 1, t: 0, event: { type: 'summon_storm', spiritId: 'rival-a', poiId: 'oakshire', depthM: 1, cells: 9 } },
        { id: 2, t: 5, event: { type: 'summon_storm', spiritId: 'player', poiId: 'oakshire', depthM: 1, cells: 9 } },
      ]);
      expect(creditForPlaceFlood(casts, 'oakshire', noPos)).toBe('player');
    });
  });

  describe('creditForSiteFlood', () => {
    it('credits the area cast covering the drowned ground', () => {
      const casts = stormCastsIn([
        { id: 1, t: 0, event: { type: 'summon_storm', spiritId: 'player', x: 8, y: 8, radius: 4, depthM: 1, cells: 40 } },
      ]);
      expect(creditForSiteFlood(casts, 9, 9)).toBe('player');
    });

    it('reports NATURAL_CAUSE for ground no cast reached', () => {
      const casts = stormCastsIn([
        { id: 1, t: 0, event: { type: 'summon_storm', spiritId: 'player', x: 8, y: 8, radius: 4, depthM: 1, cells: 40 } },
      ]);
      expect(creditForSiteFlood(casts, 25, 25)).toBe(NATURAL_CAUSE);
    });

    it('ignores a SETTLEMENT cast — a causal site is by definition unwatched ground', () => {
      const casts = stormCastsIn([
        { id: 1, t: 0, event: { type: 'summon_storm', spiritId: 'player', poiId: 'oakshire', depthM: 1, cells: 9 } },
      ]);
      expect(creditForSiteFlood(casts, 5, 5)).toBe(NATURAL_CAUSE);
    });
  });

  describe('seedFloodBelief', () => {
    it('a CAST flood teaches every resident about the caster, believer or not', () => {
      const world = emptyWorld();
      resident(world, 'faithful', 'oakshire', 'player');
      resident(world, 'heathen', 'oakshire', null);
      seedFloodBelief(world, 'rival-a', 'oakshire', 1);
      for (const id of ['faithful', 'heathen']) {
        const p = world.registry.get(id)!.properties as unknown as NpcProperties;
        expect(getDomainBelief(p, 'rival-a', 'flood')).toBeGreaterThan(0);
      }
    });

    it('a NATURAL flood is credited by each soul to its OWN god, and by the faithless to none', () => {
      const world = emptyWorld();
      resident(world, 'players-own', 'oakshire', 'player');
      resident(world, 'rivals-own', 'oakshire', 'rival-a');
      resident(world, 'heathen', 'oakshire', null);
      seedFloodBelief(world, null, 'oakshire', 1);

      const props = (id: string) => world.registry.get(id)!.properties as unknown as NpcProperties;
      expect(getDomainBelief(props('players-own'), 'player', 'flood')).toBeGreaterThan(0);
      expect(getDomainBelief(props('players-own'), 'rival-a', 'flood')).toBe(0);
      // THE BUG THIS PINS: a rival's follower used to learn this of the PLAYER.
      expect(getDomainBelief(props('rivals-own'), 'rival-a', 'flood')).toBeGreaterThan(0);
      expect(getDomainBelief(props('rivals-own'), 'player', 'flood')).toBe(0);
      expect(Object.keys(props('heathen').beliefs)).toHaveLength(0);
    });

    it('leaves other settlements alone', () => {
      const world = emptyWorld();
      resident(world, 'elsewhere', 'far-town', 'player');
      seedFloodBelief(world, 'rival-a', 'oakshire', 1);
      const p = world.registry.get('elsewhere')!.properties as unknown as NpcProperties;
      expect(getDomainBelief(p, 'rival-a', 'flood')).toBe(0);
    });
  });

  describe('WeatherSystem end to end', () => {
    /** Drive one weather tick over a world with one watched place and one resident. */
    function run(castBy: string | null, believesIn: string): NpcProperties {
      const clock = new SimClock();
      const log = new EventLog(clock);
      const world = emptyWorld();
      resident(world, 'soul', 'oakshire', believesIn);
      const stepper = new StubStepper();
      stepper.floodDisc(16, 16, 4, 1.0);
      const watch = buildFloodWatch([{ id: 'oakshire', name: 'Oakshire', x: 16, y: 16, radius: 3 }], W, H);
      if (castBy) {
        log.append({ type: 'summon_storm', spiritId: castBy, poiId: 'oakshire', depthM: 1, cells: 40 });
      }
      const sys = new WeatherSystem(() => stepper, () => watch);
      const ctx: SystemContext = {
        world, spirits: new Map(), log, clock, rng: createRng(1), dt: 1000, now: clock.now(),
      };
      sys.tick(ctx);
      return world.registry.get('soul')!.properties as unknown as NpcProperties;
    }

    it("a rival's storm over a player town seeds the RIVAL's flood domain", () => {
      const p = run('rival-a', 'player');
      expect(getDomainBelief(p, 'rival-a', 'flood')).toBeGreaterThan(0);
      expect(getDomainBelief(p, 'player', 'flood')).toBe(0);
    });

    it("an unsummoned flood seeds the resident's own god", () => {
      const p = run(null, 'rival-a');
      expect(getDomainBelief(p, 'rival-a', 'flood')).toBeGreaterThan(0);
      expect(getDomainBelief(p, 'player', 'flood')).toBe(0);
    });

    it('a cast older than the credit window no longer holds a claim on the water', () => {
      const clock = new SimClock();
      const log = new EventLog(clock);
      const world = emptyWorld();
      resident(world, 'soul', 'oakshire', 'player');
      log.append({ type: 'summon_storm', spiritId: 'rival-a', poiId: 'oakshire', depthM: 1, cells: 40 });

      const stepper = new StubStepper();
      stepper.floodDisc(16, 16, 4, 1.0);
      const watch = buildFloodWatch([{ id: 'oakshire', name: 'Oakshire', x: 16, y: 16, radius: 3 }], W, H);
      const sys = new WeatherSystem(() => stepper, () => watch);
      const now = FLOOD_CREDIT_WINDOW_TICKS * 2;
      sys.tick({ world, spirits: new Map(), log, clock, rng: createRng(1), dt: 1000, now });

      const p = world.registry.get('soul')!.properties as unknown as NpcProperties;
      expect(getDomainBelief(p, 'rival-a', 'flood')).toBe(0);
      expect(getDomainBelief(p, 'player', 'flood')).toBeGreaterThan(0);   // fell back to own-god
    });
  });

  describe('replay parity', () => {
    it('a SilentEventLog still answers recentSince, so a replayed flood keeps its caster', () => {
      // If this returned [] (as `since`/`range` do), replay would re-credit every
      // flood to nature and diverge from the live run it is supposed to reproduce.
      const clock = new SimClock();
      const silent = new SilentEventLog(clock);
      silent.append({ type: 'summon_storm', spiritId: 'rival-a', poiId: 'oakshire', depthM: 1, cells: 9 });
      const casts = stormCastsIn(silent.recentSince(0));
      expect(creditForPlaceFlood(casts, 'oakshire', () => null)).toBe('rival-a');
      // ...while the HISTORY readers stay silent, which is the whole point of the class.
      expect(silent.since()).toHaveLength(0);
      expect(silent.size()).toBe(0);
    });
  });
});
