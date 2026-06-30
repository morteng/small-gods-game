import { describe, it, expect } from 'vitest';
import { buildEarthworkDeformations } from '@/world/earthwork-deformation';
import { applyOp } from '@/world/terrain-deformation';
import { deriveEarthworks, type Earthwork, type EarthworkSpec } from '@/blueprint/connectome/earthworks';
import type { TerrainProbe } from '@/blueprint/connectome/types';

const motte = (): Earthwork => ({ kind: 'motte', centre: { x: 32, y: 32 }, topRadius: 4, height: 8, slope: 1.5, volume: 100 });
const rampart = (): Earthwork => ({ kind: 'rampart', ring: { cx: 32, cy: 32, r: 16, width: 4 }, height: 2, volume: 50 });
const ditch = (): Earthwork => ({ kind: 'ditch', ring: { cx: 32, cy: 32, r: 18.5, width: 5 }, height: -1.2, volume: -150 });

describe('buildEarthworkDeformations', () => {
  it('maps a motte to a RAISE frustum centred on the site', () => {
    const [d] = buildEarthworkDeformations([motte()]);
    expect(d.op).toBe('raise');
    expect(d.source).toBe('earthwork:motte');
    expect(d.mask(32, 32)).toBe(1);                       // flat top is full
    expect(d.mask(100, 100)).toBe(0);                     // far away untouched
    // raise lifts flat ground by the motte height at the core.
    const base = 10;
    expect(applyOp(d, base, base, d.mask(32, 32))).toBeCloseTo(base + 8, 6);
  });

  it('maps a rampart to an ADD bank and a ditch to a CARVE cut', () => {
    const defs = buildEarthworkDeformations([rampart(), ditch()]);
    const [r, c] = defs;
    expect(r.op).toBe('add');
    expect(c.op).toBe('carve');
    // The rampart RAISES near its ring radius…
    const base = 10;
    const onRampart = applyOp(r, base, base, r.mask(48, 32)); // 16 tiles east of centre = on the ring
    expect(onRampart).toBeGreaterThan(base);
    // …and the ditch LOWERS near its (larger) ring radius — sign handled by op, not amount.
    const onDitch = applyOp(c, base, base, c.mask(32 + 18.5, 32));
    expect(onDitch).toBeLessThan(base);
  });

  it('every mask is finite and 0 outside the footprint; empty input → []', () => {
    const defs = buildEarthworkDeformations([motte(), rampart(), ditch()]);
    expect(defs).toHaveLength(3);
    for (const d of defs) {
      for (const [x, y] of [[32, 32], [40, 32], [0, 0], [63, 63]]) {
        expect(Number.isFinite(d.mask(x, y))).toBe(true);
      }
    }
    expect(buildEarthworkDeformations([])).toHaveLength(0);
  });

  it('realises a derived (spoil-conserving) earthwork set end to end', () => {
    // A flat site (natural height 0) pays the full motte; the ditch balances the fill.
    const probe: TerrainProbe = { affordanceAt: () => ({ height: 0 }) } as unknown as TerrainProbe;
    const spec: EarthworkSpec = {
      motteHeight: 6, motteTopRadius: 4, slope: 1.5,
      baileyRadius: 16, rampartHeight: 2, rampartWidth: 4, ditchWidth: 5,
    };
    const { earthworks, netVolume } = deriveEarthworks({ x: 32, y: 32 }, spec, probe);
    expect(Math.abs(netVolume)).toBeLessThan(1e-6);       // spoil conserved
    const defs = buildEarthworkDeformations(earthworks);
    expect(defs.length).toBe(earthworks.length);          // one deformation per earthwork
    // The motte is present and raises the centre.
    const m = defs.find((d) => d.source === 'earthwork:motte')!;
    expect(applyOp(m, 0, 0, m.mask(32, 32))).toBeCloseTo(6, 6);
  });
});
