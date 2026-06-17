import { describe, it, expect } from 'vitest';
import {
  UiBatcher,
  UiPage,
  UiSpace,
  UI_VERTEX_FLOATS,
} from '@/render/ui/ui-batcher';
import type { Rgba } from '@/render/ui/ui-color';

const RED: Rgba = [1, 0, 0, 1];

describe('ui-batcher', () => {
  it('emits 6 verts (two tris) per quad with correct corner positions + tint', () => {
    const b = new UiBatcher();
    b.rect(10, 20, 4, 6, RED);
    const groups = b.flush();
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.space).toBe(UiSpace.Screen);
    expect(g.page).toBe(UiPage.Solid);
    expect(g.vertexCount).toBe(6);
    expect(g.vertices.length).toBe(6 * UI_VERTEX_FLOATS);

    // first vertex = top-left corner (10,20), tint red opaque
    expect(Array.from(g.vertices.slice(0, UI_VERTEX_FLOATS))).toEqual([10, 20, 0, 0, 1, 0, 0, 1]);

    // the quad spans x∈[10,14], y∈[20,26]; verify the extreme corners appear
    const xs = new Set<number>();
    const ys = new Set<number>();
    for (let i = 0; i < g.vertexCount; i++) {
      xs.add(g.vertices[i * UI_VERTEX_FLOATS]);
      ys.add(g.vertices[i * UI_VERTEX_FLOATS + 1]);
    }
    expect([...xs].sort((p, q) => p - q)).toEqual([10, 14]);
    expect([...ys].sort((p, q) => p - q)).toEqual([20, 26]);
  });

  it('groups by (space, page); separate pages/spaces become separate draws', () => {
    const b = new UiBatcher();
    b.rect(0, 0, 1, 1, RED); // Screen/Solid
    b.quad(0, 0, 1, 1, RED, UiPage.Bitmap, UiSpace.Screen, { u0: 0, v0: 0, u1: 1, v1: 1 }); // Screen/Bitmap
    b.quad(0, 0, 1, 1, RED, UiPage.Solid, UiSpace.World); // World/Solid
    const groups = b.flush();
    expect(groups).toHaveLength(3);
    const kinds = groups.map((g) => `${g.space}:${g.page}`).sort();
    expect(kinds).toEqual([
      `${UiSpace.Screen}:${UiPage.Solid}`,
      `${UiSpace.Screen}:${UiPage.Bitmap}`,
      `${UiSpace.World}:${UiPage.Solid}`,
    ].sort());
  });

  it('reset clears geometry', () => {
    const b = new UiBatcher();
    b.rect(0, 0, 1, 1, RED);
    b.reset();
    expect(b.flush()).toEqual([]);
  });

  it('border emits 4 edge quads (24 verts)', () => {
    const b = new UiBatcher();
    b.border(0, 0, 100, 50, 2, RED);
    const g = b.flush()[0];
    expect(g.vertexCount).toBe(4 * 6);
  });

  it('nineSlice emits 9 quads with fixed-size corners and mapped corner UVs', () => {
    const b = new UiBatcher();
    b.nineSlice(
      0,
      0,
      100,
      100,
      { l: 8, t: 8, r: 8, b: 8 },
      RED,
      UiPage.Skin,
      { u0: 0, v0: 0, u1: 1, v1: 1 },
      { l: 4, t: 4, r: 4, b: 4 },
      { w: 16, h: 16 },
    );
    const g = b.flush()[0];
    expect(g.vertexCount).toBe(9 * 6);

    // top-left corner quad's first vertex: dest (0,0), src UV (0,0)
    expect(Array.from(g.vertices.slice(0, 4))).toEqual([0, 0, 0, 0]);
    // source border 4px of a 16px page ⇒ first interior UV edge at 0.25
    const us = new Set<number>();
    for (let i = 0; i < g.vertexCount; i++) us.add(g.vertices[i * UI_VERTEX_FLOATS + 2]);
    expect(us.has(0.25)).toBe(true);
    expect(us.has(0.75)).toBe(true);
  });

  it('degenerate nineSlice (border larger than dest) skips collapsed quads, never NaN', () => {
    const b = new UiBatcher();
    b.nineSlice(
      0,
      0,
      10,
      10,
      { l: 8, t: 8, r: 8, b: 8 }, // l+r = 16 > 10 ⇒ centre/edge columns collapse
      RED,
      UiPage.Skin,
      { u0: 0, v0: 0, u1: 1, v1: 1 },
      { l: 4, t: 4, r: 4, b: 4 },
      { w: 16, h: 16 },
    );
    const g = b.flush()[0];
    // every emitted vertex is finite
    expect(Array.from(g.vertices).every((n) => Number.isFinite(n))).toBe(true);
    // fewer than 9 quads survive
    expect(g.vertexCount).toBeLessThan(9 * 6);
  });
});
