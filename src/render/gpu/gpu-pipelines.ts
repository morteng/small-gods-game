/// <reference types="@webgpu/types" />
// src/render/gpu/gpu-pipelines.ts
//
// The render-pipeline factories for `GpuScene`. Each `createXPipeline(device,
// format)` builds ONE `GPURenderPipeline` from its WGSL module + a self-contained
// descriptor — pure functions of (device, format) that touch no scene `this`
// state. Lifted out of the `GpuScene` constructor so the per-pass pipeline
// descriptors live together (and a NEW pass is a new factory, not another 30
// lines grown onto a god-constructor). The constructor still owns the buffers,
// bind groups, and textures (those need its instance state).
//
// Descriptors are relocated VERBATIM — same blend/depth/stencil/vertex layout as
// before, byte-for-byte; this module changes structure, never behaviour.

import { INSTANCE_STRIDE } from '@/render/gpu/instance-buffer';
import { LIT_WGSL } from '@/render/gpu/wgsl/lit-wgsl';
import { TERRAIN_WGSL } from '@/render/gpu/wgsl/terrain-wgsl';
import { DETAIL_PATCH_WGSL } from '@/render/gpu/wgsl/detail-patch-wgsl';
import { WATER_WGSL } from '@/render/gpu/wgsl/water-wgsl';
import { OCEAN_BACKDROP_WGSL } from '@/render/gpu/wgsl/ocean-backdrop-wgsl';
import { SHADOW_WGSL } from '@/render/gpu/wgsl/shadow-wgsl';
import { SHAPE_WGSL } from '@/render/gpu/wgsl/shape-wgsl';
import { BLIT_WGSL } from '@/render/gpu/wgsl/blit-wgsl';
import { STRUCTURE_MESH_WGSL } from '@/render/gpu/wgsl/structure-mesh-wgsl';
import { GRASS_WGSL } from '@/render/gpu/wgsl/grass-wgsl';
import { GRASS_INSTANCE_STRIDE } from '@/render/gpu/grass-scatter';
import { SHADOW_INSTANCE_STRIDE } from '@/render/gpu/shadow-instance';
import { SHAPE_VERTEX_STRIDE } from '@/render/gpu/shape-geometry';

export const DEPTH_FORMAT: GPUTextureFormat = 'depth24plus';

/** Premultiplied-alpha src-over blend (one / one-minus-src-alpha) — shared by the
 *  sprite, water, ribbon, shadow, and shape passes. */
const PREMULT_BLEND: GPUBlendState = {
  color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
};

/** Entity (lit-sprite) pipeline: instanced quads, premult src-over, owns the
 *  painter-order depth (greater = in front, write). */
export function createSpritePipeline(device: GPUDevice, format: GPUTextureFormat): GPURenderPipeline {
  const module = device.createShaderModule({ code: LIT_WGSL });
  return device.createRenderPipeline({
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
            { shaderLocation: 4, offset: 36, format: 'float32x4' }, // iMisc (whiten, mirror, contact, band)
            { shaderLocation: 5, offset: 52, format: 'float32x3' }, // iGround (contact target rgb)
          ],
        },
      ],
    },
    fragment: { module, entryPoint: 'fsMain', targets: [{ format, blend: PREMULT_BLEND }] },
    primitive: { topology: 'triangle-strip' },
    // larger depth = in front (matches painter-order depth encoding); clear to 0.
    depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'greater' },
  });
}

/** Terrain pipeline (T1): NO vertex buffers — the grid is generated in the vertex
 *  shader from @builtin(vertex_index) + the height/colour storage buffers. Terrain
 *  owns its OWN depth pass (spatial iso depth, greater, write), so it self-occludes;
 *  entities then draw over it in pass 2. Returns the module too — the detail-patch
 *  pass reuses the terrain FRAGMENT (same shading over a denser mesh). */
