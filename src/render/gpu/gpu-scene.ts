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
  buildInstanceBatches, srcSize,
  type InstanceBatch, type ViewTransform,
} from '@/render/gpu/instance-batch';
import {
  packInstances, packGlobals, packTerrainGlobals,
  QUAD_STRIP, QUAD_VERTEX_COUNT, INSTANCE_STRIDE,
} from '@/render/gpu/instance-buffer';
import { LIT_WGSL } from '@/render/gpu/wgsl/lit-wgsl';
import { TERRAIN_WGSL } from '@/render/gpu/wgsl/terrain-wgsl';
import { WATER_WGSL } from '@/render/gpu/wgsl/water-wgsl';
import { OCEAN_BACKDROP_WGSL } from '@/render/gpu/wgsl/ocean-backdrop-wgsl';
import { RIBBON_WGSL } from '@/render/gpu/wgsl/ribbon-wgsl';
import { RIBBON_FLOATS_PER_VERTEX, type RibbonMesh } from '@/render/ribbon/ribbon-geometry';
import { roadMaterialAtlas } from '@/render/gpu/road-material-atlas';
import { SHADOW_WGSL } from '@/render/gpu/wgsl/shadow-wgsl';
import { SHAPE_WGSL } from '@/render/gpu/wgsl/shape-wgsl';
import { BLIT_WGSL } from '@/render/gpu/wgsl/blit-wgsl';
import {
  buildShadowBatches, packShadowInstances, SHADOW_ALPHA,
  SHADOW_INSTANCE_STRIDE, type ShadowBatch,
} from '@/render/gpu/shadow-instance';
import { buildShapeVertices, SHAPE_VERTEX_STRIDE } from '@/render/gpu/shape-geometry';
import { liftDrawList } from '@/render/gpu/terrain-lift';
import type { GpuContext } from '@/render/gpu/webgpu-context';
import type { TerrainField } from '@/render/gpu/terrain-field';
import type { WaterField } from '@/render/gpu/water-field';
import { UiPass } from '@/render/ui/ui-pass';
import type { UiDrawGroup } from '@/render/ui/ui-batcher';

const DEPTH_FORMAT: GPUTextureFormat = 'depth24plus';

/** Shared per-frame render state threaded through the per-pass helpers (so they
 *  don't each take a dozen params). `colorCleared` is mutated as passes draw — the
 *  FIRST colour pass clears the target, the rest load. `out` set ⇒ the scene
 *  passes target the low-res offscreen and a blit upscales to `swapView`. */
interface PassCtx {
  enc: GPUCommandEncoder;
  /** Where the scene passes draw (offscreen low-res when `out` set, else swapchain). */
  colorView: GPUTextureView;
  /** The swapchain view (blit + UI target when `out` set). */
  swapView: GPUTextureView;
  depthView: GPUTextureView;
  /** Scene (low-res) size in px. */
  w: number; h: number;
  /** Swapchain size when rendering through the offscreen target; absent ⇒ direct. */
  out?: { w: number; h: number };
  ocean: GPUColor;
  colorCleared: boolean;
}

