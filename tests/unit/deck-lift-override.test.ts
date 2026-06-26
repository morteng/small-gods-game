// tests/unit/deck-lift-override.test.ts — G4: above-ground deck primitive.
// A bridge deck must ride its authored elevation (the feature grade line) over the low
// terrain/water it spans, instead of snapping to the ground under its foot like every
// other entity. The contained mechanism: an `image` draw item carries `liftElev`
// (normalised heightfield units); the terrain-lift pre-pass lifts it by that elevation
// directly. Piers (no liftElev) keep normal foot sampling so they stand from the bed up.
import { describe, it, expect } from 'vitest';
import { liftDrawList, liftPxFromElev, type TerrainLiftField } from '@/render/gpu/terrain-lift';
import type { DrawItem } from '@/render/iso/draw-list';

// A 4×4 field: a deep valley (low) at the centre, high banks at the edges.
const W = 4, H = 4;
const heights = new Float32Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const edge = x === 0 || x === W - 1 || y === 0 || y === H - 1;
  heights[y * W + x] = edge ? 0.6 : 0.1;   // banks high, valley floor low
}
const field: TerrainLiftField = {
  heights,
  globals: { grid: [W, H], half: [16, 8], zPxPerM: 32, seaLevel: 0, reliefM: 2 },
};

const img = (over: Partial<Extract<DrawItem, { t: 'image' }>>): DrawItem => ({
  t: 'image', src: {} as CanvasImageSource, dx: 0, dy: 0, dw: 16, dh: 16, ...over,
});

describe('G4 deck lift override', () => {
  it('lifts a deck to its authored elevation, ignoring the low terrain below', () => {
    // Place the foot over the valley floor (low). Without override it would sink.
    const foot = { dx: -8, dy: 0, dw: 16, dh: 8 };  // foot near tile (0.5,0.5)-ish centre
    const bankElev = 0.6;
    const [deck] = liftDrawList([img({ ...foot, liftElev: bankElev })], field) as DrawItem[];
    const lifted = deck as Extract<DrawItem, { t: 'image' }>;
    const expectedDz = liftPxFromElev(bankElev, 0, 2, 32);
    expect(lifted.dy).toBeCloseTo(0 - expectedDz, 6);
  });

  it('a deck and a pier at the same spot lift differently (deck=authored, pier=ground)', () => {
    const spot = { dx: -8, dy: 24, dw: 16, dh: 8 };
    const [deck] = liftDrawList([img({ ...spot, liftElev: 0.6 })], field) as DrawItem[];
    const [pier] = liftDrawList([img({ ...spot })], field) as DrawItem[];
    const d = (deck as Extract<DrawItem, { t: 'image' }>).dy;
    const p = (pier as Extract<DrawItem, { t: 'image' }>).dy;
    // The deck rides higher (more negative dy = further up-screen) than the ground pier.
    expect(d).toBeLessThan(p);
  });

  it('liftElev:0 (sea level) is a no-op shift, not an exception', () => {
    const [it] = liftDrawList([img({ liftElev: 0 })], field) as DrawItem[];
    expect((it as Extract<DrawItem, { t: 'image' }>).dy).toBe(0);
  });
});
