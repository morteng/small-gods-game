// tests/unit/connectome-openings.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { connectomeOpenings, GEN_OPENINGS_TAG } from '@/blueprint/connectome/openings';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { BLUEPRINT_VERSION, type Blueprint } from '@/blueprint/types';
import type { Connectome } from '@/blueprint/connectome/types';

beforeAll(() => ensureBuildingTypesRegistered());

const base = (over: Partial<Blueprint> = {}, tagged = true): Blueprint => ({
  version: BLUEPRINT_VERSION, class: 'building', era: 'medieval', footprint: { w: 3, h: 2 },
  materials: { walls: 'wattle', roof: 'thatch' },
  parts: { body: { type: 'body', size: { w: 3, h: 2 }, params: { plan: 'rect', levels: 1 }, ...(tagged ? { tags: [GEN_OPENINGS_TAG] } : {}) } },
  ...over,
});

const con = (over: Partial<Connectome> = {}): Connectome => ({
  scale: 'building', zones: [], portals: [], fixtures: [], ...over,
});

describe('connectomeOpenings', () => {
  it('returns {} for a body that has not opted in (no gen-openings tag)', () => {
    const c = con({ portals: [{ id: 'p', type: 'd', from: 'OUTSIDE', to: 'z0', face: 'south', main: true }] });
    expect(connectomeOpenings(c, base({}, false), 'medieval')).toEqual({});
  });

  it('derives a main door on the exterior portal face', () => {
    const c = con({ portals: [{ id: 'p', type: 'd', from: 'OUTSIDE', to: 'z0', face: 'south', main: true }] });
    const patch = connectomeOpenings(c, base(), 'medieval');
    const feats = patch.parts!.body!.features!;
    const doors = Object.values(feats).filter(f => f.type === 'door');
    expect(doors).toHaveLength(1);
    expect(doors[0].face).toBe('south');
    expect(doors[0].params!.main).toBe(true);
    expect(doors[0].params!.t).toBe(0.5);
  });

  it('a through-passage (two opposed portals) yields two doors at the ⅓ cross-passage line', () => {
    const c = con({ portals: [
      { id: 'p', type: 'd', from: 'OUTSIDE', to: 'z0', face: 'south', main: true },
      { id: 'p2', type: 'd', from: 'OUTSIDE', to: 'z0', face: 'north' },
    ] });
    const doors = Object.values(connectomeOpenings(c, base(), 'medieval').parts!.body!.features!).filter(f => f.type === 'door');
    expect(doors).toHaveLength(2);
    expect(doors.every(d => d.params!.t === 0.33)).toBe(true);
    expect(new Set(doors.map(d => d.face))).toEqual(new Set(['south', 'north']));
  });

  it('a needs-light room gets windows on the front + near flank (dwelling) — shuttered, unglazed for humble walls', () => {
    const c = con({
      portals: [{ id: 'p', type: 'd', from: 'OUTSIDE', to: 'z0', face: 'south', main: true }],
      zones: [{ id: 'z0', type: 'hall', fn: 'living', tags: ['needs-light'] }],
    });
    const wins = Object.values(connectomeOpenings(c, base(), 'medieval').parts!.body!.features!).filter(f => f.type === 'window');
    expect(wins.length).toBeGreaterThan(0);
    expect(new Set(wins.map(w => w.face))).toEqual(new Set(['south', 'east'])); // front + near flank, no rear/far flank
    expect(wins.every(w => w.params!.style === 'shuttered' && w.params!.glazed === false)).toBe(true);
    expect(wins.every(w => w.params!.perStorey === true)).toBe(true);
  });

  it('a sacred building lights both flanks symmetrically and keeps the entrance front clear', () => {
    const c = con({
      source: { topology: 'church-axial' },
      portals: [{ id: 'p', type: 'd', from: 'OUTSIDE', to: 'z0', face: 'south', main: true }],
      zones: [{ id: 'z0', type: 'nave', fn: 'worship', tags: ['needs-light'] }],
    });
    const wins = Object.values(connectomeOpenings(c, base({ era: 'classical', materials: { walls: 'stone', roof: 'tile' } }), 'classical').parts!.body!.features!)
      .filter(f => f.type === 'window');
    expect(new Set(wins.map(w => w.face))).toEqual(new Set(['east', 'west'])); // flanks only, no south front
    // Window style/glazing follow the era profile (eras.ts) — classical glass was rare,
    // so arched-but-unglazed; this is the SAME source the era-restyle patch reads.
    expect(wins.every(w => w.params!.style === 'arched' && w.params!.glazed === false)).toBe(true);
  });

  it('the migrated cottage preset resolves to a generative south door + flanking windows', () => {
    const rb = synthesizeBlueprint('cottage')!;
    const body = rb.parts.find(p => p.type === 'body')!;
    const door = body.features.find(f => f.type === 'door');
    expect(door?.face).toBe('south');
    const wins = body.features.filter(f => f.type === 'window');
    expect(wins).toHaveLength(3); // 2 south + 1 east
    expect(body.features.some(f => f.type === 'vent')).toBe(true); // derived louver still present
  });

  it('the migrated temple resolves to bilateral arched flank windows, front kept clear', () => {
    const rb = synthesizeBlueprint('temple_small')!;
    const wins = rb.parts.find(p => p.type === 'body')!.features.filter(f => f.type === 'window');
    expect(new Set(wins.map(w => w.face))).toEqual(new Set(['east', 'west']));
    expect(wins.every(w => w.params.style === 'arched')).toBe(true);
  });
});