export class GpuScene {
  private device: GPUDevice;
  private ctx: GPUCanvasContext;
  private format: GPUTextureFormat;
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
  // T-A: shared climate fields the material shader reads (moisture/temperature).
  private terrainMoistureBuf: GPUBuffer | null = null;
  private terrainTemperatureBuf: GPUBuffer | null = null;
  private terrainBind: GPUBindGroup | null = null;
  private terrainCellCap = 0;
  // Last-uploaded field arrays — skip the re-upload when unchanged by reference.
  private lastHeights: Float32Array | null = null;
  private lastColors: Uint32Array | null = null;
  private lastMoisture: Float32Array | null = null;
  private lastTemperature: Float32Array | null = null;
  // Water pass (S2): one blended pass, all body types. Reads the SAME composed
  // terrain height buffer (depth = surface − terrain) + its own surface/type/flow
  // storage buffers; the bind group rebuilds whenever any of them (incl. the
  // terrain heights it borrows) reallocate.
  private waterPipeline: GPURenderPipeline;
  private waterGlobalsBuf: GPUBuffer;
  /** Infinite-ocean backdrop (fullscreen) — drawn before terrain so open sea fills
   *  the whole viewport past the map edge. Reuses the water globals uniform. */
  private oceanBackdropPipeline: GPURenderPipeline;
  private oceanBackdropBind: GPUBindGroup | null = null;
  private waterSurfaceBuf: GPUBuffer | null = null;
  private waterTypeBuf: GPUBuffer | null = null;
  private waterFlowBuf: GPUBuffer | null = null;
  private waterShallowBuf: GPUBuffer | null = null;
  private waterDeepBuf: GPUBuffer | null = null;
  private waterClarityBuf: GPUBuffer | null = null;
  private waterShoreBuf: GPUBuffer | null = null;
  private waterBind: GPUBindGroup | null = null;
  private waterCellCap = 0;
  private waterBoundHeights: GPUBuffer | null = null;
  private lastWaterSurface: Float32Array | null = null;
  private lastWaterType: Uint32Array | null = null;
  private lastWaterFlow: Float32Array | null = null;
  private lastWaterShallow: Uint32Array | null = null;
  private lastWaterDeep: Uint32Array | null = null;
  private lastWaterClarity: Float32Array | null = null;
  private lastWaterShore: Float32Array | null = null;
  // Ribbon pass (roads-epic T7): swept road/river ribbon meshes (`ribbon-geometry`)
  // drawn as a terrain-following parametric surface. Reuses the terrain globals
  // uniform + height buffer (binding 0/1) for the SAME lift+projection; binding 2
  // is a small params block (time/kind). The vertex data is a per-world static
  // mesh streamed into a grow-on-demand vertex buffer.
  private ribbonPipeline: GPURenderPipeline;
  private ribbonParamsBuf: GPUBuffer;
  private ribbonBind: GPUBindGroup | null = null;
  private ribbonBoundHeights: GPUBuffer | null = null;
  private ribbonBoundSurf: GPUBuffer | null = null;
  // River water-surface storage buffer (ribbon binding 6): river verts lift to this
  // fill line instead of the carved bed. Null/heights on a world with no rivers.
  private riverSurfaceBuf: GPUBuffer | null = null;
  private riverSurfaceCap = 0;
  private riverSurfaceData: Float32Array | null = null;
  // Road-material atlas (binding 3/4/5): a seamless PBR swatch per surface
  // (dirt/cobble/plank), built once and bound into the ribbon pass.
  private roadMatSampler: GPUSampler | null = null;
  private roadAlbedoTex: GPUTexture | null = null;
  private roadNormalTex: GPUTexture | null = null;
  private lastRibbonData: Float32Array | null = null;
  private lastRibbonVbuf: GPUBuffer | null = null;
  private ribbonVertexCount = 0;
  private depthTex: GPUTexture | null = null;
  private depthW = 0;
  private depthH = 0;
  // Cast-shadow pass (stencil-union): each parallelogram silhouette draws
  // premultiplied black at SHADOW_ALPHA straight onto the scene colour target,
  // with a stencil buffer ensuring each pixel darkens at most once (overlaps
  // union, never double-darken). Replaced the old offscreen-accumulate +
  // fullscreen-composite pair, which shaded the WHOLE canvas every frame — a
  // measured fill-rate bottleneck on the gen-8 iGPU.
  private shadowPipeline: GPURenderPipeline;
  private shadowGlobalsBuf: GPUBuffer;
  private shadowGlobalsBind: GPUBindGroup;
  // Solid-colour shape pass (poly/circle parity): drawn in the entity pass,
  // sharing its depth buffer so shapes interleave with sprites by depth.
  private shapePipeline: GPURenderPipeline;
  private shapeGlobalsBuf: GPUBuffer;
  private shapeGlobalsBind: GPUBindGroup;
  // Dedicated stencil target for the shadow union pass (one mark per pixel).
  private stencilTex: GPUTexture | null = null;
  private stencilW = 0;
  private stencilH = 0;
  private shadowBindCache = new WeakMap<CanvasImageSource, GPUBindGroup>();
  /** Per-batch bind group cache, keyed by the albedo source (batch identity). */
  private bindCache = new WeakMap<CanvasImageSource, GPUBindGroup>();
  private texCache = new WeakMap<CanvasImageSource, GPUTexture>();
  /** Persistent, grow-on-demand vertex/instance buffers (one per stream), reused
   *  every frame instead of allocating + destroying dozens of buffers per frame. */
  private dynBufs = new Map<string, { buf: GPUBuffer; cap: number }>();
  /** L1 static entity bundle: the camera-independent layer (flora/buildings/roads)
   *  lifted + batched + packed into persistent per-batch buffers ONCE, keyed by the
   *  source-array identity. The camera transform is an entity uniform (uXform) now,
   *  so these WORLD-px instances never re-pack on pan/zoom. */
  private staticBundleSrc: readonly DrawItem[] | null = null;
  private staticBundle: { batch: InstanceBatch; buf: GPUBuffer; count: number }[] = [];
  private staticLifted: readonly DrawItem[] = [];
  /** L2 static cast-shadow bundle: the static layer's shadow parallelograms packed
   *  ONCE into persistent buffers (world px), keyed by the lifted-array identity +
   *  a lighting signature (sun move re-bakes). The camera bake is the shader uXform. */
  private staticShadowSrc: readonly DrawItem[] | null = null;
  private staticShadowSig = '';
  private staticShadowBundle: { texture: CanvasImageSource; buf: GPUBuffer; count: number }[] = [];
  /** Screen-space UI pass (S1) — drawn last, over the entity pass, no depth. */
  private uiPass: UiPass;

  // P-E — pixel-perfect low-res target + nearest-upscale blit. The scene passes
  // (terrain/water/shadow/entity/shape) render into `sceneTex` at the art-pixel
  // resolution; `blitPipeline` then nearest-upscales it onto the swapchain, with
  // the UI drawn crisp at full device res on top.
  private blitPipeline: GPURenderPipeline;
  private blitGlobalsBuf: GPUBuffer;
  private sceneTex: GPUTexture | null = null;
  private sceneW = 0;
  private sceneH = 0;
  private blitBind: GPUBindGroup | null = null;

