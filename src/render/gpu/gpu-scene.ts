/// <reference types="@webgpu/types" />
// src/render/gpu/gpu-scene.ts
//
// R2c — the raw-WebGPU instanced lit-sprite scene. Consumes the neutral draw
// list (the SAME items the Canvas2D/Pixi paths consume), buckets them into
// texture batches (`instance-batch.ts`), and draws ONE instanced call per
// batch with the banded-PBR WGSL (`lit-wgsl.ts`). Pure GPU glue — all the data
// math it relies on is Node-tested (instance-batch / instance-buffer).
//
// Lighting policy note (matches the current WebGL layer): items WITHOUT
// companion maps are bound to neutral placeholders (flat normal a=0 ⇒ flat
// camera-facing normal; material a=0 ⇒ AO 1), so map-less sprites are lit by
// the flat-normal diffuse term. A follow-up adds an explicit unlit gate so
// map-less sprites render at full albedo exactly like today.

import type { DrawItem } from '@/render/iso/draw-list';
import type { LightingState } from '@/render/lighting-state';
import {
  buildInstanceBatches, srcSize, applyViewTransform,
  type InstanceBatch, type ViewTransform,
} from '@/render/gpu/instance-batch';
import {
  packInstances, packGlobals, packTerrainGlobals,
  QUAD_STRIP, QUAD_VERTEX_COUNT, INSTANCE_STRIDE,
} from '@/render/gpu/instance-buffer';
import { LIT_WGSL } from '@/render/gpu/wgsl/lit-wgsl';
import { TERRAIN_WGSL } from '@/render/gpu/wgsl/terrain-wgsl';
import { SHADOW_WGSL, SHADOW_COMPOSITE_WGSL } from '@/render/gpu/wgsl/shadow-wgsl';
import { SHAPE_WGSL } from '@/render/gpu/wgsl/shape-wgsl';
import {
  buildShadowBatches, packShadowInstances, SHADOW_ALPHA,
  SHADOW_INSTANCE_STRIDE,
} from '@/render/gpu/shadow-instance';
import { buildShapeVertices, SHAPE_VERTEX_STRIDE } from '@/render/gpu/shape-geometry';
import { liftDrawList } from '@/render/gpu/terrain-lift';
import type { GpuContext } from '@/render/gpu/webgpu-context';
import type { TerrainField } from '@/render/gpu/terrain-field';

const DEPTH_FORMAT: GPUTextureFormat = 'depth24plus';

export class GpuScene {
  private device: GPUDevice;
  private ctx: GPUCanvasContext;
  private pipeline: GPURenderPipeline;
  private sampler: GPUSampler;
  private quadBuf: GPUBuffer;
  private globalsBuf: GPUBuffer;
  private globalsBind: GPUBindGroup;
  private flatNormal: GPUTexture;
  private neutralMaterial: GPUTexture;
  // Terrain pass (R2d): flat per-vertex-colour heightfield mesh, drawn first.
  private terrainPipeline: GPURenderPipeline;
  private terrainGlobalsBuf: GPUBuffer;
  // Buffer-driven terrain (T1): height + colour storage buffers; the bind group
  // is rebuilt whenever they reallocate (grow-on-demand by cell count).
  private terrainHeightsBuf: GPUBuffer | null = null;
  private terrainColorsBuf: GPUBuffer | null = null;
  private terrainBind: GPUBindGroup | null = null;
  private terrainCellCap = 0;
  // Last-uploaded field arrays — skip the re-upload when unchanged by reference.
  private lastHeights: Float32Array | null = null;
  private lastColors: Uint32Array | null = null;
  private depthTex: GPUTexture | null = null;
  private depthW = 0;
  private depthH = 0;
  // Cast-shadow pass: accumulate parallelogram silhouettes into an offscreen
  // texture (union via src-over), then composite once at SHADOW_ALPHA so
  // overlaps don't double-darken (the GPU port of the Pixi shadow container).
  private shadowPipeline: GPURenderPipeline;
  private shadowGlobalsBuf: GPUBuffer;
  private shadowGlobalsBind: GPUBindGroup;
  private compositePipeline: GPURenderPipeline;
  private compositeGlobalsBuf: GPUBuffer;
  // Solid-colour shape pass (poly/circle parity): drawn in the entity pass,
  // sharing its depth buffer so shapes interleave with sprites by depth.
  private shapePipeline: GPURenderPipeline;
  private shapeGlobalsBuf: GPUBuffer;
  private shapeGlobalsBind: GPUBindGroup;
  private shadowTex: GPUTexture | null = null;
  private shadowW = 0;
  private shadowH = 0;
  private compositeBind: GPUBindGroup | null = null;
  private shadowBindCache = new WeakMap<CanvasImageSource, GPUBindGroup>();
  /** Per-batch bind group cache, keyed by the albedo source (batch identity). */
  private bindCache = new WeakMap<CanvasImageSource, GPUBindGroup>();
  private texCache = new WeakMap<CanvasImageSource, GPUTexture>();
  /** Persistent, grow-on-demand vertex/instance buffers (one per stream), reused
   *  every frame instead of allocating + destroying dozens of buffers per frame. */
  private dynBufs = new Map<string, { buf: GPUBuffer; cap: number }>();

