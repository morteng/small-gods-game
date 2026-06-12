import { describe, it, expect, vi } from 'vitest';
import { PixiEntityLayer } from '@/render/pixi/pixi-entity-layer';
import type { DrawItem } from '@/render/iso/draw-list';

// ─── fake pixi.js module (no WebGL in jsdom) ─────────────────────────────────

class FakeTextureSource { scaleMode = 'linear'; }
class FakeTexture {
  source: FakeTextureSource;
  frame?: unknown;
  constructor(opts?: { source?: FakeTextureSource; frame?: unknown }) {
    this.source = opts?.source ?? new FakeTextureSource();
    this.frame = opts?.frame;
  }
  static fromCalls = 0;
  static from(_src: unknown): FakeTexture {
    FakeTexture.fromCalls++;
    return new FakeTexture();
  }
}
class FakeRectangle {
  constructor(public x: number, public y: number, public w: number, public h: number) {}
}
class FakeContainer {
  children: unknown[] = [];
  scale = { set: vi.fn() };
  position = { set: vi.fn() };
  addChild(c: unknown): void { this.children.push(c); }
  removeChildren(): void { this.children = []; }
}
class FakeSprite {
  texture: FakeTexture | null = null;
  width = 0; height = 0;
  x = 0; y = 0;
  position = { set: (x: number, y: number) => { this.x = x; this.y = y; } };
}
class FakeGraphics {
  ops: Array<[string, ...unknown[]]> = [];
  clear(): this { this.ops = []; return this; }
  poly(points: unknown, close: boolean): this { this.ops.push(['poly', points, close]); return this; }
  circle(x: number, y: number, r: number): this { this.ops.push(['circle', x, y, r]); return this; }
  fill(color: string): this { this.ops.push(['fill', color]); return this; }
}
class FakeWebGLRenderer {
  static failInit = false;
  canvas = { fake: true } as unknown as HTMLCanvasElement;
  resolution = 1;
  width = 0; height = 0;
  render = vi.fn();
  destroy = vi.fn();
  async init(o: { width: number; height: number; resolution: number }): Promise<void> {
    if (FakeWebGLRenderer.failInit) throw new Error('no webgl');
    this.resolution = o.resolution;
    this.width = o.width * o.resolution;
    this.height = o.height * o.resolution;
  }
  resize(w: number, h: number): void {
    this.width = w * this.resolution;
    this.height = h * this.resolution;
  }
}

const fakePixi = {
  WebGLRenderer: FakeWebGLRenderer,
  Container: FakeContainer,
  Sprite: FakeSprite,
  Graphics: FakeGraphics,
  Texture: FakeTexture,
  Rectangle: FakeRectangle,
} as unknown as typeof import('pixi.js');

const view = (over: Partial<{ cssWidth: number; cssHeight: number; dpr: number; zoom: number; camX: number; camY: number }> = {}) => ({
  cssWidth: over.cssWidth ?? 800,
  cssHeight: over.cssHeight ?? 600,
  dpr: over.dpr ?? 2,
  camera: { x: over.camX ?? 10, y: over.camY ?? 20, zoom: over.zoom ?? 2 },
});

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

async function readyLayer(): Promise<PixiEntityLayer> {
  const layer = new PixiEntityLayer(async () => fakePixi);
  layer.render([], view()); // kicks off init
  await tick();
  expect(layer.getState()).toBe('ready');
  return layer;
}

const img = { width: 64, height: 64 } as unknown as CanvasImageSource;

