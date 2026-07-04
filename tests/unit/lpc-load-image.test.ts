// The LPC item-image cache must dedupe CONCURRENT loads: at boot many sheets
// compose at once and share body/hair/clothes PNGs — pre-fix, each concurrent
// request created its own Image (fetch + decode), the "LPC loading storm".
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { loadImage, clearImageCache } from '@/render/lpc/canvas/load-image.js';

/** Instrumented Image stub: records instances; loads settle when we say so. */
class FakeImage {
  static created: FakeImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  crossOrigin = '';
  private _src = '';
  constructor() { FakeImage.created.push(this); }
  set src(v: string) { this._src = v; }
  get src() { return this._src; }
}

describe('lpc load-image cache', () => {
  beforeEach(() => {
    clearImageCache();
    FakeImage.created = [];
    vi.stubGlobal('Image', FakeImage);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('N concurrent requests for the same src share ONE underlying load', async () => {
    const p1 = loadImage('spritesheets/body/walk.png');
    const p2 = loadImage('spritesheets/body/walk.png');
    const p3 = loadImage('spritesheets/body/walk.png');
    expect(FakeImage.created).toHaveLength(1);

    FakeImage.created[0].onload!();
    const [a, b, c] = await Promise.all([p1, p2, p3]);
    expect(a).toBe(FakeImage.created[0] as unknown as HTMLImageElement);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('a settled load is reused without a new Image', async () => {
    const p = loadImage('spritesheets/hair/plain.png');
    FakeImage.created[0].onload!();
    await p;
    const again = await loadImage('spritesheets/hair/plain.png');
    expect(FakeImage.created).toHaveLength(1);
    expect(again).toBe(FakeImage.created[0] as unknown as HTMLImageElement);
  });

  it('distinct srcs load independently', () => {
    void loadImage('spritesheets/a.png').catch(() => {});
    void loadImage('spritesheets/b.png').catch(() => {});
    expect(FakeImage.created).toHaveLength(2);
  });

  it('a missing variant falls back to the variantless path, still one shared promise', async () => {
    const p1 = loadImage('spritesheets/body/walk/black.png');
    const p2 = loadImage('spritesheets/body/walk/black.png');
    expect(FakeImage.created).toHaveLength(1);
    FakeImage.created[0].onerror!();               // variant 404s
    expect(FakeImage.created).toHaveLength(2);     // fallback attempt
    expect(FakeImage.created[1].src).toMatch(/body\/walk\.png$/);
    FakeImage.created[1].onload!();
    const [a, b] = await Promise.all([p1, p2]);
    expect(a).toBe(FakeImage.created[1] as unknown as HTMLImageElement);
    expect(b).toBe(a);
  });

  it('a permanently missing file rejects all sharers and caches the rejection', async () => {
    const p1 = loadImage('spritesheets/missing.png');
    const p2 = loadImage('spritesheets/missing.png');
    expect(FakeImage.created).toHaveLength(1);
    FakeImage.created[0].onerror!();
    await expect(p1).rejects.toThrow('Failed to load');
    await expect(p2).rejects.toThrow('Failed to load');
    // cached rejection — no new fetch attempt
    await expect(loadImage('spritesheets/missing.png')).rejects.toThrow('Failed to load');
    expect(FakeImage.created).toHaveLength(1);
  });

  it('clearImageCache releases the cache so the next request re-fetches', async () => {
    const p = loadImage('spritesheets/body/walk.png');
    FakeImage.created[0].onload!();
    await p;
    clearImageCache();
    void loadImage('spritesheets/body/walk.png').catch(() => {});
    expect(FakeImage.created).toHaveLength(2);
  });
});
