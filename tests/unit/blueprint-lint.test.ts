// tests/unit/blueprint-lint.test.ts
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { lintBlueprint, summarizeLint } from '@/blueprint/lint';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { resolveBlueprint } from '@/blueprint/resolve';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { BLUEPRINT_VERSION, type Blueprint } from '@/blueprint/types';

beforeAll(() => ensureBuildingTypesRegistered());

const bp = (b: Partial<Blueprint> & Pick<Blueprint, 'footprint' | 'parts'>): Blueprint => ({
  version: BLUEPRINT_VERSION, class: 'building', materials: { walls: 'timber', roof: 'thatch' }, ...b,
});

describe('lintBlueprint', () => {
  it('a well-formed cottage is clean', () => {
    const cottage = bp({
      footprint: { w: 3, h: 3 },
      parts: { body: { type: 'body', size: { w: 3, h: 3 }, params: { plan: 'rect', levels: 1, roof: 'gable' },
        features: { door: { type: 'door', face: 'south', params: { main: true } } } } },
    });
    const lints = lintBlueprint(resolveBlueprint([cottage], 0));
    expect(lints.filter(l => l.severity === 'error')).toEqual([]);
    expect(summarizeLint(lints)).toBe('clean');
  });

  it('flags a window taller than the wall as an eave-breach (compiler self-correction)', () => {
    const tall = bp({
      footprint: { w: 3, h: 3 },
      parts: { body: { type: 'body', size: { w: 3, h: 3 }, params: { plan: 'rect', levels: 1, roof: 'gable' },
        features: { win: { type: 'window', face: 'south', params: { sill: 0.3, height: 5 } } } } },
    });
    const lints = lintBlueprint(resolveBlueprint([tall], 0));
    const eave = lints.find(l => l.code === 'eave-breach');
    expect(eave).toBeDefined();
    expect(eave!.feature).toBe('win');
    // the clamp always brings the head under the eave (height > clamped)
    expect(eave!.detail!.clamped).toBeLessThan(eave!.detail!.height as number);
  });

  it('flags a part poking outside the declared footprint', () => {
    const oversize = bp({
      footprint: { w: 2, h: 2 },
      parts: { body: { type: 'body', at: { x: 0, y: 0 }, size: { w: 4, h: 2 }, params: { plan: 'rect', levels: 1, roof: 'gable' } } },
    });
    const lints = lintBlueprint(resolveBlueprint([oversize], 0));
    const oob = lints.find(l => l.code === 'part-out-of-footprint');
    expect(oob).toBeDefined();
    expect(oob!.severity).toBe('warn');
  });

  it('flags a dormer on a flat roof that cannot host it', () => {
    // Use a hard roof covering (tile) so validity keeps the roof flat — thatch/hide would be
    // coerced to a pitched shape by coerceRoof, dodging the case under test.
    const flat = bp({
      materials: { walls: 'stone', roof: 'tile' },
      footprint: { w: 4, h: 4 },
      parts: { body: { type: 'body', size: { w: 4, h: 4 }, params: { plan: 'rect', levels: 1, roof: 'flat' },
        features: { d: { type: 'dormer', params: { t: 0.5 } } } } },
    });
    const lints = lintBlueprint(resolveBlueprint([flat], 0));
    expect(lints.find(l => l.code === 'dormer-unhostable')).toBeDefined();
  });

  it('notes two wall-bearing parts that overlap', () => {
    const overlap = bp({
      footprint: { w: 4, h: 4 },
      parts: {
        a: { type: 'body', at: { x: 0, y: 0 }, size: { w: 3, h: 3 }, params: { plan: 'rect', levels: 1, roof: 'gable' } },
        b: { type: 'wing', at: { x: 2, y: 2 }, size: { w: 2, h: 2 }, params: { levels: 1, roof: 'gable' } },
      },
    });
    const lints = lintBlueprint(resolveBlueprint([overlap], 0));
    const ov = lints.find(l => l.code === 'parts-overlap');
    expect(ov).toBeDefined();
    expect(ov!.severity).toBe('info');
  });
});

describe('toGeometry diagnostics sink', () => {
  it('when a sink is passed, the compiler pushes structured diagnostics and stays silent', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tall = bp({
      footprint: { w: 3, h: 3 },
      parts: { body: { type: 'body', size: { w: 3, h: 3 }, params: { plan: 'rect', levels: 1, roof: 'gable' },
        features: { win: { type: 'window', face: 'south', params: { sill: 0.3, height: 5 } } } } },
    });
    const diagnostics: import('@/blueprint/compile/diagnostics').GeometryDiagnostic[] = [];
    toGeometry(resolveBlueprint([tall], 0), { diagnostics });
    expect(diagnostics.some(d => d.code === 'eave-breach')).toBe(true);
    expect(warn).not.toHaveBeenCalled();   // silent when a sink absorbs the diagnostics
    warn.mockRestore();
  });

  it('with no sink, the compiler console.warns exactly as before (runtime path unchanged)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tall = bp({
      footprint: { w: 3, h: 3 },
      parts: { body: { type: 'body', size: { w: 3, h: 3 }, params: { plan: 'rect', levels: 1, roof: 'gable' },
        features: { win: { type: 'window', face: 'south', params: { sill: 0.3, height: 5 } } } } },
    });
    toGeometry(resolveBlueprint([tall], 0));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
