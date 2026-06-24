// @vitest-environment node
// tests/unit/compose-mount-tags.test.ts
//
// The sprite-normalised projection of the world-space mount sockets: toGeometry attaches
// `mountAnchors` (blueprint-local tile XY + metric z), composeStructure projects them through
// the SAME fit as the geometry into `anchors.tags` (normalised 0..1 to the opaque bbox). This
// is the downstream half the 2026-06-13 anchor-tags spec wanted persisted in the SpritePack.
import { describe, it, expect, beforeAll } from 'vitest';
import { composeStructure } from '@/assetgen/compose';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { resolveBlueprint } from '@/blueprint/resolve';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { BLUEPRINT_VERSION, type Blueprint } from '@/blueprint/types';

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

const flatRoof: Blueprint = {
  version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 4, h: 4 },
  materials: { walls: 'stone', roof: 'tile' },
  parts: { body: { type: 'body', size: { w: 4, h: 2 }, params: { plan: 'rect', levels: 1, roof: 'flat' },
    features: { door: { type: 'door', face: 'south', params: { main: true } } } } },
};

describe('toGeometry → mountAnchors', () => {
  it('attaches the world-space mount sockets to the spec', () => {
    const spec = toGeometry(resolveBlueprint([gableCottage], 0));
    expect(spec.mountAnchors).toBeDefined();
    const kinds = new Set(spec.mountAnchors!.map(a => a.kind));
    expect(kinds).toContain('lintel');
    expect(kinds).toContain('roof_ridge');
    expect(kinds).toContain('gable_peak');
    expect(kinds).toContain('eave');
  });
});

describe('composeStructure → anchors.tags (sprite-normalised projection)', () => {
  it('projects every mount socket, preserving role + count', async () => {
    const spec = toGeometry(resolveBlueprint([gableCottage], 0));
    const r = await composeStructure(spec);
    expect(r.anchors.tags).toBeDefined();
    expect(r.anchors.tags!.length).toBe(spec.mountAnchors!.length);
    for (const t of r.anchors.tags!) {
      expect(t.kind).toBeTruthy();
      expect(Number.isFinite(t.x)).toBe(true);
      expect(Number.isFinite(t.y)).toBe(true);
      // Sockets sit on/just outside the silhouette — allow a small eave overhang margin.
      expect(t.x).toBeGreaterThan(-0.15);
      expect(t.x).toBeLessThan(1.15);
      expect(t.y).toBeGreaterThan(-0.15);
      expect(t.y).toBeLessThan(1.15);
    }
  });

  it('respects height: the ridge projects ABOVE the door lintel (smaller y)', async () => {
    const r = await composeStructure(toGeometry(resolveBlueprint([gableCottage], 0)));
    const ridge = r.anchors.tags!.find(t => t.kind === 'roof_ridge')!;
    const lintel = r.anchors.tags!.find(t => t.kind === 'lintel')!;
    expect(ridge).toBeDefined();
    expect(lintel).toBeDefined();
    expect(ridge.y).toBeLessThan(lintel.y); // higher in the world → nearer the sprite top
  });

  it('a chimney top stands proud of the ridge it pierces', async () => {
    const r = await composeStructure(toGeometry(resolveBlueprint([withChimney], 0)));
    const chimney = r.anchors.tags!.find(t => t.kind === 'chimney_top')!;
    const ridge = r.anchors.tags!.find(t => t.kind === 'roof_ridge')!;
    expect(chimney).toBeDefined();
    expect(chimney.y).toBeLessThanOrEqual(ridge.y);
    expect(chimney.z).toBeGreaterThan(ridge.z); // metric z carried through
  });

  it('a flat roof yields only the door lintel (no ridge/gable/eave sockets)', async () => {
    const r = await composeStructure(toGeometry(resolveBlueprint([flatRoof], 0)));
    const kinds = r.anchors.tags!.map(t => t.kind);
    expect(kinds).toContain('lintel');
    expect(kinds).not.toContain('roof_ridge');
    expect(kinds).not.toContain('gable_peak');
  });

  it('carries the accepts tokens through to the projected tag', async () => {
    const r = await composeStructure(toGeometry(resolveBlueprint([gableCottage], 0)));
    const lintel = r.anchors.tags!.find(t => t.kind === 'lintel')!;
    expect(lintel.accepts).toContain('sign');
  });
});
