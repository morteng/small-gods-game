// tests/unit/blueprint-to-mount-anchors.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { toMountAnchors } from '@/blueprint/compile/to-mount-anchors';
import { resolveBlueprint } from '@/blueprint/resolve';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { BLUEPRINT_VERSION, type Blueprint } from '@/blueprint/types';
import { DOOR_HEIGHT_M, STOREY_M } from '@/render/scale-contract';

beforeAll(() => ensureBuildingTypesRegistered());

const gableCottage: Blueprint = {
  version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 4, h: 4 },
  materials: { walls: 'wattle', roof: 'thatch' },
  parts: { body: { type: 'body', size: { w: 4, h: 2 }, params: { plan: 'rect', levels: 1, roof: 'gable' },
    features: { door: { type: 'door', face: 'south', params: { main: true } } } } },
};

const withChimney: Blueprint = {
  version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 4, h: 4 },
  materials: { walls: 'stone', roof: 'tile' },
  parts: { body: { type: 'body', size: { w: 4, h: 2 }, params: { plan: 'rect', levels: 2, roof: 'gable' },
    features: {
      door: { type: 'door', face: 'south', params: { main: true } },
      smoke: { type: 'vent', params: { kind: 'chimney', t: 0.2 } },
    } } },
};

const roundTower: Blueprint = {
  version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 4, h: 4 },
  materials: { walls: 'stone', roof: 'tile' },
  parts: { body: { type: 'body', size: { w: 4, h: 4 }, params: { plan: 'round', levels: 2, roof: 'conical' } } },
};

const flatRoof: Blueprint = {
  version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 4, h: 4 },
  materials: { walls: 'stone', roof: 'tile' },
  parts: { body: { type: 'body', size: { w: 4, h: 2 }, params: { plan: 'rect', levels: 1, roof: 'flat' },
    features: { door: { type: 'door', face: 'south', params: { main: true } } } } },
};

describe('toMountAnchors — sockets a sign/lamp/banner/bird attaches to', () => {
  it('hangs a lintel socket over the main door at door-head height', () => {
    const m = toMountAnchors(resolveBlueprint([gableCottage], 0), 10, 20);
    const lintel = m.find(a => a.kind === 'lintel');
    expect(lintel).toBeDefined();
    expect(lintel!.main).toBe(true);
    expect(lintel!.facing).toEqual([0, 1]);           // faces out the south wall, like its door
    expect(lintel!.z).toBe(DOOR_HEIGHT_M);            // sits at the lintel, 2 m up
    expect(lintel!.accepts).toEqual(['sign', 'lamp']);
  });

  it('caps a gabled roof with a ridge crest + two gable-peak sockets', () => {
    const m = toMountAnchors(resolveBlueprint([gableCottage], 0), 10, 20);
    expect(m.filter(a => a.kind === 'roof_ridge')).toHaveLength(1);
    const peaks = m.filter(a => a.kind === 'gable_peak');
    expect(peaks).toHaveLength(2);
    // wide body (w > h) ⇒ ridge along x ⇒ peaks face ∓x at the short-axis ends
    expect(peaks.map(p => p.facing).sort()).toEqual([[-1, 0], [1, 0]]);
    // roof sockets stand above the lintel
    const ridge = m.find(a => a.kind === 'roof_ridge')!;
    expect(ridge.z).toBeGreaterThan(DOOR_HEIGHT_M);
    expect(ridge.z).toBeGreaterThan(STOREY_M);        // above the eave of a single storey
  });

  it('rotates the ridge onto the LONGER footprint axis', () => {
    const tall: Blueprint = { ...gableCottage,
      parts: { body: { ...gableCottage.parts.body, size: { w: 2, h: 4 } } } };
    const peaks = toMountAnchors(resolveBlueprint([tall], 0), 0, 0).filter(a => a.kind === 'gable_peak');
    expect(peaks.map(p => p.facing).sort()).toEqual([[0, -1], [0, 1]]);  // ridge along y
  });

  it('brackets two eave sockets on the long walls, below the ridge', () => {
    const m = toMountAnchors(resolveBlueprint([gableCottage], 0), 10, 20);
    const eaves = m.filter(a => a.kind === 'eave');
    expect(eaves).toHaveLength(2);
    // wide body (ridge along x) ⇒ eave walls face ∓y
    expect(eaves.map(e => e.facing).sort()).toEqual([[0, -1], [0, 1]]);
    const ridge = m.find(a => a.kind === 'roof_ridge')!;
    expect(eaves.every(e => e.z! < ridge.z!)).toBe(true);   // eave sits below the crest
    expect(eaves[0].accepts).toEqual(['lamp', 'bracket', 'perch']);
  });

  it('every roofed building offers a perch — a place for a bird to land', () => {
    const m = toMountAnchors(resolveBlueprint([gableCottage], 0), 10, 20);
    expect(m.some(a => a.accepts?.includes('perch'))).toBe(true);
  });

  it('puts a chimney-top socket above the ridge for each smoke vent (smoke + perch)', () => {
    const m = toMountAnchors(resolveBlueprint([withChimney], 0), 10, 20);
    const chimney = m.find(a => a.kind === 'chimney_top');
    const ridge = m.find(a => a.kind === 'roof_ridge')!;
    expect(chimney).toBeDefined();
    expect(chimney!.accepts).toEqual(['smoke', 'perch']);
    expect(chimney!.z!).toBeGreaterThan(ridge.z!);     // the stack stands proud of the crest
  });

  it('gives a round/conical mass a single apex socket, no ridge or gable', () => {
    const m = toMountAnchors(resolveBlueprint([roundTower], 0), 10, 20);
    expect(m.filter(a => a.kind === 'roof_apex')).toHaveLength(1);
    expect(m.some(a => a.kind === 'roof_ridge' || a.kind === 'gable_peak')).toBe(false);
    expect(m.find(a => a.kind === 'roof_apex')!.accepts).toContain('perch');
  });

  it('a flat roof gets no ridge/gable/apex — only its door lintel', () => {
    const m = toMountAnchors(resolveBlueprint([flatRoof], 0), 10, 20);
    expect(m.every(a => a.kind === 'lintel')).toBe(true);
  });

  it('is deterministic for the same blueprint + origin', () => {
    const a = toMountAnchors(resolveBlueprint([gableCottage], 0), 10, 20);
    const b = toMountAnchors(resolveBlueprint([gableCottage], 0), 10, 20);
    expect(a).toEqual(b);
  });
});
