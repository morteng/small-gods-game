import { describe, it, expect } from 'vitest';
import { gateApproachPlan, realGateAnchors } from '@/world/connectome/gate-approach';
import { evaluateContracts } from '@/world/connectome-contracts';
import '@/world/connectome/wall-contracts';   // side-effect: register the wall/gate contracts
import type { BarrierRun, PlacedBarrier } from '@/world/barrier';
import type { Connection, POI } from '@/core/types';
import type { DiagnosticContext } from '@/world/connectome-diagnostics';

// A small square town ring with ONE real gate at t=3 → world point (3,0) on the top edge.
const ring: BarrierRun = {
  kind: 'wall', path: [[0, 0], [6, 0], [6, 6], [0, 6], [0, 0]],
  height: 1.5, thickness: 1, material: 'stone', crenellated: true,
  centroid: [3, 3], gates: [{ t: 3, width: 2, kind: 'gate' }],
};
const placed: PlacedBarrier = { id: 'poi:town_ring', run: ring };
const poi = (id: string, x: number, y: number) => ({ id, position: { x, y } } as unknown as POI);

describe('gateApproachPlan — roads lead to gates', () => {
  it('walls a defensive ring as an obstacle and routes the connection through its gate', () => {
    const conns: Connection[] = [{ from: 'poi:town', to: 'poi:far' } as Connection];
    const plan = gateApproachPlan([placed], conns, [poi('poi:town', 3, 3), poi('poi:far', 20, 3)]);

    expect(plan.wallObstacles.size).toBeGreaterThan(0);           // curtain cells are obstacles
    expect(plan.wallObstacles.has('3,0')).toBe(false);            // …but the gate opening is NOT
    const wp = plan.connections[0].waypoints!;
    expect(wp[0]).toEqual({ x: 3, y: 0 });                        // from-endpoint replaced by the gate
    expect(wp[wp.length - 1]).toEqual({ x: 20, y: 3 });           // far end (no ring) unchanged
  });

  it('leaves a connection touching NO ring byte-identical (ringless parity)', () => {
    const conns: Connection[] = [{ from: 'poi:a', to: 'poi:b' } as Connection];
    const plan = gateApproachPlan([], conns, [poi('poi:a', 1, 1), poi('poi:b', 9, 9)]);
    expect(plan.wallObstacles.size).toBe(0);
    expect(plan.connections[0]).toBe(conns[0]);                   // same object reference → untouched
  });

  it('realGateAnchors lists each ring id and its POI id', () => {
    const anchors = realGateAnchors([placed]);
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toMatchObject({ runId: 'poi:town_ring', poiId: 'poi:town', x: 3, y: 0 });
  });
});

// ── Contract fixtures ────────────────────────────────────────────────────────────
function ctxWith(roadCells: [number, number][]): DiagnosticContext {
  const N = 8;
  const tiles = Array.from({ length: N }, () => Array.from({ length: N }, () => ({ type: 'grass', walkable: true })));
  for (const [x, y] of roadCells) tiles[y][x] = { type: 'dirt_road', walkable: true };
  return {
    world: { query: () => [] } as unknown as DiagnosticContext['world'],
    map: { width: N, height: N, tiles, barrierRuns: [placed] } as unknown as DiagnosticContext['map'],
  };
}
const decls = [
  { contract: 'wall.crossing-only-at-gate', scope: { poi: 'poi:town', entities: ['poi:town_ring'] } },
  { contract: 'gate.road-connected', scope: { poi: 'poi:town', entities: ['poi:town_ring'] } },
];

describe('wall/gate contracts', () => {
  it('is clean when the only road meets the gate opening', () => {
    const report = evaluateContracts(ctxWith([[3, 0], [3, 1]]), { declarations: decls });
    expect(report.byRule['wall.crossing-only-at-gate'] ?? 0).toBe(0);
    expect(report.byRule['gate.road-connected'] ?? 0).toBe(0);   // requirement met
    expect(report.unmet).toHaveLength(0);
  });

  it('flags wall.crossing-only-at-gate when a road sits on a curtain cell', () => {
    const report = evaluateContracts(ctxWith([[6, 3]]), { declarations: decls });   // (6,3) = right wall
    expect(report.byRule['wall.crossing-only-at-gate']).toBe(1);
    expect(report.counts.error).toBeGreaterThanOrEqual(1);
  });

  it('flags gate.road-connected (unmet requirement) when no road reaches the gate', () => {
    const report = evaluateContracts(ctxWith([]), { declarations: decls });
    expect(report.byRule['gate.road-connected']).toBe(1);
    expect(report.unmet.map((d) => d.rule)).toContain('gate.road-connected');
    expect(report.unmet[0].suggestedFix?.verb).toBe('wire_gate');
  });
});
