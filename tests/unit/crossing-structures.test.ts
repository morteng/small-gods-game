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

  it('spawns grey-massing structures (deck + piers + ancillary buildings) for a wide rich crossing', () => {
    const ents = buildCrossingStructureEntities(wideRich(), W, { defaults: { era: 'late-medieval', prosperity: 'rich' } });
    const kinds = new Set(ents.map((e) => e.kind));
    // The span itself now renders: a deck + supporting piers (wide span earns piers, G5).
    expect(kinds.has('bridge_deck')).toBe(true);
    expect(ents.some((e) => e.kind === 'bridge_pier')).toBe(true);
    // Piers sit on DISTINCT tiles (short-span collapse is deduped).
    const pierTiles = ents.filter((e) => e.kind === 'bridge_pier').map((e) => `${e.x},${e.y}`);
    expect(new Set(pierTiles).size).toBe(pierTiles.length);
    // A wealthy late-medieval highway crossing is a masonry ARCHED bridge — arch bays now render.
    expect(ents.some((e) => e.kind === 'bridge_arch')).toBe(true);
    // toll/guard/shrine/shop×2/gatehouse/mill → grey-massing ancillary buildings.
    const buildings = ents.filter((e) => (e.properties as any).category === 'building');
    expect(buildings.length).toBeGreaterThanOrEqual(5);
    expect(kinds.has('shrine')).toBe(true);
    expect(kinds.has('guard_post')).toBe(true);
    expect(ents.every((e) => Number.isInteger(e.x) && Number.isInteger(e.y))).toBe(true);
  });

  it('a narrow brook crossing rests on its banks — a clean deck, no interior piers', () => {
    const poly = [4, 5, 6, 7].map((x) => ({ x, y: 4 }));
    const graph: RoadGraph = { nodes: [], edges: [edge('e', poly, { class: 'path', bridgeCells: [4 * W + 5] })] };
    const ents = buildCrossingStructureEntities(graph, W, { defaults: { era: 'stone-age', prosperity: 'poor' } });
    expect(ents.filter((e) => e.kind === 'bridge_deck')).toHaveLength(1);
    // Span < 3 tiles ⇒ no interior piers (no stacked clutter).
    expect(ents.filter((e) => e.kind === 'bridge_pier')).toHaveLength(0);
    expect(ents.some((e) => (e.properties as any).category === 'building')).toBe(false);
  });

  it('deck rides its bank elevation (liftElev); piers stay grounded (foot-sampled)', () => {
    const ents = buildCrossingStructureEntities(wideRich(), W, {
      defaults: { era: 'late-medieval', prosperity: 'rich' },
      deckElevAt: () => 0.42,
    });
    const deck = ents.find((e) => e.kind === 'bridge_deck')!;
    expect((deck.properties as any).liftElev).toBe(0.42);
    const pier = ents.find((e) => e.kind === 'bridge_pier')!;
    expect((pier.properties as any).liftElev).toBeUndefined();
  });

  it('a multi-tile masonry span marches a row of arches between its piers', () => {
    // A wide late-medieval road over a 6-tile river → an arched stone bridge. The builder sizes
    // arches at ~one per 3 tiles, so a ~6-tile span earns ≥2 arch bays sitting between the piers.
    const ents = buildCrossingStructureEntities(wideRich(), W, { defaults: { era: 'late-medieval', prosperity: 'rich' } });
    const arches = ents.filter((e) => e.kind === 'bridge_arch');
    expect(arches.length).toBeGreaterThanOrEqual(2);
    // Arches march along the span (distinct tiles), not stacked on one.
    expect(new Set(arches.map((e) => `${e.x},${e.y}`)).size).toBe(arches.length);
    // An arch billboards from the bed like a pier — no liftElev.
    expect(arches.every((e) => (e.properties as any).liftElev === undefined)).toBe(true);
  });

  it('a DIAGONAL crossing gets ONE straight diagonal deck whose AABB centres on the ford', () => {
    // A road fording water at 45°: bank→bank runs (5,5)→(7,7) over a bridge cell at (6,6). The
    // deck must be ONE straight slab at the TRUE bearing (not snapped to a cardinal stub that
    // floats off the road), its footprint the rotated slab's bounding box centred on the ford.
    const poly = [3, 4, 5, 6, 7, 8, 9].map((d) => ({ x: d, y: d }));
    const graph: RoadGraph = { nodes: [], edges: [edge('e', poly, { class: 'road', bridgeCells: [6 * W + 6] })] };
    const ents = buildCrossingStructureEntities(graph, W, { defaults: { era: 'late-medieval', prosperity: 'modest' } });
    const decks = ents.filter((e) => e.kind === 'bridge_deck');
    expect(decks).toHaveLength(1);
    const deck = decks[0];
    const rb = (deck.properties as { blueprint: { rb: { footprint: { w: number; h: number }; parts: Array<{ type: string; params: Record<string, unknown> }> } } }).blueprint.rb;
    const part = rb.parts.find((p) => p.type === 'deck')!;
    // The deck carries the true 45° bank→bank bearing (not axis-snapped).
    expect(Math.abs(Number(part.params.yawDeg) - 45)).toBeLessThan(2);
    // A rotated slab ⇒ a (near-)square AABB, NOT the w×1 cardinal stub.
    expect(rb.footprint.w).toBe(rb.footprint.h);
    expect(rb.footprint.w).toBeGreaterThanOrEqual(3);
    // The SLAB centres exactly on the ford midpoint (6,6) — the integer entity origin's
    // rounding remainder flows into the part's local offset — so both ends seat on the banks.
    const at = (part as unknown as { at?: { x: number; y: number } }).at ?? { x: 0, y: 0 };
    expect(deck.x + at.x + rb.footprint.w / 2).toBeCloseTo(6, 5);
    expect(deck.y + at.y + rb.footprint.h / 2).toBeCloseTo(6, 5);
  });

  it('pier/arch HEIGHT tracks the crossing depth — a deep gorge earns taller piers than a brook', () => {
    // Same wide crossing, two elevation profiles: deep (banks far above the carved bed) vs shallow.
    // The clearance (bank − bed)·relief drives pier height, so deep > shallow.
    const pierH = (bankNorm: number, bedNorm: number): number => {
      const elevAt = (x: number) => (x <= 7 || x >= 14 ? bankNorm : bedNorm); // banks flank the span
      const ents = buildCrossingStructureEntities(wideRich(), W, {
        defaults: { era: 'late-medieval', prosperity: 'rich' },
        elevAt: (x) => elevAt(x), reliefM: 60,
      });
      const pier = ents.find((e) => e.kind === 'bridge_pier')!;
      const rb = (pier.properties as { blueprint: { rb: { parts: Array<{ type: string; params: Record<string, unknown> }> } } }).blueprint.rb;
      return Number(rb.parts.find((p) => p.type === 'pier')!.params.heightM);
    };
    const deep = pierH(0.85, 0.15);   // ~42 m drop
    const shallow = pierH(0.30, 0.25); // ~3 m drop
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
