import { describe, it, expect } from 'vitest';
import { generateWithNoise } from '@/map/map-generator';
import { placeComplexOnPatch } from '@/world/place-complex';
import { evaluateConnectome } from '@/world/connectome-diagnostics';
import { heightMetresAt } from '@/world/heightfield';
import type { Entity, WorldSeed } from '@/core/types';

const seed: WorldSeed = {
  name: 'fort-patch', size: { width: 96, height: 96 }, biome: 'temperate',
  pois: [], connections: [], constraints: [],
} as unknown as WorldSeed;

/** Lowest interior cell → a motte is genuinely needed (matches the studio's low-ground seat). */
function lowSeat(map: { width: number; height: number }): { x: number; y: number } {
  let c = { x: 48, y: 48 }, lo = Infinity;
  for (let y = 20; y < 76; y++) for (let x = 20; x < 76; x++) {
    const h = heightMetresAt(map as never, x, y);
    if (h < lo) { lo = h; c = { x, y }; }
  }
  return c;
}

async function buildFort(s: number) {
  const { map, world } = await generateWithNoise(96, 96, s, seed);
  const centre = lowSeat(map);
  const res = placeComplexOnPatch(world, map, { complexTypeId: 'motte_and_bailey', centre, seed: s, era: 'medieval' });
  return { map, world, res, centre };
}

const fortDiags = (world: never, map: never, rule?: string) =>
  evaluateConnectome({ world, map }).diagnostics.filter((d) => (rule ? d.rule === rule : d.rule.startsWith('fort.')));

describe('fort connectome diagnostics', () => {
  it('lints a healthy generated complex clean (no fort errors/warns)', async () => {
    // A few seeds — a freshly placed motte-and-bailey should never trip a fort rule.
    for (const s of [0x5170, 7, 1234]) {
      const { map, world } = await buildFort(s);
      const warns = fortDiags(world as never, map as never).filter((d) => d.severity !== 'info');
      expect(warns, `seed ${s} fort warnings: ${warns.map((d) => d.rule).join(',')}`).toHaveLength(0);
    }
  });

  it('stays silent on a world with no earthworks (ordinary settlement / synthetic map)', async () => {
    const { map, world } = await generateWithNoise(96, 96, 42, seed);
    expect(map.earthworks ?? []).toHaveLength(0);
    expect(fortDiags(world as never, map as never)).toHaveLength(0);
  });

  /** Mean radius of the outermost barrier ring around `centre`. */
  const outerRadius = (map: { barrierRuns?: { run: { path: [number, number][] } }[] }, c: { x: number; y: number }) =>
    (map.barrierRuns ?? []).reduce((m, b) => {
      const r = b.run.path.reduce((s, [x, y]) => s + Math.hypot(x - c.x, y - c.y), 0) / b.run.path.length;
      return Math.max(m, r);
    }, 0);

  it('flags a building shoved outside the enclosure', async () => {
    const { map, world, res, centre } = await buildFort(7);
    expect(fortDiags(world as never, map as never, 'fort.building-outside-enclosure')).toHaveLength(0);
    const bailey = res.buildingIds.find((id) => !id.includes('castle_keep'))!;
    const e = (world.query({}) as Entity[]).find((x) => x.id === bailey)!;
    // Just outside the ring (still within the fort-proximity window, so it's recognised as
    // a fort building that has escaped its curtain — not a distant unrelated house).
    world.updateEntity(e.id, { x: Math.round(centre.x + outerRadius(map, centre) + 6), y: centre.y });
    const hits = fortDiags(world as never, map as never, 'fort.building-outside-enclosure');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].locus.entities).toContain(bailey);
  });

  it('flags a building dropped on the gateway', async () => {
    const { map, world, res, centre } = await buildFort(7);
    expect(fortDiags(world as never, map as never, 'fort.gate-obstructed')).toHaveLength(0);
    // The outer ring's gate sits due-south; the outer radius is ~half the ring extent.
    const outer = (map.barrierRuns ?? []).reduce((m, b) => {
      const r = b.run.path.reduce((s, [x, y]) => s + Math.hypot(x - centre.x, y - centre.y), 0) / b.run.path.length;
      return r > m.r ? { r, b } : m;
    }, { r: 0, b: (map.barrierRuns ?? [])[0] });
    const bailey = res.buildingIds.find((id) => !id.includes('castle_keep'))!;
    const e = (world.query({}) as Entity[]).find((x) => x.id === bailey)!;
    world.updateEntity(e.id, { x: centre.x, y: Math.round(centre.y + outer.r) });   // onto the south gate
    const hits = fortDiags(world as never, map as never, 'fort.gate-obstructed');
    expect(hits.length).toBeGreaterThan(0);
    // A single building only PARTIALLY blocks the 3-wide opening, so the flood still routes
    // around it — `ward-unreachable` stays quiet (no false positive on a partial obstruction).
    expect(fortDiags(world as never, map as never, 'fort.ward-unreachable')).toHaveLength(0);
  });

  it('flags spoil imbalance when the ditch is removed from the ledger', async () => {
    const { map, world } = await buildFort(7);
    expect(fortDiags(world as never, map as never, 'fort.spoil-imbalance')).toHaveLength(0);
    // Strip the cut (ditch) earthworks → only fill remains → grossly unbalanced.
    map.earthworks = (map.earthworks ?? []).filter((e) => e.volume >= 0);
    expect(map.earthworks.length).toBeGreaterThan(0);
    const hits = fortDiags(world as never, map as never, 'fort.spoil-imbalance');
    expect(hits.length).toBe(1);
    expect(hits[0].severity).toBe('info');
  });
});
