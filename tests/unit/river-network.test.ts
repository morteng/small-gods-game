import { describe, it, expect } from 'vitest';
import { generateHydrology } from '@/terrain/hydrology';
import {
  buildWaterNetwork, summarizeNetwork, smoothCenterline, classifyReach,
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
