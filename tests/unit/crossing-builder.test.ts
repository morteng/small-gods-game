import { describe, it, expect } from 'vitest';
import { buildCrossing, type CrossingSpec } from '@/world/connectome/crossing-builder';
import { collectByKind, find, serializeCompact } from '@/world/connectome/world-node';

const POOR_FOOTPATH: CrossingSpec = {
  id: 'x1', waterRef: 'reach#r', spanTiles: 3, roadClass: 'path',
  era: 'stone-age', prosperity: 'poor', biome: 'riparian-wood',
};
const RICH_TRUNK: CrossingSpec = {
  id: 'x2', waterRef: 'reach#q', spanTiles: 8, roadClass: 'highway',
  era: 'late-medieval', prosperity: 'rich', style: 'region-X', biome: 'river-meadow',
};

describe('buildCrossing — poor footpath over a stream (Example A)', () => {
  const t = buildCrossing(POOR_FOOTPATH);

  it('is a bare log-plank footbridge with no ancillary structures', () => {
    const bridge = find(t, (n) => n.kind === 'bridge')!;
    expect(bridge.params.material).toBe('log-plank');
    expect(collectByKind(t, 'building')).toHaveLength(0); // no toll/guard/shrine/shops/mill
    expect(bridge.params.arches).toBeUndefined();         // not arched
  });

  it('still spans the water and has two aprons', () => {
    expect(t.relations).toContainEqual({ kind: 'spans', to: 'reach#r' });
    expect(collectByKind(t, 'apron')).toHaveLength(2);
  });
});

describe('buildCrossing — rich trunk crossing (Example B: inhabited stone bridge)', () => {
  const t = buildCrossing(RICH_TRUNK);

  it('is a multi-arch dressed-stone bridge sized to the span', () => {
    const bridge = find(t, (n) => n.kind === 'bridge')!;
    expect(bridge.params.material).toBe('dressed-stone');
    expect(bridge.params.arches).toBe(3); // ceil(8/3)
  });

  it('carries shops on the deck and a gatehouse — composition, not a special type', () => {
    const deck = find(t, (n) => n.kind === 'deck')!;
    const shopsOnDeck = deck.children.filter((c) => c.kind === 'building(shop)');
    expect(shopsOnDeck).toHaveLength(2);
    expect(find(t, (n) => n.kind === 'building(gatehouse)')).not.toBeNull();
  });

  it('sites a toll + guard on the near apron, a shrine on the far, and a serving mill', () => {
    const apronN = find(t, (n) => n.params.side === 'near')!;
    expect(apronN.children.map((c) => c.kind).sort()).toEqual(['building(guard_post)', 'building(toll_booth)']);
    const apronS = find(t, (n) => n.params.side === 'far')!;
    expect(apronS.children.map((c) => c.kind)).toEqual(['building(shrine)']);
    const mill = find(t, (n) => n.kind === 'building(watermill)')!;
    expect(mill.relations).toContainEqual({ kind: 'serves', to: 'x2' });
    expect(mill.relations).toContainEqual({ kind: 'spans', to: 'reach#q' });
  });

  it('site params cascade — a shop on the deck inherits the crossing era/prosperity', () => {
    const out = serializeCompact(t, { resolve: true });
    const shopLine = out.split('\n').find((l) => l.includes('/shop#a'))!;
    expect(shopLine).toContain('era: late-medieval');
    expect(shopLine).toContain('prosperity: rich');
  });
});

describe('buildCrossing — the parameter gradient is monotonic', () => {
  it('richer/busier crossings grow strictly more structure', () => {
    const counts = (s: CrossingSpec) => collectByKind(buildCrossing(s), 'building').length;
    const poor = counts(POOR_FOOTPATH);
    const mid = counts({ ...POOR_FOOTPATH, roadClass: 'road', era: 'early-medieval', prosperity: 'modest' });
    const rich = counts(RICH_TRUNK);
    expect(poor).toBe(0);
    expect(mid).toBeGreaterThan(poor);
    expect(rich).toBeGreaterThan(mid);
  });
});
