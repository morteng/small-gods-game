import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { createRng } from '@/core/rng';
import { initNpcProps } from '@/world/npc-helpers';
import { addDomainBelief } from '@/sim/belief-domains';
import { executeCommand, previewCommand } from '@/sim/command/command-system';
import { derivePreview } from '@/sim/command/preview';
import { summonStormAt, SUMMON_STORM_COST } from '@/sim/divine-actions';
import type { Entity, GameMap, NpcProperties } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';
import type { ApplyCtx, Command, CommandCtx } from '@/sim/command/types';
import { clampAreaRadius } from '@/sim/command/types';
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
  floodedX: number | null = null;
  floodedY: number | null = null;
  floodArea(x: number, y: number, _r: number, depthM: number): number {
    this.floodedX = x; this.floodedY = y; this.floodedDepth = depthM; return 24;
  }
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

// ── abilities-v1 B1/B2/B3 — the area-target sibling ─────────────────────────

const areaCmd = (x: number, y: number, radius: number): Command =>
  ({ verb: 'summon_storm', source: 'player', target: { kind: 'area', x, y, radius }, seq: 1 });

/** A congregation convinced enough to unlock summon_storm, homed anywhere —
 *  `aggregateDomain` folds by home-poi bucket but takes the max, so an area
 *  cast (which has no poiId of its own) reads the same unlock as a settlement
 *  cast would. */
function convinceFlood(world: World): void {
  addBeliever(world, 'town', 0.8);
  addBeliever(world, 'town', 0.8);
}

describe('summon_storm — area target (abilities-v1 B1/B2/B3)', () => {
  it('previewCommand rejects an out-of-bounds centre as invalid_target', () => {
    const world = makeWorld();              // 10×10
    convinceFlood(world);
    const spirits = new Map<SpiritId, Spirit>([['player', spirit(100)]]);
    const c: CommandCtx = { world, spirits, log: new EventLog(new SimClock()) };
    expect(previewCommand(areaCmd(999, 5, 6), c)).toBe('invalid_target');
    expect(previewCommand(areaCmd(5, -1, 6), c)).toBe('invalid_target');
  });

  it('previewCommand rejects a non-finite radius or centre as invalid_target', () => {
    const world = makeWorld();
    convinceFlood(world);
    const spirits = new Map<SpiritId, Spirit>([['player', spirit(100)]]);
    const c: CommandCtx = { world, spirits, log: new EventLog(new SimClock()) };
    expect(previewCommand(areaCmd(5, 5, NaN), c)).toBe('invalid_target');
    expect(previewCommand(areaCmd(NaN, 5, 6), c)).toBe('invalid_target');
  });

  it('does NOT reject an out-of-band radius — it clamps, so a sloppy call still does something sane', () => {
    const world = makeWorld();
    convinceFlood(world);
    const spirits = new Map<SpiritId, Spirit>([['player', spirit(1000)]]);
    const c: CommandCtx = { world, spirits, log: new EventLog(new SimClock()) };
    // radius 1 (below the 2..12 band) and 50 (above it) both preview clean —
    // clamped to 2 and 12 respectively, never bounced as invalid_target.
    expect(previewCommand(areaCmd(5, 5, 1), c)).toBeNull();
    expect(previewCommand(areaCmd(5, 5, 50), c)).toBeNull();
  });

  it('radius-scaled cost: r=6 costs exactly today\'s base; r=12 costs 4×; preview gates on the same number', () => {
    const world = makeWorld();
    convinceFlood(world);
    const ctxFor = (power: number): CommandCtx =>
      ({ world, spirits: new Map<SpiritId, Spirit>([['player', spirit(power)]]), log: new EventLog(new SimClock()) });

    const r6 = derivePreview(areaCmd(5, 5, 6), ctxFor(1000));
    expect(r6.cost).toBe(SUMMON_STORM_COST);
    const r12 = derivePreview(areaCmd(5, 5, 12), ctxFor(1000));
    expect(r12.cost).toBe(SUMMON_STORM_COST * 4);

    // The preview never lies: exactly enough power for the r=12 cast previews
    // affordable; one short of it previews insufficient_power.
    const enough = previewCommand(areaCmd(5, 5, 12), ctxFor(SUMMON_STORM_COST * 4));
    expect(enough).toBeNull();
    const short = previewCommand(areaCmd(5, 5, 12), ctxFor(SUMMON_STORM_COST * 4 - 1));
    expect(short).toBe('insufficient_power');
  });

  it('summonStormAt lays a flood via floodArea (not floodPoi) and pays the radius-scaled cost', () => {
    const weather = new StubWeather();
    const log = new EventLog(new SimClock());
    const sp = spirit(1000);
    expect(summonStormAt(sp, 7, 9, 12, log, weather)).toBe(true);
    expect(weather.floodedX).toBe(7);
    expect(weather.floodedY).toBe(9);
    expect(weather.floodedPoi).toBeNull();          // floodPoi was never called
    expect(sp.power).toBe(1000 - SUMMON_STORM_COST * 4);
  });

  it('summonStormAt declines cleanly when underfunded, spending nothing', () => {
    const weather = new StubWeather();
    const log = new EventLog(new SimClock());
    const sp = spirit(1);
    expect(summonStormAt(sp, 7, 9, 6, log, weather)).toBe(false);
    expect(weather.floodedX).toBeNull();
    expect(sp.power).toBe(1);
  });

  it('executeCommand on an area target appends a poiId-less summon_storm event with x/y/radius', () => {
    const world = makeWorld();
    convinceFlood(world);
    const sp = spirit(1000);
    const spirits = new Map<SpiritId, Spirit>([['player', sp]]);
    const weather = new StubWeather();
    const log = new EventLog(new SimClock());
    const r = executeCommand(areaCmd(4, 6, 12), ctx(world, spirits, log, weather));
    expect(r.status).toBe('applied');
    expect(weather.floodedX).toBe(4);
    expect(weather.floodedY).toBe(6);
    expect(sp.power).toBe(1000 - SUMMON_STORM_COST * 4);
    const ev = log.since(0).find((e) => e.event.type === 'summon_storm')!.event as {
      poiId?: string; x?: number; y?: number; radius?: number;
    };
    expect(ev.poiId).toBeUndefined();
    expect(ev.x).toBe(4);
    expect(ev.y).toBe(6);
    expect(ev.radius).toBe(12);
  });
});

describe('clampAreaRadius', () => {
  it('passes through an in-band radius unchanged (rounded)', () => {
    expect(clampAreaRadius(6)).toBe(6);
    expect(clampAreaRadius(6.4)).toBe(6);
  });
  it('clamps below the 2..12 band up to the floor', () => {
    expect(clampAreaRadius(0)).toBe(2);
    expect(clampAreaRadius(-5)).toBe(2);
  });
  it('clamps above the 2..12 band down to the ceiling', () => {
    expect(clampAreaRadius(50)).toBe(12);
  });
  it('never explodes on a non-finite input — falls back to the floor', () => {
    // Non-finite is a guard against a corrupt clamp read directly, not the
    // normal path — previewCommand rejects a non-finite radius outright
    // (command-system.ts), so a real command never reaches this fallback.
    expect(clampAreaRadius(NaN)).toBe(2);
    expect(clampAreaRadius(Infinity)).toBe(2);
  });
});
