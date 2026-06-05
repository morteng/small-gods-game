import { describe, it, expect, vi } from 'vitest';
import { drawPrayerMarkers } from '@/render/sim-overlay';
import { worldToScreen as isoWorldToScreen } from '@/render/iso/iso-projection';
import { BILLBOARD_H_PX } from '@/render/iso/iso-sprites';
import { TILE_SIZE } from '@/core/constants';
import type { Camera } from '@/core/types';

/** Minimal World stub exposing only what drawPrayerMarkers queries. */
function worldWith(npcs: Array<{ id: string; x: number; y: number; activity: string }>) {
  const entities = npcs.map((n) => ({
    id: n.id, kind: 'npc', x: n.x, y: n.y, tags: ['npc'],
    properties: { activity: n.activity },
  }));
  return {
    query: ({ kind }: { kind?: string }) =>
      kind === 'npc' ? entities : [],
  } as any;
}

function captureFillText() {
  const calls: Array<{ text: string; x: number; y: number }> = [];
  const ctx = {
    save: vi.fn(), restore: vi.fn(),
    fillText: vi.fn((text: string, x: number, y: number) => calls.push({ text, x, y })),
    set font(_v: string) {}, set textAlign(_v: string) {}, set textBaseline(_v: string) {},
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

const camera: Camera = { x: 40, y: 25, zoom: 2 } as Camera;

describe('drawPrayerMarkers', () => {
  it('draws a 🙏 only for NPCs in worship', () => {
    const { ctx, calls } = captureFillText();
    const world = worldWith([
      { id: 'a', x: 3, y: 3, activity: 'worship' },
      { id: 'b', x: 4, y: 4, activity: 'idle' },
      { id: 'c', x: 5, y: 5, activity: 'worship' },
    ]);
    drawPrayerMarkers(ctx, world, camera, 'topdown');
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.text === '🙏')).toBe(true);
  });

  it('iso mode anchors the glyph to the billboard head, not the topdown tile', () => {
    const world = worldWith([{ id: 'a', x: 3, y: 3, activity: 'worship' }]);

    const top = captureFillText();
    drawPrayerMarkers(top.ctx, world, camera, 'topdown');

    const iso = captureFillText();
    drawPrayerMarkers(iso.ctx, world, camera, 'iso');

    // The two projections must place the glyph at genuinely different points —
    // the old bug was iso reusing the topdown position.
    expect(iso.calls[0]).not.toEqual(top.calls[0]);

    // Iso position must match the iso projection of the head, scaled+translated
    // by the camera exactly as the iso renderer does.
    const head = isoWorldToScreen(3, 3, BILLBOARD_H_PX, 0, 0);
    expect(iso.calls[0].x).toBeCloseTo((head.sx - camera.x) * camera.zoom);
    expect(iso.calls[0].y).toBeCloseTo((head.sy - camera.y) * camera.zoom - 2);
  });

  it('iso glyph sits above the iso ground anchor (smaller y = higher on screen)', () => {
    const world = worldWith([{ id: 'a', x: 3, y: 3, activity: 'worship' }]);
    const { ctx, calls } = captureFillText();
    drawPrayerMarkers(ctx, world, camera, 'iso');

    const ground = isoWorldToScreen(3, 3, 0, 0, 0);
    const groundScreenY = (ground.sy - camera.y) * camera.zoom;
    expect(calls[0].y).toBeLessThan(groundScreenY);
  });

  it('topdown placement is unchanged (tile-centre, just above the tile)', () => {
    const world = worldWith([{ id: 'a', x: 3, y: 3, activity: 'worship' }]);
    const { ctx, calls } = captureFillText();
    drawPrayerMarkers(ctx, world, camera, 'topdown');
    // sx = (x*TILE - cam.x)*zoom, then + half a tile in screen px; sy - 2.
    const sx = (3 * TILE_SIZE - camera.x) * camera.zoom;
    const sy = (3 * TILE_SIZE - camera.y) * camera.zoom;
    expect(calls[0].x).toBeCloseTo(sx + (TILE_SIZE * camera.zoom) / 2);
    expect(calls[0].y).toBeCloseTo(sy - 2);
  });
});
