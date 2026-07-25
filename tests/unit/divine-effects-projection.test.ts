/**
 * Abilities v1 — A2 bugfix: `divine-effects.ts` used to draw every effect at
 * the flat `effect.x * tileSize` mapping with only `ctx.scale(camera.zoom)`
 * applied — no camera translate anywhere, a different space from the live
 * iso-projected scene (CLAUDE.md's documented "camera pans in ISO-SCREEN
 * space" gotcha). This pins the fix: `render()` must `ctx.translate` each
 * effect (and project each particle) to the SAME `worldToScreen` +
 * `isoStageTransform` point the rest of the renderer uses — panning the
 * camera must move where an effect draws, and a non-zero pan must NOT put it
 * at the old flat position.
 *
 * A minimal recording mock stands in for `CanvasRenderingContext2D` — only
 * the calls `DivineEffects.render` actually makes.
 */
import { describe, it, expect } from 'vitest';
import { DivineEffects } from '@/render/divine-effects';
import { worldToScreen } from '@/render/iso/iso-projection';
import { isoStageTransform } from '@/render/iso/entity-draw-list';

function mockCtx() {
  const calls: { translate: Array<[number, number]> } = { translate: [] };
  const ctx = {
    save() {}, restore() {}, scale() {}, stroke() {}, fill() {}, fillRect() {}, fillText() {},
    beginPath() {}, moveTo() {}, lineTo() {}, arc() {}, closePath() {},
    createRadialGradient: () => ({ addColorStop() {} }),
    translate(x: number, y: number) { calls.translate.push([x, y]); },
    set strokeStyle(_v: string) {}, set fillStyle(_v: unknown) {}, set globalAlpha(_v: number) {},
    set lineWidth(_v: number) {}, set lineJoin(_v: string) {}, set font(_v: string) {}, set textAlign(_v: string) {},
  };
  // `DivineEffects.render`'s ctx param type is imported from the 'canvas'
  // package (not the DOM lib global) — cast through `any` rather than the
  // ambient `CanvasRenderingContext2D`, which resolves to a DIFFERENT (DOM)
  // type here and doesn't structurally match either one.
  return { ctx: ctx as any, calls };
}

describe('DivineEffects.render — abilities-v1 A2 projection bugfix', () => {
  it('translates to the iso-projected anchor (worldToScreen + isoStageTransform), not the flat tile*tileSize mapping', () => {
    const fx = new DivineEffects();
    fx.trigger('smite', 12, 7);
    const camera = { x: 100, y: 50, zoom: 0.5 };
    const { ctx, calls } = mockCtx();

    fx.render(ctx, camera, 32);

    expect(calls.translate).toHaveLength(1);
    const [cx, cy] = calls.translate[0];

    const iso = worldToScreen(12, 7, 0, 0, 0);
    const t = isoStageTransform(camera);
    expect(cx).toBeCloseTo(iso.sx * t.scale + t.x, 6);
    expect(cy).toBeCloseTo(iso.sy * t.scale + t.y, 6);

    // The OLD (broken) behaviour: flat `effect.x * tileSize` with no camera
    // term. Confirm we're nowhere near it — this is the regression the fix
    // closes, not an incidental coincidence.
    const flatX = 12 * 32;
    const flatY = 7 * 32;
    expect(Math.abs(cx - flatX)).toBeGreaterThan(1);
    expect(Math.abs(cy - flatY)).toBeGreaterThan(1);
  });

  it('panning the camera moves the translated anchor (camera pan was previously ignored entirely)', () => {
    const fx = new DivineEffects();
    fx.trigger('whisper', 4, 4);
    const camA = { x: 0, y: 0, zoom: 1 };
    const camB = { x: 200, y: 0, zoom: 1 };

    const a = mockCtx();
    fx.render(a.ctx, camA, 32);
    const b = mockCtx();
    fx.render(b.ctx, camB, 32);

    expect(a.calls.translate[0][0]).not.toBe(b.calls.translate[0][0]);
  });
});
