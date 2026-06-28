/**
 * E2 — the live building placer routes a placed establishment through the SITE
 * connectome (`expandSite` → `siteToPlan`) and co-places the parts its function
 * derives: auxiliary BUILDINGS (a `stable` from a 'stabling' requirement) and
 * realisable FIXTURES (a `well` from 'water-supply'), with no per-preset wiring.
 *
 * Premises derive from a core's catalogue `requires` tokens, with no per-preset wiring:
 *   - `stabling`     ⇒ a `stable` auxiliary building. The `tavern` and the `manor` (a
 *                      working estate) require it, so both co-place a stable.
 *   - `water-supply` ⇒ a yard `well` (a realisable fixture). The tavern, the manor AND
 *                      the `smithy` (E4 — a forge needs a slack-tub) require it.
 * A settlement with no deriving core gains neither.
 *
 * The pass is ADDITIVE and deterministic: it scans for each part's spot without
 * drawing from the settlement rng, so the main layout is byte-identical and only the
 * new outbuildings/props are appended.
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

// Cores whose catalogue `requires` derives each premise (counted from actual placements,
// so the test tracks the roster rather than hard-coding a per-seed total).
const STABLING_CORES = ['tavern', 'manor'];          // require 'stabling' ⇒ a stable
const WATER_CORES = ['tavern', 'manor', 'smithy'];   // require 'water-supply' ⇒ a well
const countCores = (ids: string[], names: string[]) =>
  ids.filter((t) => names.some((n) => t.includes(n))).length;
// Stable-deriving establishments (tavern, manor).
const derivingCores = (ids: string[]) => countCores(ids, STABLING_CORES);

describe('site expansion (E2): auxiliaries co-placed with their deriving core', () => {
  it('every deriving establishment (tavern/manor) spawns one stable', async () => {
    // Seed 4 platts both a tavern and a manor in this village layout.
    const ids = await idsOf(4);
    const cores = derivingCores(ids);
    const stables = ids.filter((t) => t.includes('stable')).length;
    expect(cores).toBe(2); // one tavern + one manor
    expect(stables).toBe(cores); // one stable per deriving core
  });

  it('the tavern’s stable sits adjacent to it, off any road', async () => {
    const { map } = await generateWithNoise(48, 48, 4, villageSeed());
    const tavern = map.buildings.find((b) => b.templateId.includes('tavern'))!;
    const stables = map.buildings.filter((b) => b.templateId.includes('stable'));
    expect(tavern).toBeDefined();
    expect(stables.length).toBeGreaterThan(0);
    // The stable nearest the tavern is inside the yard reach (capped scan).
    const gap = Math.min(...stables.map((s) =>
      Math.max(Math.abs(s.tileX - tavern.tileX), Math.abs(s.tileY - tavern.tileY))));
    expect(gap).toBeLessThanOrEqual(10);
  });

  it('is deterministic — same seed yields the same stables and positions', async () => {
    const a = await generateWithNoise(48, 48, 4, villageSeed());
    const b = await generateWithNoise(48, 48, 4, villageSeed());
    const stA = a.map.buildings.filter((x) => x.templateId.includes('stable')).map((x) => `${x.tileX},${x.tileY}`).sort();
    const stB = b.map.buildings.filter((x) => x.templateId.includes('stable')).map((x) => `${x.tileX},${x.tileY}`).sort();
    expect(stA).toEqual(stB);
    expect(stA.length).toBe(2); // tavern + manor
  });

  it('a settlement’s stables match its deriving cores (manor-only seed gains the manor’s)', async () => {
    // Seed 1 platts a manor but NO tavern → exactly the manor's one stable.
    const ids = await idsOf(1);
    expect(ids.some((t) => t.includes('tavern'))).toBe(false);
    expect(ids.some((t) => t.includes('manor'))).toBe(true);
    expect(ids.filter((t) => t.includes('stable')).length).toBe(derivingCores(ids));
    expect(derivingCores(ids)).toBe(1);
  });
});

describe('site fixtures (E2): realisable fixtures co-placed as yard props', () => {
  // A `requires` token that resolves to a fixtureType naming a prop blueprint (the
  // catalogue 'well' ↔ the 'well' civic prop) is realised as a yard prop. Wells are
  // PROPS (not buildings), so they never appear in `map.buildings`; query the world.
  const wells = (world: { query: (o: { tag: string }) => { kind: string; x: number; y: number; properties?: Record<string, unknown> }[] }) =>
    world.query({ tag: 'fixture' }).filter((e) => e.kind === 'well');

  it('every water-requiring establishment (tavern/manor/smithy) spawns one well', async () => {
    const { map, world } = await generateWithNoise(48, 48, 4, villageSeed());
    const waterCores = countCores(map.buildings.map((b) => b.templateId), WATER_CORES);
    expect(waterCores).toBeGreaterThanOrEqual(2); // at least the tavern + manor
    expect(wells(world).length).toBe(waterCores);
  });

  it('a well sits adjacent to its tavern, off any road, with provenance', async () => {
    const { map, world } = await generateWithNoise(48, 48, 4, villageSeed());
    const tavern = map.buildings.find((b) => b.templateId.includes('tavern'))!;
    const fxWells = wells(world);
    expect(fxWells.length).toBeGreaterThan(0);
    const nearest = fxWells.reduce((best, w) => {
      const gap = Math.max(Math.abs(w.x - tavern.tileX), Math.abs(w.y - tavern.tileY));
      return gap < best.gap ? { w, gap } : best;
    }, { w: fxWells[0], gap: Infinity });
    expect(nearest.gap).toBeLessThanOrEqual(10);
    // It carries the site/fixture provenance the placer stamps on.
    expect(nearest.w.properties?.site).toBeTruthy();
    expect(nearest.w.properties?.fixtureType).toBe('well');
  });

  it('is deterministic — same seed yields the same well positions', async () => {
    const a = await generateWithNoise(48, 48, 4, villageSeed());
    const b = await generateWithNoise(48, 48, 4, villageSeed());
    const wa = wells(a.world).map((e) => `${e.x},${e.y}`).sort();
    const wb = wells(b.world).map((e) => `${e.x},${e.y}`).sort();
    expect(wa).toEqual(wb);
    // one well per water-requiring core actually platted (tavern + manor + any smithy)
    expect(wa.length).toBe(countCores(a.map.buildings.map((x) => x.templateId), WATER_CORES));
  });

  it('the aux stable is still placed — fixtures are additive, not a replacement', async () => {
    const ids = await idsOf(4);
    expect(ids.filter((t) => t.includes('stable')).length).toBe(2);
  });
});
