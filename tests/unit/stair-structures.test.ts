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
    // A 0.04/tile ramp (actual grade 0.04·48/2 = 0.96) is well over it, and a 4-tile chunk lifts
    // 0.04·4·48 = 7.68 m — a steep-but-WALKABLE flight, just under the 8 m single-flight rise cap.
    const g = graph([edge('e1', 'path', [[2, 5], [4, 5], [6, 5], [8, 5]])]);
    const ents = buildStairStructureEntities(g, { elevAt: ramp(0.04), reliefM: RELIEF });
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
      elevAt: ramp(0.04), reliefM: RELIEF,   // 7.68 m per 4-tile chunk — under the cap, so it stacks
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
    expect(hw.length).toBeGreaterThanOrEqual(1);   // a cart highway can't take this grade → stairs (one run, sub-stacked)
    expect(tr.length).toBe(0);   // a track still rolls it → no stairs
  });

  it('orients the flight to climb toward the higher end', () => {
    // Uphill toward +x ⇒ climb dir east. The first flight foots at the lower (foot) end, x≈2.
    const g = graph([edge('e1', 'path', [[2, 5], [5, 5], [8, 5]])]);
    const ents = buildStairStructureEntities(g, { elevAt: ramp(0.04), reliefM: RELIEF });
    expect(ents.length).toBeGreaterThanOrEqual(1);
    expect(ents[0].x).toBe(2);   // a 'prop' entity placed at the lower (foot) end
  });

  it('only sites stairs on cardinal road runs that CONNECT — a pure-diagonal climb gets none', () => {
    // The connection contract (user: "make sure they connect"): a stair flight is cardinal-oriented
    // (the engine has no per-entity rotation), so it can only land its head on the road when the run
    // it sits on is cardinal. A cardinal east climb gets flights whose feet sit ON the road line; a
    // pure 45° diagonal climb gets NONE (every cardinal sub-run is a single tile, below MIN_RUN) —
    // a floating, disconnected stair is worse than no stair (the road carve still climbs the grade).
    const card: Array<[number, number]> = [[2, 5], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5], [8, 5]];
    const cEnts = buildStairStructureEntities(graph([edge('c', 'path', card)]),
      { elevAt: (x, y) => (x + y) * 0.04, reliefM: RELIEF });
    expect(cEnts.length).toBeGreaterThanOrEqual(1);
    for (const e of cEnts) expect(card.some(([x, y]) => x === e.x && y === e.y)).toBe(true);  // foot on road

    const diag: Array<[number, number]> = Array.from({ length: 9 }, (_, i) => [2 + i, 5 + i]);
    const dEnts = buildStairStructureEntities(graph([edge('d', 'path', diag)]),
      { elevAt: (x, y) => (x + y) * 0.04, reliefM: RELIEF });
    expect(dEnts.length).toBe(0);   // no floating stair on a pure diagonal
  });

  it('skips a flight whose foot lands on a blocked (water/building) tile', () => {
    const g = graph([edge('e1', 'path', [[2, 5], [4, 5], [6, 5], [8, 5]])]);
    const ents = buildStairStructureEntities(g, {
      elevAt: ramp(0.04), reliefM: RELIEF,   // would stair (under the cap) but for the block
      cellBlocked: () => true,   // every candidate foot is blocked
    });
    expect(ents.length).toBe(0);
  });

  it('caps a single flight — a cliff-steep bank yields NO monument stair (the giant-stairs bug)', () => {
    // A 0.2/tile ramp (grade 0.2·48/2 = 4.8, ~78°) lifts 0.2·4·48 = 38.4 m over a 4-tile chunk. That
    // is not a walkable flight but a cliff; left uncapped it built a 10-to-20-tile-tall standalone
    // MONUMENT. MAX_STAIR_RISE_M (8 m) skips it — the road keeps its carved bank, unstaired.
    const g = graph([edge('e1', 'path', [[2, 5], [4, 5], [6, 5], [8, 5]])]);
    const ents = buildStairStructureEntities(g, { elevAt: ramp(0.2), reliefM: RELIEF });
    expect(ents.length).toBe(0);
  });

  it('suppresses a flight on a river-crossing bank (nearCrossing) — a bridge belongs there', () => {
    // A perfectly stair-worthy grade (0.04/tile, 7.68 m per chunk, under the cap) that would
    // normally place ≥1 flight is suppressed entirely when its cells sit on a crossing bank — the
    // steep drop there is the incised channel a BRIDGE spans, the locus of the orphaned monument.
    const g = graph([edge('e1', 'path', [[2, 5], [4, 5], [6, 5], [8, 5]])]);
    const staired = buildStairStructureEntities(g, { elevAt: ramp(0.04), reliefM: RELIEF });
    expect(staired.length).toBeGreaterThanOrEqual(1);                 // baseline: it WOULD stair
    const suppressed = buildStairStructureEntities(g, {
      elevAt: ramp(0.04), reliefM: RELIEF, nearCrossing: () => true,  // every cell is a crossing bank
    });
    expect(suppressed.length).toBe(0);
  });

  it('is deterministic — same graph + field ⇒ identical entity ids', () => {
    const mk = () => buildStairStructureEntities(
      graph([edge('e1', 'path', [[2, 5], [4, 5], [6, 5], [8, 5]])]),
      { elevAt: ramp(0.04), reliefM: RELIEF },
    );
    expect(mk().map((e) => e.id)).toEqual(mk().map((e) => e.id));
  });

  it('ignores non-road features (rivers, walls)', () => {
    const riverEdge: RoadEdge = { ...edge('r', 'path', [[2, 5], [8, 5]]), feature: 'river' };
    const ents = buildStairStructureEntities(graph([riverEdge]), { elevAt: ramp(0.3), reliefM: RELIEF });
    expect(ents.length).toBe(0);
  });
});
