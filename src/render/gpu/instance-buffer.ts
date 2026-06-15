// src/render/gpu/instance-buffer.ts
//
// R2c — pack InstanceBatch instances into the typed arrays the raw-WebGPU
// pipeline uploads. The per-instance float layout here MUST match the
// @location attribute slots in `wgsl/lit-wgsl.ts`:
//
//   loc 1  iRect  vec4  dx, dy, dw, dh        (offset 0,  16 bytes)
//   loc 2  iUV    vec4  u0, v0, u1, v1        (offset 16, 16 bytes)
//   loc 3  iDepth f32   depth                 (offset 32,  4 bytes)
//                                              stride = 36 bytes (9 floats)
//
// The unit quad (loc 0) is a static 4-vertex triangle-strip.

import type { InstanceAttrs } from '@/render/gpu/instance-batch';

/** Unit-quad corners as a triangle-strip: (0,0)(1,0)(0,1)(1,1). */
export const QUAD_STRIP = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
export const QUAD_VERTEX_COUNT = 4;

/** Floats per instance (iRect 4 + iUV 4 + iDepth 1). */
export const INSTANCE_FLOATS = 9;
/** Instance vertex-buffer stride in bytes. */
export const INSTANCE_STRIDE = INSTANCE_FLOATS * 4;

/** Pack instances into one interleaved Float32Array (per the layout above). */
export function packInstances(instances: readonly InstanceAttrs[]): Float32Array {
  const buf = new Float32Array(instances.length * INSTANCE_FLOATS);
  for (let i = 0; i < instances.length; i++) {
    const it = instances[i];
    const o = i * INSTANCE_FLOATS;
    buf[o] = it.dx;
    buf[o + 1] = it.dy;
    buf[o + 2] = it.dw;
    buf[o + 3] = it.dh;
    buf[o + 4] = it.u0;
    buf[o + 5] = it.v0;
    buf[o + 6] = it.u1;
    buf[o + 7] = it.v1;
    buf[o + 8] = it.depth;
  }
  return buf;
}

/** Globals uniform buffer (std140-ish; matches the `Globals` struct in lit-wgsl). */
export const GLOBALS_FLOATS = 16; // 4 vec4 slots: [vp.xy,bands,_], [amb,_], [sun,_], [col,_]

export interface GlobalsInput {
  viewport: [number, number];
  bands: number;
  ambient: [number, number, number];
  sunDir: [number, number, number];
  sunColor: [number, number, number];
}

/** Pack the per-frame Globals uniform (vec3s padded to 16-byte boundaries). */
export function packGlobals(g: GlobalsInput): Float32Array {
  const b = new Float32Array(GLOBALS_FLOATS);
  b[0] = g.viewport[0]; b[1] = g.viewport[1]; b[2] = Math.max(1, g.bands); b[3] = 0;
  b[4] = g.ambient[0]; b[5] = g.ambient[1]; b[6] = g.ambient[2]; b[7] = 0;
  b[8] = g.sunDir[0]; b[9] = g.sunDir[1]; b[10] = g.sunDir[2]; b[11] = 0;
  b[12] = g.sunColor[0]; b[13] = g.sunColor[1]; b[14] = g.sunColor[2]; b[15] = 0;
  return b;
}

/** Terrain pass uniform (T1) — matches `TGlobals` in terrain-wgsl (24 floats /
 *  96 bytes): viewport+pad, xform, grid+half, zParams, sun, ambient. */
export const TERRAIN_GLOBALS_FLOATS = 24;

export interface TerrainGlobalsInput {
  viewport: [number, number];
  xform: { sx: number; sy: number; ox: number; oy: number };
  grid: [number, number];          // cells: width, height
  half: [number, number];          // iso half-tile px: halfW, halfH
  zPxPerM: number; seaLevel: number; reliefM: number; subsample: number;
  sunDir: [number, number, number]; bands: number;
  ambient: [number, number, number]; sunStrength: number;
}

/** Pack the terrain Globals uniform (std140-ish; vec2 pairs share 16-byte slots). */
export function packTerrainGlobals(g: TerrainGlobalsInput): Float32Array {
  const b = new Float32Array(TERRAIN_GLOBALS_FLOATS);
  b[0] = g.viewport[0]; b[1] = g.viewport[1]; b[2] = 0; b[3] = 0;            // uViewport, uPad0
  b[4] = g.xform.sx; b[5] = g.xform.sy; b[6] = g.xform.ox; b[7] = g.xform.oy; // uXform
  b[8] = g.grid[0]; b[9] = g.grid[1]; b[10] = g.half[0]; b[11] = g.half[1];   // uGrid, uHalf
  b[12] = g.zPxPerM; b[13] = g.seaLevel; b[14] = g.reliefM; b[15] = Math.max(1, g.subsample); // uZParams
  b[16] = g.sunDir[0]; b[17] = g.sunDir[1]; b[18] = g.sunDir[2]; b[19] = Math.max(1, g.bands); // uSun
  b[20] = g.ambient[0]; b[21] = g.ambient[1]; b[22] = g.ambient[2]; b[23] = g.sunStrength;     // uAmbient
  return b;
}
