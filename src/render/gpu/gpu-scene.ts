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
import type { TerrainMesh } from '@/render/gpu/terrain-mesh';

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
  private terrainGlobalsBind: GPUBindGroup;
  private terrainPosBuf: GPUBuffer | null = null;
  private terrainColBuf: GPUBuffer | null = null;
  private terrainIdxBuf: GPUBuffer | null = null;
  private terrainCap = 0; // index capacity of the current terrain buffers
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

    // Terrain pipeline: two non-instanced vertex buffers (position xy, colour
    // rgb), indexed. Depth 'always' + no write ⇒ painter order via the iso
    // back-to-front index buffer; the entity pass (greater, > 0) draws over it.
    const terrainModule = device.createShaderModule({ code: TERRAIN_WGSL });
    this.terrainPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: terrainModule,
        entryPoint: 'vsMain',
        buffers: [
          { arrayStride: 8, stepMode: 'vertex', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
          { arrayStride: 12, stepMode: 'vertex', attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
        ],
      },
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
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'always' },
    });
    this.terrainGlobalsBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.terrainGlobalsBind = device.createBindGroup({
      layout: this.terrainPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.terrainGlobalsBuf } }],
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

  /** (Re)upload the terrain mesh into persistent GPU buffers, growing on demand. */
  private uploadTerrain(mesh: TerrainMesh): void {
    const { device } = this;
    const posBytes = mesh.positions.byteLength;
    const colBytes = mesh.colors.byteLength;
    const idxBytes = mesh.indices.byteLength;
    if (!this.terrainPosBuf || mesh.indices.length > this.terrainCap) {
      this.terrainPosBuf?.destroy();
      this.terrainColBuf?.destroy();
      this.terrainIdxBuf?.destroy();
      this.terrainPosBuf = device.createBuffer({ size: posBytes, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      this.terrainColBuf = device.createBuffer({ size: colBytes, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      this.terrainIdxBuf = device.createBuffer({ size: idxBytes, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
      this.terrainCap = mesh.indices.length;
    }
    device.queue.writeBuffer(this.terrainPosBuf, 0, mesh.positions as GPUAllowSharedBufferSource);
    device.queue.writeBuffer(this.terrainColBuf!, 0, mesh.colors as GPUAllowSharedBufferSource);
    device.queue.writeBuffer(this.terrainIdxBuf!, 0, mesh.indices as GPUAllowSharedBufferSource);
  }

  /**
   * Render one frame: the terrain heightfield mesh (if present) FIRST at back
   * depth, then the entity draw list over it — one render pass, one clear.
   * `w`,`h` = device-pixel target size. `xform` bakes the world→device camera
   * transform (into entity instances on the CPU; into the terrain uniform).
   */
  renderFrame(opts: {
    items: readonly DrawItem[];
    lighting: LightingState;
    w: number; h: number;
    xform?: ViewTransform;
    terrain?: TerrainMesh | null;
  }): void {
    const { device } = this;
    const { items, lighting, w, h, xform, terrain } = opts;
    const { batches } = buildInstanceBatches(items);
    if (xform) for (const b of batches) applyViewTransform(b, xform);

    device.queue.writeBuffer(this.globalsBuf, 0, packGlobals({
      viewport: [w, h], bands: lighting.bands, ambient: lighting.ambient,
      sunDir: lighting.sunDir, sunColor: lighting.sunColor,
    }) as GPUAllowSharedBufferSource);

    const hasTerrain = !!(terrain && terrain.indices.length > 0);
    if (hasTerrain) {
      this.uploadTerrain(terrain!);
      device.queue.writeBuffer(this.terrainGlobalsBuf, 0, packTerrainGlobals(
        [w, h], xform ?? { sx: 1, sy: 1, ox: 0, oy: 0 },
      ) as GPUAllowSharedBufferSource);
    }

    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: this.ctx.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 }, // transparent where no ground
        loadOp: 'clear', storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.ensureDepth(w, h),
        depthClearValue: 0.0, depthLoadOp: 'clear', depthStoreOp: 'store',
      },
    });

    // Terrain pass: flat ground, painter order via the back-to-front index buffer.
    if (hasTerrain) {
      pass.setPipeline(this.terrainPipeline);
      pass.setBindGroup(0, this.terrainGlobalsBind);
      pass.setVertexBuffer(0, this.terrainPosBuf!);
      pass.setVertexBuffer(1, this.terrainColBuf!);
      pass.setIndexBuffer(this.terrainIdxBuf!, 'uint32');
      pass.drawIndexed(terrain!.indices.length);
    }

    // Entity pass: instanced lit sprites over the ground.
    pass.setPipeline(this.pipeline);
    pass.setVertexBuffer(0, this.quadBuf);
    pass.setBindGroup(0, this.globalsBind);
    const scratch: GPUBuffer[] = [];
    for (const b of batches) {
      if (b.instances.length === 0) continue;
      const data = packInstances(b.instances);
      const instBuf = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(instBuf, 0, data as GPUAllowSharedBufferSource);
      scratch.push(instBuf);
      pass.setBindGroup(1, this.batchBind(b));
      pass.setVertexBuffer(1, instBuf);
      pass.draw(QUAD_VERTEX_COUNT, b.instances.length);
    }

    pass.end();
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
