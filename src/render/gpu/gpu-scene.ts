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
  packInstances, packGlobals, packTerrainPassGlobals, TERRAIN_PASS_GLOBALS_FLOATS,
  QUAD_STRIP, QUAD_VERTEX_COUNT, INSTANCE_STRIDE, GLOBALS_FLOATS,
} from '@/render/gpu/instance-buffer';
import type { DetailField } from '@/render/gpu/detail-field';
import {
  buildShadowBatches, packShadowInstances, SHADOW_ALPHA,
  SHADOW_INSTANCE_STRIDE, type ShadowBatch,
} from '@/render/gpu/shadow-instance';
import { buildShapeVertices } from '@/render/gpu/shape-geometry';
import {
  DEPTH_FORMAT,
  createSpritePipeline, createTerrainPipeline, createDetailPatchPipeline,
  createWaterPipeline, createOceanBackdropPipeline,
  createShadowPipeline, createShapePipeline, createBlitPipeline,
  createStructureMeshPipeline, createGrassPipeline,
} from '@/render/gpu/gpu-pipelines';
import {
  buildGrassInstances, GRASS_VERTEX_COUNT, GRASS_MIN_ZOOM,
  type ClutterManifest,
} from '@/render/gpu/grass-scatter';
import type { StructureField } from '@/render/structure-mesh-field';
import { liftDrawList } from '@/render/gpu/terrain-lift';
import type { GpuContext } from '@/render/gpu/webgpu-context';
import type { TerrainField } from '@/render/gpu/terrain-field';
import { materialAtlas, buildMaterialAtlasMips } from '@/render/gpu/material-exemplar';
import { assetUrl } from '@/core/asset-url';
import type { WaterField } from '@/render/gpu/water-field';
import { WATER_GLOBALS_FLOATS } from '@/render/gpu/water-field';
import { createNoiseTexture } from '@/render/gpu/noise-texture';
import { UiPass } from '@/render/ui/ui-pass';
import type { UiDrawGroup } from '@/render/ui/ui-batcher';
import { isRawMap, type RawMap } from '@/render/iso/sprite-canvas';

/** Sprite-texture VRAM + per-frame batch diagnostics — surfaced as `__gpuTexStats`
 *  (mirrors `__spriteCacheStats`). `canvas*` counts the `copyExternalImageToTexture`
 *  path (albedo/normal/emissive on the old rehydration path); `raw*` counts the
 *  `writeTexture` path (material always; all four maps once the raw path lands).
 *  `entityBatches`/`entityBindGroups` are the last entity pass's bucket + bind-group
 *  switch count. Bytes = Σ w·h·4 over live (cached) textures. */
export const gpuTexStats = {
  canvasTextures: 0,
  rawTextures: 0,
  canvasBytes: 0,
  rawBytes: 0,
  entityBatches: 0,
  entityBindGroups: 0,
};
if (typeof globalThis !== 'undefined') {
  (globalThis as Record<string, unknown>).__gpuTexStats = gpuTexStats;
}

/** 1-element placeholders bound to the river-channel storage slots when a world has
 *  no rivers, so the bind group always satisfies the (auto) layout; the shader skips
 *  them via `segCount == 0`. */
const EMPTY_WATER_U32 = new Uint32Array(1);
/** Shared empty result for a dynamic draw list with no poly/circle items (the common
 *  case — NPCs are image items), so the shape pass skips triangulation AND the
 *  per-frame empty Float32Array alloc. Never mutated. */
const NO_SHAPES = { vertices: new Float32Array(0), vertexCount: 0 } as const;

/** Gentle constant global breeze for the standing-grass sway (vegetation-billboard
 *  epic, step 3). Not wired to weather/config — a subtle always-on animation is the
 *  goal for this step; a later pass can drive strength/dir from wind state. */
const GRASS_WIND_DIR: readonly [number, number] = [0.8, 0.6]; // ~unit screen-space direction
/** WIND IS OFF FOR NOW (user directive 2026-07-16): 0 stills the grass/flower/reed
 *  sway and the gust wave (zero tip offset; the vertex math runs either way, so this
 *  costs nothing). Last live value: 5.0 (world px of tip sway at full amplitude). */
const GRASS_WIND_STRENGTH = 0;
const GRASS_WIND_FREQ = 1.3;      // rad/s — calmer than a fast flutter
/** Tree/shrub billboard sway shares the grass wind DIRECTION + FREQ (so canopy and
 *  ground cover ripple together) but its own strength dial: the lit shader scales the
 *  tip offset by this × per-species flexibility × sprite height (see lit-wgsl.ts).
 *  Kept intentionally LOW so the default scene is near-still — a barely-perceptible
 *  drift, not a visible sway (a gust/weather pass can raise it later). 0 = frozen.
 *  WIND IS OFF FOR NOW (user directive 2026-07-16); last live value: 1.5. */
