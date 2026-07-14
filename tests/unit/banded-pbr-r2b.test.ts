import { describe, it, expect } from 'vitest';
import { bandedPbrPixel, type PbrSample, type PbrLight } from '@/render/gpu/banded-pbr';
import { LIT_WGSL } from '@/render/gpu/wgsl/lit-wgsl';

// Encode a screen-space normal (v) into the map's RGBA (v·0.5+0.5, mask alpha).
function encodeNormal(v: [number, number, number], mask = 1): PbrSample['normal'] {
  return [v[0] * 0.5 + 0.5, v[1] * 0.5 + 0.5, v[2] * 0.5 + 0.5, mask];
}

const FLAT = encodeNormal([0, 0, 1]); // toward camera
// material = R=depth G=AO B=rough A=metal. MATTE = open AO, fully rough → no specular,
// so these fixtures exercise the diffuse term in isolation.
const MATTE: PbrSample['material'] = [0, 1, 1, 0];

const sun: PbrLight = { ambient: [0.2, 0.2, 0.2], sunDir: [0, 0, 1], sunColor: [0.8, 0.8, 0.8], bands: 4 };

function close(a: number, b: number, eps = 1e-6) {
  expect(Math.abs(a - b)).toBeLessThan(eps);
}

describe('R2b — banded-PBR reference math (diffuse)', () => {
  it('full sun on a matte camera-facing pixel = ambient + full sun, ao 1', () => {
    const out = bandedPbrPixel({ albedo: [0.6, 0.6, 0.6, 1], normal: FLAT, material: MATTE }, sun);
    // ndl=1 → banded=1 → light=(0.2+0.8)=1.0 → albedo unchanged; matte ⇒ no spec
    close(out[0], 0.6);
    close(out[1], 0.6);
    close(out[2], 0.6);
    close(out[3], 1);
  });

  it('quantizes the diffuse term into bands (0.6·ndl)', () => {
    // a normal whose dot with (0,0,1) is exactly 0.6
    const tilt = encodeNormal([0, Math.sqrt(1 - 0.6 * 0.6), 0.6]);
    const at4 = bandedPbrPixel({ albedo: [1, 1, 1, 1], normal: tilt, material: MATTE }, sun);
    // bands=4: floor(0.6*4+0.5)/4 = floor(2.9)/4 = 0.5 → light=0.2+0.8*0.5=0.6
    close(at4[0], 0.6);
    const at1 = bandedPbrPixel({ albedo: [1, 1, 1, 1], normal: tilt, material: MATTE }, { ...sun, bands: 1 });
    // bands=1: floor(0.6+0.5)=1 → light=0.2+0.8=1.0
    close(at1[0], 1.0);
  });

  it('bands clamp to ≥1 (bands=0 behaves as 1)', () => {
    const a = bandedPbrPixel({ albedo: [1, 1, 1, 1], normal: FLAT, material: MATTE }, { ...sun, bands: 0 });
    const b = bandedPbrPixel({ albedo: [1, 1, 1, 1], normal: FLAT, material: MATTE }, { ...sun, bands: 1 });
    close(a[0], b[0]);
  });

  it('AO is read straight from mat.G at full strength (not gated by metallic)', () => {
    // ao=0.5, matte, metal=0 → diffuse halved, no spec. (The old model gated AO by mat.A
    // metallic, which is ≈0 for every non-metal and silently discarded the baked AO.)
    const out = bandedPbrPixel(
      { albedo: [1, 1, 1, 1], normal: FLAT, material: [0, 0.5, 1, 0] },
      sun,
    );
    close(out[0], 0.5); // light 1.0 × ao 0.5
  });

  it('mask alpha ≤ 0.5 falls back to a flat camera-facing normal (ignores rgb)', () => {
    const garbage = bandedPbrPixel(
      { albedo: [1, 1, 1, 1], normal: [0.9, 0.1, 0.1, 0], material: MATTE }, // a=0
      sun,
    );
    const flat = bandedPbrPixel({ albedo: [1, 1, 1, 1], normal: FLAT, material: MATTE }, sun);
    close(garbage[0], flat[0]);
  });

  it('keeps the output premultiplied: alpha passes through, rgb scaled by light only', () => {
    const out = bandedPbrPixel(
      { albedo: [0.3, 0.3, 0.3, 0.5], normal: FLAT, material: MATTE },
      { ...sun, sunColor: [0, 0, 0] }, // ambient-only 0.2, no sun ⇒ no spec
    );
    close(out[0], 0.3 * 0.2);
    close(out[3], 0.5); // alpha untouched
  });
});

