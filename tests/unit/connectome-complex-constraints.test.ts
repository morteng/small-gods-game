/**
 * DC-1 — the defended-complex realism guardrails + the resolve-down plan. A
 * well-formed motte-and-bailey passes all three constraints; breaking each one
 * (remove the well, remove a gate, move the keep outward) trips exactly that rule.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { catalogue, loadDefaultPacks } from '@/catalogue';
import { expandComplex, complexToPlan } from '@/blueprint/connectome';
import type { Connectome, ExpandCtx } from '@/blueprint/connectome';
import { validateComplex } from '@/catalogue/packs/medieval-europe/constraints';

let ctx: ExpandCtx;
const clone = (c: Connectome): Connectome => JSON.parse(JSON.stringify(c));

beforeAll(() => {
  loadDefaultPacks();
  ctx = { era: 'medieval', wealth: 'modest', seed: 1, registry: catalogue };
});

describe('validateComplex — guardrails', () => {
  it('a well-formed motte-and-bailey passes all three constraints', () => {
    const con = expandComplex('motte_and_bailey', ctx);
    const { issues } = validateComplex(con, catalogue);
    expect(issues).toEqual([]);
  });

  it('trips water-inside-walls when the well is removed', () => {
    const con = clone(expandComplex('motte_and_bailey', ctx));
    con.fixtures = con.fixtures.filter((f) => !f.satisfies?.includes('water-supply'));
    const { issues } = validateComplex(con, catalogue);
    expect(issues.map((i) => i.constraintId)).toContain('water-inside-innermost-ring');
  });

  it('trips every-ring-needs-a-gate (error) when a gate is removed', () => {
    const con = clone(expandComplex('motte_and_bailey', ctx));
    const core = con.zones.find((z) => z.attrs?.core)!;
    con.portals = con.portals.filter((p) => !(p.attrs?.gate && p.to === core.id));
    const { issues } = validateComplex(con, catalogue);
    const gate = issues.find((i) => i.constraintId === 'every-ring-needs-a-gate');
    expect(gate?.severity).toBe('error');
  });

  it('trips keep-on-highest-zone when the core is not in the innermost ring', () => {
    const con = clone(expandComplex('motte_and_bailey', ctx));
    const core = con.zones.find((z) => z.attrs?.core)!;
    const bailey = con.zones.find((z) => z.type === 'bailey')!;
    // swap which ward the rings enclose ⇒ the core is now ringed by the OUTER ring
    const inner = con.barriers!.find((b) => b.encloses === core.id)!;
    const outer = con.barriers!.find((b) => b.encloses === bailey.id)!;
    inner.encloses = bailey.id;
    outer.encloses = core.id;
    const { issues } = validateComplex(con, catalogue);
    expect(issues.map((i) => i.constraintId)).toContain('keep-on-highest-zone');
  });
});

describe('complexToPlan — resolve-down', () => {
  it('produces buildings, barriers, gates and the well from the graph', () => {
    const plan = complexToPlan(expandComplex('motte_and_bailey', ctx));
    expect(plan.buildings.some((b) => b.buildingType === 'castle_keep' && b.onCore)).toBe(true);
    expect(plan.barriers).toHaveLength(2);
    expect(plan.gates.length).toBeGreaterThanOrEqual(2);
    expect(plan.fixtures.some((f) => f.satisfies?.includes('water-supply'))).toBe(true);
  });
});
