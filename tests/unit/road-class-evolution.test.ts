// Road-wear economy S2 — the class ladder as a consumer of `use`. Covers the pure year-pass
// engine (`evolveRoadClasses`): promote-fast/demote-slow hysteresis, the surface wealth gate, the
// king's-highway lord gate, graph.rev bumping, and the closed-form skip projection.
import { describe, it, expect } from 'vitest';
import {
  evolveRoadClasses, projectRoadClassesOverSkip, foldRoadUseInferred,
  PROMOTE_USE, DEMOTE_USE, N_UP, N_DOWN, STONE_WEALTH_MIN, CLASS_APPLY_YEARS,
  type EdgeClassInputs, type RoadUseFoldInputs, type EdgeUse,
} from '@/world/road-use';
import type { RoadEdge, RoadGraph, RoadClass } from '@/world/road-graph';
import { TICKS_PER_YEAR } from '@/sim/mortality';

function edge(id: string, cls: RoadClass, ema01: number, over: Partial<RoadEdge> = {}): RoadEdge {
  const use: EdgeUse = { ema01, tallies: 0, sinceTick: 0 };
  return {
    id, a: `${id}:a`, b: `${id}:b`, polyline: [{ x: 1, y: 1 }, { x: 2, y: 1 }],
    feature: 'road', class: cls, surface: 'dirt', bridgeCells: [], use, ...over,
  };
}
function graph(edges: RoadEdge[], rev = 0): RoadGraph {
  return { nodes: [], edges, rev };
}
/** Inputs with tunable wealth + lord gate; endpoints report fixed poi ids. */
function inputs(over: Partial<EdgeClassInputs> = {}): EdgeClassInputs {
  return {
    wealthFor: () => 0,
    hasLordSeatFor: () => false,
    endpointPoiIds: () => ['A', 'B'],
    ...over,
  };
}

describe('evolveRoadClasses — the class ladder year-pass', () => {
  it('promotes exactly one rung after N_UP consecutive qualifying applies (promote-fast)', () => {
    const g = graph([edge('e', 'path', PROMOTE_USE.track + 0.01)]);
    const inp = inputs();
    // First N_UP-1 applies build the streak but do not move the class.
    for (let i = 0; i < N_UP - 1; i++) {
      const t = evolveRoadClasses(g, inp);
      expect(t).toEqual([]);
      expect(g.edges[0].class).toBe('path');
    }
    const moved = evolveRoadClasses(g, inp);
    expect(g.edges[0].class).toBe('track');
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ edgeId: 'e', from: 'path', to: 'track', fromPoiId: 'A', toPoiId: 'B' });
  });

  it('demotes only after N_DOWN applies — the world forgets slower than it learns', () => {
    const g = graph([edge('e', 'road', DEMOTE_USE.road - 0.01)]);
    const inp = inputs();
    for (let i = 0; i < N_DOWN - 1; i++) {
      expect(evolveRoadClasses(g, inp)).toEqual([]);
      expect(g.edges[0].class).toBe('road');
    }
    const moved = evolveRoadClasses(g, inp);
    expect(g.edges[0].class).toBe('track');
    expect(moved[0]).toMatchObject({ from: 'road', to: 'track' });
    expect(N_DOWN).toBeGreaterThan(N_UP); // the durable asymmetry
  });

  it('the hysteresis dead band breaks both streaks (no flicker)', () => {
    // ema sits BETWEEN DEMOTE_USE.track and PROMOTE_USE.road: a track neither promotes nor demotes.
    const mid = (DEMOTE_USE.track + PROMOTE_USE.road) / 2;
    const g = graph([edge('e', 'track', mid)]);
    const inp = inputs();
    for (let i = 0; i < N_UP + N_DOWN + 2; i++) expect(evolveRoadClasses(g, inp)).toEqual([]);
    expect(g.edges[0].class).toBe('track');
    expect(g.edges[0].use!.streaks).toEqual({ up: 0, down: 0 });
  });

  it('bumps graph.rev exactly once per apply that moves a class, never on a no-op', () => {
    const g = graph([edge('e', 'path', PROMOTE_USE.track + 0.01)], 7);
    const inp = inputs();
    evolveRoadClasses(g, inp); // streak apply 1 (N_UP=2) — no move
    expect(g.rev).toBe(7);
    evolveRoadClasses(g, inp); // apply 2 — promotes
    expect(g.rev).toBe(8);
  });

  it('the streak SURVIVES a use fold between applies (hysteresis accrues across year-passes)', () => {
    // Regression: the year-pass folds `edge.use` THEN steps the class. If the fold wipes streaks,
    // no streak ever reaches N_UP and the class can never move — S2 would be inert in production.
    const g = graph([edge('e', 'path', PROMOTE_USE.track + 0.2)]);
    const inp = inputs();
    const busy: RoadUseFoldInputs = { wealthFor: () => 0, trafficFloorFor: () => 1 };
    let moved = false;
    for (let i = 0; i < N_UP + 1 && !moved; i++) {
      foldRoadUseInferred(g, (i + 1) * TICKS_PER_YEAR, busy); // fold first, exactly as the tick does
      moved = evolveRoadClasses(g, inp).length > 0;
    }
    expect(moved).toBe(true);
    expect(g.edges[0].class).toBe('track');
  });

  it('skips non-road features and edges with no use yet', () => {
    const river = edge('r', 'road', 1, { feature: 'river' });
    const fresh: RoadEdge = { ...edge('f', 'path', 0), use: undefined };
    const g = graph([river, fresh]);
    expect(evolveRoadClasses(g, inputs({ wealthFor: () => 1 }))).toEqual([]);
    expect(g.edges[0].class).toBe('road'); // river untouched
    expect(g.edges[1].class).toBe('path');
  });
});

