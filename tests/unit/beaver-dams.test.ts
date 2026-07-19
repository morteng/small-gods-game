import { describe, it, expect } from 'vitest';
import { generateHydrology } from '@/terrain/hydrology';
import { siteBeaverDams, DAM_CREST_RISE } from '@/world/beaver-dams';
import { WaterType, type TerrainField, type TerrainConfig, type HydrologyResult } from '@/core/types';

// Rivers R3 P2 — beaver dams as crest-clamp weirs. A weir raises its run's EFFECTIVE elevation
// to a crest inside the priority-flood, so the reach behind it impounds and falls out of P1's
// pond keep-rule as a `kind:'beaver'` pond. Siting picks moderate-flow, narrow-valley, near-wood
// reaches; both hydrology callers apply the SAME persisted weirs, byte-identically.

function field(elev: number[]): TerrainField {
  return {
    elevation: new Float32Array(elev),
    moisture: new Float32Array(elev.length),
    temperature: new Float32Array(elev.length),
  };
}

const W = 25, H = 11;
const CH_Y = 5;                    // channel centreline row
const CFG: TerrainConfig = { seed: 1, width: W, height: H, seaLevel: 0.05 };
const at = (x: number, y: number) => y * W + x;

/**
 * A V-valley draining EAST (elevation falls with +x) with a gentle cross-slope so the pond a
 * dam impounds is a few cells wide. bed(x) = C − xSlope·x; banks rise `bankSlope` per row off
 * CH_Y. No closed basin on its own — every cell drains monotonically to the east edge.
 */
function valley(xSlope = 0.0008, bankSlope = 0.003, C = 0.504): number[] {
  const elev = new Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      elev[at(x, y)] = C - xSlope * x + bankSlope * Math.abs(y - CH_Y);
    }
  }
  return elev;
}

