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
    // v17 layered-connectome L2b (FORM footprint variety): a gen-form body's plan LENGTH
    // is now sized to a seeded bay count from `sizeBays` ([1,2] for a cottage), so the
    // name-derived default cottage resolves to a SHORTER single-bay body (size 386→322).
    // v18 L3b (bay-aware openings): windows now snap to the structural bay CENTRES (from the
    // frame's `bayModule`) instead of fixed fractions, so the cottage's pane positions shift
    // — `size` holds (same footprint) but every channel hash moves with the relocated lights.
    // Intentional ⇒ ART_RECIPE_VERSION bumped to v18.
    // v24 warmed MATERIAL_RGB (golden thatch, terracotta tile, de-blued stone): ONLY the
    // albedo (`grey`) hash moves — normal/material/emissive are byte-identical, proof the
    // change is pure palette.
    // v27 window/door trim: openings now carry a stone sill + head lintel + a timber mullion
    // grid (windows) and a stone threshold + metal handle (doors), so a cottage window reads
    // as a real window instead of a blank hole. New geometry ⇒ every channel hash moves.
    // v27 (cont.) trim retune: window sills + door knob project half as far (SILL_PROUD/handle
    // shrunk) — the cottage's projecting trim moves on all channels again.
    expect(fingerprint(r)).toEqual({
      size: 322, grey: 'b6c61dc4', normal: '64880444', material: '9c8b4ed3', emissive: 'e487ed02',
    });
  });

  it('plain stone box primitive is bit-stable', async () => {
    const r = await composeStructure({ parts: [{ prim: 'box', at: [0, 0, 0], size: [2, 2, 2], material: 'stone' }] });
    // v24 palette warm: stone de-blued ⇒ grey (albedo) hash only.
    expect(fingerprint(r)).toEqual({
      size: 264, grey: 'a4a2f8b2', normal: '103f0c0b', material: 'd829cbcb', emissive: 'a9c77405',
    });
  });
});
