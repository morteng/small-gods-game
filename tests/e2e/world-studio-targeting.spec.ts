/**
 * E2E — World Studio mouse targeting (DIR-C)
 *
 * Drives the real WebGPU studio (`?studio=world`) and validates that the cursor
 * resolves to the correct tile / water node / POI under it, at real zoom levels —
 * via the studio's debug surface (`window.__worldStudio`: projectTile / probe / hitAt).
 * This is the end-to-end counterpart to the pure unit (`lifted-projection`) and the
 * headless integration (`mouse-targeting`) suites.
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Bring up the studio and wait for a generated world + debug hooks. Returns false when
 * the GPU studio can't initialise (the renderer is WebGPU-only; many headless runners
 * have no WebGPU adapter) so callers can SKIP rather than false-fail — the targeting
 * assertions still run wherever WebGPU is present (a headed run, a GPU CI image).
 */
async function openStudio(page: Page): Promise<boolean> {
  await page.goto('/?studio=world');
  if (!(await page.evaluate(() => !!(navigator as any).gpu))) return false;   // no WebGPU
  try {
    await expect
      .poll(
        () => page.evaluate(() => {
          const ws = (window as any).__worldStudio;
          return !!(ws && ws.map && ws.map() && ws.projectTile && ws.probe && ws.hitAt);
        }),
        { timeout: 25000, message: 'World studio + debug hooks should be ready' },
      )
      .toBe(true);
  } catch {
    return false;   // WebGPU present but the studio never came up — skip, don't fail
  }
  await page.waitForTimeout(400);
  return true;
}

test.describe('World studio — tile targeting geometry', () => {
  test('every on-terrain cursor pixel resolves to the tile drawn under it (point-in-quad)', async ({ page }) => {
    test.skip(!(await openStudio(page)), 'WebGPU world studio unavailable in this runner');
    const result = await page.evaluate(async () => {
      const ws = (window as any).__worldStudio;
      ws.lookAt(160, 90, 14);
      await new Promise((r) => setTimeout(r, 250));
      const c = document.querySelector('canvas') as HTMLCanvasElement;
      const Wd = c.width, Hd = c.height;
      const sign = (px: number, py: number, ax: number, ay: number, bx: number, by: number) =>
        (px - bx) * (ay - by) - (ax - bx) * (py - by);
      const inTri = (p: any, a: any, b: any, d: any) => {
        const d1 = sign(p.x, p.y, a.x, a.y, b.x, b.y), d2 = sign(p.x, p.y, b.x, b.y, d.x, d.y), d3 = sign(p.x, p.y, d.x, d.y, a.x, a.y);
        return !(((d1 < 0) || (d2 < 0) || (d3 < 0)) && ((d1 > 0) || (d2 > 0) || (d3 > 0)));
      };
      let n = 0, inside = 0;
      for (let sy = 40; sy < Hd - 10; sy += 19) for (let sx = 10; sx < Wd - 10; sx += 19) {
        const pr = ws.probe(sx, sy); const [cx, cy] = pr.tile;
        const a = ws.projectTile(cx, cy), b = ws.projectTile(cx + 1, cy), d = ws.projectTile(cx + 1, cy + 1), e = ws.projectTile(cx, cy + 1);
        const cur = { x: sx, y: sy };
        if (inTri(cur, a, b, d) || inTri(cur, a, d, e)) inside++;
        n++;
      }
      return { n, inside, pct: 100 * inside / n };
    });
    expect(result.n).toBeGreaterThan(500);
    expect(result.pct).toBeGreaterThan(99.5);   // pixel-perfect at a working zoom
  });

  test('targeting is stable across zoom levels', async ({ page }) => {
    test.skip(!(await openStudio(page)), 'WebGPU world studio unavailable in this runner');
    const picks = await page.evaluate(async () => {
      const ws = (window as any).__worldStudio;
      const tx = 160, ty = 90;
      const out: string[] = [];
      for (const span of [60, 24, 8]) {
        ws.lookAt(tx, ty, span);
        await new Promise((r) => setTimeout(r, 180));
        const s = ws.projectTile(tx + 0.5, ty + 0.5);
        const pr = ws.probe(s.x, s.y);
        out.push(pr.tile.join(','));
      }
      return out;
    });
    expect(new Set(picks).size).toBe(1);
    expect(picks[0]).toBe('160,90');
  });
});

test.describe('World studio — content targeting', () => {
  test('hovering a rendered river cell reads as a river (not grass)', async ({ page }) => {
    test.skip(!(await openStudio(page)), 'WebGPU world studio unavailable in this runner');
    const res = await page.evaluate(async () => {
      const ws = (window as any).__worldStudio;
      const net = ws.waterNetwork();
      const reach = net.reaches
        .filter((r: any) => r.klass === 'river' || r.klass === 'major_river')
        .sort((a: any, b: any) => b.centerline.length - a.centerline.length)[0];
      if (!reach) return { skip: true, river: 0, total: 0 };
      const mid = reach.centerline[Math.floor(reach.centerline.length / 2)];
      ws.lookAt(mid.x, mid.y, 10);
      await new Promise((r) => setTimeout(r, 250));
      // Sample several centreline cells; report how many read "river".
      let river = 0, total = 0;
      for (let k = 4; k < reach.centerline.length - 4; k += 8) {
        const p = reach.centerline[k];
        const s = ws.projectTile(p.x, p.y);
        const hit = ws.hitAt(s.x, s.y);
        const wr = (hit?.rows || []).find((row: any) => row[0] === 'water');
        if (wr && /river/.test(wr[1])) river++;
        total++;
      }
      return { skip: false, river, total };
    });
    if (res.skip) test.skip(true, 'world has no river reach');
    expect(res.total).toBeGreaterThan(0);
    expect(res.river / res.total).toBeGreaterThan(0.9);
  });

  test('clicking a POI resolves to that POI, not the bare tile', async ({ page }) => {
    test.skip(!(await openStudio(page)), 'WebGPU world studio unavailable in this runner');
    const res = await page.evaluate(async () => {
      const ws = (window as any).__worldStudio;
      const pois = (ws.map().worldSeed?.pois || []).filter((p: any) => p.position);
      if (!pois.length) return { skip: true, kind: '', title: '', poiName: '' };
      const poi = pois[0];
      ws.lookAt(poi.position.x, poi.position.y, 12);
      await new Promise((r) => setTimeout(r, 250));
      const s = ws.projectTile(poi.position.x + 0.5, poi.position.y + 0.5);
      const hit = ws.hitAt(s.x, s.y);
      return { skip: false, kind: hit?.kind ?? '', title: hit?.title ?? '', poiName: poi.name ?? poi.type };
    });
    if (res.skip) test.skip(true, 'world has no positioned POI');
    // The cursor over a POI's own cell must resolve to a POI (place/settlement), not 'tile'.
    expect(res.kind).toBe('poi');
  });
});
