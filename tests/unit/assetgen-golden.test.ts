// @vitest-environment node
// Golden-hash regression guard for the deterministic G-buffer pipeline.
// composeStructure is pure + seeded, so every map's bytes are bit-stable; a hash
// mismatch means the geometry/raster output CHANGED. If the change is intentional
// (new geometry, materials, fit), re-run with UPDATE printed values below and bump
// ART_RECIPE_VERSION so cached art regenerates.
import { describe, it, expect } from 'vitest';
import { composeStructure, type StructureResult } from '@/assetgen/compose';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { synthesizeBlueprint } from '@/blueprint/presets';

function djb2hex(buf: Uint8ClampedArray): string {
  let h = 5381;
  for (let i = 0; i < buf.length; i++) h = ((h << 5) + h + buf[i]) | 0;
  return (h >>> 0).toString(16);
}

function fingerprint(r: StructureResult): Record<string, string | number> {
  return {
    size: r.size,
    grey: djb2hex(r.grey), normal: djb2hex(r.normal),
    material: djb2hex(r.material), emissive: djb2hex(r.emissive),
  };
}

describe('assetgen golden hashes', () => {
  it('cottage (full Blueprint pipeline) is bit-stable', async () => {
    const rb = synthesizeBlueprint('cottage')!;
    const r = await composeStructure(toGeometry(rb));
    // v11 procedural weathering bakes dirt/grime/rain-streaks into the albedo (`grey`).
    // v12 lit windows: the cottage's window panes are now a 'glass' material (cool
    // albedo + warm emissive), so `grey` (pane colour), `material` (glass roughness)
    // and `emissive` (warm glow) all shift; `normal` is geometry-only ⇒ unchanged.
    // Intentional ⇒ ART_RECIPE_VERSION bumped to v12.
    expect(fingerprint(r)).toEqual({
      size: 386, grey: '9c20afd2', normal: 'ae385f81', material: '342c7b25', emissive: '8e3dc9b8',
    });
  });

  it('plain stone box primitive is bit-stable', async () => {
    const r = await composeStructure({ parts: [{ prim: 'box', at: [0, 0, 0], size: [2, 2, 2], material: 'stone' }] });
    expect(fingerprint(r)).toEqual({
      size: 264, grey: '73bee633', normal: '103f0c0b', material: 'd829cbcb', emissive: 'a9c77405',
    });
  });
});
