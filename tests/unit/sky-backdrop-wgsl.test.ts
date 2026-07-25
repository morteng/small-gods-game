import { describe, it, expect } from 'vitest';
import { SKY_BACKDROP_WGSL } from '@/render/gpu/wgsl/sky-backdrop-wgsl';

// P1-C — the title-screen sky backdrop shader. Headless Node has no WebGPU, so this
// can't actually compile the module; it asserts the shader SOURCE instead: non-empty,
// has both entry points, and — the specific build-breaker CLAUDE.md calls out — no
// backtick characters anywhere (a backtick inside a WGSL comment breaks the build,
// because the whole shader is embedded in a JS template literal at gpu-pipelines.ts's
// `device.createShaderModule({ code: SKY_BACKDROP_WGSL })` call site).
describe('sky-backdrop-wgsl', () => {
  it('is a non-empty shader source', () => {
    expect(typeof SKY_BACKDROP_WGSL).toBe('string');
    expect(SKY_BACKDROP_WGSL.length).toBeGreaterThan(0);
  });

  it('declares a vertex and a fragment entry point, matching the pipeline factory', () => {
    // createSkyBackdropPipeline (gpu-pipelines.ts) wires entryPoint: 'vsMain' / 'fsMain'.
    expect(SKY_BACKDROP_WGSL).toContain('@vertex');
    expect(SKY_BACKDROP_WGSL).toMatch(/fn\s+vsMain\s*\(/);
    expect(SKY_BACKDROP_WGSL).toContain('@fragment');
    expect(SKY_BACKDROP_WGSL).toMatch(/fn\s+fsMain\s*\(/);
  });

  it('NEVER contains a backtick — a backtick in a WGSL comment breaks the build', () => {
    expect(SKY_BACKDROP_WGSL.includes('`')).toBe(false);
  });

  it('binds group 0 at bindings 0/1/2 — globals uniform, noise texture, noise sampler '
    + '(the SAME shape GpuScene builds the sky-backdrop bind group with, and the SAME '
    + 'shape ocean-backdrop-wgsl.ts uses)', () => {
    expect(SKY_BACKDROP_WGSL).toMatch(/@group\(0\)\s*@binding\(0\)\s*var<uniform>/);
    expect(SKY_BACKDROP_WGSL).toMatch(/@group\(0\)\s*@binding\(1\)\s*var\s+\w+\s*:\s*texture_2d<f32>/);
    expect(SKY_BACKDROP_WGSL).toMatch(/@group\(0\)\s*@binding\(2\)\s*var\s+\w+\s*:\s*sampler/);
  });

  it('references the shared noise texture (no new texture — reuses the baked tiling atlas)', () => {
    expect(SKY_BACKDROP_WGSL).toContain('noiseTex');
    expect(SKY_BACKDROP_WGSL).toContain('textureSampleLevel(noiseTex');
  });

  it('the globals struct carries viewport + a time term — the minimum renderMeta needs', () => {
    expect(SKY_BACKDROP_WGSL).toMatch(/struct\s+SGlobals\s*\{/);
    expect(SKY_BACKDROP_WGSL).toContain('uParams');
  });
});
