// @vitest-environment node
// Pure procedural-texture generators — no DOM needed; the lightweight node environment
// keeps these build-heavy tests fast + contention-proof in the full parallel suite.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  MATERIAL_IDS, MATERIAL_LAYER, buildMaterialExemplar, buildMaterialAtlas,
  materialAtlas, clearMaterialAtlasCache, type MaterialId,
} from '@/render/gpu/material-exemplar';

const SIZE = 32;   // size-independent checks; small keeps the build-heavy suite fast

beforeEach(() => clearMaterialAtlasCache());

/**
 * Mean per-channel adjacency difference (0..255) over the INTERIOR vs across the
 * toroidal WRAP seam. A seamless tile wraps with no discontinuity, so the seam diff
 * must be comparable to the interior diff — that comparison IS the img2img tileability
 * gate (Slice 3). A non-periodic generator spikes the seam term and fails.
 */
function seamReport(buf: Uint8Array, size: number) {
  const at = (x: number, y: number, c: number) => buf[(y * size + x) * 4 + c];
  let interior = 0, interiorN = 0, seam = 0, seamN = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      for (let c = 0; c < 3; c++) {
        if (x + 1 < size) { interior += Math.abs(at(x, y, c) - at(x + 1, y, c)); interiorN++; }
        if (y + 1 < size) { interior += Math.abs(at(x, y, c) - at(x, y + 1, c)); interiorN++; }
      }
    }
  }
  for (let y = 0; y < size; y++) for (let c = 0; c < 3; c++) {
    seam += Math.abs(at(size - 1, y, c) - at(0, y, c)); seamN++;
  }
  for (let x = 0; x < size; x++) for (let c = 0; c < 3; c++) {
    seam += Math.abs(at(x, size - 1, c) - at(x, 0, c)); seamN++;
  }
  return { interior: interior / interiorN, seam: seam / seamN };
}

describe('material-exemplar generators', () => {
  it('produce every declared material at the right size, fully opaque', () => {
    for (const id of MATERIAL_IDS) {
      const ex = buildMaterialExemplar(id, SIZE);
      expect(ex.id).toBe(id);
      expect(ex.size).toBe(SIZE);
      expect(ex.albedo.length).toBe(SIZE * SIZE * 4);
      expect(ex.normal.length).toBe(SIZE * SIZE * 4);
      // Aggregate per-pixel invariants into counts (one expect each — cheap under vitest):
      // albedo fully opaque, and every normal Z (B) points generally up (>= ~0.47 encoded).
      let badAlpha = 0, flatN = 0;
      for (let i = 0; i < ex.albedo.length; i += 4) {
        if (ex.albedo[i + 3] !== 255) badAlpha++;
        if (ex.normal[i + 2] < 120) flatN++;
      }
      expect(badAlpha, `${id} non-opaque albedo`).toBe(0);
      expect(flatN, `${id} down-facing normals`).toBe(0);
    }
  });

  it('are DETERMINISTIC — same id ⇒ byte-identical albedo + normal', () => {
    for (const id of MATERIAL_IDS) {
      const a = buildMaterialExemplar(id, SIZE);
      const b = buildMaterialExemplar(id, SIZE);
      expect(Array.from(a.albedo)).toEqual(Array.from(b.albedo));
      expect(Array.from(a.normal)).toEqual(Array.from(b.normal));
    }
  });

  it('are SEAMLESS — wrap-edge diff comparable to interior (albedo + normal)', () => {
    for (const id of MATERIAL_IDS) {
      const ex = buildMaterialExemplar(id, SIZE);
      for (const [name, buf] of [['albedo', ex.albedo], ['normal', ex.normal]] as const) {
        const { interior, seam } = seamReport(buf, SIZE);
        // Seam may not exceed 2.5× the interior step (absolute floor 6/255 for near-flat
        // materials like snow where the interior step is itself tiny).
        const limit = Math.max(2.5 * interior, 6);
        expect(seam, `${id} ${name} seam ${seam.toFixed(2)} vs interior ${interior.toFixed(2)}`)
          .toBeLessThanOrEqual(limit);
      }
    }
  });

  it('have genuine surface variation (not a flat fill)', () => {
    for (const id of MATERIAL_IDS) {
      const ex = buildMaterialExemplar(id, SIZE);
      const { interior } = seamReport(ex.albedo, SIZE);
      expect(interior, `${id} should have albedo variation`).toBeGreaterThan(0.4);
    }
  });
});

describe('material atlas', () => {
  it('stacks layers in MATERIAL_IDS order, matching the per-material exemplar', () => {
    const atlas = buildMaterialAtlas(SIZE);
    const per = SIZE * SIZE * 4;
    expect(atlas.layers).toBe(MATERIAL_IDS.length);
    expect(atlas.albedo.length).toBe(per * MATERIAL_IDS.length);
    for (const id of MATERIAL_IDS) {
      const layer = MATERIAL_LAYER[id];
      const ex = buildMaterialExemplar(id, SIZE);
      const slice = atlas.albedo.subarray(layer * per, (layer + 1) * per);
      expect(Array.from(slice)).toEqual(Array.from(ex.albedo));
    }
  });

  it('memoises and clears', () => {
    const a = materialAtlas(SIZE);
    expect(materialAtlas(SIZE)).toBe(a);   // same instance
    clearMaterialAtlasCache();
    expect(materialAtlas(SIZE)).not.toBe(a);
  });
});

// Layer-index contract: a stable, exhaustive mapping (guards accidental reordering that
// would desync the shader's material selection in Slice 1/2).
describe('material layer contract', () => {
  it('assigns a unique contiguous layer per material', () => {
    const seen = new Set<number>();
    (MATERIAL_IDS as readonly MaterialId[]).forEach((id, i) => {
      expect(MATERIAL_LAYER[id]).toBe(i);
      seen.add(MATERIAL_LAYER[id]);
    });
    expect(seen.size).toBe(MATERIAL_IDS.length);
  });
});