  constructor(gpu: GpuContext) {
    this.device = gpu.device;
    this.ctx = gpu.ctx;
    this.format = gpu.format;
    const { device } = this;
    this.uiPass = new UiPass(device, gpu.format);

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

    this.globalsBuf = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
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
        // No blend: terrain is OPAQUE (alpha 1) and draws first on a cleared
        // target, so src-over would just read dst for nothing — a wasted RMW per
        // pixel on a fill-bound iGPU. Plain overwrite.
        targets: [{ format: gpu.format }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'greater' },
    });
    this.terrainGlobalsBuf = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // Water pipeline (S2): GPU-generated per-cell quads (no vertex buffers),
    // lifted to the water surface + blended over the terrain. Shares the terrain
    // depth buffer (greater-equal, NO depth write) so nearer terrain occludes
    // water but water never writes into the entity depth scheme. Premultiplied
    // alpha out (one / one-minus-src-alpha), like the sprite pass.
    const waterModule = device.createShaderModule({ code: WATER_WGSL });
    this.waterPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: waterModule, entryPoint: 'vsMain' },
      fragment: {
        module: waterModule,
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
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'greater-equal' },
    });
    this.waterGlobalsBuf = device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // Infinite-ocean backdrop pipeline: a fullscreen triangle, OPAQUE, no depth
    // (drawn first; terrain loads over it and covers the whole map rect, so the
    // backdrop survives only OUTSIDE the island = open sea to the horizon). Reuses
    // the 112-byte water globals uniform for the inverse projection + time.
    const backdropModule = device.createShaderModule({ code: OCEAN_BACKDROP_WGSL });
    this.oceanBackdropPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: backdropModule, entryPoint: 'vsMain' },
      fragment: { module: backdropModule, entryPoint: 'fsMain', targets: [{ format: gpu.format }] },
      primitive: { topology: 'triangle-list' },
    });
    this.oceanBackdropBind = device.createBindGroup({
      layout: this.oceanBackdropPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.waterGlobalsBuf } }],
    });

    // Ribbon pipeline (T7): swept road/river ribbons. Interleaved vertex layout
    // (RIBBON_FLOATS_PER_VERTEX f32): pos, across, along, width, tangent, speed,
    // tag. Same depth contract as water (load terrain depth, greater-equal, no
    // write) so the ribbon sits ON the ground without disturbing the entity depth
    // reset. Alpha-blended so the feathered banks melt into the terrain.
    const ribbonModule = device.createShaderModule({ code: RIBBON_WGSL });
    const RBN_STRIDE = RIBBON_FLOATS_PER_VERTEX * 4;
    this.ribbonPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: ribbonModule,
        entryPoint: 'vsMain',
        buffers: [{
          arrayStride: RBN_STRIDE,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },  // pos
            { shaderLocation: 1, offset: 8, format: 'float32' },    // across
            { shaderLocation: 2, offset: 12, format: 'float32' },   // along
            { shaderLocation: 3, offset: 16, format: 'float32' },   // width
            { shaderLocation: 4, offset: 20, format: 'float32x2' }, // tangent
            { shaderLocation: 5, offset: 28, format: 'float32' },   // speed
            { shaderLocation: 6, offset: 32, format: 'float32x2' }, // tag
          ],
        }],
      },
      fragment: {
        module: ribbonModule,
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
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'greater-equal' },
    });
    this.ribbonParamsBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.buildRoadMaterials();

    // Shadow union pipeline: parallelogram quads (4 corners) → premult black at
    // SHADOW_ALPHA straight onto the scene colour target, stencil-gated so each
    // pixel darkens at most once. Stencil-only attachment (`stencil8`): test
    // `equal 0` (ref 0) → first fragment passes; passOp `increment-clamp` bumps
    // it to 1 so any later overlapping shadow fails the test and is skipped.
    const shadowModule = device.createShaderModule({ code: SHADOW_WGSL });
    const shadowStencil: GPUStencilFaceState = {
      compare: 'equal', failOp: 'keep', depthFailOp: 'keep', passOp: 'increment-clamp',
    };
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
          format: gpu.format,
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
          },
        }],
      },
      primitive: { topology: 'triangle-strip' },
      // stencil8 carries no depth aspect → depthCompare must be 'always' + no write.
      depthStencil: {
        format: 'stencil8', depthWriteEnabled: false, depthCompare: 'always',
        stencilFront: shadowStencil, stencilBack: shadowStencil,
        stencilReadMask: 0xff, stencilWriteMask: 0xff,
      },
    });
    // 8 floats: viewport(2) + alpha(1) + pad(1) + xform(4). L2 added uXform so the
    // shadow corners can stay WORLD-px (camera-independent) and be packed once.
    this.shadowGlobalsBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.shadowGlobalsBind = device.createBindGroup({
      layout: this.shadowPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.shadowGlobalsBuf } }],
    });

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

    // Blit pipeline (P-E): a single fullscreen triangle, no vertex buffers, no
    // depth, no blend (the source is already composited) — nearest-samples the
    // low-res scene target onto the swapchain.
    const blitModule = device.createShaderModule({ code: BLIT_WGSL });
    this.blitPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: blitModule, entryPoint: 'vsMain' },
      fragment: { module: blitModule, entryPoint: 'fsMain', targets: [{ format: gpu.format }] },
      primitive: { topology: 'triangle-list' },
    });
    this.blitGlobalsBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }

  /** (Re)create the low-res scene colour target + its blit bind group on resize. */
  private ensureSceneTarget(w: number, h: number): GPUTextureView {
    if (!this.sceneTex || this.sceneW !== w || this.sceneH !== h) {
      this.sceneTex?.destroy();
      this.sceneTex = this.device.createTexture({
        size: [w, h, 1], format: this.format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      this.sceneW = w;
      this.sceneH = h;
      this.blitBind = this.device.createBindGroup({
        layout: this.blitPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.sampler },
          { binding: 1, resource: this.sceneTex.createView() },
          { binding: 2, resource: { buffer: this.blitGlobalsBuf } },
        ],
      });
    }
    return this.sceneTex!.createView();
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

  /** (Re)create the dedicated stencil target for the shadow union pass. */
  private ensureStencil(w: number, h: number): GPUTextureView {
    if (!this.stencilTex || this.stencilW !== w || this.stencilH !== h) {
      this.stencilTex?.destroy();
      this.stencilTex = this.device.createTexture({
        size: [w, h, 1], format: 'stencil8', usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.stencilW = w;
      this.stencilH = h;
    }
    return this.stencilTex.createView();
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
  private uploadFields(
    heights: Float32Array,
    colors: Uint32Array,
    moisture: Float32Array,
    temperature: Float32Array,
  ): void {
    const { device } = this;
    const cells = heights.length;
    let realloc = false;
    if (!this.terrainHeightsBuf || cells > this.terrainCellCap) {
      this.terrainHeightsBuf?.destroy();
      this.terrainColorsBuf?.destroy();
      this.terrainMoistureBuf?.destroy();
      this.terrainTemperatureBuf?.destroy();
      const storage = (n: number) => device.createBuffer({ size: n, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.terrainHeightsBuf = storage(cells * 4);
      this.terrainColorsBuf = storage(cells * 4);
      this.terrainMoistureBuf = storage(cells * 4);
      this.terrainTemperatureBuf = storage(cells * 4);
      this.terrainCellCap = cells;
      this.terrainBind = device.createBindGroup({
        layout: this.terrainPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.terrainGlobalsBuf } },
          { binding: 1, resource: { buffer: this.terrainHeightsBuf } },
          { binding: 2, resource: { buffer: this.terrainColorsBuf } },
          { binding: 3, resource: { buffer: this.terrainMoistureBuf } },
          { binding: 4, resource: { buffer: this.terrainTemperatureBuf } },
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
    if (realloc || moisture !== this.lastMoisture) {
      device.queue.writeBuffer(this.terrainMoistureBuf!, 0, moisture as GPUAllowSharedBufferSource);
      this.lastMoisture = moisture;
    }
    if (realloc || temperature !== this.lastTemperature) {
      device.queue.writeBuffer(this.terrainTemperatureBuf!, 0, temperature as GPUAllowSharedBufferSource);
      this.lastTemperature = temperature;
    }
  }

  /** (Re)upload the water field buffers. The bind group borrows the terrain
   *  height buffer (binding 1) for depth, so it rebuilds when EITHER the water
   *  buffers grow OR the terrain heights buffer identity changes. Skips the
   *  writeBuffer per array when unchanged by reference. Returns false if there is
   *  no terrain height buffer to read (water needs it). */
  private uploadWaterFields(water: WaterField): boolean {
    const { device } = this;
    if (!this.terrainHeightsBuf) return false;
    const cells = water.surfaceW.length;
    let realloc = false;
    if (!this.waterSurfaceBuf || cells > this.waterCellCap) {
      for (const b of [this.waterSurfaceBuf, this.waterTypeBuf, this.waterFlowBuf,
        this.waterShallowBuf, this.waterDeepBuf, this.waterClarityBuf, this.waterShoreBuf]) b?.destroy();
      const storage = (n: number) => device.createBuffer({ size: n, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.waterSurfaceBuf = storage(cells * 4);
      this.waterTypeBuf = storage(cells * 4);
      this.waterFlowBuf = storage(cells * 8);
      this.waterShallowBuf = storage(cells * 4);
      this.waterDeepBuf = storage(cells * 4);
      this.waterClarityBuf = storage(cells * 4);
      this.waterShoreBuf = storage(cells * 4);
      this.waterCellCap = cells;
      realloc = true;
    }
    if (realloc || this.waterBoundHeights !== this.terrainHeightsBuf) {
      this.waterBind = device.createBindGroup({
        layout: this.waterPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.waterGlobalsBuf } },
          { binding: 1, resource: { buffer: this.terrainHeightsBuf } },
          { binding: 2, resource: { buffer: this.waterSurfaceBuf } },
          { binding: 3, resource: { buffer: this.waterTypeBuf! } },
          { binding: 4, resource: { buffer: this.waterFlowBuf! } },
          { binding: 5, resource: { buffer: this.waterShallowBuf! } },
          { binding: 6, resource: { buffer: this.waterDeepBuf! } },
          { binding: 7, resource: { buffer: this.waterClarityBuf! } },
          { binding: 8, resource: { buffer: this.waterShoreBuf! } },
        ],
      });
      this.waterBoundHeights = this.terrainHeightsBuf;
    }
    if (realloc || water.surfaceW !== this.lastWaterSurface) {
      device.queue.writeBuffer(this.waterSurfaceBuf, 0, water.surfaceW as GPUAllowSharedBufferSource);
      this.lastWaterSurface = water.surfaceW;
    }
    if (realloc || water.waterType !== this.lastWaterType) {
      device.queue.writeBuffer(this.waterTypeBuf!, 0, water.waterType as GPUAllowSharedBufferSource);
      this.lastWaterType = water.waterType;
    }
    if (realloc || water.flow !== this.lastWaterFlow) {
      device.queue.writeBuffer(this.waterFlowBuf!, 0, water.flow as GPUAllowSharedBufferSource);
      this.lastWaterFlow = water.flow;
    }
    if (realloc || water.shallow !== this.lastWaterShallow) {
      device.queue.writeBuffer(this.waterShallowBuf!, 0, water.shallow as GPUAllowSharedBufferSource);
      this.lastWaterShallow = water.shallow;
    }
    if (realloc || water.deep !== this.lastWaterDeep) {
      device.queue.writeBuffer(this.waterDeepBuf!, 0, water.deep as GPUAllowSharedBufferSource);
      this.lastWaterDeep = water.deep;
    }
    if (realloc || water.clarity !== this.lastWaterClarity) {
      device.queue.writeBuffer(this.waterClarityBuf!, 0, water.clarity as GPUAllowSharedBufferSource);
      this.lastWaterClarity = water.clarity;
    }
    if (realloc || water.shoreDist !== this.lastWaterShore) {
      device.queue.writeBuffer(this.waterShoreBuf!, 0, water.shoreDist as GPUAllowSharedBufferSource);
      this.lastWaterShore = water.shoreDist;
    }
    return true;
  }

  /** Build the L1 static entity bundle when the source array identity changes:
   *  lift onto the terrain, batch by texture, and pack each batch into its own
   *  persistent WORLD-px buffer (the camera is applied in the VS via uXform). The
   *  caller swaps the array only when the world changes, so this rebuild is rare —
   *  every other frame just re-draws the persistent buffers. */
  private ensureStaticBundle(items: readonly DrawItem[], terrain: TerrainField | null): void {
    if (this.staticBundleSrc === items) return;
    for (const e of this.staticBundle) e.buf.destroy();
    this.staticBundle = [];
    const lifted = terrain ? liftDrawList(items, terrain) : items;
    this.staticLifted = lifted;
    const { batches } = buildInstanceBatches(lifted);
    for (const b of batches) {
      if (b.instances.length === 0) continue;
      const data = packInstances(b.instances);
      const buf = this.device.createBuffer({
        size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(buf, 0, data as GPUAllowSharedBufferSource);
      this.staticBundle.push({ batch: b, buf, count: b.instances.length });
    }
    this.staticBundleSrc = items;
  }

  /** L2 — pack the STATIC layer's cast shadows ONCE (world px, no xform baked) into
   *  persistent per-texture buffers. Re-bakes only when the lifted geometry changes
   *  (new array identity) or the sun moves (signature change). The camera transform
   *  is applied by the shader (uXform), so pan/zoom never re-packs these. */
  private ensureStaticShadowBundle(lifted: readonly DrawItem[], lighting: LightingState): void {
    const sig = `${+lighting.enabled}|${lighting.shadowMode ?? 'silhouette'}|${lighting.sunDir.join(',')}`;
    if (this.staticShadowSrc === lifted && this.staticShadowSig === sig) return;
    for (const e of this.staticShadowBundle) e.buf.destroy();
    this.staticShadowBundle = [];
    // No xform → corners stay WORLD px (the shader bakes the camera).
    const batches = buildShadowBatches(lifted, lighting).filter(b => b.instances.length > 0);
    for (const b of batches) {
      const data = packShadowInstances(b.instances);
      const buf = this.device.createBuffer({
        size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(buf, 0, data as GPUAllowSharedBufferSource);
      this.staticShadowBundle.push({ texture: b.texture, buf, count: b.instances.length });
    }
    this.staticShadowSrc = lifted;
    this.staticShadowSig = sig;
  }

  /**
   * Render one frame: terrain (buffer-driven heightfield, T1) in its OWN depth
   * pass, then the blended water pass over it, then the entity draw list (depth
   * reset so the two depth schemes never mix; colour preserved). `w`,`h` = device px.
   */
  renderFrame(opts: {
    items: readonly DrawItem[];
    /** L1 — the camera-independent static layer (flora/buildings/roads). Lifted +
     *  batched + packed into persistent buffers once (keyed by array identity) and
     *  reused every frame. Omitted ⇒ `items` is treated as the full per-frame list. */
    staticItems?: readonly DrawItem[];
    lighting: LightingState;
    w: number; h: number;
    xform?: ViewTransform;
    terrain?: TerrainField | null;
    /** Blended water surface (S2) — drawn over terrain, under entities. */
    water?: WaterField | null;
    /** Swept road/river ribbon mesh (T7) — drawn over terrain/water, under
     *  entities. Tile-space; lifted + iso-projected on the GPU. */
    ribbon?: RibbonMesh | null;
    /** Render-clock seconds for ribbon flow animation (rivers). */
    ribbonTime?: number;
    /** River water-surface field (`buildRiverSurfaceFieldMemo`): row-major `W*H`
     *  render-elevation the river ribbon verts lift to. Null on a dry world. */
    riverSurface?: Float32Array | null;
    /** River water-level offset in NORMALISED elevation (drought < 0, flood > 0). */
    riverLevelDeltaN?: number;
    /** Screen-space UI geometry (S1) — drawn in its own pass over the entities. */
    uiGroups?: readonly UiDrawGroup[];
    /** P-E: when set, the scene passes render into a low-res target sized `w×h`
     *  and are nearest-upscaled to `out` (swapchain device px); the UI then draws
     *  crisp at `out`. Absent ⇒ legacy direct-to-swapchain at `w×h`. */
    out?: { w: number; h: number };
    /** P-E: snap-then-offset remainder in OUTPUT pixels (default 0). */
    pixelOffset?: readonly [number, number];
    /** Profiler ablation: turn individual passes off to attribute GPU cost
     *  (all on by default). */
    passes?: {
      terrain?: boolean; water?: boolean; shadows?: boolean;
      entities?: boolean; ui?: boolean;
    };
  }): void {
    const { device } = this;
    const { items: rawItems, staticItems, lighting, w, h, xform, terrain, water, ribbon, uiGroups, out, pixelOffset } = opts;
    const P = {
      terrain: opts.passes?.terrain ?? true,
      water: opts.passes?.water ?? true,
      shadows: opts.passes?.shadows ?? true,
      entities: opts.passes?.entities ?? true,
      ui: opts.passes?.ui ?? true,
    };
    // L1 — the static layer (flora/buildings/roads) is camera-independent: lift +
    // batch + pack it into persistent per-batch buffers ONCE (keyed by array
    // identity). The camera transform is now an entity uniform (uXform), so the
    // packed WORLD-px instances never re-pack on pan/zoom — killing the per-frame
    // re-pack of ~10k entities the profiler found dominating the encode (and the
    // jerky-zoom fix). Lift entities onto the GPU terrain surface (foot-z parity)
    // before batching so sprites, shapes and shadows ride the heightfield together.
    if (staticItems) this.ensureStaticBundle(staticItems, terrain ?? null);
    // Dynamic items (NPCs, flotsam — or, with no static split, EVERYTHING) are
    // lifted + packed per frame; the set is small so this stays cheap.
    const dynLifted = terrain ? liftDrawList(rawItems, terrain) : rawItems;
    const { batches: dynBatches } = buildInstanceBatches(dynLifted);
    // Shadows + shapes still consume the COMBINED lifted list each frame (their
    // static-bundle caching is L2); the static half is already lifted (no re-lift).
    const combined: readonly DrawItem[] = staticItems ? [...this.staticLifted, ...dynLifted] : dynLifted;

    // Cast-shadow parallelograms in WORLD px (the shader's uXform bakes the
    // camera). L2: the static half is packed once into persistent buffers; only
    // the small dynamic layer (NPCs/flotsam) is rebuilt + packed per frame.
    const shadowsOn = lighting.enabled && P.shadows;
    if (shadowsOn && staticItems) this.ensureStaticShadowBundle(this.staticLifted, lighting);
    const dynShadowBatches = shadowsOn
      ? buildShadowBatches(staticItems ? dynLifted : combined, lighting).filter(b => b.instances.length > 0)
      : [];
    const staticShadowCount = (shadowsOn && staticItems)
      ? this.staticShadowBundle.reduce((s, b) => s + b.count, 0) : 0;
    const hasShadows = staticShadowCount > 0 || dynShadowBatches.length > 0;

    device.queue.writeBuffer(this.globalsBuf, 0, packGlobals({
      viewport: [w, h], bands: lighting.bands, ambient: lighting.ambient,
      sunDir: lighting.sunDir, sunColor: lighting.sunColor, xform,
    }) as GPUAllowSharedBufferSource);
    if (hasShadows) {
      const xf = xform ?? { sx: 1, sy: 1, ox: 0, oy: 0 };
      device.queue.writeBuffer(this.shadowGlobalsBuf, 0,
        new Float32Array([w, h, SHADOW_ALPHA, 0, xf.sx, xf.sy, xf.ox, xf.oy]));
    }

    const hasTerrain = !!(terrain && terrain.vertexCount > 0 && terrain.heights.length > 0 && P.terrain);
    if (hasTerrain) {
      this.uploadFields(terrain!.heights, terrain!.colors, terrain!.moisture, terrain!.temperature);
      device.queue.writeBuffer(this.terrainGlobalsBuf, 0,
        packTerrainGlobals(terrain!.globals) as GPUAllowSharedBufferSource);
    }

    // Water needs the terrain height buffer (for depth), so it only runs when
    // terrain did. uploadWaterFields returns false if that buffer isn't ready.
    let hasWater = !!(hasTerrain && water && water.wetCount > 0 && water.vertexCount > 0 && P.water);
    if (hasWater) {
      hasWater = this.uploadWaterFields(water!);
      if (hasWater) {
        device.queue.writeBuffer(this.waterGlobalsBuf, 0, water!.globals as GPUAllowSharedBufferSource);
      }
    }

    // Ribbon mesh (T7): roads (+ rivers in R2). Needs the terrain height buffer
    // (lift) + globals (projection), so it only runs when terrain did. Streamed
    // into a persistent vertex buffer; the data is a per-world static mesh so the
    // upload is skipped while the array identity is unchanged.
    const hasRibbon = !!(hasTerrain && ribbon && ribbon.vertexCount > 0 && this.terrainHeightsBuf);
    (globalThis as Record<string, unknown>).__ribbonDiag = {
      hasRibbon, hasTerrain, vc: ribbon?.vertexCount ?? null,
      terrHeights: !!this.terrainHeightsBuf, ribbonNull: ribbon == null,
      sample: ribbon && ribbon.data.length >= 10 ? Array.from(ribbon.data.slice(0, 10)) : null,
    };
    if (hasRibbon) {
      const rbuf = this.dynBuf('ribbon', ribbon!.data.byteLength);
      if (ribbon!.data !== this.lastRibbonData || rbuf !== this.lastRibbonVbuf) {
        device.queue.writeBuffer(rbuf, 0, ribbon!.data as GPUAllowSharedBufferSource);
        this.lastRibbonData = ribbon!.data;
        this.lastRibbonVbuf = rbuf;
      }
      // River water-surface buffer (binding 6): upload + bind when the world has
      // rivers; otherwise bind the height buffer itself (river verts are absent, so
      // the value is never read — the binding just has to exist for the layout).
      let surfBuf = this.terrainHeightsBuf!;
      if (opts.riverSurface) {
        const bytes = opts.riverSurface.byteLength;
        if (!this.riverSurfaceBuf || this.riverSurfaceCap < bytes) {
          this.riverSurfaceBuf?.destroy();
          this.riverSurfaceBuf = device.createBuffer({
            size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
          });
          this.riverSurfaceCap = bytes;
          this.riverSurfaceData = null;
        }
        if (this.riverSurfaceData !== opts.riverSurface) {
          device.queue.writeBuffer(this.riverSurfaceBuf, 0, opts.riverSurface as GPUAllowSharedBufferSource);
          this.riverSurfaceData = opts.riverSurface;
        }
        surfBuf = this.riverSurfaceBuf;
      }
      if (!this.ribbonBind || this.ribbonBoundHeights !== this.terrainHeightsBuf || this.ribbonBoundSurf !== surfBuf) {
        this.ribbonBind = device.createBindGroup({
          layout: this.ribbonPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.terrainGlobalsBuf } },
            { binding: 1, resource: { buffer: this.terrainHeightsBuf! } },
            { binding: 2, resource: { buffer: this.ribbonParamsBuf } },
            { binding: 3, resource: this.roadMatSampler! },
            { binding: 4, resource: this.roadAlbedoTex!.createView({ dimension: '2d-array' }) },
            { binding: 5, resource: this.roadNormalTex!.createView({ dimension: '2d-array' }) },
            { binding: 6, resource: { buffer: surfBuf } },
          ],
        });
        this.ribbonBoundHeights = this.terrainHeightsBuf;
        this.ribbonBoundSurf = surfBuf;
      }
      device.queue.writeBuffer(this.ribbonParamsBuf, 0,
        new Float32Array([opts.ribbonTime ?? 0, 0, opts.riverLevelDeltaN ?? 0, 0]));
      this.ribbonVertexCount = ribbon!.vertexCount;
    }

    // P-E: the scene passes target the low-res offscreen when `out` is set, then
    // a blit upscales it to the swapchain; otherwise they draw straight to it.
    // The infinite-ocean backdrop (pass 0) paints uniform open sea over everything
    // for ocean worlds and extends past the map unchanged, so the base clear is the
    // matching deep-ocean tone (rgb 15,68,107) — any sliver beyond the backdrop or
    // on a landlocked world still reads as sea, never a void.
    const swapView = this.ctx.getCurrentTexture().createView();
    const ctx: PassCtx = {
      enc: device.createCommandEncoder(),
      colorView: out ? this.ensureSceneTarget(w, h) : swapView,
      swapView,
      depthView: this.ensureDepth(w, h),
      w, h, out,
      ocean: { r: 0.06, g: 0.27, b: 0.42, a: 1 },
      colorCleared: false,
    };

    // Ordered passes — each helper reads/sets `ctx.colorCleared` so the first
    // colour pass clears and the rest load. terrain → shadows → water (all under
    // the entities) → entities+shapes → blit (upscale) → UI (crisp, on top).
    // Pass 0: open-ocean backdrop fills the viewport beyond the map (needs the water
    // globals, which are uploaded only when hasWater). Terrain then loads over it.
    if (hasWater) this.passBackdrop(ctx);
    if (hasTerrain) this.passTerrain(ctx, terrain!);
    if (hasShadows) this.passShadows(ctx, !!staticItems, dynShadowBatches);
    if (hasWater) this.passWater(ctx, water!);
    if (hasRibbon) this.passRibbon(ctx);
    this.passEntities(ctx, P.entities, dynBatches, combined, xform);
    if (out) this.passBlit(ctx, out, pixelOffset);
    if (P.ui && uiGroups && uiGroups.length > 0) this.passUi(ctx, uiGroups);

    device.queue.submit([ctx.enc.finish()]);
  }

  /**
   * Pass 0 — infinite-ocean backdrop. A fullscreen triangle, OPAQUE, no depth: each
   * pixel is inverse-projected onto the sea-level plane and shaded as open water, so
   * the sea fills the whole viewport past the map grid. Drawn FIRST; terrain then
   * loads over it and covers the map rect, leaving the backdrop visible only beyond
   * the island. Reuses the water globals uniform (uploaded with the water field).
   */
  private passBackdrop(ctx: PassCtx): void {
    const bpass = ctx.enc.beginRenderPass({
      colorAttachments: [{ view: ctx.colorView, clearValue: ctx.ocean, loadOp: 'clear', storeOp: 'store' }],
    });
    bpass.setPipeline(this.oceanBackdropPipeline);
    bpass.setBindGroup(0, this.oceanBackdropBind!);
    bpass.draw(3);
    bpass.end();
    ctx.colorCleared = true;
  }

  /** Pass 1 — terrain (own depth: spatial iso depth, greater, write). Loads colour
   *  if the backdrop already filled it; otherwise clears. */
  private passTerrain(ctx: PassCtx, terrain: TerrainField): void {
    const tpass = ctx.enc.beginRenderPass({
      colorAttachments: [{ view: ctx.colorView, clearValue: ctx.ocean, loadOp: ctx.colorCleared ? 'load' : 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: ctx.depthView, depthClearValue: 0.0, depthLoadOp: 'clear', depthStoreOp: 'store' },
    });
    tpass.setPipeline(this.terrainPipeline);
    tpass.setBindGroup(0, this.terrainBind!);
    tpass.draw(terrain.vertexCount);
    tpass.end();
    ctx.colorCleared = true;
  }

  /**
   * Pass 1.5 — cast shadows (stencil-union): each silhouette draws premult black
   * at SHADOW_ALPHA straight onto the scene colour; the stencil (cleared to 0,
   * test `equal 0` + increment) makes each pixel darken at most once so overlaps
   * union instead of double-darkening — touching only shadow pixels, never the
   * full screen. Between terrain and entities → shadows sit on the ground.
   */
  private passShadows(ctx: PassCtx, hasStatic: boolean, dynShadowBatches: readonly ShadowBatch[]): void {
    const apass = ctx.enc.beginRenderPass({
      colorAttachments: [{ view: ctx.colorView, clearValue: ctx.ocean, loadOp: ctx.colorCleared ? 'load' : 'clear', storeOp: 'store' }],
      depthStencilAttachment: {
        view: this.ensureStencil(ctx.w, ctx.h), stencilClearValue: 0, stencilLoadOp: 'clear', stencilStoreOp: 'discard',
      },
    });
    apass.setPipeline(this.shadowPipeline);
    apass.setStencilReference(0);
    apass.setVertexBuffer(0, this.quadBuf);
    apass.setBindGroup(0, this.shadowGlobalsBind);
    // Static shadows: persistent buffers packed once (L2), drawn first into the
    // shared stencil so the dynamic layer still unions correctly over them.
    if (hasStatic) {
      for (const b of this.staticShadowBundle) {
        apass.setBindGroup(1, this.shadowBind(b.texture));
        apass.setVertexBuffer(1, b.buf);
        apass.draw(QUAD_VERTEX_COUNT, b.count);
      }
    }
    // Dynamic shadows: packed per frame into the shared grow-on-demand buffer.
    const dynShadowInst = dynShadowBatches.reduce((s, b) => s + b.instances.length, 0);
    if (dynShadowInst > 0) {
      const shadowBuf = this.dynBuf('shadow', dynShadowInst * SHADOW_INSTANCE_STRIDE);
      let soff = 0;
      for (const b of dynShadowBatches) {
        const data = packShadowInstances(b.instances);
        this.device.queue.writeBuffer(shadowBuf, soff, data as GPUAllowSharedBufferSource);
        apass.setBindGroup(1, this.shadowBind(b.texture));
        apass.setVertexBuffer(1, shadowBuf, soff);
        apass.draw(QUAD_VERTEX_COUNT, b.instances.length);
        soff += data.byteLength;
      }
    }
    apass.end();
    ctx.colorCleared = true;
  }

  /**
   * Pass 1.75 — water (over terrain, BEFORE entities so boats/NPCs at the shore
   * draw on top). Loads the terrain depth (greater-equal, no write): nearer
   * terrain occludes water, but water never disturbs the depth the entity pass
   * resets. One draw for the whole grid; the fragment discards dry cells.
   */
  private passWater(ctx: PassCtx, water: WaterField): void {
    const wpass = ctx.enc.beginRenderPass({
      colorAttachments: [{ view: ctx.colorView, clearValue: ctx.ocean, loadOp: ctx.colorCleared ? 'load' : 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: ctx.depthView, depthLoadOp: 'load', depthStoreOp: 'store' },
    });
    wpass.setPipeline(this.waterPipeline);
    wpass.setBindGroup(0, this.waterBind!);
    wpass.draw(water.vertexCount);
    wpass.end();
    ctx.colorCleared = true;
  }

  /**
   * Pass 1.8 — ribbons (roads/rivers; T7). Over terrain + water, BEFORE entities
   * so buildings/trees/NPCs draw on top. Loads the terrain depth (greater-equal,
   * no write — same contract as water) so it sits on the ground at its own cells
   * without disturbing the depth the entity pass resets. Alpha-blended banks.
   */
  private passRibbon(ctx: PassCtx): void {
    const rpass = ctx.enc.beginRenderPass({
      colorAttachments: [{ view: ctx.colorView, clearValue: ctx.ocean, loadOp: ctx.colorCleared ? 'load' : 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: ctx.depthView, depthLoadOp: 'load', depthStoreOp: 'store' },
    });
    rpass.setPipeline(this.ribbonPipeline);
    rpass.setBindGroup(0, this.ribbonBind!);
    rpass.setVertexBuffer(0, this.lastRibbonVbuf!);
    rpass.draw(this.ribbonVertexCount);
    rpass.end();
    ctx.colorCleared = true;
  }

  /** Build the road-material atlas textures (albedo + local-frame normal) once — a
   *  seamless layer per surface, bound into the ribbon pass at binding 4/5. */
  private buildRoadMaterials(): void {
    const { device } = this;
    const atlas = roadMaterialAtlas();
    const size = { width: atlas.size, height: atlas.size, depthOrArrayLayers: atlas.layers };
    const make = (label: string) => device.createTexture({
      label, size, format: 'rgba8unorm', dimension: '2d',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.roadAlbedoTex = make('road-albedo');
    this.roadNormalTex = make('road-normal');
    const layout = { bytesPerRow: atlas.size * 4, rowsPerImage: atlas.size };
    device.queue.writeTexture({ texture: this.roadAlbedoTex }, atlas.albedo as GPUAllowSharedBufferSource, layout, size);
    device.queue.writeTexture({ texture: this.roadNormalTex }, atlas.normal as GPUAllowSharedBufferSource, layout, size);
    this.roadMatSampler = device.createSampler({
      addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear',
    });
  }

  /**
   * Pass 2 — entities + solid-colour shapes (colour preserved if terrain/shadows
   * drew; depth RESET so the entity index-depth scheme is self-contained and
   * always wins over terrain). Shapes share the pass + depth so they interleave
   * with sprites by list-order depth.
   */
  private passEntities(
    ctx: PassCtx, entitiesOn: boolean,
    dynBatches: readonly InstanceBatch[], combined: readonly DrawItem[], xform?: ViewTransform,
  ): void {
    const epass = ctx.enc.beginRenderPass({
      colorAttachments: [{ view: ctx.colorView, clearValue: ctx.ocean, loadOp: ctx.colorCleared ? 'load' : 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: ctx.depthView, depthClearValue: 0.0, depthLoadOp: 'clear', depthStoreOp: 'store' },
    });
    epass.setPipeline(this.pipeline);
    epass.setVertexBuffer(0, this.quadBuf);
    epass.setBindGroup(0, this.globalsBind);
    if (entitiesOn) {
      // Static bundle — persistent per-batch buffers, packed once (world px).
      for (const e of this.staticBundle) {
        epass.setBindGroup(1, this.batchBind(e.batch));
        epass.setVertexBuffer(1, e.buf);
        epass.draw(QUAD_VERTEX_COUNT, e.count);
      }
      // Dynamic batches — packed this frame into the shared grow-on-demand buffer.
      const dynInst = dynBatches.reduce((s, b) => s + b.instances.length, 0);
      if (dynInst > 0) {
        const entBuf = this.dynBuf('entity', dynInst * INSTANCE_STRIDE);
        let eoff = 0;
        for (const b of dynBatches) {
          if (b.instances.length === 0) continue;
          const data = packInstances(b.instances);
          this.device.queue.writeBuffer(entBuf, eoff, data as GPUAllowSharedBufferSource);
          epass.setBindGroup(1, this.batchBind(b));
          epass.setVertexBuffer(1, entBuf, eoff);
          epass.draw(QUAD_VERTEX_COUNT, b.instances.length);
          eoff += data.byteLength;
        }
      }
    }
    const shapes = entitiesOn ? buildShapeVertices(combined, xform) : { vertices: new Float32Array(0), vertexCount: 0 };
    if (shapes.vertexCount > 0) {
      this.device.queue.writeBuffer(this.shapeGlobalsBuf, 0, new Float32Array([ctx.w, ctx.h, 0, 0]));
      const sBuf = this.dynBuf('shape', shapes.vertices.byteLength);
      this.device.queue.writeBuffer(sBuf, 0, shapes.vertices as GPUAllowSharedBufferSource);
      epass.setPipeline(this.shapePipeline);
      epass.setBindGroup(0, this.shapeGlobalsBind);
      epass.setVertexBuffer(0, sBuf);
      epass.draw(shapes.vertexCount);
    }
    epass.end();
    ctx.colorCleared = true;
  }

  /** Pass 2.5 — blit (P-E): nearest-upscale the low-res scene target onto the
   *  swapchain. Only runs when rendering through the offscreen target. */
  private passBlit(ctx: PassCtx, out: { w: number; h: number }, pixelOffset?: readonly [number, number]): void {
    const ox = pixelOffset ? pixelOffset[0] : 0;
    const oy = pixelOffset ? pixelOffset[1] : 0;
    this.device.queue.writeBuffer(this.blitGlobalsBuf, 0, new Float32Array([1 / out.w, 1 / out.h, ox, oy]));
    const bpass = ctx.enc.beginRenderPass({
      colorAttachments: [{ view: ctx.swapView, clearValue: ctx.ocean, loadOp: 'clear', storeOp: 'store' }],
    });
    bpass.setPipeline(this.blitPipeline);
    bpass.setBindGroup(0, this.blitBind!);
    bpass.draw(3);
    bpass.end();
  }

  /**
   * Pass 3 — UI (screen-space HUD): painter-order over the scene colour, no
   * depth, so it never participates in the entity depth test. With P-E active the
   * UI draws CRISP at full device res on the swapchain over the upscaled scene;
   * otherwise it shares the scene target at `w×h`.
   */
  private passUi(ctx: PassCtx, uiGroups: readonly UiDrawGroup[]): void {
    const uiView = ctx.out ? ctx.swapView : ctx.colorView;
    const uiW = ctx.out ? ctx.out.w : ctx.w;
    const uiH = ctx.out ? ctx.out.h : ctx.h;
    // The swapchain already holds the blit (out) or the scene (legacy), so load —
    // clearing would erase what we just drew.
    const uiLoad: GPULoadOp = (ctx.out || ctx.colorCleared) ? 'load' : 'clear';
    const upass = ctx.enc.beginRenderPass({
      colorAttachments: [{ view: uiView, clearValue: ctx.ocean, loadOp: uiLoad, storeOp: 'store' }],
    });
    this.uiPass.record(upass, uiGroups, uiW, uiH);
    upass.end();
  }

  /**
   * Deterministic GPU bench. Renders each variant of a FIXED scene repeatedly
   * and times it, separating CPU encode (renderFrame returns) from GPU execution
   * (queue.onSubmittedWorkDone resolves). gen-8 iGPUs lack `timestamp-query`, so
   * per-pass cost is attributed by ABLATION: pass `passes:{water:false}` etc. in
   * a variant and diff against the all-on baseline. Awaiting GPU completion each
   * frame serialises CPU/GPU (no pipelining) — fair + consistent for ranking.
   *
   * Caller supplies fully-formed renderFrame opts per variant (so a px sweep is
   * just different w/h/out values). Returns averaged ms over `frames` after a
   * `warmup`.
   */
  async profile(
    variants: readonly { label: string; opts: Parameters<GpuScene['renderFrame']>[0] }[],
    frames = 30,
    warmup = 8,
  ): Promise<{ label: string; cpuMs: number; gpuMs: number; totalMs: number; fps: number }[]> {
    const results: { label: string; cpuMs: number; gpuMs: number; totalMs: number; fps: number }[] = [];
    for (const v of variants) {
      for (let i = 0; i < warmup; i++) this.renderFrame(v.opts);
      await this.device.queue.onSubmittedWorkDone();
      let cpu = 0, total = 0;
      for (let i = 0; i < frames; i++) {
        const t0 = performance.now();
        this.renderFrame(v.opts);
        const t1 = performance.now();
        await this.device.queue.onSubmittedWorkDone();
        const t2 = performance.now();
        cpu += t1 - t0;
        total += t2 - t0;
      }
      const cpuMs = cpu / frames;
      const totalMs = total / frames;
      results.push({
        label: v.label, cpuMs, gpuMs: Math.max(0, totalMs - cpuMs), totalMs, fps: 1000 / totalMs,
      });
    }
    return results;
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
