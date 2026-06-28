/**
 * E1 — site-scale connectome. `expandSite` turns an establishment into a sub-graph:
 *   - an AUTHORED `siteType` recipe (tavern-yard) → core + walled court + stable +
 *     fixtures, via the `yard` topology;
 *   - a `freestanding` recipe (wayside-shrine) → core + ground fixture, no enclosure;
 *   - a BARE buildingType with no recipe → the `derive` default synthesises a plausible
 *     open-yard site by resolving the core's `requires` tokens to catalogue satisfiers.
 * `siteToPlan` resolves the graph down to a structured placement plan (the E1 boundary —
 * no world placement yet). Deterministic + content-free throughout.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { catalogue, loadDefaultPacks } from '@/catalogue';
import { expandSite, siteToPlan } from '@/blueprint/connectome';
import type { ExpandCtx } from '@/blueprint/connectome';

let ctx: ExpandCtx;

beforeAll(() => {
  loadDefaultPacks();
  ctx = { era: 'medieval', wealth: 'modest', seed: 1, registry: catalogue };
});

describe('expandSite — authored `yard` recipe (tavern-yard)', () => {
  it('is a site-scale graph with the tavern as its core leaf', () => {
    const con = expandSite('tavern-yard', ctx);
    expect(con.scale).toBe('site');
    const buildings = con.zones.filter((z) => z.scale === 'building');
    const core = buildings.find((z) => z.attrs?.role === 'core');
    expect(core?.type).toBe('tavern');
    expect(core?.fn).toBe('core');
  });

  it('fronts the core onto a yard that holds the auxiliaries + fixtures', () => {
    const con = expandSite('tavern-yard', ctx);
    const yard = con.zones.find((z) => z.fn === 'yard');
    expect(yard?.scale).toBe('site');
    // the stable is an auxiliary building sited in the yard
    const stable = con.zones.find((z) => z.type === 'stable');
    expect(stable?.attrs?.role).toBe('auxiliary');
    expect(stable?.attrs?.site).toBe('yard');
    // fixtures (sign, bench, well) all live in the yard
    expect(con.fixtures.map((f) => f.type).sort()).toEqual(['hanging-sign', 'tavern-bench', 'well']);
    expect(con.fixtures.every((f) => f.zoneId === 'yard')).toBe(true);
    // the core fronts the yard
    expect(con.portals.some((p) => p.from === 'core' && p.to === 'yard' && p.attrs?.relation === 'fronts')).toBe(true);
  });

  it('the "wall (or not)" rings the YARD, with a gate piercing it', () => {
    const con = expandSite('tavern-yard', ctx);
    const wall = (con.barriers ?? []).find((b) => b.encloses === 'yard');
    expect(wall?.type).toBe('paling-fence');
    // no barrier rings the building itself — only the yard
    expect((con.barriers ?? []).some((b) => b.encloses === 'core')).toBe(false);
    expect(con.portals.some((p) => p.to === 'yard' && p.attrs?.relation === 'gates-onto')).toBe(true);
  });

  it('carries the fixtures’ satisfier tokens through onto the instances', () => {
    const con = expandSite('tavern-yard', ctx);
    const well = con.fixtures.find((f) => f.type === 'well');
    expect(well?.satisfies).toContain('water-supply');
  });
});

describe('expandSite — `freestanding` recipe (wayside-shrine)', () => {
  it('is a lone core with a ground fixture and no enclosure', () => {
    const con = expandSite('wayside-shrine', ctx);
    const core = con.zones.find((z) => z.attrs?.role === 'core');
    expect(core?.type).toBe('shrine');
    expect(con.zones.some((z) => z.fn === 'yard')).toBe(false);
    expect(con.barriers ?? []).toHaveLength(0);
    // fixture sits on the core's own apron
    expect(con.fixtures.map((f) => f.type)).toEqual(['cresset']);
    expect(con.fixtures[0]?.zoneId).toBe('core');
  });
});

describe('expandSite — `derive` default (no recipe, bare buildingType)', () => {
  it('synthesises an open-yard site from the tavern’s requires tokens', () => {
    const con = expandSite('tavern', ctx); // NB: the buildingType id, not a siteType
    expect(con.source?.topology).toBe('derive');
    expect(con.scale).toBe('site');
    const core = con.zones.find((z) => z.attrs?.role === 'core');
    expect(core?.type).toBe('tavern');
    expect(con.zones.some((z) => z.fn === 'yard')).toBe(true);
  });

  it('resolves each requires token to a catalogue satisfier (fixture or building)', () => {
    const con = expandSite('tavern', ctx);
    // tavern requires ['stabling','signage','seating','water-supply']
    //  - stabling   → the `stable` buildingType (an auxiliary)
    //  - signage    → hanging-sign fixture
    //  - seating    → tavern-bench fixture
    //  - water-supply→ well fixture
    expect(con.zones.some((z) => z.type === 'stable' && z.attrs?.role === 'auxiliary')).toBe(true);
    expect(con.fixtures.map((f) => f.type).sort()).toEqual(['hanging-sign', 'tavern-bench', 'well']);
  });

  it('the derived court is OPEN — no wall (the walled version is the authored recipe)', () => {
    const con = expandSite('tavern', ctx);
    expect(con.barriers ?? []).toHaveLength(0);
    expect(con.portals.some((p) => p.attrs?.relation === 'gates-onto')).toBe(true);
  });

  it('returns an empty site for an unknown id', () => {
    const con = expandSite('no-such-establishment', ctx);
    expect(con.zones).toHaveLength(0);
    expect(con.fixtures).toHaveLength(0);
  });
});

describe('expandSite — determinism', () => {
  it('same id + seed → identical graph', () => {
    const a = expandSite('tavern', ctx);
    const b = expandSite('tavern', ctx);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('satisfier choice is independent of pack order (sorted, not first-declared)', () => {
    // derive resolves 'water-supply' to the shortest-then-alphabetical satisfier id.
    const con = expandSite('smithy', ctx); // smithy requires ['water-supply'] → well
    expect(con.fixtures.map((f) => f.type)).toEqual(['well']);
  });
});

describe('expandSite — manor premises (derive on a second focus building)', () => {
  it('the manor derives a stable + a well from its requires tokens', () => {
    const plan = siteToPlan(expandSite('manor', ctx)); // manor requires ['stabling','water-supply']
    expect(plan.core.buildingType).toBe('manor');
    expect(plan.auxiliaries.map((a) => a.buildingType)).toEqual(['stable']);
    expect(plan.fixtures.map((f) => f.type)).toEqual(['well']);
    // It's a derived (open) court, like the tavern — no authored wall.
    expect(plan.barriers).toHaveLength(0);
  });
});

describe('siteToPlan — resolve-down', () => {
  it('separates the core from auxiliaries and lists barriers + fixtures + relations', () => {
    const plan = siteToPlan(expandSite('tavern-yard', ctx));
    expect(plan.core.buildingType).toBe('tavern');
    expect(plan.auxiliaries).toEqual([{ buildingType: 'stable', role: 'auxiliary' }]);
    expect(plan.barriers.map((b) => b.type)).toEqual(['paling-fence']);
    expect(plan.barriers[0]?.encloses).toBe('yard');
    expect(plan.fixtures.map((f) => f.type).sort()).toEqual(['hanging-sign', 'tavern-bench', 'well']);
    expect(plan.relations.some((r) => r.relation === 'fronts')).toBe(true);
    expect(plan.relations.some((r) => r.relation === 'gates-onto')).toBe(true);
  });

  it('a derived site plans the same shape with no wall', () => {
    const plan = siteToPlan(expandSite('tavern', ctx));
    expect(plan.core.buildingType).toBe('tavern');
    expect(plan.auxiliaries.map((a) => a.buildingType)).toEqual(['stable']);
    expect(plan.barriers).toHaveLength(0);
  });
});
