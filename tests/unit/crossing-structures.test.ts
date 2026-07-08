import { describe, it, expect } from 'vitest';
import { buildCrossingStructureEntities } from '@/world/connectome/crossing-structures';
import type { RoadGraph, RoadEdge } from '@/world/road-graph';

const W = 24;
function edge(id: string, polyline: { x: number; y: number }[], partial: Partial<RoadEdge> = {}): RoadEdge {
  return { id, a: `${id}-a`, b: `${id}-b`, polyline, feature: 'road', class: 'road', surface: 'dirt', bridgeCells: [], ...partial };
}

describe('buildCrossingStructureEntities', () => {
  // A WIDE crossing (≥3-tile span) — earns interior piers. bridgeCells span x=8..13 at y=12.
  const wideRich = (): RoadGraph => {
    const poly = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((x) => ({ x, y: 12 }));
    const cells = [8, 9, 10, 11, 12, 13].map((x) => 12 * W + x);
    return { nodes: [], edges: [edge('e', poly, { class: 'highway', bridgeCells: cells })] };
  };

  // A crossing renders as ONE coherent bridge OBJECT (kind 'bridge') whose parts (deck + arch
  // bays / piles) compose in its own space — not a scatter of separately-lifted entities.
  type BPart = { type: string; params: Record<string, unknown>; at?: { x: number; y: number } };
  const bridgeOf = (ents: ReturnType<typeof buildCrossingStructureEntities>) => ents.find((e) => e.kind === 'bridge');
  const partsOf = (e: NonNullable<ReturnType<typeof bridgeOf>>): BPart[] =>
    (e.properties as { blueprint: { rb: { parts: BPart[] } } }).blueprint.rb.parts;

  it('spawns ONE bridge object (deck + arch bays) plus ancillary buildings for a wide rich crossing', () => {
    const ents = buildCrossingStructureEntities(wideRich(), W, { defaults: { era: 'late-medieval', prosperity: 'rich' } });
    const bridge = bridgeOf(ents);
    expect(bridge).toBeDefined();
    const parts = partsOf(bridge!);
    // The span is one object: a deck riding the crowns of a filled-spandrel masonry arcade.
    expect(parts.some((p) => p.type === 'deck')).toBe(true);
    expect(parts.filter((p) => p.type === 'arch_span').length).toBeGreaterThanOrEqual(1);
    // toll/guard/shrine/shop×2/gatehouse/mill → grey-massing ancillary buildings.
    const kinds = new Set(ents.map((e) => e.kind));
    const buildings = ents.filter((e) => (e.properties as any).category === 'building');
    expect(buildings.length).toBeGreaterThanOrEqual(5);
    expect(kinds.has('shrine')).toBe(true);
    expect(kinds.has('guard_post')).toBe(true);
    expect(ents.every((e) => Number.isInteger(e.x) && Number.isInteger(e.y))).toBe(true);
  });

  it('grounds the span on a battered abutment at each bank end', () => {
    // The TTI reference finding: a span must land on masonry end-blocks, not end flush at the
    // footprint edge as a floating slab. Every bridge object carries exactly two `abutment` parts.
    const ents = buildCrossingStructureEntities(wideRich(), W, { defaults: { era: 'late-medieval', prosperity: 'rich' } });
    const abut = partsOf(bridgeOf(ents)!).filter((p) => p.type === 'abutment');
    expect(abut.length).toBe(2);
    // The two sit at opposite ends of the span (distinct origins), each battered (foot flare > 0).
    expect(new Set(abut.map((a) => `${a.at?.x},${a.at?.y}`)).size).toBe(2);
    expect(abut.every((a) => Number(a.params.batter) > 0)).toBe(true);
  });

  it('a humble brook crossing is a plain deck object — no ancillary buildings', () => {
    const poly = [4, 5, 6, 7].map((x) => ({ x, y: 4 }));
    const graph: RoadGraph = { nodes: [], edges: [edge('e', poly, { class: 'path', bridgeCells: [4 * W + 5] })] };
    const ents = buildCrossingStructureEntities(graph, W, { defaults: { era: 'stone-age', prosperity: 'poor' } });
    const bridge = bridgeOf(ents);
    expect(bridge).toBeDefined();
    expect(partsOf(bridge!).some((p) => p.type === 'deck')).toBe(true);
    expect(ents.some((e) => (e.properties as any).category === 'building')).toBe(false);
  });

  it('the whole bridge object is lifted ONCE to the bed elevation (deck rides the crowns above it)', () => {
    const ents = buildCrossingStructureEntities(wideRich(), W, {
      defaults: { era: 'late-medieval', prosperity: 'rich' },
      deckElevAt: () => 0.42, reliefM: 48, zPxPerM: 20,
    });
    const bridge = bridgeOf(ents)!;
    // Flat elevation ⇒ bed == bank == 0.42; the object lifts to it and the deck rides on top.
    expect((bridge.properties as any).liftElev).toBe(0.42);
  });

  it('a multi-tile masonry span composes a row of arch bays in ONE object', () => {
    // A wide late-medieval road over a ~6-tile river → a filled-spandrel arch bridge; the builder
    // sizes one arch per ~3.5 tiles, so the span earns ≥2 arch bays, distinct along the bearing.
    const ents = buildCrossingStructureEntities(wideRich(), W, { defaults: { era: 'late-medieval', prosperity: 'rich' } });
    const arches = partsOf(bridgeOf(ents)!).filter((p) => p.type === 'arch_span');
    expect(arches.length).toBeGreaterThanOrEqual(2);
    // Arch bays march along the span (distinct springing origins), not stacked on one.
    const at = arches.map((p) => `${(p.at ?? { x: 0 }).x?.toFixed(1)},${(p.at ?? { y: 0 }).y?.toFixed(1)}`);
    expect(new Set(at).size).toBe(arches.length);
  });

  it('a DIAGONAL crossing gets ONE straight diagonal deck whose AABB centres on the ford', () => {
    // A road fording water at 45°: bank→bank runs (5,5)→(7,7) over a bridge cell at (6,6). The
    // deck must be ONE straight slab at the TRUE bearing (not snapped to a cardinal stub that
    // floats off the road), its footprint the rotated slab's bounding box centred on the ford.
    const poly = [3, 4, 5, 6, 7, 8, 9].map((d) => ({ x: d, y: d }));
    const graph: RoadGraph = { nodes: [], edges: [edge('e', poly, { class: 'road', bridgeCells: [6 * W + 6] })] };
    const ents = buildCrossingStructureEntities(graph, W, { defaults: { era: 'late-medieval', prosperity: 'modest' } });
    const bridge = bridgeOf(ents);
    expect(bridge).toBeDefined();
    const rb = (bridge!.properties as { blueprint: { rb: { footprint: { w: number; h: number }; parts: BPart[] } } }).blueprint.rb;
    const part = rb.parts.find((p) => p.type === 'deck')!;
    // The deck carries the true 45° bank→bank bearing (not axis-snapped).
    expect(Math.abs(Number(part.params.yawDeg) - 45)).toBeLessThan(2);
    // A rotated slab ⇒ a (near-)square AABB, NOT the w×1 cardinal stub.
    expect(rb.footprint.w).toBe(rb.footprint.h);
    expect(rb.footprint.w).toBeGreaterThanOrEqual(3);
    // The SLAB centres exactly on the ford midpoint (6,6) — the integer entity origin's
    // rounding remainder flows into the part's local offset — so both ends seat on the banks.
    const at = part.at ?? { x: 0, y: 0 };
    expect(bridge!.x + at.x + rb.footprint.w / 2).toBeCloseTo(6, 5);
    expect(bridge!.y + at.y + rb.footprint.h / 2).toBeCloseTo(6, 5);
  });

  it('the deck rides at the crossing CLEARANCE — a deep gorge lifts it higher than a brook', () => {
    // Same wide crossing, two elevation profiles: deep (banks far above the carved bed) vs shallow.
    // The compressed bank−bed clearance drives the deck's baseZM, so deep > shallow.
    const clearance = (bankNorm: number, bedNorm: number): number => {
      const elevAt = (x: number) => (x <= 7 || x >= 14 ? bankNorm : bedNorm); // banks flank the span
      const ents = buildCrossingStructureEntities(wideRich(), W, {
        defaults: { era: 'late-medieval', prosperity: 'rich' },
        deckElevAt: (x) => elevAt(x), reliefM: 60, zPxPerM: 20,
      });
      const deck = partsOf(bridgeOf(ents)!).find((p) => p.type === 'deck')!;
      return Number(deck.params.baseZM);
    };
    const deep = clearance(0.85, 0.15);   // big drop
    const shallow = clearance(0.30, 0.25); // small drop
    expect(deep).toBeGreaterThan(shallow);
  });

  it('is deterministic', () => {
    const poly = [8, 9, 10, 11, 12].map((x) => ({ x, y: 6 }));
    const graph: RoadGraph = { nodes: [], edges: [edge('e', poly, { class: 'road', bridgeCells: [6 * W + 10] })] };
    const a = buildCrossingStructureEntities(graph, W);
    const b = buildCrossingStructureEntities(graph, W);
    expect(a.map((e) => `${e.kind}@${e.x},${e.y}`)).toEqual(b.map((e) => `${e.kind}@${e.x},${e.y}`));
  });

  it('without cellBlocked, positions are unchanged (legacy path is byte-identical)', () => {
    const poly = [8, 9, 10, 11, 12, 13].map((x) => ({ x, y: 10 }));
    const graph: RoadGraph = { nodes: [], edges: [edge('e', poly, { class: 'highway', bridgeCells: [10 * W + 10, 10 * W + 11] })] };
    const legacy = buildCrossingStructureEntities(graph, W, { defaults: { era: 'late-medieval', prosperity: 'rich' } });
    const guarded = buildCrossingStructureEntities(graph, W, {
      defaults: { era: 'late-medieval', prosperity: 'rich' },
      cellBlocked: () => false, // nothing blocked → must match the no-predicate path tile-for-tile
    });
    expect(guarded.map((e) => `${e.kind}@${e.x},${e.y}`)).toEqual(legacy.map((e) => `${e.kind}@${e.x},${e.y}`));
  });

  it('nudges ancillary structures off blocked cells; no solid cell lands on a blocked tile', () => {
    const poly = [8, 9, 10, 11, 12, 13].map((x) => ({ x, y: 10 }));
    const graph: RoadGraph = { nodes: [], edges: [edge('e', poly, { class: 'highway', bridgeCells: [10 * W + 10, 10 * W + 11] })] };
    // Block a fat band straight through where the aprons want to sit (rows 6..14, the inland
    // side) — emulates a settlement abutting the crossing. The road row itself (y=10) is open.
    const blocked = (x: number, y: number) => y >= 6 && y <= 9 && x >= 4 && x <= 18;
    const ents = buildCrossingStructureEntities(graph, W, {
      defaults: { era: 'late-medieval', prosperity: 'rich' },
      cellBlocked: blocked,
    });
    // Every spawned BUILDING's footprint origin clears the band (nudged out or dropped). Deck
    // and piers ride over the water on the road line — they're not subject to the apron nudge.
    const buildings = ents.filter((e) => (e.properties as any).category === 'building');
    for (const e of buildings) {
      expect(blocked(e.x, e.y)).toBe(false);
    }
    // And no two crossing buildings share an origin tile (intra-batch claim works).
    const origins = buildings.map((e) => `${e.x},${e.y}`);
    expect(new Set(origins).size).toBe(origins.length);
  });
});
