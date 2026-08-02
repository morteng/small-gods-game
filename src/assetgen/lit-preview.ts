// src/assetgen/lit-preview.ts
// Shade a composed structure OFFLINE with the game's own lighting model.
//
// `composeStructure` returns four co-registered channels — albedo (`grey`), `normal`, `material`
// (R=depth G=AO B=rough A=metal) and `emissive` — and the runtime shades them on the GPU. Every
// dev preview, though, wrote `grey` straight to a PNG and threw the other three away, so geometry
// was judged as FLAT UNLIT MASSING: no sun, no AO, no form. That is not a neutral simplification.
// A crenel gap reads as a hole only because the wall-walk behind it is darker; with one flat tone
// it vanishes, and a real battlement is indistinguishable from a solid parapet. It cost this
// project two false "the merlons are missing" bug reports in one session.
//
// Nothing here invents a light. `bandedPbrPixel` IS the shipped model (the WGSL mirrors it
// line-for-line) and `DEFAULT_LIGHTING` IS the shipped sun, so a lit preview shows what the
// renderer will show. This stays honest about the SKIN — albedo is still grey massing until a
// funded reseed — but the FORM is now lit exactly as the game lights it.
import type { StructureResult } from '@/assetgen/compose';
import { bandedPbrPixel, type Vec4 } from '@/render/gpu/banded-pbr';
import { DEFAULT_LIGHTING, type LightingState } from '@/render/lighting-state';

/** Read pixel `i` of an RGBA byte buffer as 0..1. */
function px(buf: Uint8ClampedArray, i: number): Vec4 {
  return [buf[i] / 255, buf[i + 1] / 255, buf[i + 2] / 255, buf[i + 3] / 255];
}

/**
 * Shade a composed result into an RGBA byte buffer using the runtime's banded-PBR model.
 * Fully transparent pixels stay transparent; emissive is added unshaded, as the scene does.
 */
export function litRgba(r: StructureResult, lighting: LightingState = DEFAULT_LIGHTING): Uint8ClampedArray {
  const n = r.size * r.size;
  const out = new Uint8ClampedArray(n * 4);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (r.grey[i + 3] === 0) continue;                     // empty pixel — leave it clear
    const lit = bandedPbrPixel(
      { albedo: px(r.grey, i), normal: px(r.normal, i), material: px(r.material, i) },
      lighting,
    );
    out[i] = (lit[0] + r.emissive[i] / 255) * 255;
    out[i + 1] = (lit[1] + r.emissive[i + 1] / 255) * 255;
    out[i + 2] = (lit[2] + r.emissive[i + 2] / 255) * 255;
    out[i + 3] = lit[3] * 255;
  }
  return out;
}