export function createTerrainPipeline(
  device: GPUDevice, format: GPUTextureFormat,
): { pipeline: GPURenderPipeline; module: GPUShaderModule } {
  const module = device.createShaderModule({ code: TERRAIN_WGSL });
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vsMain' },
    fragment: {
      module,
      entryPoint: 'fsMain',
      // No blend: terrain is OPAQUE (alpha 1) and draws first on a cleared target,
      // so src-over would just read dst for nothing — a wasted RMW per pixel on a
      // fill-bound iGPU. Plain overwrite.
      targets: [{ format }],
    },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'greater' },
  });
  return { pipeline, module };
}

/** Detail-patch pipeline (Slice B): a NEW vertex stage (instanced finer mesh over
 *  baked sub-tile heights) paired with the terrain FRAGMENT (`terrainModule`, same
 *  VSOut + colour/material/coarse-height bindings) — so patches shade and texture
 *  identically over a denser mesh, no fragment duplication. One per-instance vertex
 *  buffer carries the patch tile origin. Shares the terrain depth (greater-equal +
 *  write): a patch sits at the same iso depth as the coarse tile it covers and,
 *  drawn after terrain, wins; the next tile in front still occludes it. Opaque. */
export function createDetailPatchPipeline(
  device: GPUDevice, format: GPUTextureFormat, terrainModule: GPUShaderModule,
): GPURenderPipeline {
  const detailModule = device.createShaderModule({ code: DETAIL_PATCH_WGSL });
  return device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: detailModule,
      entryPoint: 'vsMain',
      buffers: [{
        arrayStride: 8, stepMode: 'instance',
        attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
      }],
    },
    fragment: { module: terrainModule, entryPoint: 'fsMain', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'greater-equal' },
  });
}

/** Structure-mesh pipeline (3D-structure epic, S1): a depth-tested 3D pass for ground-anchored
 *  structural geometry (bridges), sharing the TERRAIN globals + depth buffer so structures
 *  interleave with the heightfield. Interleaved verts (pos + terrain-frame normal + albedo);
 *  opaque, depth greater + write, same iso depth space as terrain (founding + mutual
 *  occlusion). Drawn after water, before the entity depth-clear. */
export function createStructureMeshPipeline(device: GPUDevice, format: GPUTextureFormat): GPURenderPipeline {
  const module = device.createShaderModule({ code: STRUCTURE_MESH_WGSL });
  return device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module,
      entryPoint: 'vsMain',
      buffers: [{
        arrayStride: 36, stepMode: 'vertex', attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },  // world pos (tile x,y; cube z)
          { shaderLocation: 1, offset: 12, format: 'float32x3' }, // terrain-frame normal
          { shaderLocation: 2, offset: 24, format: 'float32x3' }, // albedo rgb
        ],
      }],
    },
    fragment: { module, entryPoint: 'fsMain', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'greater' },
  });
}

/** Standing-grass pipeline (vegetation-billboard epic, S1): instanced upright ground-cover
 *  billboards. NO per-vertex buffer — the ribbon is generated from @builtin(vertex_index);
 *  one instance buffer carries foot/size/UV/seed. Shares the TERRAIN depth (greater-equal +
 *  WRITE): each blade takes its foot's iso depth, so terrain in front occludes it and closer
 *  blades (larger foot depth) win over farther ones regardless of draw order. Opaque +
 *  alpha-tested (crisp pixel edges; transparent texels discard, never writing depth).
 *  Inserted after structures, before the entity depth-clear. */
export function createGrassPipeline(device: GPUDevice, format: GPUTextureFormat): GPURenderPipeline {
  const module = device.createShaderModule({ code: GRASS_WGSL });
  return device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module,
      entryPoint: 'vsMain',
      buffers: [{
        arrayStride: GRASS_INSTANCE_STRIDE, stepMode: 'instance', attributes: [
          { shaderLocation: 1, offset: 0, format: 'float32x4' },  // iA: footX, footY, depth, size
          { shaderLocation: 2, offset: 16, format: 'float32x4' }, // iUV: u0, v0, u1, v1
          { shaderLocation: 3, offset: 32, format: 'float32x4' }, // iP: width, seed, category, bendK
        ],
      }],
    },
    fragment: { module, entryPoint: 'fsMain', targets: [{ format }] },
    primitive: { topology: 'triangle-strip' },
    depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'greater-equal' },
  });
}

