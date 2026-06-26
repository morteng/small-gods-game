import { describe, it, expect } from 'vitest';
import { buildStairStructureEntities } from '@/world/connectome/stair-structures';
import type { RoadGraph, RoadClass, RoadEdge } from '@/world/road-graph';

function edge(id: string, cls: RoadClass, poly: Array<[number, number]>): RoadEdge {
  return {
    id, a: `${id}-a`, b: `${id}-b`,
    polyline: poly.map(([x, y]) => ({ x, y })),
    feature: 'road', class: cls, surface: 'dirt', bridgeCells: [],
  };
}
function graph(edges: RoadEdge[]): RoadGraph {
  return { nodes: [], edges };
}

/** A normalised-elevation field: ramp in x at the given per-tile grade. */
function ramp(gradePerTile: number) {
  return (x: number, _y: number) => x * gradePerTile;
}

const RELIEF = 48; // metres per normalised unit (default world style)

describe('buildStairStructureEntities — stairs pop out of the connectome', () => {
  it('sites a stair flight where a road climbs steeper than its class walkability grade', () => {
    // path stair-grade = 0.33 (rise/run); with relief 48 the g-threshold is 0.33·2/48 ≈ 0.014.
    // A 0.2/tile ramp (actual grade 0.2·48/2 = 4.8) is far over it.
    const g = graph([edge('e1', 'path', [[2, 5], [4, 5], [6, 5], [8, 5]])]);
    const ents = buildStairStructureEntities(g, { elevAt: ramp(0.2), reliefM: RELIEF });
    // A long steep ramp earns one or more bounded flights; the first foots at the lower end.
    expect(ents.length).toBeGreaterThanOrEqual(1);
    expect(ents[0].x).toBe(2);
    expect(ents[0].kind).toBeTruthy();
  });

  it('follows a long climb with STACKED flights (not one billboard), each lifted to its terrain', () => {
    // A 12-tile steep path. Each ~4-tile segment that stays over-grade earns its own flight, so a
    // long climb reads as a run of stacked flights riding the slope — not one tower into the air.
    const poly: Array<[number, number]> = [
      [2, 5], [4, 5], [6, 5], [8, 5], [10, 5], [12, 5], [14, 5],
    ];
    const lifts: number[] = [];
    const ents = buildStairStructureEntities(graph([edge('e1', 'path', poly)]), {
      elevAt: ramp(0.2), reliefM: RELIEF,
      liftElevAt: (x) => x,   // record the per-flight foot lift
    });
    for (const e of ents) lifts.push((e.properties as { liftElev?: number }).liftElev ?? NaN);
    expect(ents.length).toBeGreaterThanOrEqual(2);            // more than one flight up the climb
    expect(new Set(ents.map((e) => `${e.x},${e.y}`)).size).toBe(ents.length);  // no two share a foot
    // Flights climb the slope: each successive foot sits higher than the last.
    for (let i = 1; i < lifts.length; i++) expect(lifts[i]).toBeGreaterThan(lifts[i - 1]);
  });

  it('does NOT site a stair on a road gentle enough to roll', () => {
    // road g-threshold ≈ 0.18·2/48 = 0.0075; a 0.005/tile ramp (actual grade 0.12) rolls fine.
    const g = graph([edge('e1', 'road', [[2, 5], [4, 5], [6, 5], [8, 5]])]);
    const ents = buildStairStructureEntities(g, { elevAt: ramp(0.005), reliefM: RELIEF });
    expect(ents.length).toBe(0);
  });

  it('a highway wants steps at a gentler grade than a footpath (lower threshold → more stairs)', () => {
    const poly: Array<[number, number]> = [[2, 5], [4, 5], [6, 5], [8, 5]];
    // g 0.008: over highway's 0.005 threshold, under track's 0.0104 — so highway stairs, track rolls.
    const field = ramp(0.008);
    const hw = buildStairStructureEntities(graph([edge('h', 'highway', poly)]), { elevAt: field, reliefM: RELIEF });
    const tr = buildStairStructureEntities(graph([edge('t', 'track', poly)]), { elevAt: field, reliefM: RELIEF });
    expect(hw.length).toBe(1);   // a cart highway can't take this grade → stairs
    expect(tr.length).toBe(0);   // a track still rolls it → no stairs
  });

  it('orients the flight to climb toward the higher end', () => {
    // Uphill toward +x ⇒ climb dir east. Place the flight; the part dir lands in params.
    const g = graph([edge('e1', 'path', [[2, 5], [5, 5], [8, 5]])]);
    const ents = buildStairStructureEntities(g, { elevAt: ramp(0.2), reliefM: RELIEF });
    expect(ents).toHaveLength(1);
    const e = ents[0];
    // The flight is a 'prop' entity placed at the lower (foot) end, x≈2.
    expect(e.x).toBe(2);
  });

  it('skips a flight whose foot lands on a blocked (water/building) tile', () => {
    const g = graph([edge('e1', 'path', [[2, 5], [4, 5], [6, 5], [8, 5]])]);
    const ents = buildStairStructureEntities(g, {
      elevAt: ramp(0.2), reliefM: RELIEF,
      cellBlocked: () => true,   // every candidate foot is blocked
    });
    expect(ents.length).toBe(0);
  });

  it('is deterministic — same graph + field ⇒ identical entity ids', () => {
    const mk = () => buildStairStructureEntities(
      graph([edge('e1', 'path', [[2, 5], [4, 5], [6, 5], [8, 5]])]),
      { elevAt: ramp(0.2), reliefM: RELIEF },
    );
    expect(mk().map((e) => e.id)).toEqual(mk().map((e) => e.id));
  });

  it('ignores non-road features (rivers, walls)', () => {
    const riverEdge: RoadEdge = { ...edge('r', 'path', [[2, 5], [8, 5]]), feature: 'river' };
    const ents = buildStairStructureEntities(graph([riverEdge]), { elevAt: ramp(0.3), reliefM: RELIEF });
    expect(ents.length).toBe(0);
  });
});
