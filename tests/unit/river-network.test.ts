import { describe, it, expect } from 'vitest';
import { generateHydrology } from '@/terrain/hydrology';
import {
  buildWaterNetwork, summarizeNetwork, smoothCenterline, classifyReach, classifyLake,
  reachValleySlope, reachMeander, MEANDER_SLOPE_K, MEANDER_SLOPE_Q_EXP, MEANDER_AMP_CAP_TILES,
} from '@/terrain/river-network';
import { WaterType, type TerrainField } from '@/core/types';

function field(elev: number[]): TerrainField {
  return {
    elevation: new Float32Array(elev),
    moisture: new Float32Array(elev.length),
    temperature: new Float32Array(elev.length),
  };
}

describe('water connectome — river network extraction', () => {
  // Y-confluence (the hydrology suite's fixture): two equal tributaries from the top
  // corners merge at the centre and exit at the bottom.
  //   y0:  0.9  1.0  0.9   (sources at corners; centre is a wall)
  //   y1:  0.5  0.4  0.5
  //   y2:  1.0  0.1  1.0   (outlet at (1,2))
  const CONFLUENCE = [0.9, 1.0, 0.9, 0.5, 0.4, 0.5, 1.0, 0.1, 1.0];

  it('lifts a Y-confluence into spring → confluence → mouth nodes + reaches', () => {
    const hydro = generateHydrology(field(CONFLUENCE), { seed: 1, width: 3, height: 3, seaLevel: 0.0 }, { riverFlowThreshold: 2 });
    const net = buildWaterNetwork(hydro, 3, 3);
    const sum = summarizeNetwork(net);

    // Two distinct headwater sources feeding one merge, then an outlet to the edge.
    expect(sum.nodes.spring).toBeGreaterThanOrEqual(2);
    expect(sum.nodes.confluence).toBeGreaterThanOrEqual(1);
    expect(sum.nodes.mouth).toBeGreaterThanOrEqual(1);
    // At least the two tributary reaches plus the trunk below the confluence.
    expect(sum.totalReaches).toBeGreaterThanOrEqual(3);
  });

  it('every reach is a drainTo-contiguous chain between two real nodes', () => {
    const hydro = generateHydrology(field(CONFLUENCE), { seed: 1, width: 3, height: 3, seaLevel: 0.0 }, { riverFlowThreshold: 2 });
    const net = buildWaterNetwork(hydro, 3, 3);
    for (const r of net.reaches) {
      expect(net.byId.has(r.from)).toBe(true);
      expect(net.byId.has(r.to)).toBe(true);
      // Endpoints of `cells` ARE the from/to node cells.
      expect(net.byId.get(r.from)!.cell).toBe(r.cells[0]);
      expect(net.byId.get(r.to)!.cell).toBe(r.cells[r.cells.length - 1]);
      // Interior steps follow drainTo exactly.
      for (let k = 0; k < r.cells.length - 1; k++) {
        expect(hydro.drainTo[r.cells[k]]).toBe(r.cells[k + 1]);
      }
      // Centreline starts/ends at the endpoint cell centres.
      const a = r.cells[0], b = r.cells[r.cells.length - 1];
      expect(r.centerline[0].x).toBeCloseTo((a % 3) + 0.5, 5);
      expect(r.centerline[r.centerline.length - 1].x).toBeCloseTo((b % 3) + 0.5, 5);
    }
  });

  it('classifies still water by area — tarn < pond < lake < mere', () => {
    expect(classifyLake(1)).toBe('tarn');
    expect(classifyLake(3)).toBe('tarn');
    expect(classifyLake(8)).toBe('pond');
    expect(classifyLake(40)).toBe('lake');
    expect(classifyLake(200)).toBe('mere');
  });

  it('lifts the lake body into a node linked to its outflow channel', () => {
    const W = 5;
    const elev = [
      0.9, 0.9, 0.9, 0.9, 0.9,
      0.9, 0.9, 0.9, 0.9, 0.9,
      0.8, 0.2, 0.55, 0.45, 0.1,   // valley: source · LAKE · spill · · edge
      0.9, 0.9, 0.9, 0.9, 0.9,
      0.9, 0.9, 0.9, 0.9, 0.9,
    ];
    const hydro = generateHydrology(field(elev), { seed: 1, width: W, height: 5, seaLevel: 0.05 }, { riverFlowThreshold: 2 });
    const net = buildWaterNetwork(hydro, W, 5);
    expect(net.lakes.length).toBeGreaterThanOrEqual(1);
    const lake = net.lakes[0];
    expect(lake.area).toBeGreaterThanOrEqual(1);
    // The lake feeds the outlet channel — its outlet junction is recorded on the body.
    const outlet = net.nodes.find((n) => n.kind === 'lake_outlet');
    expect(outlet).toBeDefined();
    expect(lake.outletIds).toContain(outlet!.id);
  });

  it('classifies a channel born at a lake spill as a lake_outlet (lake-fed)', () => {
    // 5×5 with a walled valley along the middle row (y=2): a high source at x=0, a
    // closed pit at x=1 that fills to a LAKE, its spill at x=2 feeding a channel that
    // descends to the map edge at x=4. The high rows above/below are valley walls.
    const W = 5;
    const elev = [
      0.9, 0.9, 0.9, 0.9, 0.9,
      0.9, 0.9, 0.9, 0.9, 0.9,
      0.8, 0.2, 0.55, 0.45, 0.1,   // valley: source · LAKE · spill · · edge
      0.9, 0.9, 0.9, 0.9, 0.9,
      0.9, 0.9, 0.9, 0.9, 0.9,
    ];
    const hydro = generateHydrology(field(elev), { seed: 1, width: W, height: 5, seaLevel: 0.05 }, { riverFlowThreshold: 2 });
    expect(hydro.waterType[2 * W + 1]).toBe(WaterType.Lake);   // the pit fills to a lake
    const net = buildWaterNetwork(hydro, W, 5);
    // The cell just downstream of the lake, fed by the lake, is a lake_outlet.
    const outlet = net.nodes.find((n) => n.kind === 'lake_outlet');
    expect(outlet).toBeDefined();
    // …and the reach leaving it is flagged lake-fed.
    const fed = net.reaches.find((r) => r.from === outlet!.id);
    expect(fed?.lakeFed).toBe(true);
  });

  it('is deterministic — same raster yields identical node/reach ids', () => {
    const cfg = { seed: 1, width: 3, height: 3, seaLevel: 0.0 };
    const a = buildWaterNetwork(generateHydrology(field(CONFLUENCE), cfg, { riverFlowThreshold: 2 }), 3, 3);
    const b = buildWaterNetwork(generateHydrology(field(CONFLUENCE), cfg, { riverFlowThreshold: 2 }), 3, 3);
    expect(a.nodes.map((n) => `${n.id}:${n.kind}`)).toEqual(b.nodes.map((n) => `${n.id}:${n.kind}`));
    expect(a.reaches.map((r) => `${r.id}:${r.klass}:${r.lakeFed}`))
      .toEqual(b.reaches.map((r) => `${r.id}:${r.klass}:${r.lakeFed}`));
  });

  it('classifyReach blends discharge with a Strahler floor', () => {
    const T = 500;
    // Low order + low flow → brook; flow promotes upward even at order 1.
    expect(classifyReach(1, 400, T)).toBe('brook');
    expect(classifyReach(1, 1000, T)).toBe('stream');     // 2× threshold
    expect(classifyReach(1, 3000, T)).toBe('river');      // 6× threshold
    expect(classifyReach(1, 9000, T)).toBe('major_river'); // 18× threshold
    // Structural floor: a post-confluence trunk is at least a stream even at low flow.
    expect(classifyReach(2, 100, T)).toBe('stream');
    expect(classifyReach(4, 100, T)).toBe('major_river');
  });

  it('smoothCenterline passes through the endpoints and subdivides sub-cell', () => {
    const control = [{ x: 0.5, y: 0.5 }, { x: 1.5, y: 0.5 }, { x: 2.5, y: 1.5 }, { x: 3.5, y: 1.5 }];
    const sm = smoothCenterline(control, 0.5);
    expect(sm[0]).toEqual(control[0]);
    expect(sm[sm.length - 1].x).toBeCloseTo(3.5, 5);
    expect(sm[sm.length - 1].y).toBeCloseTo(1.5, 5);
    expect(sm.length).toBeGreaterThan(control.length);   // genuinely subdivided
  });
});

