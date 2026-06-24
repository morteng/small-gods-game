/**
 * DC-1b — complex-scale connectome. The `enclosure` interpreter must produce, from the
 * medieval `motte_and_bailey` complexType: nested ward zones (core + bailey), the
 * buildings inside them, barrier rings inner→outer, and a CONTROLLED ACCESS CHAIN of
 * gate portals (OUTSIDE → bailey → motte-top). Plus the retrofit `encloseExisting`.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { catalogue, loadDefaultPacks } from '@/catalogue';
import { expandComplex, encloseExisting } from '@/blueprint/connectome';
import type { ExpandCtx } from '@/blueprint/connectome';

let ctx: ExpandCtx;

beforeAll(() => {
  loadDefaultPacks();
  ctx = { era: 'medieval', wealth: 'modest', seed: 1, registry: catalogue };
});

describe('expandComplex — motte_and_bailey', () => {
  it('builds two wards: a core motte-top and a bailey', () => {
    const con = expandComplex('motte_and_bailey', ctx);
    const wards = con.zones.filter((z) => z.scale === 'district');
    expect(wards).toHaveLength(2);
    const core = wards.find((z) => z.attrs?.core);
    expect(core?.type).toBe('motte-top');
    expect(core?.fn).toBe('core');
    expect(wards.find((z) => z.type === 'bailey')).toBeTruthy();
  });

  it('places the keep in the core ward and bailey buildings in the bailey', () => {
    const con = expandComplex('motte_and_bailey', ctx);
    const buildings = con.zones.filter((z) => z.scale === 'building');
    const keep = buildings.find((z) => z.type === 'castle_keep');
    expect(keep?.attrs?.onCore).toBe(true);
    // bailey buildings reference the bailey ward and are not on the core
    const bailey = con.zones.find((z) => z.type === 'bailey')!;
    const baileyBuildings = buildings.filter((z) => z.attrs?.ward === bailey.id);
    expect(baileyBuildings.length).toBeGreaterThanOrEqual(3);
    expect(baileyBuildings.every((z) => z.attrs?.onCore === false)).toBe(true);
  });

  it('rings the motte-top inside the bailey (inner ring order < outer)', () => {
    const con = expandComplex('motte_and_bailey', ctx);
    expect(con.barriers).toBeTruthy();
    const core = con.zones.find((z) => z.attrs?.core)!;
    const bailey = con.zones.find((z) => z.type === 'bailey')!;
    const inner = con.barriers!.find((b) => b.encloses === core.id)!;
    const outer = con.barriers!.find((b) => b.encloses === bailey.id)!;
    expect(inner.ring).toBeLessThan(outer.ring!); // motte ring is innermost
  });

  it('forms the controlled access chain OUTSIDE → bailey → motte-top', () => {
    const con = expandComplex('motte_and_bailey', ctx);
    const core = con.zones.find((z) => z.attrs?.core)!;
    const bailey = con.zones.find((z) => z.type === 'bailey')!;
    const gates = con.portals.filter((p) => p.attrs?.gate);
    // every ring has at least one gate
    expect(gates.length).toBeGreaterThanOrEqual(2);
    // the outer gate comes from OUTSIDE into the bailey
    expect(gates.some((g) => g.from === 'OUTSIDE' && g.to === bailey.id)).toBe(true);
    // the inner gate comes from the bailey into the motte-top (no skipping the bailey)
    expect(gates.some((g) => g.from === bailey.id && g.to === core.id)).toBe(true);
    // nothing enters the core directly from OUTSIDE
    expect(gates.some((g) => g.from === 'OUTSIDE' && g.to === core.id)).toBe(false);
  });

  it('stamps every zone with its build era (palimpsest model)', () => {
    const con = expandComplex('motte_and_bailey', { ...ctx, era: 'medieval' });
    expect(con.zones.every((z) => z.builtEra === 'medieval')).toBe(true);
    expect(con.barriers!.every((b) => b.builtEra === 'medieval')).toBe(true);
  });

  it('is deterministic for a fixed seed', () => {
    const a = expandComplex('motte_and_bailey', ctx);
    const b = expandComplex('motte_and_bailey', ctx);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('returns an empty complex for an unknown type', () => {
    const con = expandComplex('not_a_real_complex', ctx);
    expect(con.zones).toHaveLength(0);
    expect(con.barriers).toHaveLength(0);
  });
});

describe('expandComplex — ringwork (single banked enclosure, no motte)', () => {
  it('has one ring and a single core ward', () => {
    const con = expandComplex('ringwork', ctx);
    expect(con.barriers).toHaveLength(1);
    const wards = con.zones.filter((z) => z.scale === 'district');
    expect(wards).toHaveLength(1);
    expect(wards[0].attrs?.core).toBe(true);
    // its one gate comes from OUTSIDE
    const gate = con.portals.find((p) => p.attrs?.gate)!;
    expect(gate.from).toBe('OUTSIDE');
  });
});

describe('encloseExisting — retrofit a wall around a placed ward', () => {
  it('wraps a barrier + gates around an existing zone, flagged retrofit', () => {
    const ring = { barrier: 'town-wall', radius: 40, gates: 4 };
    const { barriers, portals } = encloseExisting('settlement-core', ring, ctx);
    expect(barriers).toHaveLength(1);
    expect(barriers[0].encloses).toBe('settlement-core');
    expect(barriers[0].attrs?.retrofit).toBe(true);
    expect(portals).toHaveLength(4);
    expect(portals.every((p) => p.from === 'OUTSIDE' && p.to === 'settlement-core')).toBe(true);
    expect(portals.filter((p) => p.main)).toHaveLength(1); // one principal gate
  });
});