describe('rivers R3 P2 — beaver dam crest-clamp weirs', () => {
  it('1 · a weir impounds the reach behind it into a beaver pond via the P1 machinery', () => {
    const elev = valley();
    const xDam = 15;
    const bed = elev[at(xDam, CH_Y)];
    const crest = bed + DAM_CREST_RISE;
    // The cross-channel run: cells at x=xDam whose bed sits below the crest (the banks above it
    // are natural abutments the water can't overtop).
    const runCells: number[] = [];
    for (let y = 0; y < H; y++) if (elev[at(xDam, y)] < crest) runCells.push(at(xDam, y));
    expect(runCells.length).toBeGreaterThanOrEqual(3);

    // BEFORE: the free-draining valley has no pond at the dam site.
    const base = generateHydrology(field(elev), CFG);
    expect((base.ponds ?? []).some((p) => (p.spillCell % W) === xDam)).toBe(false);

    // AFTER: the weir ponds the reach upstream (west) of the dam.
    const wr = generateHydrology(field(elev), CFG, { weirs: [{ cells: runCells, crestElev: crest }] });
    const ponds = wr.ponds ?? [];
    expect(ponds.length).toBe(1);
    const pond = ponds[0];
    expect(pond.kind).toBe('beaver');
    // Its spill saddle is one of the weir cells; area/depth land in the pond band.
    expect(runCells).toContain(pond.spillCell);
    expect(pond.area).toBeGreaterThanOrEqual(6);
    expect(pond.maxDepth).toBeGreaterThanOrEqual(0.006);
    expect(pond.maxDepth).toBeLessThan(0.01);

    // The impounded cells sit UPSTREAM (west) of the dam, classify Lake, and carry the pond id.
    let westCells = 0;
    for (let i = 0; i < W * H; i++) {
      if (wr.pondId![i] === pond.id) {
        expect(wr.waterType[i]).toBe(WaterType.Lake);
        expect(wr.waterMask[i]).toBe(1);
        expect(i % W).toBeLessThan(xDam);      // behind the dam
        westCells++;
      }
    }
    expect(westCells).toBe(pond.area);
  });

  it('2 · the weirs option is inert by default — empty/undefined is byte-identical', () => {
    const elev = valley();
    const a = generateHydrology(field(elev), CFG);
    const b = generateHydrology(field(elev), CFG, { weirs: [] });
    const c = generateHydrology(field(elev), CFG, { weirs: undefined });
    for (const other of [b, c]) {
      expect(Array.from(other.waterType)).toEqual(Array.from(a.waterType));
      expect(Array.from(other.surfaceW)).toEqual(Array.from(a.surfaceW));
      expect(Array.from(other.pondId!)).toEqual(Array.from(a.pondId!));
      expect(Array.from(other.riverMask)).toEqual(Array.from(a.riverMask));
      expect(other.ponds!.length).toBe(a.ponds!.length);
    }
  });

  // ── Siting (siteBeaverDams) over a synthetic hydrology result. ──────────────────────────
  //
  // Build a minimal HydrologyResult with a straight EAST-flowing channel at CH_Y (river cells of
  // a chosen Strahler order), so the narrow-valley probe and the Strahler gate are exercised
  // directly without a full worldgen.
  function synthHydro(elev: number[], strahlerOrder: number): HydrologyResult {
    const total = W * H;
    const riverMask = new Uint8Array(total);
    const strahler = new Uint8Array(total);
    const flowDirX = new Float32Array(total);
    const flowDirY = new Float32Array(total);
    for (let x = 2; x < W - 2; x++) {
      const i = at(x, CH_Y);
      riverMask[i] = 1;
      strahler[i] = strahlerOrder;
      flowDirX[i] = 1;   // flows east
    }
    return {
      riverMask, strahler, flowDirX, flowDirY,
      flowField: new Float32Array(total),
      drainTo: new Int32Array(total).fill(-1),
      surfaceW: new Float32Array(total).fill(-1),
      waterMask: new Uint8Array(total),
      waterType: new Uint8Array(total),
      width: new Float32Array(total),
      ponds: [],
      pondId: new Int32Array(total).fill(-1),
    };
  }

  const allWood = () => true;

  it('3 · siting is deterministic — same inputs give the same dams twice', () => {
    const elev = valley();
    const hy = synthHydro(elev, 2);
    const a = siteBeaverDams(hy, new Float32Array(elev), { width: W, height: H, seaLevel: 0.05, seed: 4242, forestAt: allWood });
    const b = siteBeaverDams(hy, new Float32Array(elev), { width: W, height: H, seaLevel: 0.05, seed: 4242, forestAt: allWood });
    expect(a.length).toBeGreaterThan(0);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('4a · never dams a trunk reach (Strahler above the band)', () => {
    const elev = valley();
    const trunk = siteBeaverDams(synthHydro(elev, 6), new Float32Array(elev), { width: W, height: H, seaLevel: 0.05, seed: 1, forestAt: allWood });
    expect(trunk.length).toBe(0);
    // …but a low-order stream on the SAME terrain does site.
    const stream = siteBeaverDams(synthHydro(elev, 2), new Float32Array(elev), { width: W, height: H, seaLevel: 0.05, seed: 1, forestAt: allWood });
    expect(stream.length).toBeGreaterThan(0);
  });

  it('4b · never dams a wide valley (banks never rise to an abutment)', () => {
    // A near-flat cross-section: banks barely rise, so no abutment within the probe → no dam.
    const flatBanks = valley(0.0008, 0.0004);
    const wide = siteBeaverDams(synthHydro(flatBanks, 2), new Float32Array(flatBanks), { width: W, height: H, seaLevel: 0.05, seed: 1, forestAt: allWood });
    expect(wide.length).toBe(0);
  });

  it('4c · never dams away from wood', () => {
    const elev = valley();
    const noWood = siteBeaverDams(synthHydro(elev, 2), new Float32Array(elev), { width: W, height: H, seaLevel: 0.05, seed: 1, forestAt: () => false });
    expect(noWood.length).toBe(0);
  });

  it('5 · a sited dam, fed back as a weir, produces a kept beaver pond (round-trip parity)', () => {
    // The map-generator two-pass in miniature: site off the base hydrology, then re-run the SAME
    // generateHydrology with the dam cells as weirs (exactly what hydrology-store replays from the
    // persisted `map.beaverDams`). Both runs are pure ⇒ identical final water.
    const elev = valley();
    const dams = siteBeaverDams(synthHydro(elev, 2), new Float32Array(elev), { width: W, height: H, seaLevel: 0.05, seed: 4242, forestAt: allWood });
    expect(dams.length).toBeGreaterThan(0);
    const weirs = dams.map((d) => ({ cells: d.cells, crestElev: d.crestElev }));

    const run1 = generateHydrology(field(elev), CFG, { weirs });
    const run2 = generateHydrology(field(elev), CFG, { weirs });
    // Byte-identical across the two callers.
    expect(Array.from(run2.waterType)).toEqual(Array.from(run1.waterType));
    expect(Array.from(run2.surfaceW)).toEqual(Array.from(run1.surfaceW));
    expect(Array.from(run2.pondId!)).toEqual(Array.from(run1.pondId!));

    // At least one dam impounded a real beaver pond that the keep-rule kept.
    const beaverPonds = (run1.ponds ?? []).filter((p) => p.kind === 'beaver');
    expect(beaverPonds.length).toBeGreaterThanOrEqual(1);
  });
});
