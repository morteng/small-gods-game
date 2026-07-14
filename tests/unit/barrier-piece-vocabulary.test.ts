import { describe, it, expect, beforeAll } from 'vitest';
import { chunkBarrierRun, runElements } from '@/render/parametric-barrier-source';
import { deriveSettlementRing, deriveCroftEnclosures, type EnclosureCtx } from '@/world/enclosure';
import { loadDefaultPacks } from '@/catalogue';
import type { BarrierRun } from '@/world/barrier';
import type { Lot } from '@/world/settlement-plan';

// WP-W2 acceptance: the barrier render cutter emits a FINITE piece vocabulary. Two independently
// seeded settlement rings (+ crofts) must (1) key every element in the finite grammar, (2) stay
// under a small distinct-key budget, (3) SHARE curtain pieces across seeds (the whole point — a
// pre-generated bundle covers every world), (4) round-trip key⇄spec via `pieceRunFromKey`, and
// (5) be deterministic. Read src/render/parametric-barrier-source.ts (the cutter + PieceKey grammar)
// before touching this file.

const ctx: EnclosureCtx = { era: 'medieval', wealth: 'wealthy' };

/** A finite-vocabulary element key: a canonical wall PIECE, a gate leaf/frame, a tower, a stair, or
 *  a post. No JSON braces (a `free:` legacy chunk or a raw `JSON.stringify` would carry one). */
const GRAMMAR = /^(piece|gate|gateframe|tower|stair|post):[^{]*$/;

beforeAll(() => loadDefaultPacks());

/** A seeded settlement ring around a disc of building cells, with inbound connections so real gates
 *  commit onto piece slots (mirrors the enclosure.test cluster fixture). */
function clusterRing(cx0: number, cy0: number, r2: number, poiId: string, connections: { dx: number; dy: number }[]): BarrierRun {
  const cells = new Set<string>();
  for (let y = cy0 - 12; y <= cy0 + 12; y++) {
    for (let x = cx0 - 12; x <= cx0 + 12; x++) {
      if ((x - cx0) ** 2 + (y - cy0) ** 2 <= r2) cells.add(`${x},${y}`);
    }
  }
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  for (const k of cells) { const [x, y] = k.split(',').map(Number); mnx = Math.min(mnx, x); mny = Math.min(mny, y); mxx = Math.max(mxx, x); mxy = Math.max(mxy, y); }
  const ring = deriveSettlementRing({
    bbox: { minX: mnx, minY: mny, maxX: mxx, maxY: mxy },
    mapW: 90, mapH: 90, buildingCount: 40, poiId,
    isWater: () => false, isRoad: () => false,
    isBuilding: (x, y) => cells.has(`${x},${y}`),
    connections, ctx,
  });
  expect(ring).toBeTruthy();
  return ring!.run;
}

/** A couple of built burgage lots → croft rings (short cardinal sides exercise the remainder cut). */
function crofts(poiId: string, ox: number, oy: number): BarrierRun[] {
  const seqRng = (() => { let i = 0; const vals = [0.1, 0.6]; return { next: () => vals[i++ % vals.length] }; })();
  const lots: Lot[] = [0, 1].map((j) => ({
    id: `lot:${j}`, edge: 0, side: [0, 1] as [number, number],
    frontage: [{ x: ox + j * 8, y: oy + 1 }], depth: 3,
    tiles: [0, 1, 2, 3].flatMap((dx) => [0, 1, 2].map((dy) => ({ x: ox + j * 8 + dx, y: oy + 2 + dy }))),
    buildingId: `b${j}`,
  }));
  return deriveCroftEnclosures(lots, poiId, seqRng, ctx).map((e) => e.run);
}

function seedRuns(seed: 0 | 1): BarrierRun[] {
  return seed === 0
    ? [clusterRing(30, 28, 60, 'seedA', [{ dx: 1, dy: 0 }, { dx: 0, dy: -1 }, { dx: -1, dy: 1 }]), ...crofts('seedA', 4, 4)]
    : [clusterRing(38, 40, 110, 'seedB', [{ dx: 1, dy: 1 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }]), ...crofts('seedB', 6, 6)];
}

const keysOf = (runs: BarrierRun[]): string[] => runs.flatMap((r) => runElements(r).map((e) => e.key));

describe('WP-W2 — finite barrier piece vocabulary', () => {
  it('every element key is in the finite grammar (no JSON blobs / free chunks)', () => {
    for (const seed of [0, 1] as const) {
      for (const k of keysOf(seedRuns(seed))) expect(k, k).toMatch(GRAMMAR);
    }
  });

  it('stays under a small distinct-key budget per seed (pre-generatable)', () => {
    // 30 → 36 with the gate/wall tile-exactness round (WCV 97): gate openings floor at the
    // rendered ribbon width, so a DIAGONAL gate is 2 slots = 4 fragments (g2i0..g2i3) instead
    // of 1 slot = 2 — a few more distinct keys, still finite + enumerable.
    for (const seed of [0, 1] as const) {
      const distinct = new Set(keysOf(seedRuns(seed)));
      expect(distinct.size, `seed ${seed}: ${distinct.size} distinct keys`).toBeLessThanOrEqual(36);
    }
  });

  it('SHARES curtain pieces across seeds (the vendored bundle covers every world)', () => {
    const curtainA = new Set(keysOf(seedRuns(0)).filter((k) => k.includes(':curtain')));
    const curtainB = new Set(keysOf(seedRuns(1)).filter((k) => k.includes(':curtain')));
    expect(curtainA.size).toBeGreaterThan(0);
    expect(curtainB.size).toBeGreaterThan(0);
    const inter = [...curtainA].filter((k) => curtainB.has(k));
    expect(inter.length).toBeGreaterThan(0);                               // real cross-seed reuse
    const union = new Set([...curtainA, ...curtainB]).size;
    expect(union).toBeLessThan(0.6 * (curtainA.size + curtainB.size));     // < 60% of the sum ⇒ overlap
  });

  it('pieceRunFromKey round-trips: re-cutting a piece localRun reproduces its key', () => {
    for (const seed of [0, 1] as const) {
      for (const run of seedRuns(seed)) {
        for (const c of chunkBarrierRun(run)) {
          const recut = chunkBarrierRun(c.localRun);
          expect(recut, c.key).toHaveLength(1);
          expect(recut[0].key).toBe(c.key);
        }
      }
    }
  });

  it('is deterministic: the same run twice yields a byte-identical key list', () => {
    for (const seed of [0, 1] as const) {
      for (const run of seedRuns(seed)) {
        expect(runElements(run).map((e) => e.key)).toEqual(runElements(run).map((e) => e.key));
      }
    }
  });
});