describe('evolveRoadClasses — the surface wealth gate (§3)', () => {
  function promoteToRoad(wealth: number): RoadEdge {
    const g = graph([edge('e', 'track', PROMOTE_USE.road + 0.01)]);
    const inp = inputs({ wealthFor: () => wealth });
    let last: RoadEdge = g.edges[0];
    for (let i = 0; i < N_UP; i++) { evolveRoadClasses(g, inp); last = g.edges[0]; }
    return last;
  }
  it('a promotion INTO road paves in stone when wealth ≥ STONE_WEALTH_MIN', () => {
    const e = promoteToRoad(STONE_WEALTH_MIN + 0.05);
    expect(e.class).toBe('road');
    expect(e.surface).toBe('stone');
  });
  it('a poor busy road stays wide DIRT below the wealth gate', () => {
    const e = promoteToRoad(STONE_WEALTH_MIN - 0.05);
    expect(e.class).toBe('road');
    expect(e.surface).toBe('dirt');
  });
  it('the transition reports surfaceChanged only when it flipped', () => {
    const rich = graph([edge('e', 'track', PROMOTE_USE.road + 0.01)]);
    const inp = inputs({ wealthFor: () => 1 });
    evolveRoadClasses(rich, inp);
    const tr = evolveRoadClasses(rich, inp)[0];
    expect(tr.surfaceChanged).toBe(true);
  });
});

describe('evolveRoadClasses — the king\'s-highway lord gate (§3)', () => {
  function climbToward(highwayReady: boolean, hasLord: boolean): RoadClass {
    // ema high enough to earn highway; from `road` a single rung remains.
    const g = graph([edge('e', 'road', PROMOTE_USE.highway + 0.01)]);
    const inp = inputs({ hasLordSeatFor: () => hasLord });
    void highwayReady;
    for (let i = 0; i < N_UP + 2; i++) evolveRoadClasses(g, inp);
    return g.edges[0].class;
  }
  it('without a lord seat the edge SATURATES at road (no highway)', () => {
    expect(climbToward(true, false)).toBe('road');
  });
  it('a gripping/garrisoned lord seat unlocks the highway rung', () => {
    expect(climbToward(true, true)).toBe('highway');
  });
});

describe('projectRoadClassesOverSkip — closed-form era of road-building', () => {
  const inferredBusy: RoadUseFoldInputs = { wealthFor: () => 0.9, trafficFloorFor: () => 0.9 };
  const inferredDead: RoadUseFoldInputs = { wealthFor: () => 0, trafficFloorFor: () => 0 };

  it('an era of sustained high importance promotes a path up several rungs (net transition)', () => {
    const g = graph([edge('e', 'path', 0)]);
    const net = projectRoadClassesOverSkip(g, 0, 20 * TICKS_PER_YEAR, inferredBusy, inputs({ wealthFor: () => 0.9, hasLordSeatFor: () => true }));
    expect(g.edges[0].class).toBe('highway'); // climbed to the ceiling over 20 years
    expect(net).toHaveLength(1);
    expect(net[0]).toMatchObject({ edgeId: 'e', from: 'path', to: 'highway', surfaceChanged: true });
  });

  it('the lord gate caps the era at road when no seat funds it', () => {
    const g = graph([edge('e', 'path', 0)]);
    projectRoadClassesOverSkip(g, 0, 20 * TICKS_PER_YEAR, inferredBusy, inputs({ wealthFor: () => 0.9, hasLordSeatFor: () => false }));
    expect(g.edges[0].class).toBe('road');
  });

  it('an abandoned era demotes a road back down the ladder', () => {
    const g = graph([edge('e', 'road', 0)]);
    const net = projectRoadClassesOverSkip(g, 0, 40 * TICKS_PER_YEAR, inferredDead, inputs());
    expect(g.edges[0].class).toBe('path');
    expect(net[0]).toMatchObject({ from: 'road', to: 'path' });
  });

  it('is a no-op for a non-positive span', () => {
    const g = graph([edge('e', 'path', 1)]);
    expect(projectRoadClassesOverSkip(g, 100, 100, inferredBusy, inputs())).toEqual([]);
    expect(g.edges[0].class).toBe('path');
  });

  it('skip-vs-live parity: N inferred year-passes ≡ one skip of N years', () => {
    // Live: fold inferred use + one class apply, once per CLASS_APPLY_YEARS, for 12 years.
    const years = 12;
    const applies = Math.round(years / CLASS_APPLY_YEARS);
    const live = graph([edge('e', 'path', 0)]);
    const liveInp = inputs({ wealthFor: () => 0.9, hasLordSeatFor: () => true });
    for (let k = 0; k < applies; k++) {
      foldRoadUseInferred(live, Math.round(((k + 1) / applies) * years * TICKS_PER_YEAR), inferredBusy);
      evolveRoadClasses(live, liveInp);
    }
    // Skip: the same span in one closed-form call.
    const skip = graph([edge('e', 'path', 0)]);
    projectRoadClassesOverSkip(skip, 0, years * TICKS_PER_YEAR, inferredBusy, inputs({ wealthFor: () => 0.9, hasLordSeatFor: () => true }));
    expect(skip.edges[0].class).toBe(live.edges[0].class);
  });
});
