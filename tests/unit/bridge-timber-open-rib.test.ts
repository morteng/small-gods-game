// A TIMBER arch is an open rib; a MASONRY arch is a filled spandrel — and either way the ring
// has to reach the deck it carries.
//
// Both pins guard the same class of defect: `buildBridgeObject` (the path the GAME uses) composes
// its parts by hand and had drifted from `BRIDGE_RECIPES` (the path the STUDIO renders), so the
// studio's bridges looked right while every bridge in the world did not. Reported from live play:
// "the arched wood bridge appears to have a huge flat block of wood under the arch span".
//
//  1. OPEN RIB — `arch_span` defaults to a filled spandrel WALL drawn in the bridge's own material.
//     On a timber bridge that is a solid slab of wood filling the space between ring and deck. The
//     recipe has always passed `openRib` for its timber arch (`presets/bridges.ts`); this path
//     never learned to.
//  2. THE RING REACHES THE DECK — a cambered deck lifts its whole segment, underside included
//     (`z0 = baseZ + camber·(1−t²)`, `parts/bridge.ts`), so the deck underside at MID-SPAN is
//     `baseZM + camberM`. Solving the arch rise against the deck's END height alone leaves the
//     crown a full camber short. Masonry hid that gap behind its filled spandrel; an open timber
//     rib cannot, so it would hang visibly under its own deck.
import { describe, it, expect } from 'vitest';
import { buildBridgeObject } from '@/world/connectome/crossing-structures';
import type { CrossingSpec } from '@/world/connectome/crossing-builder';
import type { Entity } from '@/core/types';

/** A seated crossing wide enough to earn an arch, tuned by era/prosperity to pick its class. */
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

interface ResolvedLike { id: string; type?: string; params?: Record<string, unknown> }

function parts(e: Entity): ResolvedLike[] {
  const rb = (e.properties as { blueprint: { rb: { parts: ResolvedLike[] } } }).blueprint.rb;
  return rb.parts;
}
const archesOf = (e: Entity) => parts(e).filter((p) => p.id.startsWith('arch'));
const deckOf = (e: Entity) => parts(e).find((p) => p.id === 'deck')!;

describe('timber arches are open ribs, masonry arches are filled', () => {
  it('a TIMBER arch declares openRib — no filled spandrel wall in the bridge material', () => {
    const e = buildBridgeObject(spec({ era: 'early-medieval', prosperity: 'poor' }));
    expect(e, 'the crossing builds a bridge').toBeTruthy();
    const arches = archesOf(e!);
    expect(arches.length, 'a timber crossing is arched').toBeGreaterThan(0);
    for (const a of arches) {
      // THE regression: unset ⇒ the arch prim fills its spandrel, and the fill takes the bridge's
      // own `walls` material, which for this class is timber.
      expect(a.params?.openRib, `${a.id} is an open rib`).toBe(true);
    }
  });

  it('a DRESSED-STONE arch does NOT — that mass is the structure', () => {
    const e = buildBridgeObject(spec({ era: 'late-medieval', prosperity: 'rich', roadClass: 'highway', spanTiles: 8 }));
    expect(e).toBeTruthy();
    const arches = archesOf(e!);
    expect(arches.length).toBeGreaterThan(0);
    for (const a of arches) expect(a.params?.openRib, `${a.id} stays filled`).toBeUndefined();
  });
});

describe('the arch ring reaches the deck it carries', () => {
  // `riseM + ringDepthM` is the top of the ring; the deck underside at mid-span is
  // `baseZM + camberM`. They must meet, or the rib hangs under the deck (open) / the spandrel
  // stretches to cover the gap (filled).
  for (const [label, s] of [
    ['timber', spec({ era: 'early-medieval', prosperity: 'poor' })],
    ['dressed stone', spec({ era: 'late-medieval', prosperity: 'rich', roadClass: 'highway', spanTiles: 8 })],
  ] as const) {
    it(`${label}: ring top meets the deck underside at the crown`, () => {
      const e = buildBridgeObject(s);
      expect(e).toBeTruthy();
      const deck = deckOf(e!);
      const baseZM = deck.params?.baseZM as number;
      const camberM = (deck.params?.camberM as number) ?? 0;
      const crownUnderside = baseZM + camberM;
      for (const a of archesOf(e!)) {
        const ringTop = (a.params?.riseM as number) + (a.params?.ringDepthM as number);
        // Exact by construction (the rise is SOLVED from this), bar the 0.8 m rise floor on a
        // very shallow crossing — which can only push the ring UP into the deck, never short.
        expect(ringTop, `${a.id} ring top vs deck underside`).toBeGreaterThanOrEqual(crownUnderside - 1e-9);
      }
    });
  }

  it('the deck underside still rides proud of its bank (the seating invariant is untouched)', () => {
    // Guards the fix that was BACKED OUT: dropping the deck ends to "land on the bank" like the
    // studio recipe's moon bridge buries them, because `clearZM` already carries the freeboard.
    // See tests/unit/bridge-deck-carries-road.test.ts for the metric form of this contract.
    const e = buildBridgeObject(spec({ era: 'early-medieval', prosperity: 'poor' }));
    expect((deckOf(e!).params?.baseZM as number)).toBeGreaterThan(0);
  });
});
