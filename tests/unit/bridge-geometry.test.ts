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

  it('a straight pier is a box; a battered pier tapers (prism)', () => {
    const straight = compile({ p: { type: 'pier', size: { w: 1, h: 1 }, params: { heightM: 4, widthM: 1, batter: 0 } } });
    const battered = compile({ p: { type: 'pier', size: { w: 1, h: 1 }, params: { heightM: 4, widthM: 1, batter: 0.3 } } });
    expect(prims(straight, 'box').length).toBe(1);
    expect(prims(battered, 'prism').length).toBe(1);
  });

  it('arch_span emits an arch prim', () => {
    const arch = compile({ a: { type: 'arch_span', size: { w: 3, h: 1 }, params: { spanM: 6, riseM: 2.5, thicknessM: 1 } } });
    expect(prims(arch, 'arch').length).toBe(1);
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