  constructor(gpu: GpuContext) {
    this.device = gpu.device;
    this.ctx = gpu.ctx;
    const { device } = this;

    const module = device.createShaderModule({ code: LIT_WGSL });

    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'vsMain',
        buffers: [
          { arrayStride: 8, stepMode: 'vertex', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
          {
            arrayStride: INSTANCE_STRIDE, stepMode: 'instance', attributes: [
              { shaderLocation: 1, offset: 0, format: 'float32x4' },  // iRect
              { shaderLocation: 2, offset: 16, format: 'float32x4' }, // iUV
              { shaderLocation: 3, offset: 32, format: 'float32' },   // iDepth
            ],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: 'fsMain',
        targets: [{
          format: gpu.format,
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
          },
        }],
      },
      primitive: { topology: 'triangle-strip' },
      // larger depth = in front (matches painter-order depth encoding); clear to 0.
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'greater' },
    });

    this.sampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });

    this.quadBuf = device.createBuffer({ size: QUAD_STRIP.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.quadBuf, 0, QUAD_STRIP);

    this.globalsBuf = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.globalsBind = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.globalsBuf } }],
    });

    this.flatNormal = this.make1x1([128, 128, 255, 0]);      // a=0 ⇒ flat normal
    this.neutralMaterial = this.make1x1([0, 255, 0, 0]);     // a=0 ⇒ AO 1

    // Terrain pipeline (T1): NO vertex buffers — the grid is generated in the
    // vertex shader from @builtin(vertex_index) + the height/colour storage
    // buffers. Terrain owns its OWN depth pass (spatial iso depth, greater,
    // write), so it self-occludes; entities then draw over it in pass 2.
    const terrainModule = device.createShaderModule({ code: TERRAIN_WGSL });
    this.terrainPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: terrainModule, entryPoint: 'vsMain' },
      fragment: {
        module: terrainModule,
        entryPoint: 'fsMain',
        targets: [{
          format: gpu.format,
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'greater' },
    });
    this.terrainGlobalsBuf = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // Shadow accumulation pipeline: parallelogram quads (4 corners) → premult
    // black into the offscreen shadow texture, unioned via src-over. No depth.
    const shadowModule = device.createShaderModule({ code: SHADOW_WGSL });
    this.shadowPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shadowModule,
        entryPoint: 'vsMain',
        buffers: [
          { arrayStride: 8, stepMode: 'vertex', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
          {
            arrayStride: SHADOW_INSTANCE_STRIDE, stepMode: 'instance', attributes: [
              { shaderLocation: 1, offset: 0, format: 'float32x4' },  // cTop
              { shaderLocation: 2, offset: 16, format: 'float32x4' }, // cBot
              { shaderLocation: 3, offset: 32, format: 'float32x4' }, // iUV
            ],
          },
        ],
      },
      fragment: {
        module: shadowModule,
        entryPoint: 'fsMain',
        targets: [{
          format: 'rgba8unorm',
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
          },
        }],
      },
      primitive: { topology: 'triangle-strip' },
    });
    this.shadowGlobalsBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.shadowGlobalsBind = device.createBindGroup({
      layout: this.shadowPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.shadowGlobalsBuf } }],
    });

    // Composite pipeline: fullscreen triangle samples the shadow texture and
    // lays the union over the scene at the capped container alpha (no depth).
    const compositeModule = device.createShaderModule({ code: SHADOW_COMPOSITE_WGSL });
    this.compositePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: compositeModule, entryPoint: 'vsMain' },
      fragment: {
        module: compositeModule,
        entryPoint: 'fsMain',
        targets: [{
          format: gpu.format,
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });
    this.compositeGlobalsBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.compositeGlobalsBuf, 0, new Float32Array([SHADOW_ALPHA, 0, 0, 0]));

    // Solid-colour shape pipeline: per-vertex (pos+depth, colour) triangles.
    // SAME colour target + blend + depth scheme as the entity pipeline so it can
    // run in the entity pass and depth-interleave with sprites.
    const shapeModule = device.createShaderModule({ code: SHAPE_WGSL });
    this.shapePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shapeModule,
        entryPoint: 'vsMain',
        buffers: [{
          arrayStride: SHAPE_VERTEX_STRIDE, stepMode: 'vertex', attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },  // x, y, depth
            { shaderLocation: 1, offset: 12, format: 'float32x4' }, // rgba
          ],
        }],
      },
      fragment: {
        module: shapeModule,
        entryPoint: 'fsMain',
        targets: [{
          format: gpu.format,
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'greater' },
    });
    this.shapeGlobalsBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.shapeGlobalsBind = device.createBindGroup({
      layout: this.shapePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.shapeGlobalsBuf } }],
    });
  }

  private make1x1(rgba: [number, number, number, number]): GPUTexture {
    const tex = this.device.createTexture({
      size: [1, 1, 1], format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.device.queue.writeTexture({ texture: tex }, new Uint8Array(rgba), { bytesPerRow: 4, rowsPerImage: 1 }, [1, 1, 1]);
    return tex;
  }

  private uploadTexture(src: CanvasImageSource, premultiply: boolean): GPUTexture {
    const cached = this.texCache.get(src);
    if (cached) return cached;
    const { w, h } = srcSize(src);
    const tex = this.device.createTexture({
      size: [Math.max(1, w), Math.max(1, h), 1], format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture(
      // draw-list sources are canvases/images (never SVG); narrow for the GPU API.
      { source: src as GPUCopyExternalImageSource, flipY: false },
      { texture: tex, premultipliedAlpha: premultiply },
      [Math.max(1, w), Math.max(1, h), 1],
    );
    this.texCache.set(src, tex);
    return tex;
  }

  private batchBind(b: InstanceBatch): GPUBindGroup {
    const cached = this.bindCache.get(b.texture);
    if (cached) return cached;
    const albedo = this.uploadTexture(b.texture, true);
    const normal = b.normal ? this.uploadTexture(b.normal, false) : this.flatNormal;
    const material = b.material ? this.uploadTexture(b.material, false) : this.neutralMaterial;
    const bind = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: albedo.createView() },
        { binding: 2, resource: normal.createView() },
        { binding: 3, resource: material.createView() },
      ],
    });
    this.bindCache.set(b.texture, bind);
    return bind;
  }

  /** Per-source bind group for the shadow pass (sampler + alpha-sampled tex). */
  private shadowBind(texture: CanvasImageSource): GPUBindGroup {
    const cached = this.shadowBindCache.get(texture);
    if (cached) return cached;
    // Reuse the entity albedo upload (same src) — only the alpha is read.
    const tex = this.uploadTexture(texture, true);
    const bind = this.device.createBindGroup({
      layout: this.shadowPipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: tex.createView() },
      ],
    });
    this.shadowBindCache.set(texture, bind);
    return bind;
  }

  /** (Re)create the offscreen shadow texture + its composite bind group. */
  private ensureShadow(w: number, h: number): GPUTextureView {
    if (!this.shadowTex || this.shadowW !== w || this.shadowH !== h) {
      this.shadowTex?.destroy();
      this.shadowTex = this.device.createTexture({
        size: [w, h, 1], format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      this.shadowW = w;
      this.shadowH = h;
      this.compositeBind = this.device.createBindGroup({
        layout: this.compositePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.compositeGlobalsBuf } },
          { binding: 1, resource: this.sampler },
          { binding: 2, resource: this.shadowTex.createView() },
        ],
      });
    }
    return this.shadowTex.createView();
  }

  /** A persistent VERTEX|COPY_DST buffer for `key`, grown geometrically to fit
   *  `bytes`. Reused across frames — no per-frame create/destroy churn. */
  private dynBuf(key: string, bytes: number): GPUBuffer {
    let e = this.dynBufs.get(key);
    if (!e || e.cap < bytes) {
      e?.buf.destroy();
      const cap = Math.max(bytes, (e?.cap ?? 1024) * 2);
      const buf = this.device.createBuffer({ size: cap, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      e = { buf, cap };
      this.dynBufs.set(key, e);
    }
    return e.buf;
  }

  private ensureDepth(w: number, h: number): GPUTextureView {
    if (!this.depthTex || this.depthW !== w || this.depthH !== h) {
      this.depthTex?.destroy();
      this.depthTex = this.device.createTexture({
        size: [w, h, 1], format: DEPTH_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.depthW = w;
      this.depthH = h;
    }
    return this.depthTex.createView();
  }

  /** (Re)upload the terrain field buffers, growing + rebinding on cell-count
   *  growth. Skips the writeBuffer when the field ARRAYS are unchanged by
   *  reference (the common case: `getHeightfield` is memoised and the colour
   *  field is now memoised too), so a static world re-uploads nothing per frame. */
  private uploadFields(heights: Float32Array, colors: Uint32Array): void {
    const { device } = this;
    const cells = heights.length;
    let realloc = false;
    if (!this.terrainHeightsBuf || cells > this.terrainCellCap) {
      this.terrainHeightsBuf?.destroy();
      this.terrainColorsBuf?.destroy();
      this.terrainHeightsBuf = device.createBuffer({ size: cells * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.terrainColorsBuf = device.createBuffer({ size: cells * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.terrainCellCap = cells;
      this.terrainBind = device.createBindGroup({
        layout: this.terrainPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.terrainGlobalsBuf } },
          { binding: 1, resource: { buffer: this.terrainHeightsBuf } },
          { binding: 2, resource: { buffer: this.terrainColorsBuf } },
        ],
      });
      realloc = true;
    }
    if (realloc || heights !== this.lastHeights) {
      device.queue.writeBuffer(this.terrainHeightsBuf, 0, heights as GPUAllowSharedBufferSource);
      this.lastHeights = heights;
    }
    if (realloc || colors !== this.lastColors) {
      device.queue.writeBuffer(this.terrainColorsBuf!, 0, colors as GPUAllowSharedBufferSource);
      this.lastColors = colors;
    }
  }

  /**
   * Render one frame: terrain (buffer-driven heightfield, T1) in its OWN depth
   * pass, then the entity draw list over it in a second pass (depth reset so the
   * two depth schemes never mix; colour preserved). `w`,`h` = device-pixel size.
   */
  renderFrame(opts: {
    items: readonly DrawItem[];
    lighting: LightingState;
    w: number; h: number;
    xform?: ViewTransform;
    terrain?: TerrainField | null;
  }): void {
    const { device } = this;
    const { items: rawItems, lighting, w, h, xform, terrain } = opts;
    // Lift entities onto the GPU terrain surface (foot-z parity) before any
    // batching/shadow/shape work, so sprites, fallback shapes and cast shadows
    // all ride the heightfield together. No-op when there's no terrain.
    const items = terrain ? liftDrawList(rawItems, terrain) : rawItems;
    const { batches } = buildInstanceBatches(items);
    if (xform) for (const b of batches) applyViewTransform(b, xform);

    // Cast-shadow parallelograms (world coords → device via the same xform).
    const shadowBatches = lighting.enabled
      ? buildShadowBatches(items, lighting, xform).filter(b => b.instances.length > 0)
      : [];
    const hasShadows = shadowBatches.length > 0;

    device.queue.writeBuffer(this.globalsBuf, 0, packGlobals({
      viewport: [w, h], bands: lighting.bands, ambient: lighting.ambient,
      sunDir: lighting.sunDir, sunColor: lighting.sunColor,
    }) as GPUAllowSharedBufferSource);
    if (hasShadows) {
      device.queue.writeBuffer(this.shadowGlobalsBuf, 0, new Float32Array([w, h, 0, 0]));
    }

    const hasTerrain = !!(terrain && terrain.vertexCount > 0 && terrain.heights.length > 0);
    if (hasTerrain) {
      this.uploadFields(terrain!.heights, terrain!.colors);
      device.queue.writeBuffer(this.terrainGlobalsBuf, 0,
        packTerrainGlobals(terrain!.globals) as GPUAllowSharedBufferSource);
    }

    const enc = device.createCommandEncoder();
    const colorView = this.ctx.getCurrentTexture().createView();
    const depthView = this.ensureDepth(w, h);

    // Pass 1 — terrain (own depth: spatial iso depth, greater, write).
    if (hasTerrain) {
      const tpass = enc.beginRenderPass({
        colorAttachments: [{ view: colorView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }],
        depthStencilAttachment: { view: depthView, depthClearValue: 0.0, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      tpass.setPipeline(this.terrainPipeline);
      tpass.setBindGroup(0, this.terrainBind!);
      tpass.draw(terrain!.vertexCount);
      tpass.end();
    }
    // `colorCleared` tracks whether any prior pass has written the colour
    // target, so the FIRST colour pass clears and the rest load.
    let colorCleared = hasTerrain;

    // Pass 1.5 — cast shadows: accumulate parallelogram silhouettes into the
    // offscreen shadow texture (union via src-over), then composite the union
    // once over the scene at the capped alpha (so overlaps don't double-darken).
    // Drawn between terrain and entities → shadows sit on the ground, under the
    // sprites that cast them.
    if (hasShadows) {
      const shadowView = this.ensureShadow(w, h);
      const apass = enc.beginRenderPass({
        colorAttachments: [{ view: shadowView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }],
      });
      apass.setPipeline(this.shadowPipeline);
      apass.setVertexBuffer(0, this.quadBuf);
      apass.setBindGroup(0, this.shadowGlobalsBind);
      const shadowInst = shadowBatches.reduce((s, b) => s + b.instances.length, 0);
      const shadowBuf = this.dynBuf('shadow', shadowInst * SHADOW_INSTANCE_STRIDE);
      let soff = 0;
      for (const b of shadowBatches) {
        const data = packShadowInstances(b.instances);
        device.queue.writeBuffer(shadowBuf, soff, data as GPUAllowSharedBufferSource);
        apass.setBindGroup(1, this.shadowBind(b.texture));
        apass.setVertexBuffer(1, shadowBuf, soff);
        apass.draw(QUAD_VERTEX_COUNT, b.instances.length);
        soff += data.byteLength;
      }
      apass.end();

      const cpass = enc.beginRenderPass({
        colorAttachments: [{
          view: colorView, clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: colorCleared ? 'load' : 'clear', storeOp: 'store',
        }],
      });
      cpass.setPipeline(this.compositePipeline);
      cpass.setBindGroup(0, this.compositeBind!);
      cpass.draw(3);
      cpass.end();
      colorCleared = true;
    }

    // Pass 2 — entities (colour preserved if terrain/shadows drew; depth RESET so
    // the entity index-depth scheme is self-contained and always wins over terrain).
    const epass = enc.beginRenderPass({
      colorAttachments: [{
        view: colorView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: colorCleared ? 'load' : 'clear', storeOp: 'store',
      }],
      depthStencilAttachment: { view: depthView, depthClearValue: 0.0, depthLoadOp: 'clear', depthStoreOp: 'store' },
    });
    epass.setPipeline(this.pipeline);
    epass.setVertexBuffer(0, this.quadBuf);
    epass.setBindGroup(0, this.globalsBind);
    const entInst = batches.reduce((s, b) => s + b.instances.length, 0);
    if (entInst > 0) {
      const entBuf = this.dynBuf('entity', entInst * INSTANCE_STRIDE);
      let eoff = 0;
      for (const b of batches) {
        if (b.instances.length === 0) continue;
        const data = packInstances(b.instances);
        device.queue.writeBuffer(entBuf, eoff, data as GPUAllowSharedBufferSource);
        epass.setBindGroup(1, this.batchBind(b));
        epass.setVertexBuffer(1, entBuf, eoff);
        epass.draw(QUAD_VERTEX_COUNT, b.instances.length);
        eoff += data.byteLength;
      }
    }

    // Solid-colour shapes (poly/circle) — same pass + depth buffer, so they
    // interleave with sprites by their list-order depth.
    const shapes = buildShapeVertices(items, xform);
    if (shapes.vertexCount > 0) {
      device.queue.writeBuffer(this.shapeGlobalsBuf, 0, new Float32Array([w, h, 0, 0]));
      const sBuf = this.dynBuf('shape', shapes.vertices.byteLength);
      device.queue.writeBuffer(sBuf, 0, shapes.vertices as GPUAllowSharedBufferSource);
      epass.setPipeline(this.shapePipeline);
      epass.setBindGroup(0, this.shapeGlobalsBind);
      epass.setVertexBuffer(0, sBuf);
      epass.draw(shapes.vertexCount);
    }
    epass.end();

    device.queue.submit([enc.finish()]);
  }

  /**
   * Render the entity draw list for one frame (no terrain). Thin wrapper over
   * {@link renderFrame} — preserves the original signature + the in-browser
   * verified entity-only path.
   */
  render(
    items: readonly DrawItem[], lighting: LightingState, w: number, h: number,
    xform?: ViewTransform,
  ): void {
    this.renderFrame({ items, lighting, w, h, xform });
  }

  /** Number of instanced draw calls the last/most-recent batch set would issue. */
  drawCallCount(items: readonly DrawItem[]): number {
    return buildInstanceBatches(items).batches.filter(b => b.instances.length > 0).length;
  }
}
