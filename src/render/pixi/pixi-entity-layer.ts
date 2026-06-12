/**
 * Incremental PixiJS WebGL entity layer (PBR epic, Slice 2 — parity).
 *
 * Executes the neutral entity draw list (see `entity-draw-list.ts`) on an
 * OFFSCREEN WebGL canvas; the iso renderer blits the result into the main
 * Canvas2D context between terrain and overlays, so z-order, input handling
 * and every overlay stay byte-for-byte where they were. Later slices replace
 * the plain sprites with lit G-buffer materials — placement stays put.
 *
 * - `pixi.js` is loaded LAZILY via dynamic import (its own Vite chunk) the
 *   first time `render()` is called; until then (and on any init failure)
 *   `render()` returns null and the caller falls back to Canvas2D.
 * - Textures are cached per source (WeakMap) + per sheet-frame; sources are
 *   assumed static once handed to the renderer (true for LPC sheets, tree
 *   sheets and generated/parametric building canvases — all composed once).
 * - Sprites and Graphics are pooled; consecutive shape items share one
 *   Graphics (they're adjacent in y-sort order, so batching preserves it).
 */
import type { DrawItem } from '@/render/iso/draw-list';
import { isoStageTransform } from '@/render/iso/entity-draw-list';

export interface PixiLayerView {
  /** Main-canvas CSS pixel size (viewport units, pre-DPR). */
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  camera: { x: number; y: number; zoom: number };
}

export type PixiBackendState = 'idle' | 'loading' | 'ready' | 'failed';

type PixiModule = typeof import('pixi.js');

export class PixiEntityLayer {
  private state: PixiBackendState = 'idle';
  private pixi: PixiModule | null = null;
  private renderer: import('pixi.js').WebGLRenderer | null = null;
  private stage: import('pixi.js').Container | null = null;
  private spritePool: import('pixi.js').Sprite[] = [];
  private gfxPool: import('pixi.js').Graphics[] = [];
  private textures = new WeakMap<object, { base: import('pixi.js').Texture; frames: Map<string, import('pixi.js').Texture> }>();
  private destroyed = false;

  constructor(private loadPixi: () => Promise<PixiModule> = () => import('pixi.js')) {}

  getState(): PixiBackendState { return this.state; }

  /**
   * Render the draw list; returns the WebGL canvas to composite, or null when
   * the backend isn't ready (first call kicks off the async init) or failed.
   */
  render(items: readonly DrawItem[], view: PixiLayerView): HTMLCanvasElement | null {
    if (this.state === 'idle') { void this.init(view); return null; }
    if (this.state !== 'ready' || !this.renderer || !this.stage || !this.pixi) return null;

    this.resize(view);
    const t = isoStageTransform(view.camera);
    this.stage.scale.set(t.scale);
    this.stage.position.set(t.x, t.y);

    this.populate(items);
    this.renderer.render(this.stage);
    return this.renderer.canvas as HTMLCanvasElement;
  }

  destroy(): void {
    this.destroyed = true;
    this.renderer?.destroy();
    this.renderer = null;
    this.stage = null;
    this.spritePool = [];
    this.gfxPool = [];
    this.state = 'failed'; // render() stays null forever after destroy
  }

  private async init(view: PixiLayerView): Promise<void> {
    this.state = 'loading';
    try {
      const pixi = await this.loadPixi();
      const renderer = new pixi.WebGLRenderer();
      await renderer.init({
        width: Math.max(1, view.cssWidth),
        height: Math.max(1, view.cssHeight),
        resolution: view.dpr,
        backgroundAlpha: 0,
        antialias: false,
        // Same-task drawImage after render() reads the buffer reliably; this
        // is belt-and-braces for browsers that clear aggressively.
        preserveDrawingBuffer: true,
        autoDensity: false,
      });
      if (this.destroyed) { renderer.destroy(); return; }
      this.pixi = pixi;
      this.renderer = renderer;
      this.stage = new pixi.Container();
      this.state = 'ready';
    } catch {
      // No WebGL / import failure → permanent session fallback to Canvas2D.
      this.state = 'failed';
    }
  }

  private resize(view: PixiLayerView): void {
    const r = this.renderer!;
    if (r.resolution !== view.dpr) r.resolution = view.dpr;
    if (r.width !== view.cssWidth * view.dpr || r.height !== view.cssHeight * view.dpr) {
      r.resize(Math.max(1, view.cssWidth), Math.max(1, view.cssHeight));
    }
  }

  private texture(src: CanvasImageSource, frame?: { sx: number; sy: number; sw: number; sh: number }): import('pixi.js').Texture {
    const pixi = this.pixi!;
    let entry = this.textures.get(src as object);
    if (!entry) {
      const base = pixi.Texture.from(src as Parameters<typeof pixi.Texture.from>[0]);
      base.source.scaleMode = 'nearest'; // pixel-art 1:1 rule
      entry = { base, frames: new Map() };
      this.textures.set(src as object, entry);
    }
    if (!frame) return entry.base;
    const key = `${frame.sx}:${frame.sy}:${frame.sw}:${frame.sh}`;
    let tex = entry.frames.get(key);
    if (!tex) {
      tex = new pixi.Texture({
        source: entry.base.source,
        frame: new pixi.Rectangle(frame.sx, frame.sy, frame.sw, frame.sh),
      });
      entry.frames.set(key, tex);
    }
    return tex;
  }

  /** Rebuild the stage children from the draw list (pooled, order-preserving). */
  private populate(items: readonly DrawItem[]): void {
    const pixi = this.pixi!;
    const stage = this.stage!;
    stage.removeChildren();
    let si = 0, gi = 0, i = 0;
    while (i < items.length) {
      const it = items[i];
      if (it.t === 'image') {
        const sprite = (this.spritePool[si] ??= new pixi.Sprite());
        si++;
        sprite.texture = this.texture(it.src, it.frame);
        sprite.position.set(it.dx, it.dy);
        sprite.width = it.dw;
        sprite.height = it.dh;
        stage.addChild(sprite);
        i++;
      } else {
        // Batch consecutive shape items into one Graphics — adjacent in
        // y-sort order, so a single display object preserves interleaving.
        const g = (this.gfxPool[gi] ??= new pixi.Graphics());
        gi++;
        g.clear();
        while (i < items.length && items[i].t !== 'image') {
          const s = items[i];
          if (s.t === 'poly') {
            g.poly(s.points, true).fill(s.color);
          } else if (s.t === 'circle') {
            g.circle(s.cx, s.cy, s.r).fill(s.color);
          }
          i++;
        }
        stage.addChild(g);
      }
    }
  }
}
