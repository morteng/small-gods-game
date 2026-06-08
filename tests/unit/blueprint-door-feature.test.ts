// tests/unit/blueprint-door-feature.test.ts
import { describe, it, expect } from 'vitest';
import { doorFeatureType } from '@/blueprint/features/door';
import { DOOR_HEIGHT_UNITS, DOOR_WIDTH_TILES } from '@/render/scale-contract';

const ctx = { seed: 0, materials: {} };

describe('door feature — scale-contract sizing', () => {
  it('default door derives height from DOOR_HEIGHT_UNITS', () => {
    const { params } = doorFeatureType.resolve({ type: 'door', face: 'south' }, ctx);
    expect(params.height).toBeCloseTo(DOOR_HEIGHT_UNITS, 5);
  });
  it('default door half-width derives from DOOR_WIDTH_TILES', () => {
    const { params } = doorFeatureType.resolve({ type: 'door', face: 'south' }, ctx);
    expect(params.halfW).toBeCloseTo(DOOR_WIDTH_TILES / 2, 5);
  });
  it('main door is a touch wider/taller but stays human-relative (< 1.4× human headroom)', () => {
    const { params } = doorFeatureType.resolve({ type: 'door', face: 'south', params: { main: true } }, ctx);
    expect(params.height as number).toBeGreaterThan(DOOR_HEIGHT_UNITS);
    expect(params.height as number).toBeLessThan(DOOR_HEIGHT_UNITS * 1.4);
  });
  it('honours an explicit height override', () => {
    const { params } = doorFeatureType.resolve({ type: 'door', face: 'south', params: { height: 0.6 } }, ctx);
    expect(params.height).toBe(0.6);
  });
});
