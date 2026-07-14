// src/render/gpu/wgsl/lit-wgsl.ts
//
// R2c — WGSL for the raw-WebGPU instanced lit-sprite pipeline.
//
// The spike (`public/webgpu-spike.html`) proved RAW WebGPU instancing on this
// hardware (stepMode:'instance', one draw call), so the scene is hand-rolled
// WebGPU — not Pixi's custom-shader path. This shader is therefore structured
// for raw vertex-buffer instancing + explicit bind groups, NOT Pixi's uniform
// groups.
//
// Geometry: a unit quad (stepMode 'vertex') instanced once per sprite. Per-
// instance attributes (stepMode 'instance') give the destination rect, the UV
// sub-rect, and a painter-order depth (see instance-buffer.ts for the byte
// layout these @location indices must match).
//
// The lighting math mirrors `banded-pbr.ts` (the executable reference) exactly:
// hard alpha-cutout, flat-normal fallback on mask ≤ 0.5, AO = mat.G (full
// strength), diffuse banded by floor(ndl·bands + 0.5)/bands, plus a banded
// Blinn-Phong specular glint gated by gloss (1 − mat.B roughness) and tinted by
// mat.A metallic — so finished/smooth faces glint and matte faces don't. Output
// premultiplied. On top of that, a night-only EMISSIVE term (`uEmissiveMap.rgb ·
// uNight`) fades in self-illumination (lit window panes) — absent from the TS
// reference, which models daytime only; at uNight = 0 the two are identical.

export const LIT_WGSL = /* wgsl */ `
struct Globals {
  uViewport : vec2<f32>,   // target size in px (matches the draw list's dx/dy space)
  uBands    : f32,
  _pad0     : f32,
  uAmbient  : vec3<f32>,
  _pad1     : f32,
  uSunDir   : vec3<f32>,   // toward the light, screen space, normalized
  _pad2     : f32,
  uSunColor : vec3<f32>,
  uNight    : f32,         // 0 = day (no emissive), 1 = night (full window glow)
  uXform    : vec4<f32>,   // world→device affine: sx, sy, ox, oy (applied in VS)
};

@group(0) @binding(0) var<uniform> G : Globals;

@group(1) @binding(0) var uSampler     : sampler;
@group(1) @binding(1) var uAlbedo      : texture_2d<f32>;
@group(1) @binding(2) var uNormalMap   : texture_2d<f32>;
@group(1) @binding(3) var uMaterialMap : texture_2d<f32>;
@group(1) @binding(4) var uEmissiveMap : texture_2d<f32>;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) vUV : vec2<f32>,
  @location(1) vMisc : vec2<f32>,    // x: snow whiten 0..1, y: mirror flag 0/1
};

@vertex
fn vsMain(
  @location(0) corner : vec2<f32>,   // unit quad 0..1
  @location(1) iRect  : vec4<f32>,   // dx, dy, dw, dh  (WORLD px)
  @location(2) iUV    : vec4<f32>,   // u0, v0, u1, v1
  @location(3) iDepth : f32,         // painter-order depth, 0..1
  @location(4) iMisc  : vec2<f32>,   // whiten, mirror (per-instance; see instance-buffer.ts)
) -> VSOut {
  // Instances are packed in WORLD px (camera-independent, so the static layer can
  // be packed once); the camera world→device affine is applied here in the VS.
  let world = iRect.xy + corner * iRect.zw;
  let px = world * G.uXform.xy + G.uXform.zw;
  // screen px (y down, origin top-left) → clip NDC (y up)
  let ndc = vec2<f32>(
    px.x / (G.uViewport.x * 0.5) - 1.0,
    1.0 - px.y / (G.uViewport.y * 0.5),
  );
  var out : VSOut;
  out.pos = vec4<f32>(ndc, iDepth, 1.0);
  out.vUV = mix(iUV.xy, iUV.zw, corner);
  out.vMisc = iMisc;
  return out;
}

@fragment
fn fsMain(@location(0) vUV : vec2<f32>, @location(1) vMisc : vec2<f32>) -> @location(0) vec4<f32> {
  let albedo = textureSample(uAlbedo, uSampler, vUV);
  if (albedo.a < 0.5) { discard; }   // hard pixel-art cutout, not soft AA

  let nrm = textureSample(uNormalMap, uSampler, vUV);
  var n = vec3<f32>(0.0, 0.0, 1.0);
  if (nrm.a > 0.5) {
    n = normalize(nrm.rgb * 2.0 - 1.0);
  }
  // Mirrored instance (iMisc.y): the UV rect is u-flipped, so the sampled normal's
  // screen-x component points the wrong way — negate it so lighting matches the flip.
  if (vMisc.y > 0.5) {
    n = vec3<f32>(-n.x, n.y, n.z);
  }

  // Snow whiten (iMisc.x, alpine fidelity): settle snow on UP-FACING texels — the
  // crown-radial foliage normals make n.y meaningful — by mixing the albedo toward
  // the terrain snow tone BEFORE the banded diffuse, so entity snow participates in
  // the same band quantization as everything else (keeps the pixel-art look). The
  // constant matches the terrain snow exemplar's mean tone (material-exemplar.ts
  // buildSnow: v = 0.95, rgb = 0.99v / v / 1.02v) so tree snow and ground snow read
  // as one material. At whiten 0 the mix is exact identity (byte-identical output).
  var alb = albedo.rgb;
  if (vMisc.x > 0.0) {
    let topFacing = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
    alb = mix(alb, vec3<f32>(0.94, 0.95, 0.97), vMisc.x * topFacing);
  }

  let mat = textureSample(uMaterialMap, uSampler, vUV);
  let ao    = mat.g;   // baked ambient occlusion (1 = open)
  let rough = mat.b;
  let metal = mat.a;

  // Diffuse — banded Lambert.
  let ndl = max(dot(n, G.uSunDir), 0.0);
  let banded = floor(ndl * G.uBands + 0.5) / G.uBands;
  let diffuse = (G.uAmbient + G.uSunColor * banded) * ao;

  // Specular — banded Blinn-Phong glint, gated to zero on matte surfaces (gloss = 1 − rough).
  let gloss = 1.0 - rough;
  let half = normalize(G.uSunDir + vec3<f32>(0.0, 0.0, 1.0));   // viewDir = +z (toward camera)
  let ndh = max(dot(n, half), 0.0);
  let specPower = pow(2.0, 2.0 + 9.0 * gloss);
  let specRaw = pow(ndh, specPower) * gloss * ao;
  let specBand = floor(specRaw * G.uBands + 0.5) / G.uBands;
  let specTint = mix(vec3<f32>(1.0, 1.0, 1.0), alb, metal);  // metals tint the highlight
  let specular = G.uSunColor * specBand * specTint;

  // Self-illumination (lit window panes): added on top of the lit albedo and
  // faded in by the night factor, so panes are dark glass by day and glow at night.
  // Premultiplied: scale by alpha to stay consistent with the cutout output.
  let emissive = textureSample(uEmissiveMap, uSampler, vUV).rgb * G.uNight;
  return vec4<f32>(alb * diffuse + (specular + emissive) * albedo.a, albedo.a);
}
`;
