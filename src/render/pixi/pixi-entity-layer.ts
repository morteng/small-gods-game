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
import type { LightingState } from '@/render/lighting-state';
import { LIT_VERTEX, LIT_FRAGMENT, litUniformGroup, litUniformValues } from './lit-shader';

export interface PixiLayerView {
  /** Main-canvas CSS pixel size (viewport units, pre-DPR). */
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  camera: { x: number; y: number; zoom: number };
  /** Global lighting (PBR Slice 3); absent or disabled = every item unlit. */
  lighting?: LightingState;
}

export type PixiBackendState = 'idle' | 'loading' | 'ready' | 'failed';

type PixiModule = typeof import('pixi.js');
/** A pooled lit-mesh entry — the quad mesh + its (per-entry) custom shader. */
interface LitEntry {
  mesh: import('pixi.js').Mesh<import('pixi.js').MeshGeometry, import('pixi.js').Shader>;
  shader: import('pixi.js').Shader;
}

export class PixiEntityLayer {
  private state: PixiBackendState = 'idle';
  private pixi: PixiModule | null = null;
  private renderer: import('pixi.js').WebGLRenderer | null = null;
  private stage: import('pixi.js').Container | null = null;
  private spritePool: import('pixi.js').Sprite[] = [];
  private gfxPool: import('pixi.js').Graphics[] = [];
  private litPool: LitEntry[] = [];
  private shadowPool: import('pixi.js').Sprite[] = [];
  private shadowLayer: import('pixi.js').Container | null = null;
  private quadGeometry: import('pixi.js').MeshGeometry | null = null;
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

    this.populate(items, view.lighting);
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
    this.litPool = [];
    this.shadowPool = [];
    this.shadowLayer = null;
    this.quadGeometry = null;
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

  /**
   * One pooled lit mesh: a unit quad (honest 0..1 UVs — unlike a Filter, never
   * clipped by the viewport) with the banded-lighting shader. Each pool entry
   * owns its Shader so per-building textures can differ; the light uniforms are
   * rewritten every frame (the group is non-static, so pixi re-uploads it).
   */
  private litMesh(li: number, lighting: LightingState): LitEntry {
    const pixi = this.pixi!;
    let entry = this.litPool[li];
    if (!entry) {
      this.quadGeometry ??= new pixi.MeshGeometry({
        positions: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      });
      const white = pixi.Texture.WHITE.source;
      const shader = pixi.Shader.from({
        gl: { vertex: LIT_VERTEX, fragment: LIT_FRAGMENT },
        resources: {
          uAlbedo: white, uNormalMap: white, uMaterialMap: white,
          litUniforms: litUniformGroup(lighting),
        },
      });
      entry = { mesh: new pixi.Mesh({ geometry: this.quadGeometry, shader }), shader };
      this.litPool[li] = entry;
    }
    return entry;
  }

  /**
   * Projected cast shadows: every image item (building/NPC/tree) drops a
   * black-tinted copy of its silhouette, flipped past its foot line and
   * skewed along the screen-space sun azimuth — the classic 2D projected
   * shadow. All shadows live in ONE container at the bottom of the stage
   * (alpha applied at the container, so overlapping shadows don't
   * double-darken into pure black) — they fall across terrain and the bases
   * of whatever stands behind.
   */
  private populateShadows(items: readonly DrawItem[], lighting: LightingState): void {
    const pixi = this.pixi!;
    const layer = (this.shadowLayer ??= new pixi.Container());
    layer.removeChildren();
    layer.alpha = 0.32;
    this.stage!.addChild(layer);
    // Screen-space shadow vector per unit of sprite height (sun → away from sun),
    // damped so shadows stay readable rather than photometrically long.
    const [sx, sy, sz] = lighting.sunDir;
    const z = Math.max(0.3, sz);
    const len = 0.5;
    const stretch = Math.min(1.2, (sy / z) * len);     // vertical squash of the flipped copy
    const lean = Math.min(1.2, (-sx / z) * len);       // horizontal shear per unit height
    if (stretch <= 0.05) return;
    let pi = 0;
    for (const it of items) {
      if (it.t !== 'image') continue;
      const s = (this.shadowPool[pi] ??= new pixi.Sprite());
      pi++;
      s.texture = this.texture(it.src, it.frame);
      s.tint = 0x000000;
      s.anchor.set(0, 1);
      s.position.set(it.dx, it.dy + it.dh);
      s.width = it.dw;
      s.height = it.dh * stretch;
      s.scale.y = -Math.abs(s.scale.y);                // flip past the foot line
      // Lean along the sun azimuth. The y-flip mirrors the shear, so negate to
      // keep the shadow falling AWAY from the sun (verified in-browser).
      s.skew.x = -Math.atan2(lean, 1);
      layer.addChild(s);
    }
  }

  /** Rebuild the stage children from the draw list (pooled, order-preserving). */
  private populate(items: readonly DrawItem[], lighting?: LightingState): void {
    const pixi = this.pixi!;
    const stage = this.stage!;
    stage.removeChildren();
    const lit = lighting?.enabled === true;
    if (lit) this.populateShadows(items, lighting!);
    let si = 0, gi = 0, li = 0, i = 0;
    while (i < items.length) {
      const it = items[i];
      if (it.t === 'image' && lit && it.maps?.normal) {
        // Lit building sprite: albedo + co-registered normal/AO under the
        // banded sun. A missing material map degrades to AO 1 (white texture).
        const { mesh, shader } = this.litMesh(li, lighting!);
        li++;
        shader.resources.uAlbedo = this.texture(it.src).source;
        shader.resources.uNormalMap = this.texture(it.maps.normal).source;
        shader.resources.uMaterialMap = it.maps.material
          ? this.texture(it.maps.material).source
          : pixi.Texture.WHITE.source;
        const u = (shader.resources.litUniforms as { uniforms: Record<string, unknown> }).uniforms;
        const v = litUniformValues(lighting!);
        u.uAmbient = v.uAmbient; u.uSunDir = v.uSunDir; u.uSunColor = v.uSunColor; u.uBands = v.uBands;
        mesh.position.set(it.dx, it.dy);
        mesh.scale.set(it.dw, it.dh);
        stage.addChild(mesh);
        i++;
      } else if (it.t === 'image') {
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
