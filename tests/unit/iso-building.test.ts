import { describe, it, expect, vi } from 'vitest';
import { drawIsoBuildingMassing } from '@/render/iso/iso-building';
import { buildingMassing } from '@/render/building-massing-model';
import { synthesizeFromPreset, BUILDING_PRESETS } from '@/world/building-presets';

function makeMockCtx() {
  return {
    save: vi.fn(), restore: vi.fn(), translate: vi.fn(),
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(),
    fill: vi.fn(), fillRect: vi.fn(), ellipse: vi.fn(), arc: vi.fn(),
    fillStyle: '',
  } as unknown as CanvasRenderingContext2D;
}

const dc = (ctx: CanvasRenderingContext2D) => ({ ctx, atlas: {} as any, originX: 0, originY: 0 });

describe('drawIsoBuildingMassing', () => {
  it('draws every preset without throwing', () => {
    for (const name of Object.keys(BUILDING_PRESETS)) {
      const ctx = makeMockCtx();
      const m = buildingMassing(synthesizeFromPreset(name)!);
      expect(() => drawIsoBuildingMassing(dc(ctx), m, 5, 5), name).not.toThrow();
      expect((ctx.fill as ReturnType<typeof vi.fn>).mock.calls.length, name).toBeGreaterThan(0);
    }
  });

  it('draws a round plan (yurt) with ellipses (drum + dome)', () => {
    const ctx = makeMockCtx();
    drawIsoBuildingMassing(dc(ctx), buildingMassing(synthesizeFromPreset('yurt')!), 2, 2);
    // drum: bottom + top ellipse, plus the dome cap = ≥3 ellipse calls
    expect((ctx.ellipse as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('draws a stepped plan (keep) as multiple stacked levels', () => {
    const ctx = makeMockCtx();
    const keep = synthesizeFromPreset('castle_keep')!; // levels 4, levelInset 1
    drawIsoBuildingMassing(dc(ctx), buildingMassing(keep), 0, 0);
    // each level = 3 quads (2 walls + top); 4 levels ⇒ many fills, no ellipse
    // (no ground-shadow fill any more — programmatic shadows removed).
    expect((ctx.fill as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(6);
    expect((ctx.ellipse as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('draws gable-family and hip-family roofs as ridged/pitched silhouettes (not flat caps)', () => {
    const lineToCount = (roof: string): number => {
      const ctx = makeMockCtx();
      const d = synthesizeFromPreset('cottage')!; d.roof = roof as any;
      drawIsoBuildingMassing(dc(ctx), buildingMassing(d), 5, 5);
      return (ctx.lineTo as ReturnType<typeof vi.fn>).mock.calls.length;
    };
    // Baseline: a 'flat' roof hits the flat-cap path. A correctly-mapped pitched roof
    // adds ridge/apex geometry → strictly MORE lineTo calls than the flat cap. (An
    // unmapped roof would fall through to the same flat cap and tie this baseline.)
    const flatCalls = lineToCount('flat');
    const pitched = ['gambrel', 'saltbox', 'cross_gable', 'pyramidal', 'mansard', 'jerkinhead', 'tented', 'spire'];
    for (const roof of pitched) {
      expect(lineToCount(roof), roof).toBeGreaterThan(flatCalls);
    }
  });

  it('taller buildings reach higher on screen than flat ones (height honoured)', () => {
    // Capture the minimum y passed to lineTo as a proxy for silhouette height.
    const ys: number[] = [];
    const ctx = makeMockCtx();
    (ctx.lineTo as any) = vi.fn((_x: number, y: number) => ys.push(y));
    drawIsoBuildingMassing(dc(ctx), buildingMassing(synthesizeFromPreset('castle_keep')!), 5, 5);
    const keepTop = Math.min(...ys);
    ys.length = 0;
    drawIsoBuildingMassing(dc(ctx), buildingMassing(synthesizeFromPreset('dock')!), 5, 5);
    const dockTop = Math.min(...ys);
    expect(keepTop).toBeLessThan(dockTop); // smaller y = higher on screen
  });
});
