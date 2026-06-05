import { describe, it, expect } from 'vitest';
import { drawBuildingPlaceholder } from '@/render/building-massing';
import { buildingPalette } from '@/world/building-descriptor';
import { BUILDING_PRESETS, synthesizeFromPreset } from '@/world/building-presets';

/** Minimal canvas-context spy recording the calls the renderer makes. */
function spyCtx() {
  const calls: string[] = [];
  const fillStyles: string[] = [];
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_t, prop: string) {
      if (prop === '__calls') return calls;
      if (prop === '__fillStyles') return fillStyles;
      if (prop === 'fillStyle' || prop === 'strokeStyle') return '';
      return (...args: unknown[]) => { calls.push(prop); void args; };
    },
    set(_t, prop: string, value: unknown) {
      if (prop === 'fillStyle') fillStyles.push(String(value));
      return true;
    },
  };
  return new Proxy({}, handler) as unknown as CanvasRenderingContext2D & {
    __calls: string[]; __fillStyles: string[];
  };
}

describe('drawBuildingPlaceholder', () => {
  it('draws something for every preset without throwing', () => {
    for (const name of Object.keys(BUILDING_PRESETS)) {
      const ctx = spyCtx();
      const d = synthesizeFromPreset(name)!;
      expect(() => drawBuildingPlaceholder(ctx, d, 4, 4), name).not.toThrow();
      expect(ctx.__calls.some(c => c === 'fill' || c === 'fillRect'), name).toBe(true);
    }
  });

  it('uses the wall colour as a fill', () => {
    const ctx = spyCtx();
    const d = synthesizeFromPreset('cottage')!;
    drawBuildingPlaceholder(ctx, d, 0, 0);
    expect(ctx.__fillStyles).toContain(buildingPalette(d).walls);
  });

  it('draws concentric steps for a stepped ziggurat (one fill per level)', () => {
    const ctx = spyCtx();
    const d = synthesizeFromPreset('castle_keep')!; // stepped, levels 4
    drawBuildingPlaceholder(ctx, d, 0, 0);
    const fills = ctx.__calls.filter(c => c === 'fill' || c === 'fillRect').length;
    expect(fills).toBeGreaterThanOrEqual(4);
  });
});
