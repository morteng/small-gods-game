import { describe, it, expect } from 'vitest';
import { planAqueducts, type SettlementSite, type WaterSource } from '@/world/connectome/aqueduct-placement';

const town = (id: string, x: number, y: number): SettlementSite => ({ id, x, y });
const spring = (id: string, x: number, y: number): WaterSource => ({ id, x, y });

describe('planAqueducts — aqueducts emerge from source→demand', () => {
  // A plane descending 1 m/tile toward +x (reliefM 1 ⇒ elevAt is metres); maxGrade 0.6 lets a
  // channel hug it as surface.
  const plane = { elevAt: (x: number) => 30 - x, reliefM: 1, width: 40, height: 16, maxGrade: 0.6 };

  it('routes one feasible aqueduct from a highland source to a dry town below it', () => {
    const plans = planAqueducts([town('riverside', 20, 5)], [spring('peak', 2, 5)], plane);
    expect(plans).toHaveLength(1);
    expect(plans[0].sourceId).toBe('peak');
    expect(plans[0].settlementId).toBe('riverside');
    expect(plans[0].profile.feasible).toBe(true);
    expect(plans[0].route[0]).toEqual({ x: 2, y: 5 });
    expect(plans[0].route[plans[0].route.length - 1]).toEqual({ x: 20, y: 5 });
    expect(plans[0].structuralCostM).toBeCloseTo(0, 3);   // all-surface line over the open slope
  });

  it('builds nothing when the only source lacks the head to feed the town', () => {
    // Source at x=18 (elev 12) is barely above the town at x=20 (elev 10): head 2 m < minHead 6.
    const plans = planAqueducts([town('t', 20, 5)], [spring('lowknoll', 18, 5)], plane);
    expect(plans).toHaveLength(0);
  });

  it('skips a source beyond the routing budget', () => {
    const plans = planAqueducts([town('t', 30, 5)], [spring('faraway', 2, 5)],
      { ...plane, maxRouteTiles: 10 });   // 28 tiles away > budget
    expect(plans).toHaveLength(0);
  });

  it('prefers a feasible source over one whose route a tall ridge makes infeasible', () => {
    // A full-height ridge wall (elev 40) at x=23..25 separates the eastern source from the town; the
    // western source reaches it downhill. Both clear head + distance, but only the west is feasible.
    const elevAt = (x: number) => {
      if (x >= 23 && x <= 25) return 40;
      return 5 + Math.abs(x - 20);   // V-valley: town at the floor, ground rises away from it
    };
    const opts = { elevAt, reliefM: 1, width: 40, height: 20, maxGrade: 0.6, cutDepthMaxM: 8 };
    const plans = planAqueducts([town('valleytown', 20, 10)],
      [spring('westhill', 10, 10), spring('easthill', 30, 10)], opts);
    expect(plans).toHaveLength(1);
    expect(plans[0].sourceId).toBe('westhill');   // east is walled off by the ridge → infeasible
    expect(plans[0].profile.feasible).toBe(true);
  });

  it('honours the demand gate — a town that needs no aqueduct gets none', () => {
    const plans = planAqueducts([town('wet', 20, 5)], [spring('peak', 2, 5)],
      { ...plane, needsAqueduct: () => false });
    expect(plans).toHaveLength(0);
  });

  it('counts the deck length when the line must arch across a gorge', () => {
    // A gorge (floor 2 m) at x=9..13 the gentle grade cannot descend into ⇒ an elevated run.
    const elevAt = (x: number) => (x >= 9 && x <= 13 ? 2 : 25 - 0.5 * x);
    const opts = { elevAt, reliefM: 1, width: 40, height: 16, maxGrade: 0.6 };
    const plans = planAqueducts([town('downstream', 20, 5)], [spring('source', 2, 5)], opts);
    expect(plans).toHaveLength(1);
    expect(plans[0].structuralCostM).toBeGreaterThan(0);
    expect(plans[0].profile.stations.some((s) => s.mode === 'elevated')).toBe(true);
  });

  it('serves multiple towns independently, in a deterministic order', () => {
    const towns = [town('beta', 22, 5), town('alpha', 18, 11)];
    const sources = [spring('s1', 2, 5), spring('s2', 2, 11)];
    const plans = planAqueducts(towns, sources, plane);
    expect(plans.map((p) => p.settlementId)).toEqual(['alpha', 'beta']);   // id-sorted, both served
    expect(plans.every((p) => p.profile.feasible)).toBe(true);
  });

  it('is deterministic — same world ⇒ identical plans', () => {
    const towns = [town('t', 20, 5)];
    const sources = [spring('a', 2, 3), spring('b', 2, 9)];
    const mk = () => planAqueducts(towns, sources, plane);
    expect(JSON.stringify(mk())).toEqual(JSON.stringify(mk()));
  });
});