describe('PixiEntityLayer', () => {
  it('returns null until init completes, then the WebGL canvas', async () => {
    const layer = new PixiEntityLayer(async () => fakePixi);
    expect(layer.render([], view())).toBeNull();
    expect(layer.getState()).toBe('loading');
    await tick();
    expect(layer.getState()).toBe('ready');
    expect(layer.render([], view())).toEqual({ fake: true });
  });

  it('fails permanently when init throws (Canvas2D fallback forever)', async () => {
    FakeWebGLRenderer.failInit = true;
    try {
      const layer = new PixiEntityLayer(async () => fakePixi);
      layer.render([], view());
      await tick();
      expect(layer.getState()).toBe('failed');
      expect(layer.render([], view())).toBeNull();
    } finally {
      FakeWebGLRenderer.failInit = false;
    }
  });

  it('applies the pixel-snapped iso stage transform', async () => {
    const layer = await readyLayer();
    layer.render([], view({ zoom: 2, camX: 10.3, camY: 20.7 }));
    const stage = (layer as never as { stage: FakeContainer }).stage;
    expect(stage.scale.set).toHaveBeenCalledWith(2);
    // round(-cam·z): round(-20.6) = -21, round(-41.4) = -41
    expect(stage.position.set).toHaveBeenCalledWith(-21, -41);
  });

  it('batches consecutive shape items into ONE Graphics, preserving y-sort interleaving', async () => {
    const layer = await readyLayer();
    const items: DrawItem[] = [
      { t: 'poly', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], color: '#111111' },
      { t: 'circle', cx: 5, cy: 5, r: 2, color: '#222222' },
      { t: 'image', src: img, dx: 0, dy: 0, dw: 64, dh: 64 },
      { t: 'poly', points: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 3 }], color: '#333333' },
    ];
    layer.render(items, view());
    const stage = (layer as never as { stage: FakeContainer }).stage;
    // [Graphics(poly+circle), Sprite, Graphics(poly)] — order preserved.
    expect(stage.children).toHaveLength(3);
    expect(stage.children[0]).toBeInstanceOf(FakeGraphics);
    expect(stage.children[1]).toBeInstanceOf(FakeSprite);
    expect(stage.children[2]).toBeInstanceOf(FakeGraphics);
    expect((stage.children[0] as FakeGraphics).ops.map((o) => o[0])).toEqual(['poly', 'fill', 'circle', 'fill']);
  });

  it('positions and sizes sprites from the draw item', async () => {
    const layer = await readyLayer();
    layer.render([{ t: 'image', src: img, dx: 12, dy: 34, dw: 128, dh: 96 }], view());
    const stage = (layer as never as { stage: FakeContainer }).stage;
    const sprite = stage.children[0] as FakeSprite;
    expect([sprite.x, sprite.y, sprite.width, sprite.height]).toEqual([12, 34, 128, 96]);
  });

  it('caches the base texture per source and per sheet frame, with nearest sampling', async () => {
    const layer = await readyLayer();
    const before = FakeTexture.fromCalls;
    const frameA = { sx: 0, sy: 0, sw: 64, sh: 64 };
    const frameB = { sx: 64, sy: 0, sw: 64, sh: 64 };
    layer.render([
      { t: 'image', src: img, frame: frameA, dx: 0, dy: 0, dw: 64, dh: 64 },
      { t: 'image', src: img, frame: frameB, dx: 0, dy: 0, dw: 64, dh: 64 },
    ], view());
    layer.render([
      { t: 'image', src: img, frame: frameA, dx: 0, dy: 0, dw: 64, dh: 64 },
    ], view());
    // One Texture.from per SOURCE — frames reuse the base, repeats hit the cache.
    expect(FakeTexture.fromCalls - before).toBe(1);
    const stage = (layer as never as { stage: FakeContainer }).stage;
    const sprite = stage.children[0] as FakeSprite;
    expect(sprite.texture!.source.scaleMode).toBe('nearest');
    expect((sprite.texture!.frame as FakeRectangle).x).toBe(0);
  });

  it('reuses pooled sprites across frames', async () => {
    const layer = await readyLayer();
    layer.render([{ t: 'image', src: img, dx: 0, dy: 0, dw: 64, dh: 64 }], view());
    const stage = (layer as never as { stage: FakeContainer }).stage;
    const first = stage.children[0];
    layer.render([{ t: 'image', src: img, dx: 9, dy: 9, dw: 64, dh: 64 }], view());
    expect(stage.children[0]).toBe(first);
  });

  it('resizes the renderer when the viewport or dpr changes', async () => {
    const layer = await readyLayer();
    const renderer = (layer as never as { renderer: FakeWebGLRenderer }).renderer;
    layer.render([], view({ cssWidth: 400, cssHeight: 300, dpr: 2 }));
    expect([renderer.width, renderer.height]).toEqual([800, 600]);
    layer.render([], view({ cssWidth: 400, cssHeight: 300, dpr: 1 }));
    expect([renderer.width, renderer.height]).toEqual([400, 300]);
  });

  it('destroy() tears down the renderer and render() stays null', async () => {
    const layer = await readyLayer();
    const renderer = (layer as never as { renderer: FakeWebGLRenderer }).renderer;
    layer.destroy();
    expect(renderer.destroy).toHaveBeenCalled();
    expect(layer.render([], view())).toBeNull();
  });
});
