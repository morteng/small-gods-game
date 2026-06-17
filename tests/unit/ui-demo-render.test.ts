import { describe, it, expect } from 'vitest';
import { UiLayer } from '@/render/ui/ui-layer';
import { UiPage, UI_VERTEX_FLOATS, type UiDrawGroup } from '@/render/ui/ui-batcher';

// CPU rasteriser for the UI draw groups — independent of WebGPU, so it gives a
// real pixel-level check of the batcher output. Every UI quad is an axis-aligned rect (2 tris), so we read 6 verts
// at a time, take the bbox + the vertex colour, and alpha-blend it over the
// background. Faithful to what the GPU pass draws for Solid-page geometry.
function rasterize(groups: UiDrawGroup[], W: number, H: number): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(W * H * 4);
  // dark slate background gradient (stand-in for the scene under the HUD)
  for (let y = 0; y < H; y++) {
    const t = y / H;
    const r = Math.round(30 + 18 * t), g = Math.round(34 + 14 * t), b = Math.round(46 + 20 * t);
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
    }
  }
  const F = UI_VERTEX_FLOATS;
  for (const grp of groups) {
    if (grp.page !== UiPage.Solid) continue; // S1 demo is all Solid
    const v = grp.vertices;
    for (let q = 0; q < grp.vertexCount; q += 6) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let k = 0; k < 6; k++) {
        const px = v[(q + k) * F], py = v[(q + k) * F + 1];
        x0 = Math.min(x0, px); y0 = Math.min(y0, py);
        x1 = Math.max(x1, px); y1 = Math.max(y1, py);
      }
      const cr = v[q * F + 4], cg = v[q * F + 5], cb = v[q * F + 6], ca = v[q * F + 7];
      const R = cr * 255, Gc = cg * 255, B = cb * 255;
      const xi0 = Math.max(0, Math.round(x0)), yi0 = Math.max(0, Math.round(y0));
      const xi1 = Math.min(W, Math.round(x1)), yi1 = Math.min(H, Math.round(y1));
      for (let y = yi0; y < yi1; y++) {
        for (let x = xi0; x < xi1; x++) {
          const i = (y * W + x) * 4;
          buf[i] = R * ca + buf[i] * (1 - ca);
          buf[i + 1] = Gc * ca + buf[i + 1] * (1 - ca);
          buf[i + 2] = B * ca + buf[i + 2] * (1 - ca);
        }
      }
    }
  }
  return buf;
}

const at = (buf: Uint8ClampedArray, W: number, x: number, y: number) => {
  const i = (y * W + x) * 4;
  return [buf[i], buf[i + 1], buf[i + 2]] as const;
};

describe('UI demo renders correctly (CPU raster, GPU-independent)', () => {
  const W = 1000, H = 600, dpr = 3, s = 3;
  const groups = new UiLayer().buildDemo(W, H, dpr);
  const buf = rasterize(groups, W, H);

  // panel geometry mirrors ui-layer.buildDemo
  const pad = 14 * s, ph = 92 * s;
  const px = pad, py = H - ph - pad;

  it('draws a translucent panel surface (darker than the background it covers)', () => {
    const inside = at(buf, W, px + 80 * s, py + 70 * s); // a quiet spot inside the panel
    const outside = at(buf, W, W - 30, py + 70 * s); // background to the right
    const lum = (c: readonly number[]) => c[0] + c[1] + c[2];
    expect(lum(inside)).toBeLessThan(lum(outside)); // panel darkens the scene
  });

  it('draws the gold presence-orb accent block', () => {
    const [r, g, b] = at(buf, W, px + 12 * s + 10 * s, py + 34 * s + 10 * s);
    expect(r).toBeGreaterThan(150); // gold: strong red...
    expect(r).toBeGreaterThan(b + 30); // ...much more than blue
    expect(g).toBeGreaterThan(b); // green between
  });

  it('renders readable glyph pixels in the title region', () => {
    // scan the title row band for lit (bright) pixels = real letters, not blocks
    let lit = 0;
    const ty = py + 12 * s;
    for (let y = ty; y < ty + 7 * s; y++) {
      for (let x = px + 12 * s; x < px + 170 * s; x++) {
        const [r, g, b] = at(buf, W, x, y);
        if (r + g + b > 540) lit++; // near-white text
      }
    }
    expect(lit).toBeGreaterThan(40); // plenty of lit glyph pixels
  });
});