/** Water pipeline (S2): GPU-generated per-cell quads (no vertex buffers), lifted to
 *  the water surface + blended over the terrain. Shares the terrain depth buffer
 *  (greater-equal, NO depth write) so nearer terrain occludes water but water never
 *  writes into the entity depth scheme. Premultiplied alpha out, like the sprites. */
export function createWaterPipeline(device: GPUDevice, format: GPUTextureFormat): GPURenderPipeline {
  const module = device.createShaderModule({ code: WATER_WGSL });
  return device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vsMain' },
    fragment: { module, entryPoint: 'fsMain', targets: [{ format, blend: PREMULT_BLEND }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'greater-equal' },
  });
}

/** Infinite-ocean backdrop pipeline: a fullscreen triangle, OPAQUE, no depth (drawn
 *  first; terrain loads over it and covers the whole map rect, so the backdrop
 *  survives only OUTSIDE the island = open sea to the horizon). Reuses the 112-byte
 *  water globals uniform for the inverse projection + time (bind group in caller). */
export function createOceanBackdropPipeline(device: GPUDevice, format: GPUTextureFormat): GPURenderPipeline {
  const module = device.createShaderModule({ code: OCEAN_BACKDROP_WGSL });
  return device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vsMain' },
    fragment: { module, entryPoint: 'fsMain', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
}

/** Shadow union pipeline: parallelogram quads (4 corners) → premult black at
 *  SHADOW_ALPHA straight onto the scene colour target, stencil-gated so each pixel
 *  darkens at most once. Stencil-only attachment (`stencil8`): test `equal 0` (ref 0)
 *  → first fragment passes; passOp `increment-clamp` bumps it to 1 so any later
 *  overlapping shadow fails the test and is skipped. */
export function createShadowPipeline(device: GPUDevice, format: GPUTextureFormat): GPURenderPipeline {
  const module = device.createShaderModule({ code: SHADOW_WGSL });
  const shadowStencil: GPUStencilFaceState = {
    compare: 'equal', failOp: 'keep', depthFailOp: 'keep', passOp: 'increment-clamp',
  };
  return device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module,
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
    fragment: { module, entryPoint: 'fsMain', targets: [{ format, blend: PREMULT_BLEND }] },
    primitive: { topology: 'triangle-strip' },
    // stencil8 carries no depth aspect → depthCompare must be 'always' + no write.
    depthStencil: {
      format: 'stencil8', depthWriteEnabled: false, depthCompare: 'always',
      stencilFront: shadowStencil, stencilBack: shadowStencil,
      stencilReadMask: 0xff, stencilWriteMask: 0xff,
    },
  });
}

/** Solid-colour shape pipeline: per-vertex (pos+depth, colour) triangles. SAME
 *  colour target + blend + depth scheme as the entity pipeline so it can run in the
 *  entity pass and depth-interleave with sprites. */
export function createShapePipeline(device: GPUDevice, format: GPUTextureFormat): GPURenderPipeline {
  const module = device.createShaderModule({ code: SHAPE_WGSL });
  return device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module,
      entryPoint: 'vsMain',
      buffers: [{
        arrayStride: SHAPE_VERTEX_STRIDE, stepMode: 'vertex', attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },  // x, y, depth
          { shaderLocation: 1, offset: 12, format: 'float32x4' }, // rgba
        ],
      }],
    },
    fragment: { module, entryPoint: 'fsMain', targets: [{ format, blend: PREMULT_BLEND }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'greater' },
  });
}

/** Blit pipeline (P-E): a single fullscreen triangle, no vertex buffers, no depth,
 *  no blend (the source is already composited) — nearest-samples the low-res scene
 *  target onto the swapchain. */
export function createBlitPipeline(device: GPUDevice, format: GPUTextureFormat): GPURenderPipeline {
  const module = device.createShaderModule({ code: BLIT_WGSL });
  return device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vsMain' },
    fragment: { module, entryPoint: 'fsMain', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
}
