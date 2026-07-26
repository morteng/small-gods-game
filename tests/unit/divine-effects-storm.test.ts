/**
 * Abilities v1 — B5 (the visual half, built alongside A4): `summon_storm` had
 * NO effect at all before this — a cast storm rendered nothing. This pins the
 * new `'storm'` effect: `DivineEffects.trigger` threads an optional radius
 * through to `renderStorm`, which draws a raincloud + downpour over a disc
 * that SCALES with that radius (a big area-cast storm should look bigger than
 * a settlement one) — deterministically, via the fixed `RAIN_DROPLETS` table,
 * not `Math.random` (the same discipline `renderSmite`'s zigzag offsets use).
 *
 * A minimal recording mock stands in for `CanvasRenderingContext2D`, extending
 * `divine-effects-projection.test.ts`'s mock with `ellipse`/`moveTo`/`lineTo`
 * capture (`renderSmite` didn't need `ellipse`; `renderStorm`'s cloud/ground
 * disc does).
 */
import { describe, it, expect } from 'vitest';
import { DivineEffects } from '@/render/divine-effects';

function mockCtx() {
  const calls: {
    ellipse: Array<[number, number, number, number]>;
    moveTo: Array<[number, number]>;
    lineTo: Array<[number, number]>;
  } = { ellipse: [], moveTo: [], lineTo: [] };
  const ctx = {
    save() {}, restore() {}, scale() {}, stroke() {}, fill() {}, fillRect() {}, fillText() {},
    beginPath() {}, closePath() {}, arc() {},
    moveTo(x: number, y: number) { calls.moveTo.push([x, y]); },
    lineTo(x: number, y: number) { calls.lineTo.push([x, y]); },
    ellipse(x: number, y: number, rx: number, ry: number) { calls.ellipse.push([x, y, rx, ry]); },
    createRadialGradient: () => ({ addColorStop() {} }),
    translate() {},
    set strokeStyle(_v: string) {}, set fillStyle(_v: unknown) {}, set globalAlpha(_v: number) {},
    set lineWidth(_v: number) {}, set lineJoin(_v: string) {}, set font(_v: string) {}, set textAlign(_v: string) {},
  };
  return { ctx: ctx as any, calls };
}

describe('DivineEffects — the summon_storm visual (abilities-v1 B5)', () => {
  it('trigger() stores the given radius on the effect', () => {
    const fx = new DivineEffects();
    fx.trigger('storm', 5, 5, 9);
    expect((fx as any).effects[0].radiusTiles).toBe(9);
  });

  it('trigger() without a radius leaves it undefined — renderStorm supplies its own default', () => {
    const fx = new DivineEffects();
    fx.trigger('storm', 5, 5);
    expect((fx as any).effects[0].radiusTiles).toBeUndefined();
  });

  it('a triggered storm renders without throwing through the public render() path', () => {
    const fx = new DivineEffects();
    fx.trigger('storm', 3, 3, 8);
    const { ctx } = mockCtx();
    expect(() => fx.render(ctx, { x: 0, y: 0, zoom: 1 }, 32)).not.toThrow();
  });

  it('a bigger radius draws a bigger cloud/ground disc — the storm scales with the flooded area', () => {
    const fx = new DivineEffects();
    const small = mockCtx();
    (fx as any).renderStorm(small.ctx, 0.3, 32, '#9fd8ff', 6);
    const big = mockCtx();
    (fx as any).renderStorm(big.ctx, 0.3, 32, '#9fd8ff', 12);

    // The wet-ground disc is the first ellipse drawn; its x-radius is
    // `tileSize * radiusTiles`, so doubling the radius must double it.
    const [, , smallRx] = small.calls.ellipse[0];
    const [, , bigRx] = big.calls.ellipse[0];
    expect(bigRx).toBeCloseTo(smallRx * 2, 5);
  });

  it('renderStorm is deterministic — identical inputs draw identical shapes (no Math.random on the render path)', () => {
    const fx = new DivineEffects();
    const a = mockCtx();
    (fx as any).renderStorm(a.ctx, 0.45, 32, '#9fd8ff', 6);
    const b = mockCtx();
    (fx as any).renderStorm(b.ctx, 0.45, 32, '#9fd8ff', 6);
    expect(a.calls).toEqual(b.calls);
  });

  it('the rain droplets vary across the fall (not a single frozen frame)', () => {
    const fx = new DivineEffects();
    const early = mockCtx();
    (fx as any).renderStorm(early.ctx, 0.05, 32, '#9fd8ff', 6);
    const later = mockCtx();
    (fx as any).renderStorm(later.ctx, 0.5, 32, '#9fd8ff', 6);
    expect(early.calls.moveTo).not.toEqual(later.calls.moveTo);
  });
});
