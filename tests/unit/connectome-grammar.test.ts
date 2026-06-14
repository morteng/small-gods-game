import { describe, it, expect, beforeAll } from 'vitest';
import { CatalogueRegistry } from '@/catalogue/registry';
import { loadPack } from '@/catalogue/pack';
import { medievalEuropePack } from '@/catalogue/packs/medieval-europe';
import { expand } from '@/blueprint/connectome/grammar';
import type { ExpandCtx } from '@/blueprint/connectome/types';

let registry: CatalogueRegistry;
const ctx = (over: Partial<ExpandCtx> = {}): ExpandCtx => ({
  era: 'medieval',
  seed: 42,
  registry,
  ...over,
});

beforeAll(() => {
  registry = new CatalogueRegistry();
  loadPack(medievalEuropePack, registry);
});

describe('connectome grammar — expand()', () => {
  it('cottage → 1 zone, 1 exterior door, open-hearth fixture in the hall', () => {
    const c = expand('cottage', ctx());
    expect(c.zones).toHaveLength(1);
    expect(c.zones[0].type).toBe('hall');
    const ext = c.portals.filter((p) => p.from === 'OUTSIDE');
    expect(ext).toHaveLength(1);
    expect(ext[0].main).toBe(true);
    const hearth = c.fixtures.find((f) => f.type === 'open-hearth');
    expect(hearth?.zoneId).toBe(c.zones[0].id);
    expect(hearth?.requires).toContain('smoke-egress');
  });

  it('longhouse → cross-passage (2 opposed exterior doors), hall(hearth) + byre(no hearth)', () => {
    const c = expand('longhouse', ctx());
    const ext = c.portals.filter((p) => p.from === 'OUTSIDE');
    expect(ext).toHaveLength(2);
    const faces = ext.map((p) => p.face).sort();
    expect(faces).toEqual(['north', 'south']); // opposed
    const hall = c.zones.find((z) => z.type === 'hall')!;
    const byre = c.zones.find((z) => z.type === 'byre')!;
    expect(c.fixtures.some((f) => f.zoneId === hall.id)).toBe(true);
    expect(c.fixtures.some((f) => f.zoneId === byre.id)).toBe(false);
    // interior door connects the two zones
    expect(c.portals.some((p) => p.from !== 'OUTSIDE')).toBe(true);
  });

  it('farm_barn → 2 opposed cart-sized doors, no hearth', () => {
    const c = expand('farm_barn', ctx());
    const ext = c.portals.filter((p) => p.from === 'OUTSIDE');
    expect(ext.length).toBe(2);
    expect(ext.every((p) => p.type === 'cart-door')).toBe(true);
    expect(c.fixtures).toHaveLength(0);
  });

  it('castle_keep (vertical-stack) → one zone per level, stair portals between', () => {
    const c = expand('castle_keep', ctx());
    const levels = c.zones.map((z) => z.level ?? -1).sort((a, b) => a - b);
    expect(levels).toEqual([0, 1, 2, 3]);
    expect(c.portals.some((p) => p.attrs?.vertical)).toBe(true);
  });

  it('is deterministic: same args → byte-identical connectome', () => {
    const a = JSON.stringify(expand('longhouse', ctx()));
    const b = JSON.stringify(expand('longhouse', ctx()));
    expect(a).toBe(b);
  });

  it('light-needing rooms are tagged for windows', () => {
    const c = expand('cottage', ctx());
    // hall needsLight in the pack → tagged
    expect(c.zones[0].tags ?? []).toContain('needs-light');
  });
});
