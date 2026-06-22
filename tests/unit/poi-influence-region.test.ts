import { describe, it, expect } from 'vitest';
import { applyPoiInfluences, getAffectedRegion } from '@/terrain/poi-influence';
import type { TerrainField, TerrainConfig, POI } from '@/core/types';

const W = 80, H = 80;

function flatFields(temp = 0.45, moist = 0.45, elev = 0.5): TerrainField {
  const n = W * H;
  return {
    elevation:   new Float32Array(n).fill(elev),
    moisture:    new Float32Array(n).fill(moist),
    temperature: new Float32Array(n).fill(temp),
  } as TerrainField;
}
const cfg: TerrainConfig = { seed: 7, width: W, height: H } as TerrainConfig;
const at = (f: Float32Array, x: number, y: number) => f[y * W + x];

describe('POI region-fill climate (W-A)', () => {
  it('a desert REGION lerps temperature toward its hot target across the whole box, not a point disc', () => {
    const fields = flatFields();
    const desert: POI = {
      id: 'd', type: 'desert',
      region: { x_min: 20, x_max: 60, y_min: 20, y_max: 60 },
    } as POI;
    applyPoiInfluences(fields, [desert], cfg);

    // Interior clears the 0.80 desert temp threshold and the 0.25 dry cap…
    expect(at(fields.temperature, 40, 40)).toBeGreaterThan(0.8);
    expect(at(fields.moisture, 40, 40)).toBeLessThan(0.25);
    // …at a corner well inside the box too (not just the centre, as a disc would).
    expect(at(fields.temperature, 26, 26)).toBeGreaterThan(0.7);
    // Far outside the region + feather is untouched.
    expect(at(fields.temperature, 2, 2)).toBeCloseTo(0.45, 5);
  });

  it('a region-only POI (no position) still exerts climate — the old skip is gone', () => {
    const fields = flatFields(0.45, 0.20); // dry-ish base
    const forest: POI = {
      id: 'f', type: 'forest',
      region: { x_min: 10, x_max: 50, y_min: 10, y_max: 50 },
    } as POI; // note: no `position`
    applyPoiInfluences(fields, [forest], cfg);
    expect(at(fields.moisture, 30, 30)).toBeGreaterThan(0.5); // moistened toward forest
  });

  it('region-fill leaves ELEVATION as a point feature — a swamp box does not sink wholesale', () => {
    const fields = flatFields();
    const swamp: POI = {
      id: 's', type: 'swamp', position: { x: 40, y: 40 },
      region: { x_min: 20, x_max: 60, y_min: 30, y_max: 50 },
    } as POI;
    const beforeCorner = at(fields.elevation, 22, 32);
    applyPoiInfluences(fields, [swamp], cfg);
    // Climate filled the region (moisture up at a corner)…
    expect(at(fields.moisture, 24, 34)).toBeGreaterThan(0.5);
    // …but the elevation dip stayed local to the point, so a far corner of the
    // region keeps its original height (no region-wide drowning).
    expect(at(fields.elevation, 22, 32)).toBeCloseTo(beforeCorner, 5);
  });

  it('getAffectedRegion returns the region box (expanded) for a region-fill POI', () => {
    const desert: POI = {
      id: 'd', type: 'desert',
      region: { x_min: 20, x_max: 60, y_min: 20, y_max: 60 },
    } as POI;
    const r = getAffectedRegion(desert, cfg);
    expect(r).not.toBeNull();
    expect(r!.x0).toBeLessThan(20); // feathered outward
    expect(r!.x1).toBeGreaterThan(60);
  });
});