describe('K0e — roughness/metallic specular', () => {
  // Light + view both along +z, normal flat ⇒ half-vector aligns with the normal, so a
  // smooth surface gets a maximal, on-axis highlight; a matte one gets none.
  const onAxis: PbrLight = { ambient: [0, 0, 0], sunDir: [0, 0, 1], sunColor: [1, 1, 1], bands: 4 };

  it('matte (rough=1) contributes exactly zero specular — diffuse path unchanged', () => {
    const matte = bandedPbrPixel({ albedo: [0.5, 0.5, 0.5, 1], normal: FLAT, material: [0, 1, 1, 0] }, onAxis);
    // ambient 0, banded sun = albedo·1·ao, no spec ⇒ exactly the albedo back.
    close(matte[0], 0.5);
  });

  it('a smooth dielectric (rough=0) adds a white highlight on top of diffuse', () => {
    const glossy = bandedPbrPixel({ albedo: [0.5, 0.5, 0.5, 1], normal: FLAT, material: [0, 1, 0, 0] }, onAxis);
    const matte = bandedPbrPixel({ albedo: [0.5, 0.5, 0.5, 1], normal: FLAT, material: [0, 1, 1, 0] }, onAxis);
    expect(glossy[0]).toBeGreaterThan(matte[0]); // glint brightens the pixel
    // dielectric highlight is uncoloured: equal across channels for grey albedo
    close(glossy[0], glossy[1]);
    close(glossy[1], glossy[2]);
  });

  it('roughness scales the highlight: smoother ⇒ brighter on-axis glint', () => {
    const smooth = bandedPbrPixel({ albedo: [0.4, 0.4, 0.4, 1], normal: FLAT, material: [0, 1, 0.1, 0] }, onAxis);
    const rougher = bandedPbrPixel({ albedo: [0.4, 0.4, 0.4, 1], normal: FLAT, material: [0, 1, 0.6, 0] }, onAxis);
    expect(smooth[0]).toBeGreaterThanOrEqual(rougher[0]);
  });

  it('metallic tints the highlight toward the albedo (warm gold stays warm)', () => {
    // gilt-like: gold albedo, smooth, fully metal. Highlight should carry the gold bias
    // (more red than blue), unlike a white dielectric glint.
    const gold = bandedPbrPixel({ albedo: [0.9, 0.7, 0.3, 1], normal: FLAT, material: [0, 1, 0, 1] }, onAxis);
    expect(gold[0]).toBeGreaterThan(gold[2]); // R highlight > B highlight
  });

  it('specular stays premultiplied (scaled by albedo alpha)', () => {
    const full = bandedPbrPixel({ albedo: [0.5, 0.5, 0.5, 1], normal: FLAT, material: [0, 1, 0, 0] }, onAxis);
    const half = bandedPbrPixel({ albedo: [0.25, 0.25, 0.25, 0.5], normal: FLAT, material: [0, 1, 0, 0] }, onAxis);
    // half-alpha: diffuse term halves (albedo halved) AND the spec term halves (×alpha).
    close(half[0], full[0] * 0.5);
  });
});

describe('R2b — WGSL parity with the reference', () => {
  it('WGSL holds the same load-bearing operations as the reference math', () => {
    expect(LIT_WGSL).toContain('nrm.a > 0.5');                  // mask fallback
    expect(LIT_WGSL).toContain('normalize(nrm.rgb * 2.0 - 1.0)'); // normal decode
    expect(LIT_WGSL).toContain('let ao    = mat.g;');            // AO straight from G
    expect(LIT_WGSL).toContain('floor(ndl * G.uBands + 0.5) / G.uBands'); // diffuse banding
    expect(LIT_WGSL).toContain('let gloss = 1.0 - rough;');      // specular gate
    expect(LIT_WGSL).toContain('floor(specRaw * G.uBands + 0.5) / G.uBands'); // spec banding
    // `alb` is albedo.rgb AFTER the optional snow whiten (identity at whiten 0, which is
    // why the reference math above — which knows nothing of snow — still holds).
    expect(LIT_WGSL).toContain('mix(vec3<f32>(1.0, 1.0, 1.0), alb, metal)'); // metal tint
    expect(LIT_WGSL).toContain('alb * diffuse');                 // premultiplied output
    expect(LIT_WGSL).toContain('if (albedo.a < 0.5) { discard; }'); // hard cutout
  });

  it('the snow whiten is IDENTITY at 0 and only touches UP-FACING texels (alpine fidelity)', () => {
    // Gated on whiten > 0, so an unsnowed world's pixels take the byte-identical old path.
    expect(LIT_WGSL).toContain('if (vMisc.x > 0.0) {');
    // Weighted by the up-facing term, and mixed BEFORE the banded diffuse (so entity snow
    // quantizes into the same bands as everything else).
    expect(LIT_WGSL).toContain('let topFacing = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);');
    expect(LIT_WGSL).toContain('vMisc.x * topFacing');
  });

  it('a mirrored instance negates the sampled normal\'s x (lighting follows the flip)', () => {
    expect(LIT_WGSL).toContain('if (vMisc.y > 0.5) {');
    expect(LIT_WGSL).toContain('n = vec3<f32>(-n.x, n.y, n.z);');
  });

  it('the ground CONTACT blend is IDENTITY at strength 0 and only reaches the FOOT', () => {
    // Gated on contact > 0 (iMisc.z), so every sprite that declares no contact — every
    // building, NPC and tree — takes the byte-identical old path.
    expect(LIT_WGSL).toContain('if (vMisc.z > 0.0) {');
    // Weight rises toward the foot (vFoot = the quad's corner.y, 1 at the ground line),
    // over the bottom `band` (iMisc.w) of the drawn sprite, squared so it falls away fast.
    expect(LIT_WGSL).toContain('let t = clamp((vFoot - (1.0 - band)) / band, 0.0, 1.0);');
    expect(LIT_WGSL).toContain('alb = mix(alb, vGround, vMisc.z * t * t);');
    // The per-instance vertex layout the pipeline descriptor must match.
    expect(LIT_WGSL).toContain('@location(4) iMisc  : vec4<f32>');
    expect(LIT_WGSL).toContain('@location(5) iGround : vec3<f32>');
    expect(LIT_WGSL).toContain('out.vFoot = corner.y;');
  });
});
