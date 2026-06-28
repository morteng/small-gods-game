/**
 * E2 — the live building placer routes a placed establishment through the SITE
 * connectome (`expandSite` → `siteToPlan`) and co-places the auxiliary buildings its
 * function derives. A tavern's 'stabling' requirement yields a `stable` outbuilding,
 * sited on free ground beside the taproom — with no per-preset wiring.
 *
 * The pass is ADDITIVE and deterministic: it scans for the outbuilding's spot without
 * drawing from the settlement rng, so the main layout is byte-identical and only the
 * new outbuildings are appended. A settlement with no establishment that derives an
 * auxiliary is unchanged.
 */
import { describe, it, expect } from 'vitest';
import { generateWithNoise } from '@/map/map-generator';
import type { WorldSeed } from '@/core/types';

const villageSeed = (): WorldSeed => ({
  name: 'test',
  size: { width: 48, height: 48 },
  biome: 'temperate',
  pois: [{ id: 'v', type: 'village', name: 'V', position: { x: 24, y: 24 } }],
  connections: [],
  constraints: [],
});

const idsOf = (s: number) =>
  generateWithNoise(48, 48, s, villageSeed()).then(({ map }) => map.buildings.map((b) => b.templateId));

describe('site expansion (E2): auxiliaries co-placed with their core', () => {
  it('a tavern spawns exactly one adjacent stable (its derived auxiliary)', async () => {
    // Seed 4 is known to platt a tavern in this village layout.
    const ids = await idsOf(4);
    const taverns = ids.filter((t) => t.includes('tavern')).length;
    const stables = ids.filter((t) => t.includes('stable')).length;
    expect(taverns).toBe(1);
    expect(stables).toBe(taverns); // one stable per tavern
  });

  it('the stable sits adjacent to its tavern, off any road', async () => {
    const { map } = await generateWithNoise(48, 48, 4, villageSeed());
    const tavern = map.buildings.find((b) => b.templateId.includes('tavern'));
    const stable = map.buildings.find((b) => b.templateId.includes('stable'));
    expect(tavern).toBeDefined();
    expect(stable).toBeDefined();
    // Chebyshev gap between footprints stays inside the yard reach (capped scan).
    const gap = Math.max(
      Math.abs(stable!.tileX - tavern!.tileX),
      Math.abs(stable!.tileY - tavern!.tileY),
    );
    expect(gap).toBeLessThanOrEqual(10);
  });

  it('is deterministic — same seed yields the same stable count and position', async () => {
    const a = await generateWithNoise(48, 48, 4, villageSeed());
    const b = await generateWithNoise(48, 48, 4, villageSeed());
    const stA = a.map.buildings.filter((x) => x.templateId.includes('stable')).map((x) => `${x.tileX},${x.tileY}`);
    const stB = b.map.buildings.filter((x) => x.templateId.includes('stable')).map((x) => `${x.tileX},${x.tileY}`);
    expect(stA).toEqual(stB);
    expect(stA.length).toBe(1);
  });

  it('a tavern-free settlement gains no auxiliary outbuilding', async () => {
    // Seed 1 platts no tavern in this layout → no derived auxiliary.
    const ids = await idsOf(1);
    expect(ids.some((t) => t.includes('tavern'))).toBe(false);
    expect(ids.some((t) => t.includes('stable'))).toBe(false);
  });
});

describe('site fixtures (E2): realisable fixtures co-placed as yard props', () => {
  // The tavern's `requires: [..., 'water-supply']` resolves to the catalogue `well`
  // fixtureType, which names the `well` civic prop — so the site-expansion pass now
  // realises a yard well beside the taproom. Wells are PROPS (not buildings), so they
  // never appear in `map.buildings`; query the world.
  const wells = (world: { query: (o: { tag: string }) => { kind: string; x: number; y: number }[] }) =>
    world.query({ tag: 'fixture' }).filter((e) => e.kind === 'well');

  it('a tavern spawns exactly one adjacent well (its derived water-supply fixture)', async () => {
    // Seed 4 platts one tavern in this village layout.
    const { map, world } = await generateWithNoise(48, 48, 4, villageSeed());
    const taverns = map.buildings.filter((b) => b.templateId.includes('tavern'));
    expect(taverns.length).toBe(1);
    const fxWells = wells(world);
    expect(fxWells.length).toBe(1);
  });

  it('the well sits adjacent to its tavern, off any road', async () => {
    const { map, world } = await generateWithNoise(48, 48, 4, villageSeed());
    const tavern = map.buildings.find((b) => b.templateId.includes('tavern'))!;
    const well = world.query({ tag: 'fixture' }).find((e) => e.kind === 'well')!;
    expect(well).toBeDefined();
    const gap = Math.max(Math.abs(well.x - tavern.tileX), Math.abs(well.y - tavern.tileY));
    expect(gap).toBeLessThanOrEqual(10);
    // It carries the site/fixture provenance the placer stamps on.
    expect(well.properties?.site).toBeTruthy();
    expect(well.properties?.fixtureType).toBe('well');
  });

  it('is deterministic — same seed yields the same well position', async () => {
    const a = await generateWithNoise(48, 48, 4, villageSeed());
    const b = await generateWithNoise(48, 48, 4, villageSeed());
    const wa = wells(a.world).map((e) => `${e.x},${e.y}`);
    const wb = wells(b.world).map((e) => `${e.x},${e.y}`);
    expect(wa).toEqual(wb);
    expect(wa.length).toBe(1);
  });

  it('the aux stable is still placed — fixtures are additive, not a replacement', async () => {
    const ids = await idsOf(4);
    expect(ids.filter((t) => t.includes('stable')).length).toBe(1);
  });
});
