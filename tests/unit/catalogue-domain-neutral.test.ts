/**
 * Domain-neutrality proof: a pack from a completely different setting (sci-fi)
 * registers, validates, and expands through the UNCHANGED engine. If this passes,
 * the requirement "support any age incl. fantasy/sci-fi/custom" holds at the engine
 * level — only content (packs) ever needs authoring.
 */
import { describe, it, expect } from 'vitest';
import { CatalogueRegistry } from '@/catalogue/registry';
import { loadPack } from '@/catalogue/pack';
import { expand } from '@/blueprint/connectome/grammar';
import { scifiTestPack } from '../fixtures/scifi-test-pack';

describe('domain-neutral engine — sci-fi pack', () => {
  it('registers with zero engine changes', () => {
    const r = new CatalogueRegistry();
    loadPack(scifiTestPack, r);
    expect(r.get('buildingType', 'hab-module')).toBeDefined();
    expect(r.get('roomType', 'airlock')).toBeDefined();
  });

  it('expands into a connectome through the same grammar', () => {
    const r = new CatalogueRegistry();
    loadPack(scifiTestPack, r);
    const c = expand('hab-module', { era: 'current', seed: 7, registry: r });
    // 1 airlock + 2 crew-decks = 3 zones, stacked (vertical-stack interpreter)
    expect(c.zones).toHaveLength(3);
    expect(c.zones.map((z) => z.level).sort()).toEqual([0, 1, 2]);
    // exterior pressure hatch + stair portals between decks
    expect(c.portals.some((p) => p.from === 'OUTSIDE' && p.type === 'pressure-hatch')).toBe(true);
    expect(c.portals.some((p) => p.attrs?.vertical)).toBe(true);
    // no hearth, no fixtures
    expect(c.fixtures).toHaveLength(0);
  });
});
