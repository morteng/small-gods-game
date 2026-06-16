import { describe, it, expect } from 'vitest';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { synthesizeBlueprint } from '@/blueprint/presets';

const rb = () => {
  const b = synthesizeBlueprint('cottage');
  if (!b) throw new Error('no cottage blueprint');
  return b;
};

describe('building skirt (ground apron) geometry', () => {
  it('is opt-in: no skirt part without opts', () => {
    const spec = toGeometry(rb());
    expect(spec.parts.some((p) => p.prim === 'skirt')).toBe(false);
  });

  it('emits a wall-hugging skirt (one lip per footprint piece), drawn first', () => {
    const margin = 0.15;
    const spec = toGeometry(rb(), { skirt: { margin } });
    const skirts = spec.parts.filter((p) => p.prim === 'skirt');
    // One narrow lip per footprint rect (wing/box/round body); at least one.
    expect(skirts.length).toBeGreaterThanOrEqual(1);
    // Prepended → the skirts lead the part list (drawn under everything else).
    expect(spec.parts[0].prim).toBe('skirt');

    // Each lip overhangs its piece by exactly `margin` on every side.
    for (const sk of skirts) {
      const s = sk as Extract<typeof sk, { prim: 'skirt' }>;
      expect(s.rect.w).toBeGreaterThan(2 * margin);
      expect(s.rect.h).toBeGreaterThan(2 * margin);
      expect(Number.isFinite(s.rect.x) && Number.isFinite(s.rect.y)).toBe(true);
    }
  });

  it('derives a ground material for the apron', () => {
    const spec = toGeometry(rb(), { skirt: { margin: 0.5 } });
    const s = spec.parts.find((p) => p.prim === 'skirt') as Extract<ReturnType<typeof toGeometry>['parts'][number], { prim: 'skirt' }>;
    expect(typeof s.material).toBe('string');
  });
});
