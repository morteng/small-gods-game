// tests/unit/bridge-geometry.test.ts — G4/G5: bridge structural vocabulary.
// deck / pier / arch_span part types emit raw prims through the shared pipeline, so a
// bridge is a composition of these the same way a building is a composition of wings.
import { describe, it, expect, beforeAll } from 'vitest';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { resolveBlueprint } from '@/blueprint/resolve';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { BLUEPRINT_VERSION, type Blueprint } from '@/blueprint/types';

beforeAll(() => ensureBuildingTypesRegistered());

/* eslint-disable @typescript-eslint/no-explicit-any */
function compile(parts: Record<string, any>, materials = { walls: 'stone', roof: 'stone', ground: 'dirt' }) {
  const bp: Blueprint = {
    version: BLUEPRINT_VERSION, class: 'prop', preset: 't', category: 'infrastructure',
    footprint: { w: 4, h: 8 }, materials, parts,
  };
  return toGeometry(resolveBlueprint([bp], 7));
}
const prims = (spec: { parts: any[] }, prim: string) => spec.parts.filter((p) => p.prim === prim);

describe('bridge parts compile to geometry', () => {
  it('deck emits a box; parapet:both adds two side walls', () => {
    const plain = compile({ d: { type: 'deck', size: { w: 3, h: 4 }, params: { lengthM: 8, widthM: 3, parapet: 'none' } } });
    const railed = compile({ d: { type: 'deck', size: { w: 3, h: 4 }, params: { lengthM: 8, widthM: 3, parapet: 'both' } } });
    expect(prims(plain, 'box').length).toBe(1);
    expect(prims(railed, 'box').length).toBe(3);   // deck + 2 parapets
  });

  it('parapets line the deck LONG sides and run its full length — for ns AND ew spans', () => {
    // A parapet must hug the two long edges of the deck and span its whole length; the bug was the
    // ew deck got the ns layout, capping its short ENDS instead. Assert the rails for each axis are
    // long (≈ the deck length) and thin (≈ the rail thickness), oriented along the travel axis.
    const railThin = 0.25 / 2 + 0.01;   // mToTiles(0.25) is small; rails are the thin boxes
    const longTiles = (m: number) => m / 2;  // METRES_PER_TILE = 2
    for (const dir of ['ns', 'ew'] as const) {
      const deck = compile({ d: { type: 'deck', size: { w: 3, h: 6 }, params: { lengthM: 12, widthM: 3, dir, parapet: 'both' } } });
      const boxes = prims(deck, 'box');
      // The two rails are the boxes that are thin on one axis and long on the other.
      const rails = boxes.filter((b) => Math.min(b.size[0], b.size[1]) <= railThin);
      expect(rails.length).toBe(2);
      for (const r of rails) {
        if (dir === 'ns') {
          // long in y (the travel axis), thin in x
          expect(r.size[1]).toBeGreaterThan(longTiles(11));
          expect(r.size[0]).toBeLessThan(railThin + 0.01);
        } else {
          // long in x (the travel axis), thin in y
          expect(r.size[0]).toBeGreaterThan(longTiles(11));
          expect(r.size[1]).toBeLessThan(railThin + 0.01);
        }
      }
    }
  });

  it('a straight pier is a box; a battered pier tapers (prism)', () => {
    const straight = compile({ p: { type: 'pier', size: { w: 1, h: 1 }, params: { heightM: 4, widthM: 1, batter: 0 } } });
    const battered = compile({ p: { type: 'pier', size: { w: 1, h: 1 }, params: { heightM: 4, widthM: 1, batter: 0.3 } } });
    expect(prims(straight, 'box').length).toBe(1);
    expect(prims(battered, 'prism').length).toBe(1);
  });

  it('arch_span emits an arch prim, curved (round) by default', () => {
    const arch = compile({ a: { type: 'arch_span', size: { w: 3, h: 1 }, params: { spanM: 6, riseM: 2.5, thicknessM: 1 } } });
    expect(prims(arch, 'arch').length).toBe(1);
    expect((prims(arch, 'arch')[0] as any).style).toBe('round'); // real curve, not the square portal
  });

  it('arch_span style is selectable (pointed/segmental/flat)', () => {
    const pointed = compile({ a: { type: 'arch_span', size: { w: 3, h: 1 }, params: { spanM: 6, style: 'pointed' } } });
    const flat = compile({ a: { type: 'arch_span', size: { w: 3, h: 1 }, params: { spanM: 6, style: 'flat' } } });
    expect((prims(pointed, 'arch')[0] as any).style).toBe('pointed');
    expect((prims(flat, 'arch')[0] as any).style).toBe('flat');
  });

  it('an arch yaws to spring along the deck axis (ew native, ns turned 90°)', () => {
    const ew = compile({ a: { type: 'arch_span', size: { w: 3, h: 1 }, params: { spanM: 6, dir: 'ew' } } });
    const ns = compile({ a: { type: 'arch_span', size: { w: 1, h: 3 }, params: { spanM: 6, dir: 'ns' } } });
    expect((prims(ew, 'arch')[0] as any).yaw ?? 0).toBe(0);
    expect((prims(ns, 'arch')[0] as any).yaw).toBe(90);
  });

  it('a stone viabridge composes deck + arches + piers in one blueprint', () => {
    const spec = compile({
      deck: { type: 'deck', size: { w: 3, h: 6 }, params: { lengthM: 12, widthM: 3, parapet: 'both' } },
      a1: { type: 'arch_span', at: { x: 0, y: 1 }, size: { w: 3, h: 1 }, params: { spanM: 5 } },
      a2: { type: 'arch_span', at: { x: 0, y: 4 }, size: { w: 3, h: 1 }, params: { spanM: 5 } },
      p1: { type: 'pier', at: { x: 1, y: 0 }, size: { w: 1, h: 1 }, params: { heightM: 4 } },
      p2: { type: 'pier', at: { x: 1, y: 3 }, size: { w: 1, h: 1 }, params: { heightM: 4 } },
    });
    expect(prims(spec, 'arch').length).toBe(2);
    expect(prims(spec, 'box').length).toBeGreaterThanOrEqual(3); // deck + 2 parapets + piers
    expect(spec.parts.some((p) => p.prim === 'building')).toBe(false);
  });
});
