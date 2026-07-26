// Manning the Walls W4 — tower circulation geometry: a drum (flank) tower's doorway moves off
// grade onto the allure and faces along the wall, plus a vice turret carries a defender from
// there up to the tower's own crown. A gate (square, tall) tower keeps its street-level door
// unconditionally — verified byte-identical to the pre-change emission. New tests, not an
// extension of battlement-layout.test.ts: that file pins the merlon/parapet LAYOUT rules shared
// by every surface; this one is scoped to the tower-specific circulation change (door placement,
// the new `alongWall` opt, the vice turret, and the render-source cache key that must not collide
// two differently-oriented drums onto one cached sprite).
import { describe, it, expect } from 'vitest';
import { towerSpec, type TowerOpts, type TowerSpec } from '@/assetgen/geometry/tower-spec';
import { parapetHeight } from '@/assetgen/geometry/battlement';
import { runElements } from '@/render/parametric-barrier-source';
import type { BarrierRun } from '@/world/barrier';

const base: TowerOpts = { curtainHeight: 3.5, curtainThickness: 2, material: 'stone' };

/** Highest z any part reaches — the tower's own crown, same measure `battlement-layout.test.ts`
 *  uses for its aspect assertions (reading emitted geometry, not the internal formula). */
function crownOf(parts: TowerSpec['parts']): number {
  return Math.max(...parts.map((p) => {
    if (p.prim === 'box') return p.at[2] + p.size[2];
    if (p.prim === 'cylinder' || p.prim === 'column') return (p.baseZ ?? 0) + p.height;
    return 0;
  }));
}

/** The z of the first door aperture found on a box or cylinder part, or undefined. */
function firstDoorZ(parts: TowerSpec['parts']): number | undefined {
  for (const p of parts) {
    if ((p.prim === 'box' || p.prim === 'cylinder') && p.apertures && p.apertures.length > 0) {
      return p.apertures[0].at[2];
    }
  }
  return undefined;
}

describe('drum (flank tower) doorway — allure level, not grade or crown', () => {
  it('sits exactly at curtainHeight − parapetHeight(curtainHeight) — the shared allure height', () => {
    const t = towerSpec({ ...base, round: true, alongWall: [1, 0] });
    const doorZ = firstDoorZ(t.parts);
    expect(doorZ).toBeDefined();
    const allureZ = base.curtainHeight - parapetHeight(base.curtainHeight);
    expect(doorZ!).toBeCloseTo(allureZ, 9);
  });

  it('is well clear of grade and well clear of the tower\'s own crown', () => {
    const t = towerSpec({ ...base, round: true, alongWall: [1, 0] });
    const doorZ = firstDoorZ(t.parts)!;
    expect(doorZ).toBeGreaterThan(0.1);                    // the old grade door sat at ~ -EPS
    expect(doorZ).toBeLessThan(crownOf(t.parts) - 0.5);     // not the tower's own parapet floor
  });

  it('holds across a spread of curtain heights (the door tracks the ALLURE, which moves with it)', () => {
    for (const curtainHeight of [1.5, 2, 3, 4, 6]) {
      const t = towerSpec({ ...base, curtainHeight, round: true, alongWall: [0, 1] });
      const doorZ = firstDoorZ(t.parts)!;
      expect(doorZ, `curtainHeight ${curtainHeight}`).toBeCloseTo(curtainHeight - parapetHeight(curtainHeight), 9);
    }
  });
});

describe('gate tower (square, tall) — unaffected by the flank-door change', () => {
  it('is byte-identical whether or not alongWall is supplied — gate towers ignore it', () => {
    const withAlong = towerSpec({ ...base, tall: true, inward: [1, 0], alongWall: [0, 1] });
    const without = towerSpec({ ...base, tall: true, inward: [1, 0] });
    expect(withAlong.parts).toEqual(without.parts);
    expect(withAlong.side).toBe(without.side);
    expect(withAlong.mountAnchors).toEqual(without.mountAnchors);
  });

  it('keeps its grade door (pins the pre-change behaviour)', () => {
    const t = towerSpec({ ...base, tall: true, inward: [1, 0] });
    const doorZ = firstDoorZ(t.parts);
    expect(doorZ).toBeDefined();
    expect(doorZ!).toBeLessThan(0);                         // grade: at/just below z=0
    expect(doorZ!).toBeGreaterThan(-0.1);
  });
});

