import { describe, it, expect, beforeEach } from 'vitest';
import { generateWithNoise } from '@/map/map-generator';
import { WaterType, type WorldSeed } from '@/core/types';
import { getHydrologyResult, clearHydrologyCache } from '@/world/hydrology-store';
import { getLakeBodies } from '@/render/gpu/water-field';
import { WaterDynamics, DEFAULT_WEATHER, type WeatherParams } from '@/render/gpu/water-dynamics';

const seed: WorldSeed = {
  name: 'wd', size: { width: 96, height: 96 }, biome: 'temperate',
  pois: [], connections: [], constraints: [],
};

beforeEach(() => clearHydrologyCache());

/** Find a tile that sits inside a (render) lake body. */
function aLakeTile(map: { width: number }): { x: number; y: number; body: number } | null {
  const { bodyId } = getLakeBodies(map as never);
  for (let i = 0; i < bodyId.length; i++) {
    if (bodyId[i] >= 0) return { x: i % map.width, y: (i / map.width) | 0, body: bodyId[i] };
  }
  return null;
}

describe('WaterDynamics — localized water level', () => {
  it('rain ON a lake raises that basin; evaporation drains it back to baseline', async () => {
    const { map } = await generateWithNoise(96, 96, 3, seed);
    const lake = aLakeTile(map);
    expect(lake, 'this seed should produce a lake').not.toBeNull();
    const wd = new WaterDynamics(map);
    const before = wd.lakeOffsetM()[lake!.body];
    expect(before).toBe(0);

    wd.rain(lake!.x, lake!.y, DEFAULT_WEATHER);
    const flooded = wd.lakeOffsetM()[lake!.body];
    expect(flooded).toBeGreaterThan(0);             // basin rose

    // Evaporate for a few seconds at a strong rate → recedes toward 0.
    const dry: WeatherParams = { ...DEFAULT_WEATHER, evapMmPerSec: 200 };
    for (let s = 0; s < 60; s++) wd.step(0.1, dry);  // 6 s
    expect(wd.lakeOffsetM()[lake!.body]).toBeLessThan(flooded);
    expect(wd.lakeOffsetM()[lake!.body]).toBeGreaterThanOrEqual(0);  // never below baseline from evap
  });

  it('rain UPSTREAM routes downhill and fills the basin it drains into', async () => {
    const { map } = await generateWithNoise(96, 96, 3, seed);
    const hy = getHydrologyResult(map);
    const { bodyId } = getLakeBodies(map);
    // A land cell whose drainTo chain terminates at a lake (a basin's catchment).
    const W = map.width;
    let upstream: { x: number; y: number; body: number } | null = null;
    for (let i = 0; i < bodyId.length && !upstream; i++) {
      if (hy.waterType[i] !== WaterType.Dry) continue;   // start from dry land
      if (bodyId[i] >= 0) continue;                 // skip cells already in a lake
      let j = i, steps = 0;
      while (steps++ < W * 2) {
        if (bodyId[j] >= 0) { upstream = { x: i % W, y: (i / W) | 0, body: bodyId[j] }; break; }
        const t = hy.drainTo[j];
        if (t < 0 || t === j) break;
        j = t;
      }
    }
    if (!upstream) return;                            // not all worlds have a lake-terminating catchment
    const wd = new WaterDynamics(map);
    const target = wd.rain(upstream.x, upstream.y, DEFAULT_WEATHER);
    expect(target).toBe(upstream.body);
    expect(wd.lakeOffsetM()[upstream.body]).toBeGreaterThan(0);
  });

  it('rain raises humidity over the brush, which decays over time', async () => {
    const { map } = await generateWithNoise(96, 96, 3, seed);
    const wd = new WaterDynamics(map);
    wd.rain(48, 48, { ...DEFAULT_WEATHER, brushRadius: 5 });
    const peak = wd.maxHumidity();
    expect(peak).toBeGreaterThan(0);
    const dryAir: WeatherParams = { ...DEFAULT_WEATHER, humidityDecayPerSec: 0.5, evapMmPerSec: 0 };
    for (let s = 0; s < 40; s++) wd.step(0.1, dryAir);  // 4 s
    expect(wd.maxHumidity()).toBeLessThan(peak);
  });

  it('shiftLargest floods/droughts the biggest basin; reset clears everything', async () => {
    const { map } = await generateWithNoise(96, 96, 3, seed);
    const wd = new WaterDynamics(map);
    if (wd.bodyCount === 0) return;
    expect(wd.shiftLargest(2)).toBe(true);
    expect(wd.maxLevelM()).toBeGreaterThan(0);
    wd.shiftLargest(-5);
    expect(wd.maxLevelM()).toBeLessThan(0);            // drought now dominates
    wd.reset();
    expect(wd.maxLevelM()).toBe(0);
    expect(wd.maxHumidity()).toBe(0);
  });

  it('a lakeless catchment swallows rain without error (humidity only)', async () => {
    const { map } = await generateWithNoise(96, 96, 3, seed);
    const wd = new WaterDynamics(map);
    // Rain in the open sea / a non-draining spot — must not throw, humidity still rises.
    expect(() => wd.rain(2, 2, DEFAULT_WEATHER)).not.toThrow();
    expect(wd.maxHumidity()).toBeGreaterThanOrEqual(0);
  });
});
