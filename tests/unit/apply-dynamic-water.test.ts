import { describe, it, expect } from 'vitest';
import { WaterType } from '@/core/types';
import {
  applyDynamicWater,
  type WaterSurfaceArrays,
  type DynamicWaterInputs,
} from '@/render/gpu/water-field';

// A tiny 4-cell world. Cell layout / roles:
//   0: dry land       (surfaceW = -1, type Dry)
//   1: lake cell      (body 0, static surface 0.50)
//   2: river cell     (static surface 0.50, type River — deep channel)
//   3: dry land       (surfaceW = -1, type Dry)
function base(): WaterSurfaceArrays {
  return {
    surfaceW: Float32Array.from([-1, 0.50, 0.50, -1]),
    waterType: Uint32Array.from([WaterType.Dry, WaterType.Lake, WaterType.River, WaterType.Dry]),
    shallow: Uint32Array.from([0, 11, 22, 0]),
    deep: Uint32Array.from([0, 111, 222, 0]),
    clarity: Float32Array.from([0, 0.6, 0.7, 0]),
  };
}
function out(): WaterSurfaceArrays {
  return {
    surfaceW: new Float32Array(4),
    waterType: new Uint32Array(4),
    shallow: new Uint32Array(4),
    deep: new Uint32Array(4),
    clarity: new Float32Array(4),
  };
}
const inputs = (over: Partial<DynamicWaterInputs>): DynamicWaterInputs => ({
  lakeOffsetM: null,
  lakeCells: Int32Array.from([1]),         // cell 1 is the only lake cell
  bodyId: Int32Array.from([-1, 0, -1, -1]),
  floodOffsetM: null,
  bed: null,
  relief: 10,                              // metres → normalised: /10
  floodShallowC: 99, floodDeepC: 999, floodClarityC: 0.5,
  ...over,
});

describe('applyDynamicWater — the one ΔW composition rule', () => {
  it('with no dynamic sources, out mirrors the static base exactly', () => {
    const o = out();
    const applied = applyDynamicWater(o, base(), inputs({}));
    expect(applied).toEqual(new Int32Array(0));
    expect(Array.from(o.surfaceW)).toEqual([-1, 0.50, 0.50, -1]);
    expect(Array.from(o.waterType)).toEqual([WaterType.Dry, WaterType.Lake, WaterType.River, WaterType.Dry]);
  });

  it('raises only the offset lake body within its bank (additive on the static surface)', () => {
    const o = out();
    applyDynamicWater(o, base(), inputs({ lakeOffsetM: Float32Array.from([2.0]) })); // body 0 +2 m
    // cell 1 (lake, body 0): 0.50 + 2/10 = 0.70; everything else untouched.
    expect(o.surfaceW[1]).toBeCloseTo(0.70, 6);
    expect(Array.from(o.surfaceW)).toEqual([-1, expect.closeTo(0.70, 6), 0.50, -1]);
    expect(o.waterType[1]).toBe(WaterType.Lake);
  });

  it('floods dry land: max(bed+depth) becomes a fresh lake sheet with flood colours', () => {
    const o = out();
    const bed = Float32Array.from([0.20, 0.40, 0.40, 0.20]);
    const applied = applyDynamicWater(o, base(), inputs({
      floodOffsetM: Float32Array.from([3.0, 0, 0, 0]), bed,    // 3 m on dry cell 0
    }));
    expect(Array.from(applied)).toEqual([0]);
    expect(o.surfaceW[0]).toBeCloseTo(0.20 + 3 / 10, 6);       // bed + depth/relief
    expect(o.waterType[0]).toBe(WaterType.Lake);
    expect(o.shallow[0]).toBe(99);
    expect(o.deep[0]).toBe(999);
    expect(o.clarity[0]).toBeCloseTo(0.5, 6);
  });

  it('a shallow flood over a DEEPER channel leaves the channel alone (the overlap rule)', () => {
    const o = out();
    // bed of the river cell 2 is 0.40; its static surface is 0.50 (a 0.10-norm deep channel).
    // A 0.5 m flood → bed+0.05 = 0.45 < 0.50 → must NOT lower the river.
    const bed = Float32Array.from([0.20, 0.40, 0.40, 0.20]);
    const applied = applyDynamicWater(o, base(), inputs({
      floodOffsetM: Float32Array.from([0, 0, 0.5, 0]), bed,
    }));
    expect(Array.from(applied)).toEqual([]);                   // nothing applied
    expect(o.surfaceW[2]).toBeCloseTo(0.50, 6);                // river surface preserved
    expect(o.waterType[2]).toBe(WaterType.River);
  });

  it('a deep flood over a channel raises it (max wins) and flips it to a still sheet', () => {
    const o = out();
    const bed = Float32Array.from([0.20, 0.40, 0.40, 0.20]);
    const applied = applyDynamicWater(o, base(), inputs({
      floodOffsetM: Float32Array.from([0, 0, 2.0, 0]), bed,    // 2 m → 0.40+0.2 = 0.60 > 0.50
    }));
    expect(Array.from(applied)).toEqual([2]);
    expect(o.surfaceW[2]).toBeCloseTo(0.60, 6);
    expect(o.waterType[2]).toBe(WaterType.Lake);
  });

  it('composes lake offset AND flood in one pass (both sources land in one field)', () => {
    const o = out();
    const bed = Float32Array.from([0.20, 0.40, 0.40, 0.20]);
    applyDynamicWater(o, base(), inputs({
      lakeOffsetM: Float32Array.from([1.0]),                   // lake body 0 +1 m → cell 1 = 0.60
      floodOffsetM: Float32Array.from([3.0, 0, 0, 0]), bed,    // flood cell 0
    }));
    expect(o.surfaceW[1]).toBeCloseTo(0.60, 6);                // lake rise
    expect(o.surfaceW[0]).toBeCloseTo(0.50, 6);                // flood sheet (0.20 + 0.30)
    expect(o.waterType[0]).toBe(WaterType.Lake);
  });
});