describe('vice turret on a drum', () => {
  it('exists (a cylinder part offset from the tower centre) and its radius is a small fraction of the drum\'s', () => {
    const t = towerSpec({ ...base, round: true, alongWall: [1, 0] }, 10, 20);
    const r = t.side / 2;
    const offCentre = t.parts.filter(
      (p) => p.prim === 'cylinder' && (Math.abs(p.center[0] - 10) > 1e-6 || Math.abs(p.center[1] - 20) > 1e-6),
    );
    expect(offCentre.length).toBeGreaterThanOrEqual(2);      // shaft + corbel cap
    for (const p of offCentre) {
      if (p.prim !== 'cylinder') continue;
      expect(p.radius, 'turret radius vs drum radius').toBeLessThan(r * 0.6);
    }
  });

  it('rides the TOWN side, never bulging out over the field', () => {
    // A perpendicular of the wall axis picks a side arbitrarily — on a ring that puts the vice
    // outward on roughly half the drums, fouling the machicolation and the loops covering the
    // wall foot. Whenever the tower knows where the town is, the turret goes there.
    for (const inward of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
      const t = towerSpec({ ...base, round: true, alongWall: [0, 1], inward }, 0, 0);
      const off = t.parts.filter(
        (p) => p.prim === 'cylinder' && (Math.abs(p.center[0]) > 1e-6 || Math.abs(p.center[1]) > 1e-6),
      ) as Extract<TowerSpec['parts'][number], { prim: 'cylinder' }>[];
      expect(off.length).toBeGreaterThanOrEqual(2);
      for (const p of off) {
        const dot = p.center[0] * inward[0] + p.center[1] * inward[1];
        expect(dot, `turret sits outward for inward=${inward}`).toBeGreaterThan(0);
      }
    }
  });

  it('spans walk (the allure, where the flank door lets a defender in) to crown (the drum\'s own top)', () => {
    const t = towerSpec({ ...base, round: true, alongWall: [1, 0] }, 0, 0);
    const allureZ = base.curtainHeight - parapetHeight(base.curtainHeight);
    const crown = crownOf(t.parts);
    const turretParts = t.parts.filter(
      (p) => p.prim === 'cylinder' && (Math.abs(p.center[0]) > 1e-6 || Math.abs(p.center[1]) > 1e-6),
    ) as Extract<TowerSpec['parts'][number], { prim: 'cylinder' }>[];
    expect(turretParts.length).toBeGreaterThanOrEqual(2);
    const lo = Math.min(...turretParts.map((p) => p.baseZ));
    const hi = Math.max(...turretParts.map((p) => p.baseZ + p.height));
    expect(lo).toBeCloseTo(allureZ, 6);
    expect(hi).toBeCloseTo(crown, 6);
  });

  it('is present even on an unoriented drum (a real tower always carries its stair)', () => {
    const t = towerSpec({ ...base, round: true });
    const offCentre = t.parts.filter((p) => p.prim === 'cylinder' && (Math.abs(p.center[0]) > 1e-6 || Math.abs(p.center[1]) > 1e-6));
    expect(offCentre.length).toBeGreaterThanOrEqual(2);
  });
});

describe('an unoriented tower stays solid', () => {
  it('no inward, no alongWall ⇒ no doorway anywhere, and no crash', () => {
    expect(() => towerSpec({ ...base, round: true })).not.toThrow();
    const t = towerSpec({ ...base, round: true });
    expect(firstDoorZ(t.parts)).toBeUndefined();
  });

  it('holds for the square form too', () => {
    const t = towerSpec({ ...base, round: false });
    expect(firstDoorZ(t.parts)).toBeUndefined();
  });
});

describe('render-source cache key — two differently-oriented drums must not collide', () => {
  // No `centroid` ⇒ `inwardAt` returns undefined for every tower, so `alongWall` is the ONLY
  // orientation input in play here — isolating exactly the gotcha the plan calls out (a new
  // geometry-affecting option that fails to reach the cache key silently shares one sprite
  // between two differently-doored/turreted drums).
  const RING: [number, number][] = [[0, 0], [14, 0], [14, 10], [0, 10], [0, 0]];
  const ring: BarrierRun = {
    kind: 'wall', path: RING, height: 3.5, thickness: 2, material: 'stone', crenellated: true, gates: [],
    towers: [{ x: 7, y: 0, role: 'fill' }, { x: 0, y: 5, role: 'fill' }],
  };

  it('emits a distinct `tower:round:` key per along-wall axis', () => {
    const els = runElements(ring);
    const south = els.find((e) => e.refX === 7 && e.refY === 0);
    const west = els.find((e) => e.refX === 0 && e.refY === 5);
    expect(south, 'south-leg drum').toBeDefined();
    expect(west, 'west-leg drum').toBeDefined();
    expect(south!.key).toMatch(/^tower:round:.*:solid:aw\d$/);
    expect(west!.key).toMatch(/^tower:round:.*:solid:aw\d$/);
    expect(south!.key).not.toBe(west!.key);
    const awOf = (k: string): string => k.match(/aw(\d)$/)![1];
    expect(awOf(south!.key)).not.toBe(awOf(west!.key));
  });

  it('a gate tower key is unchanged in shape — no `aw` suffix leaks into it', () => {
    const gated: BarrierRun = { ...ring, gates: [{ t: 7, width: 3 }], towers: undefined };
    const els = runElements(gated);
    const gate = els.find((e) => e.key.startsWith('tower:gate:'));
    expect(gate).toBeDefined();
    expect(gate!.key).not.toMatch(/:aw\d/);
  });
});
