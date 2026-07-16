// tests/unit/bridge-carpentry.test.ts — WCV 101: timber bridges get their carpentry.
// `buildBridgeObject` composition by class, proven against the wooden TTI references:
//  · timber (the default class) → open post-and-rail parapets, not masonry walls;
//  · multi-bay timber → one hump-backed deck PER bay (camber → 0 at the joints, so the deck
//    seats on the structure instead of floating over the mid-span cusp) + a stout joint pier;
//  · log-plank → real BENTS: pile PAIRS at the deck edges with proud heads + a cap beam,
//    not the single centreline stick that read as a dock on stilts.
import { describe, it, expect, beforeAll } from 'vitest';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { buildBridgeObject } from '@/world/connectome/crossing-structures';
import type { CrossingSpec } from '@/world/connectome/crossing-builder';
import type { Entity } from '@/core/types';

beforeAll(() => ensureBuildingTypesRegistered());

/** A seated crossing spec; era/prosperity/roadClass pick the bridge class. */
function spec(over: Partial<CrossingSpec> = {}): CrossingSpec {
  return {
    id: 'crossing@re0#0', waterRef: 'w', spanTiles: 4, roadClass: 'road',
    era: 'late-medieval', prosperity: 'modest',
    banks: [{ x: 10, y: 10 }, { x: 14, y: 10 }],
    bankCells: [[10, 10], [14, 10]],
    axis: [1, 0],
    ...over,
  };
}

type Rb = { parts: Array<{ id: string; type: string; params?: Record<string, unknown> }> };
const partsOf = (e: Entity): Rb['parts'] =>
  ((e.properties as { blueprint: { rb: Rb } }).blueprint.rb).parts;

describe('timber bridges get their carpentry (WCV 101)', () => {
  it('the default timber class rails its deck; dressed stone keeps solid parapets', () => {
    const timber = buildBridgeObject(spec())!;
    const deck = partsOf(timber).find((p) => p.id === 'deck')!;
    expect(deck.params?.parapet).toBe('rails');

    const stone = buildBridgeObject(spec({ prosperity: 'rich', roadClass: 'highway' }))!;
    const sDeck = partsOf(stone).find((p) => p.id === 'deck')!;
    expect(sDeck.params?.parapet).toBe('both');
  });

  it('a LONG timber crossing composes a hump per rib + a stout pier at each bay joint', () => {
    // 20 clear tiles / TILES_PER_ARCH_TIMBER(5) = 4 bays → 4 per-bay decks, 3 joint piers.
    const e = buildBridgeObject(spec({ banks: [{ x: 4, y: 10 }, { x: 24, y: 10 }], bankCells: [[4, 10], [24, 10]], spanTiles: 20 }))!;
    const parts = partsOf(e);
    const decks = parts.filter((p) => p.type === 'deck');
    const joints = parts.filter((p) => p.id.startsWith('jointpier'));
    expect(decks.length).toBe(4);
    expect(joints.length).toBe(3);
    // Every bay deck rides the SAME underside height and carries its OWN hump — sized to the
    // bay, so smaller than a whole-span camber would be (0.12·40 m capped at 1.2 vs 0.12·10 m).
    const base = decks[0].params?.baseZM;
    for (const d of decks) {
      expect(d.params?.baseZM).toBe(base);
      expect(d.params?.parapet).toBe('rails');
      expect(d.params?.camberM as number).toBeCloseTo(Math.min(1.2, 10 * 0.12), 6);
    }
    // The joint pier spans bed → deck underside (it lands the cusp between two ribs).
    for (const j of joints) expect(j.params?.heightM).toBe(base);
  });

  it('a SHORT timber crossing keeps the single deck (no phantom joints)', () => {
    const parts = partsOf(buildBridgeObject(spec())!);
    expect(parts.filter((p) => p.type === 'deck').length).toBe(1);
    expect(parts.some((p) => p.id.startsWith('jointpier'))).toBe(false);
  });

  it('log-plank composes BENTS — pile pairs at the deck edges, proud heads, cap beams', () => {
    const e = buildBridgeObject(spec({ era: 'stone-age', prosperity: 'destitute' }))!;
    const parts = partsOf(e);
    const piles = parts.filter((p) => p.type === 'pier');
    const caps = parts.filter((p) => p.id.startsWith('cap'));
    // spanLen 4 → 2 bents(+1) = 3 stations, each a PAIR of piles + one cap beam.
    expect(piles.length).toBe(6);
    expect(caps.length).toBe(3);
    for (const p of piles) {
      // Piles run PROUD of the deck (above underside + slab) and carry the chunky square head.
      expect(p.params?.headM as number).toBeGreaterThan(0);
      expect(p.params?.heightM as number).toBeGreaterThan(1.2 + 0.6);
    }
    for (const c of caps) {
      expect(c.type).toBe('deck');
      expect(c.params?.parapet).toBe('none');
      // The beam lies ACROSS the span (yawed 90° off the deck bearing), under the planks.
      expect(c.params?.yawDeg as number).toBeCloseTo(90, 3);
    }
    // No rails on the crudest tier — the proud pile heads are the only edge treatment.
    const deck = parts.find((p) => p.id === 'deck')!;
    expect(deck.params?.parapet).toBe('none');
  });
});
