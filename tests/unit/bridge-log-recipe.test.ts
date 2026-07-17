// @vitest-environment node
// Golden-hash pin for the tier-0 `bridge-log` recipe (road-wear economy S0 redux) — the SAME
// discipline as tests/unit/assetgen-golden.test.ts, in its own file because the recipe is
// ADDITIVE: a new preset must never perturb the existing pins (and needs no ART bump —
// the WCV-101 carpentry-round precedent). If bridge-log geometry changes intentionally,
// update this pin AND bump ART_RECIPE_VERSION.
//
// S0-redux ("the log looks like a plank"): the log is now a real ROUND trunk — a `log` part
// emitting the `roundwood` prim (taper, hewn-flat top, branch stubs) — and the recipe takes a
// VARIATION seed through the repo's seeded sfc32. The pins below pin the DEFAULT (seed 0)
// canonical build; the variation tests pin the seed contract, not specific geometry.
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
  it('is the humble crossing: ONE round trunk + branch stubs + two low stone seats, nothing else', () => {
    const parts = BRIDGE_RECIPES['log'].build();
    const byType = new Map<string, number>();
    for (const p of Object.values(parts)) byType.set(p.type, (byType.get(p.type) ?? 0) + 1);
    // Exactly 2 abutment-type parts (the preset invariant) — humble stone SEATS, kept LOW.
    expect(byType.get('abutment')).toBe(2);
    // Exactly ONE trunk + 1–3 branch stubs, ALL roundwood `log` parts — no deck box anywhere
    // (a deck box is precisely the "looks like a plank" failure this rung was redone to fix).
    expect(byType.get('deck')).toBeUndefined();
    const logs = Object.entries(parts).filter(([, p]) => p.type === 'log');
    expect(logs.length).toBeGreaterThanOrEqual(2);   // trunk + ≥1 stub
    expect(logs.length).toBeLessThanOrEqual(4);      // trunk + ≤3 stubs
    const trunk = parts['log']!;
    expect(trunk).toBeTruthy();
    for (const p of Object.values(parts)) {
      if (p.type === 'abutment') {
        expect(p.material).toBe('stone');
        expect(p.params?.heightM as number).toBeLessThan(1);   // a block, not an engineered abutment
      }
    }
    // The trunk is GENEROUS (a real trunk, not a pole), askew, and hewn flat on top.
    expect(trunk.params?.radiusM as number).toBeGreaterThanOrEqual(0.3);
    expect(Math.abs(trunk.params?.yawDeg as number)).toBeGreaterThan(0.5);
    expect(trunk.params?.flatDepthM as number).toBeGreaterThan(0);
    // Natural taper: tip thinner than butt.
    expect(trunk.params?.tipRadiusM as number).toBeLessThan(trunk.params?.radiusM as number);
  });

  it('the variation seed is deterministic and actually varies the build', () => {
    // Same seed ⇒ identical parts (the studio reroll and any cache key can trust this).
    expect(BRIDGE_RECIPES['log'].build(7)).toEqual(BRIDGE_RECIPES['log'].build(7));
    // Omitted seed ⇒ the canonical (seed 0) build.
    expect(BRIDGE_RECIPES['log'].build()).toEqual(BRIDGE_RECIPES['log'].build(0));
    // A different seed moves the trunk within tasteful bounds (girth and askew both live).
    const a = BRIDGE_RECIPES['log'].build(0)['log']!.params!;
    const b = BRIDGE_RECIPES['log'].build(1)['log']!.params!;
    expect(a.radiusM).not.toBe(b.radiusM);
    for (const p of [a, b]) {
      expect(p.radiusM as number).toBeGreaterThanOrEqual(0.34);
      expect(p.radiusM as number).toBeLessThanOrEqual(0.42);
      expect(Math.abs(p.yawDeg as number)).toBeLessThanOrEqual(4);
    }
  });

  it('is bit-stable through the full compose pipeline (golden pin, default seed)', async () => {
    const rb = synthesizeBlueprint('bridge-log')!;
    expect(rb).toBeTruthy();
    const r = await composeStructure(toGeometry(rb));
    expect(fingerprint(r)).toEqual({
      size: 266, grey: 'd5b31622', normal: '573059c5', material: 'ef6f2dfa', emissive: 'c402f57c',
    });
  });
});
