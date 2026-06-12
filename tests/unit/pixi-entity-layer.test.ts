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
  static WHITE = new FakeTexture();
  static fromCalls = 0;
  static from(_src: unknown): FakeTexture {
    FakeTexture.fromCalls++;
    return new FakeTexture();
  }
}
class FakeMeshGeometry {
  constructor(public opts: { positions: Float32Array; uvs: Float32Array; indices: Uint32Array }) {}
}
class FakeShader {
  resources: Record<string, unknown>;
  constructor(public opts: { gl: { vertex: string; fragment: string }; resources: Record<string, unknown> }) {
    // Mirror pixi: plain-object resources become uniform groups (`.uniforms`
    // holding the VALUES); texture sources pass through untouched.
    this.resources = {};
    for (const [k, v] of Object.entries(opts.resources)) {
      if (v instanceof FakeTextureSource) { this.resources[k] = v; continue; }
      const uniforms: Record<string, unknown> = {};
      for (const [uk, uv] of Object.entries(v as Record<string, { value: unknown }>)) uniforms[uk] = uv.value;
      this.resources[k] = { uniforms };
    }
  }
  static from(opts: ConstructorParameters<typeof FakeShader>[0]): FakeShader { return new FakeShader(opts); }
}
class FakeMesh {
  geometry: FakeMeshGeometry; shader: FakeShader;
  x = 0; y = 0; scaleX = 1; scaleY = 1;
  position = { set: (x: number, y: number) => { this.x = x; this.y = y; } };
  scale = { set: (x: number, y: number) => { this.scaleX = x; this.scaleY = y ?? x; } };
  constructor(opts: { geometry: FakeMeshGeometry; shader: FakeShader }) {
    this.geometry = opts.geometry; this.shader = opts.shader;
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
  Mesh: FakeMesh,
  MeshGeometry: FakeMeshGeometry,
  Shader: FakeShader,
} as unknown as typeof import('pixi.js');

import { DEFAULT_LIGHTING, type LightingState } from '@/render/lighting-state';

const view = (over: Partial<{ cssWidth: number; cssHeight: number; dpr: number; zoom: number; camX: number; camY: number; lighting: LightingState }> = {}) => ({
  cssWidth: over.cssWidth ?? 800,
  cssHeight: over.cssHeight ?? 600,
  dpr: over.dpr ?? 2,
  camera: { x: over.camX ?? 10, y: over.camY ?? 20, zoom: over.zoom ?? 2 },
  lighting: over.lighting,
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

describe('PixiEntityLayer — lit path (PBR Slice 3)', () => {
  const normal = { width: 64, height: 64 } as unknown as CanvasImageSource;
  const material = { width: 64, height: 64 } as unknown as CanvasImageSource;
  const litItem = (over: Partial<Extract<DrawItem, { t: 'image' }>> = {}): DrawItem => ({
    t: 'image', src: img, dx: 10, dy: 20, dw: 128, dh: 96,
    maps: { normal, material }, ...over,
  });
  const stageOf = (layer: PixiEntityLayer) => (layer as never as { stage: FakeContainer }).stage;

  it('an image with a normal map becomes a quad Mesh with the lit shader', async () => {
    const layer = await readyLayer();
    layer.render([litItem()], view({ lighting: DEFAULT_LIGHTING }));
    const mesh = stageOf(layer).children[0] as FakeMesh;
    expect(mesh).toBeInstanceOf(FakeMesh);
    // Unit quad scaled to the item's destination rect, positioned at dx/dy.
    expect([mesh.x, mesh.y, mesh.scaleX, mesh.scaleY]).toEqual([10, 20, 128, 96]);
    expect(Array.from(mesh.geometry.opts.positions)).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
    // All three maps bound as texture sources, nearest-sampled.
    const r = mesh.shader.resources;
    expect(r.uAlbedo).toBeInstanceOf(FakeTextureSource);
    expect(r.uNormalMap).toBeInstanceOf(FakeTextureSource);
    expect(r.uMaterialMap).toBeInstanceOf(FakeTextureSource);
    expect(r.uNormalMap).not.toBe(r.uAlbedo);
    expect((r.uAlbedo as FakeTextureSource).scaleMode).toBe('nearest');
  });

  it('writes the lighting uniforms every frame', async () => {
    const layer = await readyLayer();
    const lighting: LightingState = {
      enabled: true, ambient: [0.2, 0.2, 0.2], sunDir: [0, 1, 0], sunColor: [0.9, 0.8, 0.7], bands: 3,
    };
    layer.render([litItem()], view({ lighting }));
    const mesh = stageOf(layer).children[0] as FakeMesh;
    const u = (mesh.shader.resources.litUniforms as { uniforms: Record<string, unknown> }).uniforms;
    expect(u.uAmbient).toEqual([0.2, 0.2, 0.2]);
    expect(u.uSunDir).toEqual([0, 1, 0]);
    expect(u.uSunColor).toEqual([0.9, 0.8, 0.7]);
    expect(u.uBands).toBe(3);
  });

  it('a missing material map binds the white texture (AO 1)', async () => {
    const layer = await readyLayer();
    layer.render([litItem({ maps: { normal } })], view({ lighting: DEFAULT_LIGHTING }));
    const mesh = stageOf(layer).children[0] as FakeMesh;
    expect(mesh.shader.resources.uMaterialMap).toBe(FakeTexture.WHITE.source);
  });

  it('stays a plain Sprite when lighting is disabled or maps are absent', async () => {
    const layer = await readyLayer();
    // lighting absent
    layer.render([litItem()], view());
    expect(stageOf(layer).children[0]).toBeInstanceOf(FakeSprite);
    // lighting disabled
    layer.render([litItem()], view({ lighting: { ...DEFAULT_LIGHTING, enabled: false } }));
    expect(stageOf(layer).children[0]).toBeInstanceOf(FakeSprite);
    // no maps
    layer.render([{ t: 'image', src: img, dx: 0, dy: 0, dw: 64, dh: 64 }], view({ lighting: DEFAULT_LIGHTING }));
    expect(stageOf(layer).children[0]).toBeInstanceOf(FakeSprite);
  });

  it('preserves y-sort interleaving across shapes, lit meshes and plain sprites', async () => {
    const layer = await readyLayer();
    layer.render([
      { t: 'circle', cx: 1, cy: 1, r: 1, color: '#111111' },
      litItem(),
      { t: 'image', src: img, dx: 0, dy: 0, dw: 64, dh: 64 },
    ], view({ lighting: DEFAULT_LIGHTING }));
    const kids = stageOf(layer).children;
    expect(kids[0]).toBeInstanceOf(FakeGraphics);
    expect(kids[1]).toBeInstanceOf(FakeMesh);
    expect(kids[2]).toBeInstanceOf(FakeSprite);
  });

  it('reuses pooled lit meshes (and their shaders) across frames', async () => {
    const layer = await readyLayer();
    layer.render([litItem()], view({ lighting: DEFAULT_LIGHTING }));
    const first = stageOf(layer).children[0] as FakeMesh;
    layer.render([litItem({ dx: 99 })], view({ lighting: DEFAULT_LIGHTING }));
    const second = stageOf(layer).children[0] as FakeMesh;
    expect(second).toBe(first);
    expect(second.shader).toBe(first.shader);
    expect(second.x).toBe(99);
  });
});
