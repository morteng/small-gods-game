import { describe, it, expect } from 'vitest';
import { buildInstanceBatches, instancedDrawCalls, srcSize, applyViewTransform } from '@/render/gpu/instance-batch';
import type { DrawItem } from '@/render/iso/draw-list';

// Stand-in image sources: plain objects carrying width/height (CanvasImageSource
// is structural here — the batcher only reads identity + size).
function tex(w = 64, h = 64): CanvasImageSource {
  return { width: w, height: h } as unknown as CanvasImageSource;
}

function img(src: CanvasImageSource, dx: number, extra: Partial<Extract<DrawItem, { t: 'image' }>> = {}): DrawItem {
  return { t: 'image', src, dx, dy: 0, dw: 32, dh: 32, ...extra };
}

describe('R2c — instance batching', () => {
  it('buckets image items by texture identity (one batch per shared src)', () => {
    const a = tex(), b = tex();
    const items: DrawItem[] = [img(a, 0), img(b, 10), img(a, 20), img(a, 30), img(b, 40)];
    const { batches } = buildInstanceBatches(items);
    expect(batches).toHaveLength(2);
    expect(batches[0].texture).toBe(a);
    expect(batches[0].instances).toHaveLength(3);
    expect(batches[1].texture).toBe(b);
    expect(batches[1].instances).toHaveLength(2);
  });

  it('collapses 500 same-texture instances to ONE draw call (not 500)', () => {
    const shared = tex();
    const items: DrawItem[] = Array.from({ length: 500 }, (_, i) => img(shared, i));
    const { batches } = buildInstanceBatches(items);
    expect(instancedDrawCalls(batches)).toBe(1);
    expect(batches[0].instances).toHaveLength(500);
  });

  it('draw-call count = number of distinct textures (species buckets)', () => {
    const oak = tex(), pine = tex(), willow = tex();
    const items: DrawItem[] = [];
    for (let i = 0; i < 200; i++) items.push(img(oak, i));
    for (let i = 0; i < 150; i++) items.push(img(pine, i));
    for (let i = 0; i < 50; i++) items.push(img(willow, i));
    const { batches } = buildInstanceBatches(items);
    expect(instancedDrawCalls(batches)).toBe(3);
  });

  it('encodes painter order as strictly-increasing depth in (0,1)', () => {
    const a = tex();
    const items: DrawItem[] = [img(a, 0), img(a, 1), img(a, 2)];
    const { batches } = buildInstanceBatches(items);
    const d = batches[0].instances.map(i => i.depth);
    expect(d[0]).toBeGreaterThan(0);
    expect(d[2]).toBeLessThan(1);
    expect(d[0]).toBeLessThan(d[1]);
    expect(d[1]).toBeLessThan(d[2]);
  });

  it('preserves global painter order across interleaved textures via depth', () => {
    const a = tex(), b = tex();
    // a,b,a,b — depths must remain globally monotonic by original index.
    const items: DrawItem[] = [img(a, 0), img(b, 1), img(a, 2), img(b, 3)];
    const { batches } = buildInstanceBatches(items);
    const aDepths = batches[0].instances.map(i => i.depth); // items 0,2
    const bDepths = batches[1].instances.map(i => i.depth); // items 1,3
    expect(aDepths[0]).toBeLessThan(bDepths[0]); // 0 < 1
    expect(bDepths[0]).toBeLessThan(aDepths[1]); // 1 < 2
    expect(aDepths[1]).toBeLessThan(bDepths[1]); // 2 < 3
  });

  it('derives depth from a GLOBAL depthKey, not list index (cross-list comparability)', () => {
    const a = tex();
    // Two SEPARATE batch calls (the static + NPC lists are built independently). A
    // building deep in the static list vs an NPC early in the tiny dynamic list.
    const near = buildInstanceBatches([img(a, 0, { depthKey: 500 })]).batches[0].instances[0].depth;
    const staticList: DrawItem[] = Array.from({ length: 100 }, (_, i) => img(a, i, { depthKey: 100 + i }));
    const farBuilding = buildInstanceBatches(staticList).batches[0].instances[50].depth; // depthKey 150
    // The NPC (key 500, foot further downhill) must depth-test IN FRONT of the
    // building (key 150) even though the NPC is index 0 of a 1-item list and the
    // building is index 50 of a 100-item list. Index-based depth got this backwards.
    expect(near).toBeGreaterThan(farBuilding);
  });

  it('an equal-tile NPC (higher kindPriority key) beats co-tile ground flora', () => {
    const a = tex();
    // Same tile-sum 20; ground cover quantized to kindPriority 3 → key 20+3/16;
    // npc kindPriority 6 → key 20+6/16. The npc key is higher ⇒ greater depth ⇒ front.
    const grass = buildInstanceBatches([img(a, 0, { depthKey: 20 + 3 / 16 })]).batches[0].instances[0].depth;
    const npc = buildInstanceBatches([img(a, 0, { depthKey: 20 + 6 / 16 })]).batches[0].instances[0].depth;
    expect(npc).toBeGreaterThan(grass);
  });

  it('equal depthKey keeps stable painter order via the index nudge (stacked quads)', () => {
    const a = tex();
    // Three quads of ONE building entry share a depthKey; they must still layer in
    // emission order so the massing stacks correctly.
    const d = buildInstanceBatches([
      img(a, 0, { depthKey: 42 }), img(a, 1, { depthKey: 42 }), img(a, 2, { depthKey: 42 }),
    ]).batches[0].instances.map(i => i.depth);
    expect(d[0]).toBeLessThan(d[1]);
    expect(d[1]).toBeLessThan(d[2]);
    expect(d[0]).toBeGreaterThan(0);
    expect(d[2]).toBeLessThan(1);
  });

  it('computes UV sub-rects from a sheet frame', () => {
    const sheet = tex(128, 64);
    const items: DrawItem[] = [img(sheet, 0, { frame: { sx: 64, sy: 0, sw: 32, sh: 64 } })];
    const { batches } = buildInstanceBatches(items);
    const inst = batches[0].instances[0];
    expect(inst.u0).toBeCloseTo(0.5);
    expect(inst.v0).toBeCloseTo(0);
    expect(inst.u1).toBeCloseTo(0.75);
    expect(inst.v1).toBeCloseTo(1);
  });

  it('whole-image items get full (0,0)-(1,1) UVs', () => {
    const { batches } = buildInstanceBatches([img(tex(), 0)]);
    const inst = batches[0].instances[0];
    expect([inst.u0, inst.v0, inst.u1, inst.v1]).toEqual([0, 0, 1, 1]);
  });

  it('marks a batch lit only when companion maps are present', () => {
    const lit = tex(), flat = tex();
    const items: DrawItem[] = [
      img(lit, 0, { maps: { normal: tex(), material: tex() } }),
      img(flat, 1),
    ];
    const { batches } = buildInstanceBatches(items);
    expect(batches[0].lit).toBe(true);
    expect(batches[0].normal).toBeDefined();
    expect(batches[1].lit).toBe(false);
  });

  it('routes poly/circle items to passthrough, not batches', () => {
    const items: DrawItem[] = [
      img(tex(), 0),
      { t: 'poly', points: [{ x: 0, y: 0 }], color: '#000' },
      { t: 'circle', cx: 0, cy: 0, r: 1, color: '#000' },
    ];
    const { batches, passthrough } = buildInstanceBatches(items);
    expect(batches).toHaveLength(1);
    expect(passthrough).toHaveLength(2);
  });

  it('srcSize reads natural/intrinsic dimensions', () => {
    expect(srcSize(tex(128, 96))).toEqual({ w: 128, h: 96 });
    expect(srcSize({ naturalWidth: 40, naturalHeight: 20 } as unknown as CanvasImageSource)).toEqual({ w: 40, h: 20 });
  });

  it('applyViewTransform maps world rects to device space (screen = world·s + o)', () => {
    const { batches } = buildInstanceBatches([img(tex(), 10, { dy: 20, dw: 32, dh: 48 })]);
    // zoom 2 at dpr 2 ⇒ scale 4; camera offset (5,7) device px.
    applyViewTransform(batches[0], { sx: 4, sy: 4, ox: 5, oy: 7 });
    const inst = batches[0].instances[0];
    expect(inst.dx).toBe(10 * 4 + 5);
    expect(inst.dy).toBe(20 * 4 + 7);
    expect(inst.dw).toBe(32 * 4);
    expect(inst.dh).toBe(48 * 4);
  });

  it('carries the emissive map onto the batch, independent of lit', () => {
    const albedo = tex(), emissive = tex();
    // emissive WITHOUT normal/material ⇒ a glowing-but-unlit batch (lit stays false).
    const { batches } = buildInstanceBatches([img(albedo, 0, { maps: { emissive } })]);
    expect(batches[0].emissive).toBe(emissive);
    expect(batches[0].lit).toBe(false);
  });

  it('a sprite with full PBR + emissive carries all maps and is lit', () => {
    const albedo = tex(), normal = tex(), material = tex(), emissive = tex();
    const { batches } = buildInstanceBatches([img(albedo, 0, { maps: { normal, material, emissive } })]);
    expect(batches[0].normal).toBe(normal);
    expect(batches[0].material).toBe(material);
    expect(batches[0].emissive).toBe(emissive);
    expect(batches[0].lit).toBe(true);
  });

  it('applyViewTransform leaves UV and depth untouched', () => {
    const { batches } = buildInstanceBatches([img(tex(128, 64), 0, { frame: { sx: 64, sy: 0, sw: 32, sh: 64 } })]);
    const before = { ...batches[0].instances[0] };
    applyViewTransform(batches[0], { sx: 3, sy: 3, ox: 1, oy: 2 });
    const inst = batches[0].instances[0];
    expect([inst.u0, inst.v0, inst.u1, inst.v1]).toEqual([before.u0, before.v0, before.u1, before.v1]);
    expect(inst.depth).toBe(before.depth);
  });
});
