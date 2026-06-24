// @vitest-environment node
// tests/unit/mount-anchor-geometry-parity.test.ts
//
// The world-space mount-anchor model (to-mount-anchors) re-derives roof/chimney heights
// analytically rather than importing the heavy manifold geometry. This guard keeps the two
// in lockstep two ways:
//   1. the pitch/protrude constants equal the exported solids values (catches a drift early);
//   2. behaviourally — a projected `chimney_top` tag lands on the geometry's OWN vent anchor
//      (composeStructure already projects the true chimney top into `anchors.vents`), so the
//      sockets sit on the rendered massing, not floating below the ridge (the 2026-06-25 bug).
import { describe, it, expect, beforeAll } from 'vitest';
import {
  GABLE_PITCH as GEO_GABLE, HIP_PITCH as GEO_HIP,
  SHED_SLOPE as GEO_SHED, CHIMNEY_PROTRUDE as GEO_PROTRUDE,
} from '@/assetgen/geometry/solids';
import {
  GABLE_PITCH, HIP_PITCH, SHED_SLOPE, CHIMNEY_PROTRUDE,
} from '@/blueprint/compile/to-mount-anchors';
import { composeStructure } from '@/assetgen/compose';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { resolveBlueprint } from '@/blueprint/resolve';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { BLUEPRINT_VERSION, type Blueprint } from '@/blueprint/types';

beforeAll(() => ensureBuildingTypesRegistered());

const withChimney: Blueprint = {
  version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 4, h: 4 },
  materials: { walls: 'stone', roof: 'tile' },
  parts: { body: { type: 'body', size: { w: 4, h: 2 }, params: { plan: 'rect', levels: 2, roof: 'gable' },
    features: {
      door: { type: 'door', face: 'south', params: { main: true } },
      smoke: { type: 'vent', params: { kind: 'chimney', t: 0.35 } },
    } } },
};

describe('mount-anchor ↔ geometry parity', () => {
  it('the analytic roof/chimney constants match the geometry exports', () => {
    expect(GABLE_PITCH).toBe(GEO_GABLE);
    expect(HIP_PITCH).toBe(GEO_HIP);
    expect(SHED_SLOPE).toBe(GEO_SHED);
    expect(CHIMNEY_PROTRUDE).toBe(GEO_PROTRUDE);
  });

  it('a projected chimney_top tag lands on the geometry vent anchor', async () => {
    const r = await composeStructure(toGeometry(resolveBlueprint([withChimney], 0)));
    const chimney = r.anchors.tags!.find(t => t.kind === 'chimney_top');
    expect(chimney).toBeDefined();
    expect(r.anchors.vents.length).toBeGreaterThan(0);
    // Nearest geometry vent top, in normalised sprite space. The analytic socket should sit
    // right on it (a few % of the sprite) — proof the tag is on the actual stack.
    const d = Math.min(...r.anchors.vents.map(v => Math.hypot(v.x - chimney!.x, v.y - chimney!.y)));
    expect(d).toBeLessThan(0.06);
  });
});
