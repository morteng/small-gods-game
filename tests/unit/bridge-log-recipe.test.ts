// @vitest-environment node
// Golden-hash pin for the tier-0 `bridge-log` recipe (road-wear economy S0) — the SAME
// discipline as tests/unit/assetgen-golden.test.ts, in its own file because the recipe is
// ADDITIVE: a new preset must never perturb the existing pins (and needs no ART bump —
// the WCV-101 carpentry-round precedent). If bridge-log geometry changes intentionally,
// update this pin AND bump ART_RECIPE_VERSION.
import { describe, it, expect } from 'vitest';
import { composeStructure, type StructureResult } from '@/assetgen/compose';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { BRIDGE_RECIPES } from '@/blueprint/presets/bridges';

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

describe('bridge-log recipe (tier 0)', () => {
  it('is the humble crossing: log + treadway + two low seat blocks, nothing else', () => {
    const parts = BRIDGE_RECIPES['log'].build();
    const types = Object.values(parts).map((p) => p.type).sort();
    expect(types).toEqual(['abutment', 'abutment', 'deck', 'deck']);
    // No rails on either timber member, and the seating stays LOW (below 1 m — a block, not
    // an engineered abutment).
    for (const p of Object.values(parts)) {
      if (p.type === 'deck') expect(p.params?.parapet).toBe('none');
      if (p.type === 'abutment') expect(p.params?.heightM as number).toBeLessThan(1);
    }
  });

  it('is bit-stable through the full compose pipeline (golden pin)', async () => {
    const rb = synthesizeBlueprint('bridge-log')!;
    expect(rb).toBeTruthy();
    const r = await composeStructure(toGeometry(rb));
    expect(fingerprint(r)).toEqual({
      size: 257, grey: '6a37744a', normal: '6fb4cb00', material: 'cd6f82e1', emissive: 'b374ab9f',
    });
  });
});
