import { describe, it, expect } from 'vitest';
import { buildAqueductStructureEntities } from '@/world/connectome/aqueduct-structures';
import type { SettlementSite } from '@/world/connectome/aqueduct-placement';
import type { WaterNetwork, WaterNode, WaterNodeKind } from '@/terrain/river-network';

let cell = 0;
const node = (id: string, kind: WaterNodeKind, x: number, y: number): WaterNode =>
  ({ id, kind, cell: cell++, x, y });

function net(nodes: WaterNode[]): WaterNetwork {
  return {
    nodes, reaches: [], lakes: [],
    byId: new Map(nodes.map((n) => [n.id, n])),
    nodeAtCell: new Map(), width: 64, height: 64,
  };
}

const town = (id: string, x: number, y: number): SettlementSite => ({ id, x, y });

// reliefM 1 ⇒ elevAt returns metres directly. liftForWaterM is the identity-ish render map; for the
// tests we just echo the metre value so we can assert an elevated deck got lifted to its water line.
const baseOpts = (elevAt: (x: number, y: number) => number, extra = {}) => ({
  elevAt, reliefM: 1, width: 40, height: 16, maxGrade: 0.6,
  liftForWaterM: (m: number) => m,
  ...extra,
});

describe('buildAqueductStructureEntities — emergent aqueduct realization', () => {
  it('emits a continuous channel of cardinal pieces from a highland spring to a dry town', () => {
    const plane = (x: number) => 30 - x;   // descends 1 m/tile toward +x
    const ents = buildAqueductStructureEntities(
      net([node('peak', 'spring', 2, 5)]),
      [town('riverside', 20, 5)],
      baseOpts(plane),
    );
    const channels = ents.filter((e) => e.kind === 'aqueduct_channel');
    expect(channels.length).toBeGreaterThan(0);
    // Every channel id traces back to this source→sink pair (deterministic, addressable).
    expect(channels.every((e) => e.id.startsWith('aqueduct:aqsrc:peak->riverside:'))).toBe(true);
    // A gentle open slope ⇒ all surface ⇒ no piers, no lift.
    expect(ents.some((e) => e.kind === 'aqueduct_pier')).toBe(false);
    expect(channels.every((e) => (e.properties as Record<string, unknown>).liftElev === undefined)).toBe(true);
  });

  it('rides an elevated run on a lifted deck carried by an arch arcade across a gorge', () => {
    // A gorge (floor 2 m) at x=9..13 the gentle grade cannot descend into ⇒ an elevated run.
    const elevAt = (x: number) => (x >= 9 && x <= 13 ? 2 : 25 - 0.5 * x);
    const ents = buildAqueductStructureEntities(
      net([node('source', 'spring', 2, 5)]),
      [town('downstream', 20, 5)],
      baseOpts(elevAt),
    );
    // A tall elevated run marches as an ARCADE of arch bays (not bare piers).
    const arches = ents.filter((e) => e.kind === 'aqueduct_arch');
    expect(arches.length).toBeGreaterThan(0);
    // The elevated channel deck is lifted to ~its water line (well above the 2 m gorge floor).
    const lifted = ents.filter((e) =>
      e.kind === 'aqueduct_channel' && (e.properties as Record<string, unknown>).liftElev !== undefined);
    expect(lifted.length).toBeGreaterThan(0);
    for (const e of lifted) {
      expect((e.properties as { liftElev: number }).liftElev).toBeGreaterThan(2);
    }
    // An arch bay spans across the gorge (its from→to endpoints, parsed from the id, bracket it).
    const spansGorge = arches.some((e) => {
      const m = /arch:(\d+),\d+-(\d+),\d+$/.exec(e.id);
      if (!m) return false;
      const ax = Number(m[1]), bx = Number(m[2]);
      return Math.min(ax, bx) <= 13 && Math.max(ax, bx) >= 9;
    });
    expect(spansGorge).toBe(true);
  });

  it('respects the demand gate and a sourceless / townless world', () => {
    const plane = (x: number) => 30 - x;
    expect(buildAqueductStructureEntities(
      net([node('peak', 'spring', 2, 5)]), [town('wet', 20, 5)],
      baseOpts(plane, { needsAqueduct: () => false }),
    )).toEqual([]);
    // No springs/outlets ⇒ no intakes ⇒ nothing.
    expect(buildAqueductStructureEntities(
      net([node('c', 'confluence', 2, 5)]), [town('t', 20, 5)], baseOpts(plane),
    )).toEqual([]);
    // No settlements ⇒ nothing.
    expect(buildAqueductStructureEntities(
      net([node('peak', 'spring', 2, 5)]), [], baseOpts(plane),
    )).toEqual([]);
  });

  it('is deterministic — same world ⇒ identical entity ids', () => {
    const elevAt = (x: number) => (x >= 9 && x <= 13 ? 2 : 25 - 0.5 * x);
    const mk = () => buildAqueductStructureEntities(
      net([node('source', 'spring', 2, 5)]), [town('t', 20, 5)], baseOpts(elevAt),
    ).map((e) => e.id);
    expect(mk()).toEqual(mk());
  });
});
