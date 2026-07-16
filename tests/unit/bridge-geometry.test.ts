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

  it('parapets line the deck LONG sides, run its full length, and YAW with the span', () => {
    // A parapet hugs the two long edges and spans the whole length. The deck is now built in ONE
    // canonical local frame (long axis = +x, size [len, thin]) and ORIENTED by a `yaw` field, so a
    // diagonal ford gets a diagonal deck. A cardinal `dir` maps to that yaw: ew → 0°, ns → 90°.
    const railThin = 0.25 / 2 + 0.01;   // mToTiles(0.25) is small; rails are the thin boxes
    const longTiles = (m: number) => m / 2;  // METRES_PER_TILE = 2
    for (const [dir, wantYaw] of [['ns', 90], ['ew', 0]] as const) {
      const deck = compile({ d: { type: 'deck', size: { w: 3, h: 6 }, params: { lengthM: 12, widthM: 3, dir, parapet: 'both' } } });
      const boxes = prims(deck, 'box');
      const rails = boxes.filter((b) => Math.min(b.size[0], b.size[1]) <= railThin);
      expect(rails.length).toBe(2);
      for (const r of rails) {
        // Long along local +x (the run), thin across (the rail thickness), yawed onto the travel axis.
        expect(r.size[0]).toBeGreaterThan(longTiles(11));
        expect(r.size[1]).toBeLessThan(railThin + 0.01);
        expect(((r.yaw ?? 0) % 180 + 180) % 180).toBeCloseTo(wantYaw, 3);
      }
    }
  });

  it('a diagonal span yaws the WHOLE deck (slab + both parapets) to its true bearing', () => {
    // The core of the diagonal-bridge work: a `yawDeg` (true bank→bank bearing) overrides `dir`, so
    // a 45° ford gets one straight 45° deck — slab and parapets share the bearing — not a cardinal stub.
    const deck = compile({ d: { type: 'deck', size: { w: 5, h: 5 }, params: { lengthM: 12, widthM: 3, yawDeg: 45, parapet: 'both' } } });
    const boxes = prims(deck, 'box');
    expect(boxes.length).toBe(3);                       // slab + 2 parapets
    for (const b of boxes) expect(b.yaw).toBeCloseTo(45, 3);
  });

  it("parapet:'rails' composes an OPEN post-and-rail — rails per side plus PROUD posts (WCV 101)", () => {
    // The wooden-bridge edge every TTI reference draws: a top handrail + mid rail per side,
    // square posts whose heads stand proud of the top rail. A flat 8 m deck = 1 slab + 2 sides
    // × 2 rails + posts on both sides.
    const railed = compile({ d: { type: 'deck', size: { w: 4, h: 4 }, params: { lengthM: 8, widthM: 3, thicknessM: 0.5, parapet: 'rails' } } });
    const boxes = prims(railed, 'box') as any[];
    const rails = boxes.filter((b) => b.size[2] <= 0.1 / 2 + 1e-6);        // thin horizontal bars
    const posts = boxes.filter((b) => Math.abs(b.size[0] - b.size[1]) < 1e-6 && b.size[2] > 0.4);
    expect(rails.length).toBe(4);                                          // 2 sides × (top + mid)
    expect(posts.length).toBeGreaterThanOrEqual(2 * 2);                    // ≥2 stations, both sides
    // Post heads stand PROUD of the top rail (post top above rail top).
    const postTop = Math.max(...posts.map((b) => b.at[2] + b.size[2]));
    const railTop = Math.max(...rails.map((b) => b.at[2] + b.size[2]));
    expect(postTop).toBeGreaterThan(railTop);
    // Additive: 'none' and 'both' are byte-identical to the pre-rails deck.
    const plain = compile({ d: { type: 'deck', size: { w: 4, h: 4 }, params: { lengthM: 8, widthM: 3, thicknessM: 0.5, parapet: 'none' } } });
    expect(prims(plain, 'box').length).toBe(1);
  });

  it('a pier IS a square Column; batter is a TRUE taper (top half-width shrinks)', () => {
    const straight = compile({ p: { type: 'pier', size: { w: 1, h: 1 }, params: { heightM: 4, widthM: 1, batter: 0 } } });
    const battered = compile({ p: { type: 'pier', size: { w: 1, h: 1 }, params: { heightM: 4, widthM: 1, batter: 0.3 } } });
    const sCol = prims(straight, 'column')[0] as any;
    const bCol = prims(battered, 'column')[0] as any;
    expect(sCol).toBeDefined();
    expect(sCol.shape).toBe('square');
    // straight: top == base; battered: top narrower than base (real diminution, not a fake prism)
    expect(sCol.topRadius).toBeCloseTo(sCol.radius, 6);
    expect(bCol.topRadius).toBeLessThan(bCol.radius);
    expect(bCol.topRadius).toBeCloseTo(bCol.radius * 0.7, 6);
  });

  it('pier.headM caps the pile with a chunky proud head; unset stays a bare column (WCV 101)', () => {
    const bare = compile({ p: { type: 'pier', size: { w: 1, h: 1 }, params: { heightM: 3, widthM: 0.35 } } });
    const headed = compile({ p: { type: 'pier', size: { w: 1, h: 1 }, params: { heightM: 3, widthM: 0.35, headM: 0.22 } } });
    expect(prims(bare, 'box').length).toBe(0);                 // byte-identical historic pier
    const head = prims(headed, 'box')[0] as any;
    expect(head).toBeDefined();
    const shaft = prims(headed, 'column')[0] as any;
    // Head sits ON the shaft top and overhangs it on every side (1.4× the shaft width).
    expect(head.at[2]).toBeCloseTo(shaft.height, 6);
    expect(head.size[0]).toBeCloseTo(shaft.radius * 2 * 1.4, 6);
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

  it('an explicit yawDeg springs the arch along a DIAGONAL ford (overrides dir)', () => {
    // Mirror of the deck: a true bearing makes the arch face across a diagonal watercourse.
    const diag = compile({ a: { type: 'arch_span', size: { w: 4, h: 4 }, params: { spanM: 6, yawDeg: 30 } } });
    expect((prims(diag, 'arch')[0] as any).yaw).toBeCloseTo(30, 3);
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