describe('gradient-aware meanders (rivers R1)', () => {
  const W = 20;
  // A horizontal reach along row 0 (cells 0..len-1), with a water surface that descends
  // by `slopePerTile` each step. surfaceW < 0 is the dry-land sentinel.
  function horizReach(len: number, slopePerTile: number): { cells: number[]; surf: Float32Array } {
    const surf = new Float32Array(W * W).fill(-1);
    const cells: number[] = [];
    for (let x = 0; x < len; x++) { cells.push(x); surf[x] = 5.0 - x * slopePerTile; }
    return { cells, surf };
  }
  // Critical slope at a given flow — the meander/straight boundary.
  const crit = (flow: number): number => MEANDER_SLOPE_K * Math.pow(Math.max(flow, 1), MEANDER_SLOPE_Q_EXP);

  it('reachValleySlope = surface drop over D8 path length (tiles)', () => {
    const { cells, surf } = horizReach(5, 0.1);   // drop 0.4 over 4 tiles
    expect(reachValleySlope(cells, surf, W)).toBeCloseTo(0.1, 6);
    // A dry-sentinel endpoint yields no usable gradient.
    surf[cells[cells.length - 1]] = -1;
    expect(reachValleySlope(cells, surf, W)).toBe(0);
  });

  const LONG = 1000;   // a reach long enough to host a meander (past the min-length gate)

  it('a STEEP reach (S_v ≥ S꜀) runs straight — no injected meander', () => {
    const flow = 2500;
    const steep = crit(flow) * 2;                 // well above threshold
    const cfg = reachMeander(flow, 1, steep, LONG, 3, 7);
    expect(cfg.amp).toBe(0);
  });

  it('a SHORT reach (< one wavelength) runs straight — bridges/gates sit here', () => {
    const flow = 2500, gentle = crit(flow) / 1.6;
    // fullW = 2 ⇒ wavelength ≈ 22 tiles; a 10-tile connector reach has no room to bend.
    const shortCfg = reachMeander(flow, 1, gentle, 10, 3, 7);
    const longCfg = reachMeander(flow, 1, gentle, LONG, 3, 7);
    expect(shortCfg.amp).toBe(0);
    expect(longCfg.amp).toBeGreaterThan(0);       // same reach, only length differs
  });

  it('a GENTLE reach (S_v < S꜀) meanders, and flatter ⇒ larger amplitude', () => {
    const flow = 2500;
    const c = crit(flow);
    // A thin channel (halfWidth 0.4 ⇒ small wavelength) keeps both amplitudes below the
    // caps, so K genuinely drives the amplitude. K stays < 1.61 (above which the width
    // cap binds and both would pin equal).
    const mild = reachMeander(flow, 0.4, c / 1.2, LONG, 3, 7);   // K ≈ 1.2
    const flat = reachMeander(flow, 0.4, c / 1.5, LONG, 3, 7);   // K ≈ 1.5 (flatter)
    expect(mild.amp).toBeGreaterThan(0);
    expect(flat.amp).toBeGreaterThan(mild.amp);          // flatter valley → curvier
  });

  it('wavelength scales with channel width (λ ≈ 11 × full width)', () => {
    const flow = 2500, slope = crit(flow) / 1.5;
    const thin = reachMeander(flow, 1, slope, LONG, 3, 7);     // fullW = 2
    const wide = reachMeander(flow, 2, slope, LONG, 3, 7);      // fullW = 4 (same spring ⇒ same jitter)
    expect(wide.wavelength).toBeCloseTo(2 * thin.wavelength, 5);
  });

  it('amplitude is bounded by the absolute tile cap (no confinement clamp yet)', () => {
    // A very flat, very wide reach would otherwise wander arbitrarily far.
    const cfg = reachMeander(9000, 3.2, 1e-6, LONG, 3, 7);
    expect(cfg.amp).toBeLessThanOrEqual(MEANDER_AMP_CAP_TILES + 1e-9);
    expect(cfg.amp).toBeGreaterThan(0);
  });

  it('is deterministic — same inputs re-derive an identical config', () => {
    const a = reachMeander(2500, 1.4, 0.002, LONG, 11, 13);
    const b = reachMeander(2500, 1.4, 0.002, LONG, 11, 13);
    expect(a).toEqual(b);
    // The exponent is the Leopold–Wolman threshold slope exponent.
    expect(MEANDER_SLOPE_Q_EXP).toBeCloseTo(-0.44, 6);
  });
});
