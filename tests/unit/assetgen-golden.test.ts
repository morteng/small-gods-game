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
    // Updated for connectome Slice 1: the cottage's smoke vent is now DERIVED from the
    // hearth (a ridge louver, t=0.5) instead of the old hand-authored smokehole (t=0.4).
    // Geometry shifted intentionally ⇒ ART_RECIPE_VERSION bumped.
    expect(fingerprint(r)).toEqual({
      size: 386, grey: '750f1d99', normal: '74b2f4c', material: 'f11d4eb7', emissive: '56818c1d',
    });
  });

  it('plain stone box primitive is bit-stable', async () => {
    const r = await composeStructure({ parts: [{ prim: 'box', at: [0, 0, 0], size: [2, 2, 2], material: 'stone' }] });
    expect(fingerprint(r)).toEqual({
      size: 264, grey: '8d493e6e', normal: '103f0c0b', material: 'd829cbcb', emissive: 'a9c77405',
    });
  });
});