const TREE_WIND_STRENGTH = 0;

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
  // Material-exemplar atlas (Slice 1): seamless tileable swatch per terrain/road material,
  // bound into the terrain + detail passes (bindings 7/8) and sampled with a REPEAT sampler.
  private matAtlasView: GPUTextureView;
  private matSampler: GPUSampler;
  // Harvested ground-cover clutter atlas: a grid of alpha sprites the standing-grass
  // billboard pass (passGrass) stamps. A 1×1 transparent placeholder binds until the PNG
  // loads (async); on load the grass bind group rebuilds. Nearest+clamp keeps sprites crisp.
  private clutterView: GPUTextureView;
  private clutterSampler: GPUSampler;
  private clutterLoaded = false;
  private clutterManifest: ClutterManifest | null = null;
  // Seamless BASE-GROUND texture-patch ARRAY (terrain bindings 11/12): 11 tiling swatches
  // (public/textures/ground/*.png → layers 0..10) the terrain shader SPLATS terrain-aware —
  // open ground (grass/dust/pebble/dry), shallow seabed, beaches (white-sand/shingle), drylands
  // (desert-dune/cracked-hardpan), snow, and forest-litter, each keyed on the climate fields.
  // 1×1×11 placeholder → real PNGs async (bind groups rebuild on load); reuses matSampler.
  private groundView: GPUTextureView;
  // Standing-grass billboard pass (vegetation-billboard epic). The instance array is
  // memoised per world (rebuilt when the height-array identity changes) into a persistent
  // buffer; the camera rides uXform, so pan/zoom never re-packs.
  private grassPipeline: GPURenderPipeline;
  // Sibling pipeline for the SUBMERGED seaweed sub-pass — identical shader, but NO depth
  // write, drawn before the water pass so the translucent water composites over the fronds.
  private grassSubmergedPipeline: GPURenderPipeline;
  private grassBind: GPUBindGroup | null = null;
  private grassSubmergedBind: GPUBindGroup | null = null;
  private grassBuf: GPUBuffer | null = null;
  private grassCount = 0;
  private grassSeaweedCount = 0;   // leading instances (seaweed) drawn pre-water
  private grassSrcHeights: Float32Array | null = null;
  private grassSrcRoad: Uint32Array | null = null;
  private grassSrcWaterSurf: Float32Array | null = null;
  // Dedicated grass globals (step 3, wind): the shared 80-byte entity Globals has no
  // time/wind slot, so grass gets its own uniform packed once per frame.
  private grassGlobalsBuf: GPUBuffer;
  private quadBuf: GPUBuffer;
  private globalsBuf: GPUBuffer;
  private globalsBind: GPUBindGroup;
  private flatNormal: GPUTexture;
  private neutralMaterial: GPUTexture;
  private blackEmissive: GPUTexture;
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
  // Road FEATURE geometry (binding 6) — analytic centreline segments + CSR buckets
  // (feature-geometry.ts), a self-describing u32 buffer; the shader evaluates pavedness
  // by distance, no per-cell field. Replaces the old super-sampled roadSurface buffer.
  private terrainFeatureBuf: GPUBuffer | null = null;
  private terrainBind: GPUBindGroup | null = null;
  private terrainCellCap = 0;
  // The feature buffer is variable-length (header + index + segments), so it has its
  // own byte capacity / realloc trigger independent of the per-cell fields.
  private terrainFeatureCap = 0;
  // Last-uploaded field arrays — skip the re-upload when unchanged by reference.
  private lastHeights: Float32Array | null = null;
  private lastColors: Uint32Array | null = null;
  private lastMoisture: Float32Array | null = null;
  private lastTemperature: Float32Array | null = null;
  private lastRoadFeature: Uint32Array | null = null;
  // Adaptive detail patches (Slice B): a finer instanced mesh over the hot regions,
  // reading baked sub-tile heights. Reuses the terrain FRAGMENT (shared module) +
  // the coarse colour/material/height buffers (bindings 1–4); the patch heights are
  // a separate storage buffer (binding 5); the per-patch tile origin is an instance
  // vertex buffer. Drawn right after terrain into the shared depth (greater-equal +
  // write) so patches overdraw the coarse tiles they cover.
  private detailPatchPipeline: GPURenderPipeline;
  private detailHeightsBuf: GPUBuffer | null = null;     // storage: packed fine heights
  private detailOriginsBuf: GPUBuffer | null = null;     // vertex: per-patch origin
  private detailBind: GPUBindGroup | null = null;
  private detailHeightsCap = 0;                          // bytes
  private detailOriginsCap = 0;                          // bytes
  private detailBoundHeights: GPUBuffer | null = null;   // coarse-height identity at bind time
  private lastDetailHeights: Float32Array | null = null;
  private lastDetailOrigins: Float32Array | null = null;
  // Structure-mesh pass (3D-structure epic, S1): depth-tested 3D masonry (bridges), sharing
  // the terrain globals (bind group 0) + depth buffer so a structure interleaves with the
  // heightfield (founding + mutual occlusion). One interleaved world-space vertex buffer,
  // drawn after water, before the entity depth-clear. Grows on demand by byte capacity.
  private structureMeshPipeline: GPURenderPipeline;
  private structureVertexBuf: GPUBuffer | null = null;
  private structureBind: GPUBindGroup | null = null;
  private structureVertexCap = 0;                        // bytes
  private lastStructureData: Float32Array | null = null;
  // Water pass (S2): one blended pass, all body types. Reads the SAME composed
  // terrain height buffer (depth = surface − terrain) + its own surface/type/flow
  // storage buffers; the bind group rebuilds whenever any of them (incl. the
  // terrain heights it borrows) reallocate.
  private waterPipeline: GPURenderPipeline;
  private waterGlobalsBuf: GPUBuffer;
  /** Baked tiling-noise atlas (noise-texture.ts) bound into the water + backdrop passes. */
  private noiseTexView: GPUTextureView;
  private noiseSampler: GPUSampler;
  /** Infinite-ocean backdrop (fullscreen) — drawn before terrain so open sea fills
   *  the whole viewport past the map edge. Reuses the water globals uniform. */
  private oceanBackdropPipeline: GPURenderPipeline;
  private oceanBackdropBind: GPUBindGroup | null = null;
  private waterSurfaceBuf: GPUBuffer | null = null;
  private waterTypeBuf: GPUBuffer | null = null;
  private waterShallowBuf: GPUBuffer | null = null;
  private waterDeepBuf: GPUBuffer | null = null;
  private waterClarityBuf: GPUBuffer | null = null;
  private waterShoreBuf: GPUBuffer | null = null;
  // WET-CELL MESH list (binding 4) — packed (cellX | cellY<<16) per drawn quad. Rewritten
  // EVERY frame (the visible wet set moves with the camera), so unlike the per-cell surface
  // buffers it has no reference-skip guard. Sized to the cell grid (the dense flood/whole-
  // map fallback can fill it completely).
  private waterWetBuf: GPUBuffer | null = null;
  // Analytic river-channel geometry (binding 9) — ONE packed u32 buffer (CSR bucket
  // index + bitcast segment floats) so the water fragment stays within the 8-storage-
  // buffer baseline limit. Sized independently of the cell grid; a studio edit re-emits
  // a new array → re-upload. A no-river world binds a 1-element dummy (shader skips on
  // segCount 0).
  private waterChannelBuf: GPUBuffer | null = null;
  private waterChannelCap = 0;      // bytes
  private waterBind: GPUBindGroup | null = null;
  private waterCellCap = 0;
  private waterBoundHeights: GPUBuffer | null = null;
  private lastWaterSurface: Float32Array | null = null;
  private lastWaterType: Uint32Array | null = null;
  private lastWaterShallow: Uint32Array | null = null;
  private lastWaterClarity: Float32Array | null = null;
  private lastWaterDeep: Uint32Array | null = null;
  private lastWaterShore: Float32Array | null = null;
  private lastWaterChannel: Uint32Array | null = null;
  private lastWaterWet: Uint32Array | null = null;
  // (Ribbon pass retired 2026-06-25 — roads are carved+textured terrain; river/road
  //  ribbon meshes + the road-material atlas were removed as tech debt.)
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
  /** Keyed by the batch texture identity — a CanvasImageSource OR a RawMap object. */
  private shadowBindCache = new WeakMap<object, GPUBindGroup>();
  /** Per-batch bind group cache, keyed by the albedo source (batch identity —
   *  a CanvasImageSource or a RawMap). */
  private bindCache = new WeakMap<object, GPUBindGroup>();
  private texCache = new WeakMap<CanvasImageSource, GPUTexture>();
  /** One-shot warn flag for transient texture-upload failures (see uploadTexture). */
  private uploadWarned = false;
  /** Raw-map textures (material always; albedo/normal/emissive on the raw
   *  rehydration path), keyed by RawMap identity (not a CanvasImageSource). */
  private rawTexCache = new WeakMap<object, GPUTexture>();
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
  private staticShadowBundle: { texture: CanvasImageSource | RawMap; buf: GPUBuffer; count: number }[] = [];
  /** L2 static shape bundle: the static layer's poly/circle fills (flora trunks +
   *  canopies, fallback shapes) triangulated ONCE into a persistent WORLD-px vertex
   *  buffer, keyed by the lifted-array identity. The camera xform is applied in the
   *  shape VS (uXform), so this never re-triangulates on pan/zoom — killing the
   *  ~9 ms/frame re-bake of ~15k flora shapes the ablation found dominating encode. */
  private staticShapeSrc: readonly DrawItem[] | null = null;
  private staticShapeBuf: GPUBuffer | null = null;
  private staticShapeCount = 0;
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

    this.pipeline = createSpritePipeline(device, gpu.format);

    this.sampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });

    // Material-exemplar atlas → a 2d texture array (one layer per material), uploaded once
    // (content-static). Sampled with REPEAT addressing + linear filtering so the seamless
    // swatches tile smoothly under the chunky banded look.
    {
      const atlas = materialAtlas();
      // CPU box-filter mip chain (WebGPU won't auto-generate them) so the baked stochastic
      // swatches minify cleanly at zoom-out instead of aliasing. Box-averaging a toroidal
      // swatch stays seamless, so every level still tiles.
      const mips = buildMaterialAtlasMips(atlas);
      const tex = device.createTexture({
        size: { width: atlas.size, height: atlas.size, depthOrArrayLayers: atlas.layers },
        format: 'rgba8unorm',
        mipLevelCount: mips.length,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      for (let lvl = 0; lvl < mips.length; lvl++) {
        const m = mips[lvl];
        device.queue.writeTexture(
          { texture: tex, mipLevel: lvl },
          m.albedo as GPUAllowSharedBufferSource,
          { bytesPerRow: m.size * 4, rowsPerImage: m.size },
          { width: m.size, height: m.size, depthOrArrayLayers: atlas.layers },
        );
      }
      this.matAtlasView = tex.createView({ dimension: '2d-array' });
      this.matSampler = device.createSampler({
        addressModeU: 'repeat', addressModeV: 'repeat',
        magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear',
      });
    }

    // Clutter atlas: transparent placeholder now, real sprites when the PNG loads.
    this.clutterView = this.make1x1([0, 0, 0, 0]).createView();
    this.clutterSampler = device.createSampler({
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
      magFilter: 'nearest', minFilter: 'nearest',
    });
    void this.loadClutterAtlas();

    // Base-ground texture-patch array: per-layer flat fallback until the PNGs load.
    this.groundView = this.makeGroundPlaceholder();
    void this.loadGroundTexture();

    this.quadBuf = device.createBuffer({ size: QUAD_STRIP.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.quadBuf, 0, QUAD_STRIP);

    this.globalsBuf = device.createBuffer({ size: GLOBALS_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.globalsBind = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.globalsBuf } }],
    });

    this.flatNormal = this.make1x1([128, 128, 255, 0]);      // a=0 ⇒ flat normal
    this.neutralMaterial = this.make1x1([0, 255, 0, 0]);     // a=0 ⇒ AO 1
    this.blackEmissive = this.make1x1([0, 0, 0, 0]);         // no self-illumination

    // Terrain owns its OWN depth pass (spatial iso depth, greater, write) so it
    // self-occludes; entities draw over it in pass 2. The detail-patch pass reuses
    // the terrain FRAGMENT module (same shading over a denser mesh).
    const { pipeline: terrainPipeline, module: terrainModule } = createTerrainPipeline(device, gpu.format);
    this.terrainPipeline = terrainPipeline;
    // 32 floats (128 bytes): the 24 shared terrain globals + a 7th vec4 `uWindow` (T5
    // viewport cull) + an 8th vec4 `uFlags` (Slice-2 ground colour texture). The detail
    // pass shares this buffer (its vertex struct reads only the first 96 bytes; its
    // fragment is the terrain module's, which reads the full struct).
    this.terrainGlobalsBuf = device.createBuffer({ size: TERRAIN_PASS_GLOBALS_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    this.detailPatchPipeline = createDetailPatchPipeline(device, gpu.format, terrainModule);
    this.structureMeshPipeline = createStructureMeshPipeline(device, gpu.format);
    this.grassPipeline = createGrassPipeline(device, gpu.format);
    this.grassSubmergedPipeline = createGrassPipeline(device, gpu.format, false);
    // 112 bytes / 28 floats: mirrors the entity Globals viewport/ambient/sun/xform
    // block (80 B) plus uTime (padded to a 16-B boundary) + a uWind vec4 — see
    // `GGlobals` in grass-wgsl.ts and `packGrassGlobals` below.
    this.grassGlobalsBuf = device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    this.waterPipeline = createWaterPipeline(device, gpu.format);
    // Sized from WATER_GLOBALS_FLOATS (was a hardcoded 128) so it tracks the struct —
    // grew to 144 bytes when uWindow (the viewport mesh-cull window) was appended.
    this.waterGlobalsBuf = device.createBuffer({ size: WATER_GLOBALS_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // Baked tiling-noise atlas shared by the water + backdrop shaders (one texture
    // tap replaces their per-fragment ALU fbm — see noise-texture.ts).
    const noise = createNoiseTexture(device);
    this.noiseTexView = noise.texture.createView();
    this.noiseSampler = noise.sampler;

    // Infinite-ocean backdrop reuses the 112-byte water globals uniform for the
    // inverse projection + time.
    this.oceanBackdropPipeline = createOceanBackdropPipeline(device, gpu.format);
    this.oceanBackdropBind = device.createBindGroup({
      layout: this.oceanBackdropPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.waterGlobalsBuf } },
        { binding: 1, resource: this.noiseTexView },
        { binding: 2, resource: this.noiseSampler },
      ],
    });

    this.shadowPipeline = createShadowPipeline(device, gpu.format);
    // 8 floats: viewport(2) + alpha(1) + pad(1) + xform(4). uXform keeps the shadow
    // corners WORLD-px (camera-independent), packed once.
    this.shadowGlobalsBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.shadowGlobalsBind = device.createBindGroup({
      layout: this.shadowPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.shadowGlobalsBuf } }],
    });

    this.shapePipeline = createShapePipeline(device, gpu.format);
    // 32 B: vec2 viewport + vec2 pad + vec4 uXform (world→device affine, sx/sy/ox/oy).
    this.shapeGlobalsBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.shapeGlobalsBind = device.createBindGroup({
      layout: this.shapePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.shapeGlobalsBuf } }],
    });

    this.blitPipeline = createBlitPipeline(device, gpu.format);
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

  /** Load the harvested clutter sprite atlas (optional). On success the real texture
   *  replaces the transparent placeholder and the terrain bind groups rebuild so the
   *  scatter pass samples it. A missing/failed atlas simply leaves the ground bare. */
  private async loadClutterAtlas(): Promise<void> {
    try {
      const resp = await fetch(assetUrl('textures/clutter/atlas.png'));
      if (!resp.ok) return;
      const bmp = await createImageBitmap(await resp.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      this.clutterView = this.uploadTexture(bmp, false).createView();   // straight alpha
      this.clutterLoaded = true;
      this.terrainBind = null;   // rebuild both bind groups with the real texture
      this.detailBind = null;
      // The slicer's sidecar manifest drives the standing-grass pass (data-driven layer
      // ranges — a re-slice with different sprite counts needs no code edit). Optional:
      // absent manifest ⇒ the flat in-shader scatter still runs, just no billboards.
      try {
        const mResp = await fetch(assetUrl('textures/clutter/manifest.json'));
        if (mResp.ok) {
          this.clutterManifest = await mResp.json() as ClutterManifest;
          this.grassBind = null;         // rebuild with the real texture view
          this.grassSrcHeights = null;   // force an instance rebuild
        }
      } catch { /* no manifest ⇒ no standing grass */ }
    } catch { /* clutter is optional — no atlas ⇒ no ground-cover sprites */ }
  }

  /** A 1×1×4 array texture (per-layer fallback tones) bound until the ground PNGs load. */
  private makeGroundPlaceholder(): GPUTextureView {
    // Per-layer mean tones (grass/dust/pebble/dry · seabed/white-sand/shingle · dune/hardpan · snow/litter) —
    // shown until the real swatches load; order MUST match GROUND_LAYER_* in terrain-wgsl.ts.
    const fallback = [
      [52, 86, 49], [176, 130, 77], [112, 100, 86], [168, 151, 92],       // 0..3 grass/dust/pebble/dry
      [219, 226, 178], [249, 245, 227], [126, 125, 118],                  // 4..6 seabed/white-sand/shingle
      [228, 181, 107], [179, 158, 130],                                   // 7..8 dune/hardpan
      [224, 241, 248], [56, 49, 39],                                      // 9..10 snow/forest-litter
    ];
    const tex = this.device.createTexture({
      size: [1, 1, fallback.length], format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    for (let l = 0; l < fallback.length; l++) {
      const [r, g, b] = fallback[l];
      this.device.queue.writeTexture(
        { texture: tex, origin: [0, 0, l] },
        new Uint8Array([r, g, b, 255]), { bytesPerRow: 4, rowsPerImage: 1 }, [1, 1, 1],
      );
    }
    return tex.createView({ dimension: '2d-array' });
  }

  /** Load the seamless base-ground patches into a texture array (optional). 11 layers:
   *  grass/dust/pebble/dry (open ground) · seabed (shallows) · white-sand/shingle (beaches) ·
   *  desert-dune/cracked-hardpan (drylands) · snow · forest-litter. Order MUST match
   *  GROUND_LAYER_* in terrain-wgsl.ts. On success the real array replaces the flat placeholder
   *  and the terrain bind groups rebuild; a missing/failed set leaves the flat fallback tones. */
  private async loadGroundTexture(): Promise<void> {
    try {
      const names = [
        'grass', 'dust', 'pebble', 'dry',
        'seabed', 'sand-white', 'sand-shingle',
        'desert-dune', 'cracked-hardpan',
        'snow', 'forest-litter',
      ] as const;
      const blobs = await Promise.all(names.map(async (n) => {
        const resp = await fetch(assetUrl(`textures/ground/${n}.png`));
        if (!resp.ok) throw new Error(`ground/${n}.png ${resp.status}`);
        return resp.blob();
      }));
      const bmps = await Promise.all(blobs.map((b) => createImageBitmap(b, { colorSpaceConversion: 'none' })));
      const size = bmps[0].width;
      // FULL MIP CHAIN, CPU-downsampled per level. The swatches are 512px over a
      // ~1.25-tile repeat, so at gameplay zoom every screen pixel spans MANY texels;
      // sampled at mip 0 (the only level the old single-mip texture had) that detail
      // decimated into aliased grit and the pebble/gravel/grass character never
      // resolved at 1:1. With the pyramid + the footprint LOD in groundPatch
      // (terrain-wgsl) each zoom reads the finest level it can actually show.
      const mipCount = Math.floor(Math.log2(size)) + 1;
      const tex = this.device.createTexture({
        size: [size, size, names.length], format: 'rgba8unorm', mipLevelCount: mipCount,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      for (let l = 0; l < bmps.length; l++) {
        for (let lvl = 0, s = size; lvl < mipCount; lvl++, s = Math.max(1, s >> 1)) {
          const scaled = lvl === 0 ? bmps[l] : await createImageBitmap(blobs[l], {
            colorSpaceConversion: 'none', resizeWidth: s, resizeHeight: s, resizeQuality: 'high',
          });
          this.device.queue.copyExternalImageToTexture(
            { source: scaled, flipY: false }, { texture: tex, origin: [0, 0, l], mipLevel: lvl }, [s, s, 1],
          );
          if (lvl > 0) scaled.close();
        }
      }
      this.groundView = tex.createView({ dimension: '2d-array' });
      this.terrainBind = null;   // rebuild both bind groups with the real array
      this.detailBind = null;
    } catch { /* ground textures optional — flat fallback tones otherwise */ }
  }

  private uploadTexture(src: CanvasImageSource, premultiply: boolean): GPUTexture {
    const cached = this.texCache.get(src);
    if (cached) return cached;
    const { w, h } = srcSize(src);
    const tex = this.device.createTexture({
      size: [Math.max(1, w), Math.max(1, h), 1], format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    // A source with no pixels yet (an image that hasn't finished decoding, a
    // canvas whose backing was transiently unavailable) must NOT kill the frame
    // loop: `copyExternalImageToTexture` throws on such sources, and an uncaught
    // throw here permanently stops rAF (observed once composes/sheet loads were
    // spread across live frames instead of finishing before frame 1). Render a
    // transparent texture this frame and DON'T cache, so the next frame retries.
    if (w <= 0 || h <= 0) return tex;
    try {
      this.device.queue.copyExternalImageToTexture(
        // draw-list sources are canvases/images (never SVG); narrow for the GPU API.
        { source: src as GPUCopyExternalImageSource, flipY: false },
        { texture: tex, premultipliedAlpha: premultiply },
        [w, h, 1],
      );
    } catch (err) {
      if (!this.uploadWarned) { console.warn('[gpu-scene] texture upload failed (will retry next frame)', err); this.uploadWarned = true; }
      return tex;
    }
    this.texCache.set(src, tex);
    gpuTexStats.canvasTextures++;
    gpuTexStats.canvasBytes += Math.max(1, w) * Math.max(1, h) * 4;
    return tex;
  }

  /** Upload a raw, UN-premultiplied RGBA buffer (a DATA map like the material map)
   *  straight to a texture via writeTexture — bypassing the premultiplied 2D-canvas
   *  path that would zero the AO/roughness channels where metallic (alpha) is 0. */
  private uploadRawTexture(m: { data: Uint8ClampedArray; w: number; h: number }): GPUTexture {
    const cached = this.rawTexCache.get(m);
    if (cached) return cached;
    const w = Math.max(1, m.w), h = Math.max(1, m.h);
    const tex = this.device.createTexture({
      size: [w, h, 1], format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.device.queue.writeTexture(
      { texture: tex },
      m.data as unknown as BufferSource,
      { bytesPerRow: w * 4, rowsPerImage: h },
      [w, h, 1],
    );
    this.rawTexCache.set(m, tex);
    gpuTexStats.rawTextures++;
    gpuTexStats.rawBytes += w * h * 4;
    return tex;
  }

  /** Upload an albedo/companion map to a texture. A RawMap goes straight to
   *  `writeTexture` (already premultiplied where it needs to be — albedo/emissive —
   *  or a DATA/normal map that must stay un-premultiplied); a CanvasImageSource
   *  takes the `copyExternalImageToTexture` path with the given premultiply flag. */
  private uploadMap(src: CanvasImageSource | RawMap, premultiply: boolean): GPUTexture {
    return isRawMap(src) ? this.uploadRawTexture(src) : this.uploadTexture(src, premultiply);
  }

  private batchBind(b: InstanceBatch): GPUBindGroup {
    const cached = this.bindCache.get(b.texture);
    if (cached) return cached;
    const albedo = this.uploadMap(b.texture, true);
    // Failed/pending CANVAS upload (not in texCache) → build the bind for THIS
    // frame but don't memoize, so the retry next frame isn't masked by a stale
    // bind. A raw upload can't transiently fail (writeTexture from owned bytes), so
    // it's always settled.
    const settled = isRawMap(b.texture) ? true : this.texCache.has(b.texture);
    const normal = b.normalData
      ? this.uploadRawTexture(b.normalData)
      : b.normal ? this.uploadTexture(b.normal, false) : this.flatNormal;
    const material = b.materialData
      ? this.uploadRawTexture(b.materialData)
      : b.material ? this.uploadTexture(b.material, false) : this.neutralMaterial;
    // Emissive is premultiplied-uploaded (true) like the albedo: lit-pane RGB is
    // co-keyed to the same alpha cutout, and the shader scales it by alpha. The raw
    // form (emissiveData) is premultiplied at rehydration, so it uploads as-is.
    const emissive = b.emissiveData
      ? this.uploadRawTexture(b.emissiveData)
      : b.emissive ? this.uploadTexture(b.emissive, true) : this.blackEmissive;
    const bind = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: albedo.createView() },
        { binding: 2, resource: normal.createView() },
        { binding: 3, resource: material.createView() },
        { binding: 4, resource: emissive.createView() },
      ],
    });
    if (settled) this.bindCache.set(b.texture, bind);
    return bind;
  }

  /** Per-source bind group for the shadow pass (sampler + alpha-sampled tex). The
   *  source is the entity albedo (silhouette) or the baked geometry-shadow mask —
   *  a canvas OR a raw premultiplied map; only its alpha is read either way. */
  private shadowBind(texture: CanvasImageSource | RawMap): GPUBindGroup {
    const cached = this.shadowBindCache.get(texture);
    if (cached) return cached;
    // Reuse the entity albedo upload (same src object) — only the alpha is read.
    const tex = this.uploadMap(texture, true);
    const bind = this.device.createBindGroup({
      layout: this.shadowPipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: tex.createView() },
      ],
    });
    // As in batchBind: only memoize once the underlying upload actually landed (raw
    // uploads are always settled; canvas uploads may be pending a decode).
    if (isRawMap(texture) || this.texCache.has(texture)) this.shadowBindCache.set(texture, bind);
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
    roadFeature: Uint32Array,
  ): void {
    const { device } = this;
    const cells = heights.length;
    // The road feature buffer is variable-length (header + CSR index + segments), so it
    // has its own byte capacity and can force a realloc even when the cell count is
    // unchanged (e.g. a world with no roads gains some, growing the geometry).
    const featBytes = roadFeature.byteLength;
    let realloc = false;
    if (!this.terrainHeightsBuf || cells > this.terrainCellCap || featBytes > this.terrainFeatureCap) {
      this.terrainHeightsBuf?.destroy();
      this.terrainColorsBuf?.destroy();
      this.terrainMoistureBuf?.destroy();
      this.terrainTemperatureBuf?.destroy();
      this.terrainFeatureBuf?.destroy();
      const storage = (n: number) => device.createBuffer({ size: n, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.terrainHeightsBuf = storage(cells * 4);
      this.terrainColorsBuf = storage(cells * 4);
      this.terrainMoistureBuf = storage(cells * 4);
      this.terrainTemperatureBuf = storage(cells * 4);
      this.terrainFeatureBuf = storage(Math.max(featBytes, 16));
      this.terrainCellCap = cells;
      this.terrainFeatureCap = Math.max(featBytes, 16);
      realloc = true;
    }
    // Built out of the realloc block so a clutter-atlas load (which nulls terrainBind)
    // forces a rebuild that binds the real sprite texture.
    if (realloc || !this.terrainBind) {
      this.terrainBind = device.createBindGroup({
        layout: this.terrainPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.terrainGlobalsBuf } },
          { binding: 1, resource: { buffer: this.terrainHeightsBuf! } },
          { binding: 2, resource: { buffer: this.terrainColorsBuf! } },
          { binding: 3, resource: { buffer: this.terrainMoistureBuf! } },
          { binding: 4, resource: { buffer: this.terrainTemperatureBuf! } },
          { binding: 6, resource: { buffer: this.terrainFeatureBuf! } },
          { binding: 7, resource: this.matAtlasView },
          { binding: 8, resource: this.matSampler },
          { binding: 9, resource: this.noiseTexView },
          { binding: 10, resource: this.noiseSampler },
          { binding: 11, resource: this.groundView },
          { binding: 12, resource: this.matSampler },
        ],
      });
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
    if (realloc || roadFeature !== this.lastRoadFeature) {
      device.queue.writeBuffer(this.terrainFeatureBuf!, 0, roadFeature as GPUAllowSharedBufferSource);
      this.lastRoadFeature = roadFeature;
    }
  }

  /** (Re)upload the detail-patch buffers (packed fine heights + per-patch origins).
   *  The bind group reuses the coarse terrain buffers (heights/colour/material) for
   *  the shared fragment, so it rebuilds when EITHER the patch buffers grow OR the
   *  coarse height buffer identity changes. Skips the writeBuffer when arrays are
   *  unchanged by reference. Returns false if the coarse terrain buffers aren't
   *  ready (patches reuse them). */
  private uploadDetail(detail: DetailField): boolean {
    const { device } = this;
    if (!this.terrainHeightsBuf || !this.terrainColorsBuf
      || !this.terrainMoistureBuf || !this.terrainTemperatureBuf || !this.terrainFeatureBuf) return false;
    const hBytes = detail.heights.byteLength;
    const oBytes = detail.origins.byteLength;
    let realloc = false;
    if (!this.detailHeightsBuf || hBytes > this.detailHeightsCap) {
      this.detailHeightsBuf?.destroy();
      this.detailHeightsBuf = device.createBuffer({ size: hBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.detailHeightsCap = hBytes;
      realloc = true;
    }
    if (!this.detailOriginsBuf || oBytes > this.detailOriginsCap) {
      this.detailOriginsBuf?.destroy();
      this.detailOriginsBuf = device.createBuffer({ size: oBytes, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      this.detailOriginsCap = oBytes;
      realloc = true;
    }
    if (realloc || !this.detailBind || this.detailBoundHeights !== this.terrainHeightsBuf) {
      this.detailBind = device.createBindGroup({
        layout: this.detailPatchPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.terrainGlobalsBuf } },
          { binding: 1, resource: { buffer: this.terrainHeightsBuf } },
          { binding: 2, resource: { buffer: this.terrainColorsBuf } },
          { binding: 3, resource: { buffer: this.terrainMoistureBuf } },
          { binding: 4, resource: { buffer: this.terrainTemperatureBuf } },
          { binding: 5, resource: { buffer: this.detailHeightsBuf } },
          { binding: 6, resource: { buffer: this.terrainFeatureBuf } },
          { binding: 7, resource: this.matAtlasView },
          { binding: 8, resource: this.matSampler },
          { binding: 9, resource: this.noiseTexView },
          { binding: 10, resource: this.noiseSampler },
          { binding: 11, resource: this.groundView },
          { binding: 12, resource: this.matSampler },
        ],
      });
      this.detailBoundHeights = this.terrainHeightsBuf;
    }
    if (realloc || detail.heights !== this.lastDetailHeights) {
      device.queue.writeBuffer(this.detailHeightsBuf, 0, detail.heights as GPUAllowSharedBufferSource);
      this.lastDetailHeights = detail.heights;
    }
    if (realloc || detail.origins !== this.lastDetailOrigins) {
      device.queue.writeBuffer(this.detailOriginsBuf, 0, detail.origins as GPUAllowSharedBufferSource);
      this.lastDetailOrigins = detail.origins;
    }
    return true;
  }

  /** (Re)upload the structure-mesh vertex buffer + (re)bind the terrain globals. The bind
   *  group reads ONLY the terrain globals uniform (binding 0), so it's built once and reused;
   *  the vertex buffer grows on demand and re-uploads only when the array identity changes. */
  private uploadStructures(field: StructureField): void {
    const { device } = this;
    const bytes = field.data.byteLength;
    let realloc = false;
    if (!this.structureVertexBuf || bytes > this.structureVertexCap) {
      this.structureVertexBuf?.destroy();
      this.structureVertexBuf = device.createBuffer({ size: Math.max(bytes, 36), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      this.structureVertexCap = Math.max(bytes, 36);
      realloc = true;
    }
    if (!this.structureBind) {
      this.structureBind = device.createBindGroup({
        layout: this.structureMeshPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.terrainGlobalsBuf } }],
      });
    }
    if (realloc || field.data !== this.lastStructureData) {
      device.queue.writeBuffer(this.structureVertexBuf, 0, field.data as GPUAllowSharedBufferSource);
      this.lastStructureData = field.data;
    }
  }

  /** Pack the dedicated grass Globals uniform (step 3: wind). Mirrors the entity
   *  Globals viewport/ambient/sun/xform layout (so the FS lighting math is unchanged)
   *  then appends `uTime` (padded to a 16-byte boundary) and `uWind` — see `GGlobals`
   *  in grass-wgsl.ts. `timeSec` is wall-clock (render code, not `src/sim/`, so this
   *  is exempt from the Math.random/Date.now sim ban); the water pass animates the
   *  same way. */
  private packGrassGlobals(
    w: number, h: number, lighting: LightingState, xform: ViewTransform | undefined, timeSec: number,
  ): Float32Array {
    const b = new Float32Array(28);
    b[0] = w; b[1] = h; b[2] = Math.max(1, lighting.bands); b[3] = 0;
    b[4] = lighting.ambient[0]; b[5] = lighting.ambient[1]; b[6] = lighting.ambient[2]; b[7] = 0;
    b[8] = lighting.sunDir[0]; b[9] = lighting.sunDir[1]; b[10] = lighting.sunDir[2]; b[11] = 0;
    b[12] = lighting.sunColor[0]; b[13] = lighting.sunColor[1]; b[14] = lighting.sunColor[2];
    b[15] = lighting.enabled ? (lighting.nightFactor ?? 0) : 0;
    b[16] = xform?.sx ?? 1; b[17] = xform?.sy ?? 1; b[18] = xform?.ox ?? 0; b[19] = xform?.oy ?? 0;
    b[20] = timeSec; b[21] = 0; b[22] = 0; b[23] = 0;
    b[24] = GRASS_WIND_DIR[0]; b[25] = GRASS_WIND_DIR[1]; b[26] = GRASS_WIND_STRENGTH; b[27] = GRASS_WIND_FREQ;
    return b;
  }

  /** Build (once per world) + bind the standing-grass instance buffer from the terrain
   *  heightfield. Returns true when there are blades to draw. The instance array is
   *  memoised on the height-array identity, so a static world re-packs nothing per frame;
   *  the camera rides uXform so pan/zoom never invalidate it. Needs the clutter atlas +
   *  its manifest (both async) — until they land, the pass simply does not run. */
  private ensureGrass(terrain: TerrainField, water: WaterField | null): boolean {
    if (!this.clutterLoaded || !this.clutterManifest) return false;
    // Memoised on the height array AND the water-surface array (which arrives a frame or two
    // after terrain, and shifts on drought/flood) so river/lake weed re-packs when it lands.
    const waterSurf = water?.surfaceW ?? null;
    // Road identity rides the memo too: desire-line adoption / road evolution bumps
    // roadGraph.rev, which mints a new (memoised) feature geometry — the carpet must
    // re-pack so the billboards clear off a NEW carriageway.
    const roadPacked = terrain.roadGeo?.packed ?? null;
    if (terrain.heights === this.grassSrcHeights && this.grassSrcWaterSurf === waterSurf
        && this.grassSrcRoad === roadPacked && this.grassBind) {
      return this.grassCount > 0;
    }

    const { data, count, seaweedCount } = buildGrassInstances(
      terrain, this.clutterManifest, waterSurf, water?.waterType ?? null, terrain.roadGeo ?? null,
    );
    this.grassSrcHeights = terrain.heights;
    this.grassSrcRoad = roadPacked;
    this.grassSrcWaterSurf = waterSurf;
    this.grassCount = count;
    this.grassSeaweedCount = seaweedCount;
    if (count === 0) return false;

    const buf = this.dynBuf('grass', data.byteLength);
    this.device.queue.writeBuffer(buf, 0, data as GPUAllowSharedBufferSource);
    this.grassBuf = buf;
    const entries: GPUBindGroupEntry[] = [
      { binding: 0, resource: { buffer: this.grassGlobalsBuf } },
      { binding: 1, resource: this.clutterView },
      { binding: 2, resource: this.clutterSampler },
    ];
    // Two bind groups (one per pipeline) — layout:'auto' makes each pipeline's layout its
    // own object, so a bind group built for one is not reusable on the other.
    if (!this.grassBind) {
      this.grassBind = this.device.createBindGroup({ layout: this.grassPipeline.getBindGroupLayout(0), entries });
    }
    if (!this.grassSubmergedBind) {
      this.grassSubmergedBind = this.device.createBindGroup({ layout: this.grassSubmergedPipeline.getBindGroupLayout(0), entries });
    }
    return true;
  }

  /** (Re)upload the water field buffers. The bind group borrows the terrain
   *  height buffer (binding 1) for depth, so it rebuilds when EITHER the water
   *  buffers grow OR the terrain heights buffer identity changes. Skips the
   *  writeBuffer per array when unchanged by reference. Returns false if there is
   *  no terrain height buffer to read (water needs it). */
  private uploadWaterFields(water: WaterField): boolean {
    const { device } = this;
    if (!this.terrainHeightsBuf) return false;
    const storage = (n: number) => device.createBuffer({ size: n, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const cells = water.surfaceW.length;
    let realloc = false;
    if (!this.waterSurfaceBuf || cells > this.waterCellCap) {
      for (const b of [this.waterSurfaceBuf, this.waterTypeBuf,
        this.waterShallowBuf, this.waterDeepBuf, this.waterClarityBuf, this.waterShoreBuf,
        this.waterWetBuf]) b?.destroy();
      this.waterSurfaceBuf = storage(cells * 4);
      this.waterTypeBuf = storage(cells * 4);
      this.waterShallowBuf = storage(cells * 4);
      this.waterDeepBuf = storage(cells * 4);
      this.waterClarityBuf = storage(cells * 4);
      this.waterShoreBuf = storage(cells * 4);
      this.waterWetBuf = storage(cells * 4);   // ≤ one packed u32 per lattice cell
      this.waterCellCap = cells;
      realloc = true;
    }

    // Analytic river-channel geometry (binding 9) — ONE packed u32 buffer, independent
    // of `cells`; grow on demand by byte size. A null channel (no rivers) binds a
    // 1-element dummy — the shader's `segCount == 0` guard skips every read (no-op).
    const ch = water.channel;
    const chData = ch ? ch.packed : EMPTY_WATER_U32;
    if (!this.waterChannelBuf || chData.byteLength > this.waterChannelCap) {
      this.waterChannelBuf?.destroy();
      this.waterChannelBuf = storage(Math.max(4, chData.byteLength));
      this.waterChannelCap = Math.max(4, chData.byteLength);
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
          { binding: 4, resource: { buffer: this.waterWetBuf! } },
          { binding: 5, resource: { buffer: this.waterShallowBuf! } },
          { binding: 6, resource: { buffer: this.waterDeepBuf! } },
          { binding: 7, resource: { buffer: this.waterClarityBuf! } },
          { binding: 8, resource: { buffer: this.waterShoreBuf! } },
          { binding: 9, resource: { buffer: this.waterChannelBuf! } },
          { binding: 10, resource: this.noiseTexView },
          { binding: 11, resource: this.noiseSampler },
        ],
      });
      this.waterBoundHeights = this.terrainHeightsBuf;
    }
    // WET-CELL list — the pack is memoised per (window, sub, flood) signature in
    // water-field.ts, so a stationary camera hands back the SAME subarray view and the
    // reference guard skips the re-upload; a moved window re-packs → new view → upload.
    if (realloc || water.wetCells !== this.lastWaterWet) {
      device.queue.writeBuffer(this.waterWetBuf!, 0, water.wetCells as GPUAllowSharedBufferSource);
      this.lastWaterWet = water.wetCells;
    }
    if (realloc || water.surfaceW !== this.lastWaterSurface) {
      device.queue.writeBuffer(this.waterSurfaceBuf, 0, water.surfaceW as GPUAllowSharedBufferSource);
      this.lastWaterSurface = water.surfaceW;
    }
    if (realloc || water.waterType !== this.lastWaterType) {
      device.queue.writeBuffer(this.waterTypeBuf!, 0, water.waterType as GPUAllowSharedBufferSource);
      this.lastWaterType = water.waterType;
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
    // Channel buffer — re-upload when the geometry array reference changes (a studio
    // edit re-emits; the memoised game geometry keeps a stable ref, so this is skipped).
    if (realloc || chData !== this.lastWaterChannel) {
      device.queue.writeBuffer(this.waterChannelBuf!, 0, chData as GPUAllowSharedBufferSource);
      this.lastWaterChannel = chData;
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
    // Keyed on the SHADOW direction (shadowDir ?? sunDir): the day/night cycle
    // sweeps sunDir per lighting step but pins shadowDir, so the bundle never
    // re-bakes on the clock — only on a real sun-convention change.
    const shadowSun = lighting.shadowDir ?? lighting.sunDir;
    const sig = `${+lighting.enabled}|${lighting.shadowMode ?? 'silhouette'}|${shadowSun.join(',')}`;
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

  /** L2 — triangulate the STATIC layer's poly/circle shapes ONCE (world px, no xform
   *  baked) into a persistent vertex buffer, keyed by the lifted-array identity. The
   *  camera transform is applied by the shape VS (uXform), so pan/zoom never
   *  re-triangulates these — the per-frame cost was ~15k flora trunks/canopies. */
  private ensureStaticShapeBundle(lifted: readonly DrawItem[]): void {
    if (this.staticShapeSrc === lifted) return;
    const { vertices, vertexCount } = buildShapeVertices(lifted);
    this.staticShapeBuf?.destroy();
    if (vertexCount > 0) {
      const buf = this.device.createBuffer({
        size: vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this.device.queue.writeBuffer(buf, 0, vertices as GPUAllowSharedBufferSource);
      this.staticShapeBuf = buf;
    } else {
      this.staticShapeBuf = null;
    }
    this.staticShapeCount = vertexCount;
    this.staticShapeSrc = lifted;
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
    /** Adaptive sub-tile detail patches (Slice B) — a finer instanced mesh over the
     *  hot regions, drawn right after terrain. Null/absent ⇒ coarse terrain only. */
    detail?: DetailField | null;
    /** Blended water surface (S2) — drawn over terrain, under entities. */
    water?: WaterField | null;
    /** Depth-tested structure meshes (3D-structure epic, S1) — bridges founded against the
     *  terrain, drawn after water, before the entity depth-clear. Needs terrain (shares its
     *  globals + depth); null/absent ⇒ structures draw as sprites via the entity list. */
    structures?: StructureField | null;
    /** Screen-space UI geometry (S1) — drawn in its own pass over the entities. */
    uiGroups?: readonly UiDrawGroup[];
    /** P-E: when set, the scene passes render into a low-res target sized `w×h`
     *  and are nearest-upscaled to `out` (swapchain device px); the UI then draws
     *  crisp at `out`. Absent ⇒ legacy direct-to-swapchain at `w×h`. */
    out?: { w: number; h: number };
    /** P-E: snap-then-offset remainder in OUTPUT pixels (default 0). */
    pixelOffset?: readonly [number, number];
    /** The CAMERA's zoom (world scale the player chose) — drives zoom-LOD gates
     *  like the standing-grass cutoff. Distinct from xform.sx, which is divided
     *  by the adaptive pixel-scale: gating on sx made ground cover vanish whenever
     *  the resolution dropped to px2/px3, even at gameplay zoom. Absent ⇒ falls
     *  back to xform.sx (tests / direct callers without a camera). */
    camZoom?: number;
    /** Profiler ablation: turn individual passes off to attribute GPU cost
     *  (all on by default). */
    passes?: {
      terrain?: boolean; water?: boolean; shadows?: boolean;
      entities?: boolean; ui?: boolean;
    };
  }): void {
    const { device } = this;
    const { items: rawItems, staticItems, lighting, w, h, xform, terrain, water, structures, uiGroups, out, pixelOffset } = opts;
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
    // The static layer's poly/circle shapes (flora trunks/canopies, fallback fills)
    // are triangulated ONCE into a persistent world-px buffer (L2), keyed by the
    // lifted-array identity — the shape VS applies the camera (uXform), so this
    // never re-bakes on pan/zoom. Only the small dynamic shape set is built below.
    if (staticItems) this.ensureStaticShapeBundle(this.staticLifted);
    // Dynamic items (NPCs, flotsam — or, with no static split, EVERYTHING) are
    // lifted + packed per frame; the set is small so this stays cheap.
    const dynLifted = terrain ? liftDrawList(rawItems, terrain) : rawItems;
    const { batches: dynBatches } = buildInstanceBatches(dynLifted);

    // Cast-shadow parallelograms in WORLD px (the shader's uXform bakes the
    // camera). L2: the static half is packed once into persistent buffers; only
    // the small dynamic layer (NPCs/flotsam) is rebuilt + packed per frame.
    const shadowsOn = lighting.enabled && P.shadows;
    if (shadowsOn && staticItems) this.ensureStaticShadowBundle(this.staticLifted, lighting);
    const dynShadowBatches = shadowsOn
      ? buildShadowBatches(dynLifted, lighting).filter(b => b.instances.length > 0)
      : [];
    const staticShadowCount = (shadowsOn && staticItems)
      ? this.staticShadowBundle.reduce((s, b) => s + b.count, 0) : 0;
    const hasShadows = staticShadowCount > 0 || dynShadowBatches.length > 0;

    // Wall-clock seconds drive both the grass and the tree-billboard sway phase; a
    // non-browser host (SSR/tests) has no `performance`, so it falls back to a frozen
    // 0 (still, not animated — keeps the golden-image tests deterministic).
    const grassTimeSec = typeof performance !== 'undefined' ? performance.now() / 1000 : 0;
    device.queue.writeBuffer(this.globalsBuf, 0, packGlobals({
      viewport: [w, h], bands: lighting.bands, ambient: lighting.ambient,
      sunDir: lighting.sunDir, sunColor: lighting.sunColor,
      night: lighting.enabled ? (lighting.nightFactor ?? 0) : 0, xform,
      wind: { dir: [GRASS_WIND_DIR[0], GRASS_WIND_DIR[1]],
              strength: (globalThis as { __treeWind?: number }).__treeWind ?? TREE_WIND_STRENGTH,
              freq: GRASS_WIND_FREQ },
      timeSec: grassTimeSec,
    }) as GPUAllowSharedBufferSource);
    device.queue.writeBuffer(this.grassGlobalsBuf, 0,
      this.packGrassGlobals(w, h, lighting, xform, grassTimeSec) as GPUAllowSharedBufferSource);
    if (hasShadows) {
      const xf = xform ?? { sx: 1, sy: 1, ox: 0, oy: 0 };
      device.queue.writeBuffer(this.shadowGlobalsBuf, 0,
        new Float32Array([w, h, SHADOW_ALPHA, 0, xf.sx, xf.sy, xf.ox, xf.oy]));
    }

    const hasTerrain = !!(terrain && terrain.vertexCount > 0 && terrain.heights.length > 0 && P.terrain);
    if (hasTerrain) {
      this.uploadFields(terrain!.heights, terrain!.colors, terrain!.moisture, terrain!.temperature, terrain!.roadFeature);
      device.queue.writeBuffer(this.terrainGlobalsBuf, 0,
        packTerrainPassGlobals(terrain!.globals) as GPUAllowSharedBufferSource);
    }

    // Detail patches reuse the coarse terrain buffers (+ its globals/depth), so they
    // only run when terrain did; uploadDetail returns false if those aren't ready.
    let hasDetail = !!(hasTerrain && opts.detail && opts.detail.patchCount > 0);
    if (hasDetail) hasDetail = this.uploadDetail(opts.detail!);

    // Water needs the terrain height buffer (for depth), so it only runs when
    // terrain did. uploadWaterFields returns false if that buffer isn't ready.
    let hasWater = !!(hasTerrain && water && water.wetCount > 0 && water.vertexCount > 0 && P.water);
    if (hasWater) {
      hasWater = this.uploadWaterFields(water!);
      if (hasWater) {
        device.queue.writeBuffer(this.waterGlobalsBuf, 0, water!.globals as GPUAllowSharedBufferSource);
      }
    }

    // Structure meshes (S1) borrow the terrain globals (camera + iso + z + sun), so they only
    // run when terrain did. The vertex buffer is world-space; the pass just projects + depth-tests.
    const hasStructures = !!(hasTerrain && structures && structures.vertexCount > 0);
    if (hasStructures) this.uploadStructures(structures!);

    // Standing-grass billboards (vegetation-billboard epic) — GPU-only ground cover from
    // the terrain scatter, drawn between structures and the entity depth-clear so it shares
    // the terrain depth. Gated to gameplay zoom (a full meadow is noise + fill cost at
    // overview) and to a loaded clutter atlas + manifest.
    const zoom = opts.camZoom ?? xform?.sx ?? 1;
    const hasGrass = !!(hasTerrain && zoom >= GRASS_MIN_ZOOM && this.ensureGrass(terrain!, water ?? null));
    // Dev observability (mutated in place — no per-frame alloc), like __gpuTexStats.
    const gStats = ((globalThis as Record<string, unknown>).__grassStats ??= {}) as Record<string, unknown>;
    gStats.zoom = zoom; gStats.hasGrass = hasGrass;
    gStats.count = this.grassCount; gStats.seaweed = this.grassSeaweedCount;

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
    // colour pass clears and the rest load. terrain → ground veg → water → shadows
    // (all under the entities) → entities+shapes → blit (upscale) → UI (crisp, on top).
    // Pass 0: open-ocean backdrop fills the viewport beyond the map (needs the water
    // globals, which are uploaded only when hasWater). Terrain then loads over it.
    if (hasWater) this.passBackdrop(ctx);
    if (hasTerrain) this.passTerrain(ctx, terrain!);
    if (hasDetail) this.passDetail(ctx, opts.detail!);
    const grassOn = hasGrass && !(globalThis as { __noGrass?: boolean }).__noGrass;
    // Submerged seaweed draws UNDER the water so the surface composites over it (submerged).
    if (grassOn) this.passGrassSubmerged(ctx);
    if (hasWater) this.passWater(ctx, water!);
    if (hasStructures) this.passStructures(ctx, structures!);
    if (grassOn) this.passGrass(ctx);
    // Cast shadows LAST of the ground layers — after the terrain AND the standing veg — so a
    // tree/building shadow darkens the grass, flowers and pressed clutter it falls across, not
    // just the bare ground (grass used to overpaint the shadow and stay fully sunlit). Still
    // below the entity depth-clear, so the casters themselves and NPCs stay lit.
    if (hasShadows) this.passShadows(ctx, !!staticItems, dynShadowBatches);
    this.passEntities(ctx, P.entities, dynBatches, dynLifted, xform);
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

  /** Pass 1.1 — adaptive detail patches over the coarse terrain. Loads colour +
   *  depth (greater-equal + write): each patch overdraws the coarse tiles it covers
   *  at finer resolution; the next un-patched tile in front still occludes it. One
   *  instanced draw — `vertexCountPerPatch` verts × `patchCount` instances. */
  private passDetail(ctx: PassCtx, detail: DetailField): void {
    const dpass = ctx.enc.beginRenderPass({
      colorAttachments: [{ view: ctx.colorView, clearValue: ctx.ocean, loadOp: ctx.colorCleared ? 'load' : 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: ctx.depthView, depthLoadOp: 'load', depthStoreOp: 'store' },
    });
    dpass.setPipeline(this.detailPatchPipeline);
    dpass.setBindGroup(0, this.detailBind!);
    dpass.setVertexBuffer(0, this.detailOriginsBuf!);
    dpass.draw(detail.vertexCountPerPatch, detail.patchCount);
    dpass.end();
    ctx.colorCleared = true;
  }

  /**
   * Pass 1.5 — cast shadows (stencil-union): each silhouette draws premult black
   * at SHADOW_ALPHA straight onto the scene colour; the stencil (cleared to 0,
   * test `equal 0` + increment) makes each pixel darken at most once so overlaps
   * union instead of double-darkening — touching only shadow pixels, never the
   * full screen. After the terrain AND ground veg, before the entity depth-clear →
   * shadows sit on the ground AND darken the grass/clutter standing in them.
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
   * Pass 1.9 — structure meshes (3D-structure epic, S1). Depth-tested masonry (bridges)
   * over the terrain, AFTER water (so the deck reads over the surface) and BEFORE the entity
   * depth-clear. Loads the terrain depth (greater, WRITE): a structure interleaves with the
   * heightfield in the shared iso depth — masonry that plunges below the visible bed is
   * occluded by nearer terrain (founding), and structures resolve each other by true depth.
   * One draw for the whole world-space vertex buffer.
   */
  private passStructures(ctx: PassCtx, field: StructureField): void {
    const spass = ctx.enc.beginRenderPass({
      colorAttachments: [{ view: ctx.colorView, clearValue: ctx.ocean, loadOp: ctx.colorCleared ? 'load' : 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: ctx.depthView, depthLoadOp: 'load', depthStoreOp: 'store' },
    });
    spass.setPipeline(this.structureMeshPipeline);
    spass.setBindGroup(0, this.structureBind!);
    spass.setVertexBuffer(0, this.structureVertexBuf!);
    spass.draw(field.vertexCount);
    spass.end();
    ctx.colorCleared = true;
  }

  /**
   * Pass 1.95 — standing-grass billboards (vegetation-billboard epic, S1). Upright
   * ground-cover sprites over the terrain, AFTER structures and BEFORE the entity
   * depth-clear. Loads the terrain depth (greater-equal, WRITE): each blade takes its
   * foot's iso depth, so terrain in front occludes it (far-hill grass hidden by the near
   * hill) and closer blades win over farther ones by depth, order-independent. Opaque +
   * alpha-tested. One instanced draw for the whole memoised instance buffer.
   */
  private passGrass(ctx: PassCtx): void {
    const landCount = this.grassCount - this.grassSeaweedCount;
    if (landCount <= 0) return;
    const gpass = ctx.enc.beginRenderPass({
      colorAttachments: [{ view: ctx.colorView, clearValue: ctx.ocean, loadOp: ctx.colorCleared ? 'load' : 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: ctx.depthView, depthLoadOp: 'load', depthStoreOp: 'store' },
    });
    gpass.setPipeline(this.grassPipeline);
    gpass.setBindGroup(0, this.grassBind!);
    gpass.setVertexBuffer(0, this.grassBuf!);
    // Land veg + wrack only — the leading seaweed instances drew pre-water (passGrassSubmerged).
    gpass.draw(GRASS_VERTEX_COUNT, landCount, 0, this.grassSeaweedCount);
    gpass.end();
    ctx.colorCleared = true;
  }

  /**
   * Pass 1.4 — SUBMERGED seaweed billboards, drawn BEFORE the water pass so the translucent
   * water composites over them (real depth-graded Beer-Lambert tint = they read underwater).
   * The leading `grassSeaweedCount` instances of the shared buffer are seaweed; NO depth write
   * (siblings the water pass) so the fronds never reject the water above them. Terrain still
   * occludes them (greater-equal). Skipped when there is no seaweed (inland worlds).
   */
  private passGrassSubmerged(ctx: PassCtx): void {
    if (this.grassSeaweedCount <= 0 || !this.grassSubmergedBind) return;
    const gpass = ctx.enc.beginRenderPass({
      colorAttachments: [{ view: ctx.colorView, clearValue: ctx.ocean, loadOp: ctx.colorCleared ? 'load' : 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: ctx.depthView, depthLoadOp: 'load', depthStoreOp: 'store' },
    });
    gpass.setPipeline(this.grassSubmergedPipeline);
    gpass.setBindGroup(0, this.grassSubmergedBind);
    gpass.setVertexBuffer(0, this.grassBuf!);
    gpass.draw(GRASS_VERTEX_COUNT, this.grassSeaweedCount, 0, 0);
    gpass.end();
    ctx.colorCleared = true;
  }

  /**
   * Pass 2 — entities + solid-colour shapes (colour preserved if terrain/shadows
   * drew; depth RESET so the entity index-depth scheme is self-contained and
   * always wins over terrain). Shapes share the pass + depth so they interleave
   * with sprites by list-order depth.
   */
  private passEntities(
    ctx: PassCtx, entitiesOn: boolean,
    dynBatches: readonly InstanceBatch[], dynLifted: readonly DrawItem[], xform?: ViewTransform,
  ): void {
    const epass = ctx.enc.beginRenderPass({
      colorAttachments: [{ view: ctx.colorView, clearValue: ctx.ocean, loadOp: ctx.colorCleared ? 'load' : 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: ctx.depthView, depthClearValue: 0.0, depthLoadOp: 'clear', depthStoreOp: 'store' },
    });
    epass.setPipeline(this.pipeline);
    epass.setVertexBuffer(0, this.quadBuf);
    epass.setBindGroup(0, this.globalsBind);
    if (entitiesOn) {
      // Per-frame batch/bind diagnostics (one bind-group switch per drawn bucket).
      gpuTexStats.entityBatches = this.staticBundle.length
        + dynBatches.filter((b) => b.instances.length > 0).length;
      gpuTexStats.entityBindGroups = gpuTexStats.entityBatches;
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
    // Shape pass (poly/circle fills). The static layer is triangulated once into a
    // persistent buffer (ensureStaticShapeBundle); only the small dynamic set is
    // rebuilt this frame. Both are WORLD px — the camera xform rides in the shape
    // globals (uXform), so neither re-triangulates on pan/zoom. The usual dynamic
    // layer is all image items (NPCs), so skip the triangulation (and its per-frame
    // empty-array alloc) entirely unless a poly/circle is actually present.
    const dynShapes = entitiesOn && dynLifted.some((it) => it.t !== 'image')
      ? buildShapeVertices(dynLifted) : NO_SHAPES;
    const staticShapeCount = entitiesOn ? this.staticShapeCount : 0;
    if (staticShapeCount > 0 || dynShapes.vertexCount > 0) {
      const xf = xform ?? { sx: 1, sy: 1, ox: 0, oy: 0 };
      this.device.queue.writeBuffer(this.shapeGlobalsBuf, 0,
        new Float32Array([ctx.w, ctx.h, 0, 0, xf.sx, xf.sy, xf.ox, xf.oy]));
      epass.setPipeline(this.shapePipeline);
      epass.setBindGroup(0, this.shapeGlobalsBind);
      if (staticShapeCount > 0 && this.staticShapeBuf) {
        epass.setVertexBuffer(0, this.staticShapeBuf);
        epass.draw(staticShapeCount);
      }
      if (dynShapes.vertexCount > 0) {
        const sBuf = this.dynBuf('shape', dynShapes.vertices.byteLength);
        this.device.queue.writeBuffer(sBuf, 0, dynShapes.vertices as GPUAllowSharedBufferSource);
        epass.setVertexBuffer(0, sBuf);
        epass.draw(dynShapes.vertexCount);
      }
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
