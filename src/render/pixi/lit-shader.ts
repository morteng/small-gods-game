/**
 * Lit-sprite GL shader (PBR Slice 3) — ambient + one directional sun, with the
 * diffuse term quantized into bands so the pixel-art look survives.
 *
 * Rendered as a unit-quad MESH (not a Filter: filter input frames clip at the
 * viewport edge, which would shear the companion-map UV mapping; a mesh's UVs
 * are honest 0..1 over the sprite). The vertex shader follows pixi v8 mesh
 * conventions: `uProjectionMatrix`/`uWorldTransformMatrix` arrive from the
 * global uniform group (group 100) and `uTransformMatrix` from the mesh pipe's
 * local group (group 101) — both are bound by MeshPipe for custom shaders.
 *
 * Inputs (all same dimensions, co-registered by construction — see
 * `registerAlbedo` / `structureResultToPack`):
 *  - uAlbedo      RGBA, premultiplied on upload
 *  - uNormalMap   screen-space normal, (v·0.5+0.5)·255; alpha 0 outside geometry
 *  - uMaterialMap R=depth G=AO B=rough A≈metal; alpha 0 outside geometry
 *
 * Where the normal map's alpha is 0 (negotiation-band pixels the LLM painted
 * beyond the geometry silhouette) the pixel takes a flat toward-camera normal
 * and AO 1 — neutral lighting instead of garbage decode.
 */
import type { LightingState } from '@/render/lighting-state';

export const LIT_VERTEX = /* glsl */ `
  in vec2 aPosition;
  in vec2 aUV;

  out vec2 vUV;

  uniform mat3 uProjectionMatrix;
  uniform mat3 uWorldTransformMatrix;
  uniform mat3 uTransformMatrix;

  void main() {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vUV = aUV;
  }
`;

export const LIT_FRAGMENT = /* glsl */ `
  in vec2 vUV;

  uniform sampler2D uAlbedo;
  uniform sampler2D uNormalMap;
  uniform sampler2D uMaterialMap;

  uniform vec3 uAmbient;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uBands;

  void main() {
    vec4 albedo = texture(uAlbedo, vUV);

    vec4 nrm = texture(uNormalMap, vUV);
    vec3 n = nrm.a > 0.5 ? normalize(nrm.rgb * 2.0 - 1.0) : vec3(0.0, 0.0, 1.0);

    vec4 mat = texture(uMaterialMap, vUV);
    float ao = mix(1.0, mat.g, mat.a);

    float ndl = max(dot(n, uSunDir), 0.0);
    // Quantize the diffuse term into uBands steps — banded, not painterly.
    float banded = floor(ndl * uBands + 0.5) / uBands;

    vec3 light = (uAmbient + uSunColor * banded) * ao;
    // Albedo is premultiplied; scaling rgb by the light keeps it premultiplied.
    gl_FragColor = vec4(albedo.rgb * light, albedo.a);
  }
`;

export interface LitUniformValues {
  uAmbient: [number, number, number];
  uSunDir: [number, number, number];
  uSunColor: [number, number, number];
  uBands: number;
}

/** Shader uniform values for a lighting state (bands clamped to ≥1). */
export function litUniformValues(l: LightingState): LitUniformValues {
  return {
    uAmbient: [...l.ambient],
    uSunDir: [...l.sunDir],
    uSunColor: [...l.sunColor],
    uBands: Math.max(1, l.bands),
  };
}

/** The uniform-group resource descriptor `Shader.from` expects. */
export function litUniformGroup(l: LightingState): Record<string, { value: unknown; type: string }> {
  const v = litUniformValues(l);
  return {
    uAmbient: { value: v.uAmbient, type: 'vec3<f32>' },
    uSunDir: { value: v.uSunDir, type: 'vec3<f32>' },
    uSunColor: { value: v.uSunColor, type: 'vec3<f32>' },
    uBands: { value: v.uBands, type: 'f32' },
  };
}
