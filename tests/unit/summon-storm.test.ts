import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { createRng } from '@/core/rng';
import { initNpcProps } from '@/world/npc-helpers';
import { addDomainBelief } from '@/sim/belief-domains';
import { executeCommand } from '@/sim/command/command-system';
import type { Entity, GameMap, NpcProperties } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';
import type { ApplyCtx, Command } from '@/sim/command/types';
import type { WeatherStepper, WeatherSnapshot } from '@/sim/water/weather-stepper';

function makeWorld(): World {
  return new World({
    tiles: [], width: 10, height: 10, villages: [], seed: 1,
    success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as GameMap);
}
function spirit(power = 100): Spirit {
  return { id: 'player', name: 'p', sigil: '*', color: '#fff', isPlayer: true, power, manifestation: null };
}
let nextId = 0;
function addBeliever(world: World, poi: string, flood: number): Entity {
  const props = initNpcProps('Pip', 'farmer', ++nextId) as NpcProperties;
  props.beliefs = { player: { faith: 1, understanding: 0.6, devotion: 1 } };
  props.homePoiId = poi;
  if (flood > 0) addDomainBelief(props, 'player', 'flood', flood);
  const e = { id: `n${nextId}`, kind: 'npc', x: 0, y: 0, properties: props as unknown as Record<string, unknown> } as Entity;
  world.addEntity(e);
  return e;
}

class StubWeather implements WeatherStepper {
  floodedPoi: string | null = null;
  floodedDepth = 0;
  stepTick(): void {}
  serialize(): WeatherSnapshot { return { bodyOffsetM: [], floodM: [], humidity: [], cloud: [], temp: [], timeOfDaySec: 0 }; }
  hydrate(): void {}
  reset(): void {}
  floodOffsetM(): Float32Array { return new Float32Array(0); }
  hasFlood(): boolean { return false; }
  lakeOffsetM(): Float32Array { return new Float32Array(0); }
  floodPoi(poiId: string, _r: number, depthM: number): number { this.floodedPoi = poiId; this.floodedDepth = depthM; return 42; }
}

function ctx(world: World, spirits: Map<SpiritId, Spirit>, log: EventLog, weather: WeatherStepper | null): ApplyCtx {
  return { world, spirits, log, weather, rng: createRng(1), now: 0 };
}
const cmd = (poiId: string): Command =>
  ({ verb: 'summon_storm', source: 'player', target: { kind: 'settlement', poiId }, seq: 1 });

describe('summon_storm (W-H)', () => {
  it('is belief-gated: rejected when the congregation lacks flood conviction', () => {
    const world = makeWorld();
    addBeliever(world, 'town', 0);   // believer, but no flood-domain belief
    const spirits = new Map<SpiritId, Spirit>([['player', spirit()]]);
    const weather = new StubWeather();
    const r = executeCommand(cmd('town'), ctx(world, spirits, new EventLog(new SimClock()), weather));
    expect(r.status).toBe('rejected');
    expect(weather.floodedPoi).toBeNull();   // no flood laid
  });

  it('applies when believers credit the god with floods — lays the flood + emits the event + spends power', () => {
    const world = makeWorld();
    addBeliever(world, 'town', 0.8);
    addBeliever(world, 'town', 0.8);
    const sp = spirit(100);
    const spirits = new Map<SpiritId, Spirit>([['player', sp]]);
    const weather = new StubWeather();
    const log = new EventLog(new SimClock());
    const r = executeCommand(cmd('town'), ctx(world, spirits, log, weather));
    expect(r.status).toBe('applied');
    expect(weather.floodedPoi).toBe('town');               // flood laid at the target
    expect(weather.floodedDepth).toBeGreaterThan(0);
    expect(sp.power).toBeLessThan(100);                    // power spent
    const ev = log.since(0).find((e) => e.event.type === 'summon_storm');
    expect(ev?.event).toMatchObject({ type: 'summon_storm', poiId: 'town' });
  });

  it('rejected when the god cannot afford it', () => {
    const world = makeWorld();
    addBeliever(world, 'town', 0.8);
    const spirits = new Map<SpiritId, Spirit>([['player', spirit(1)]]);   // too little power
    const r = executeCommand(cmd('town'), ctx(world, spirits, new EventLog(new SimClock()), new StubWeather()));
    expect(r.status).toBe('rejected');
  });
});
