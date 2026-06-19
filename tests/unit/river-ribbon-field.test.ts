import { describe, it, expect } from 'vitest';
import { traceRiverPolylines, buildRiverRibbonMesh } from '@/render/ribbon/river-ribbon-field';
import { WaterType, type GameMap, type HydrologyResult } from '@/core/types';

/** Minimal map + hydrology with rivers laid out on a W×H grid. `river` lists the
 *  cell chain head→mouth; drainTo links each to the next, last to `mouthDrain`. */
function makeHydro(W: number, H: number, chains: number[][], mouthDrain = -1): { map: GameMap; hydro: HydrologyResult } {
  const N = W * H;
  const waterType = new Uint8Array(N);
  const drainTo = new Int32Array(N).fill(-1);
  const strahler = new Uint8Array(N);
  const width = new Float32Array(N);
  const surfaceW = new Float32Array(N).fill(-1);
  for (const chain of chains) {
    for (let k = 0; k < chain.length; k++) {
      const c = chain[k];
      waterType[c] = WaterType.River;
      strahler[c] = 1;
      width[c] = 1;
      surfaceW[c] = 1 - k * 0.01; // monotonically downhill
      drainTo[c] = k < chain.length - 1 ? chain[k + 1] : mouthDrain;
    }
  }
  const map = { width: W, height: H, tiles: [], villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
  const hydro = {
    riverMask: new Uint8Array(N), flowField: new Float32Array(N), drainTo, surfaceW,
    waterMask: new Uint8Array(N), waterType, flowDirX: new Float32Array(N), flowDirY: new Float32Array(N),
    strahler, width,
  } as unknown as HydrologyResult;
  return { map, hydro };
}

describe('traceRiverPolylines', () => {
  it('traces a single chain head→mouth in downstream order', () => {
    // 5×1 river along the row: cells 0..3 river, draining right to outlet.
    const { map, hydro } = makeHydro(5, 1, [[0, 1, 2, 3]]);
    const paths = traceRiverPolylines(map, hydro);
    expect(paths).toHaveLength(1);
    const xs = paths[0].points.map((p) => p.x);
    // Cell centres at x+0.5, strictly increasing (downstream order preserved).
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    expect(paths[0].points[0]).toEqual({ x: 0.5, y: 0.5 });
  });

  it('joins a tributary into the trunk at the confluence (each reach once)', () => {
    // 4×2 grid. Trunk row0: 0→1→2→3(outlet). Tributary cell 4=(0,1) drains INTO 1.
    // Built directly so the tributary doesn't clobber the trunk's drainTo[1].
    const W = 4, H = 2, N = W * H;
    const waterType = new Uint8Array(N);
    const drainTo = new Int32Array(N).fill(-1);
    const strahler = new Uint8Array(N);
    const width = new Float32Array(N);
    const surfaceW = new Float32Array(N).fill(-1);
    const river = (c: number, to: number, s: number) => {
      waterType[c] = WaterType.River; drainTo[c] = to; strahler[c] = s; width[c] = s; surfaceW[c] = 1 - c * 0.01;
    };
    river(0, 1, 1); river(1, 2, 2); river(2, 3, 2); river(3, -1, 2); river(4, 1, 1);
    const map = { width: W, height: H, tiles: [], villages: [], seed: 1, success: true,
      worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
    const hydro = { riverMask: new Uint8Array(N), flowField: new Float32Array(N), drainTo, surfaceW,
      waterMask: new Uint8Array(N), waterType, flowDirX: new Float32Array(N), flowDirY: new Float32Array(N),
      strahler, width } as unknown as HydrologyResult;

    const paths = traceRiverPolylines(map, hydro);
    // Two headwaters (0 and 4); the first to reach the confluence owns the trunk
    // below it, the tributary stops at the confluence cell.
    expect(paths.length).toBe(2);
    const tribPath = paths.find((p) => p.points[0].x === 0.5 && p.points[0].y === 1.5)!;
    expect(tribPath).toBeTruthy();
    expect(tribPath.points[tribPath.points.length - 1]).toEqual({ x: 1.5, y: 0.5 }); // the confluence
  });

  it('builds a non-empty ribbon mesh with river tag (tag.y=1)', () => {
    const { map, hydro } = makeHydro(6, 1, [[0, 1, 2, 3, 4]]);
    const mesh = buildRiverRibbonMesh(map, hydro);
    expect(mesh.vertexCount).toBeGreaterThan(0);
    // tag.y is the 10th float (index 9) of each vertex; rivers are 1.
    expect(mesh.data[9]).toBe(1);
  });

  it('returns an empty mesh when there are no rivers', () => {
    const { map, hydro } = makeHydro(4, 4, []);
    expect(buildRiverRibbonMesh(map, hydro).vertexCount).toBe(0);
  });
});
