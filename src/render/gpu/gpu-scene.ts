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
  private depthTex: GPUTexture | null = null;
  private depthW = 0;
  private depthH = 0;
  /** Per-batch bind group cache, keyed by the albedo source (batch identity). */
  private bindCache = new WeakMap<CanvasImageSource, GPUBindGroup>();
  private texCache = new WeakMap<CanvasImageSource, GPUTexture>();

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
   *  growth. Cheap when the field is unchanged size (just two writeBuffers). */
  private uploadFields(heights: Float32Array, colors: Uint32Array): void {
    const { device } = this;
    const cells = heights.length;
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
    }
    device.queue.writeBuffer(this.terrainHeightsBuf, 0, heights as GPUAllowSharedBufferSource);
    device.queue.writeBuffer(this.terrainColorsBuf!, 0, colors as GPUAllowSharedBufferSource);
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
    const { items, lighting, w, h, xform, terrain } = opts;
    const { batches } = buildInstanceBatches(items);
    if (xform) for (const b of batches) applyViewTransform(b, xform);

    device.queue.writeBuffer(this.globalsBuf, 0, packGlobals({
      viewport: [w, h], bands: lighting.bands, ambient: lighting.ambient,
      sunDir: lighting.sunDir, sunColor: lighting.sunColor,
    }) as GPUAllowSharedBufferSource);

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

    // Pass 2 — entities (colour preserved if terrain drew; depth RESET so the
    // entity index-depth scheme is self-contained and always wins over terrain).
    const epass = enc.beginRenderPass({
      colorAttachments: [{
        view: colorView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: hasTerrain ? 'load' : 'clear', storeOp: 'store',
      }],
      depthStencilAttachment: { view: depthView, depthClearValue: 0.0, depthLoadOp: 'clear', depthStoreOp: 'store' },
    });
    epass.setPipeline(this.pipeline);
    epass.setVertexBuffer(0, this.quadBuf);
    epass.setBindGroup(0, this.globalsBind);
    const scratch: GPUBuffer[] = [];
    for (const b of batches) {
      if (b.instances.length === 0) continue;
      const data = packInstances(b.instances);
      const instBuf = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(instBuf, 0, data as GPUAllowSharedBufferSource);
      scratch.push(instBuf);
      epass.setBindGroup(1, this.batchBind(b));
      epass.setVertexBuffer(1, instBuf);
      epass.draw(QUAD_VERTEX_COUNT, b.instances.length);
    }
    epass.end();

    device.queue.submit([enc.finish()]);
    void device.queue.onSubmittedWorkDone().then(() => { for (const s of scratch) s.destroy(); });
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
