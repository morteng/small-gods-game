import { describe, it, expect } from 'vitest';
import { synthesizeBlueprint, isBridgePreset, bridgePresetNames } from '@/blueprint/presets';
import { BRIDGE_RECIPES, bridgeBlueprintByName } from '@/blueprint/presets/bridges';
import { assetCatalogue } from '@/blueprint/catalogue';

describe('bridge presets (shared game-code bridge module)', () => {
  it('exposes a canonical bridge-<short> name per recipe', () => {
    const names = bridgePresetNames();
    expect(names.sort()).toEqual(Object.keys(BRIDGE_RECIPES).map((k) => `bridge-${k}`).sort());
    for (const n of names) expect(isBridgePreset(n)).toBe(true);
    expect(isBridgePreset('tavern')).toBe(false);
    expect(isBridgePreset('bridge-nope')).toBe(false);
  });

  it('synthesizeBlueprint resolves each bridge to a prop blueprint with assembled parts', () => {
    for (const n of bridgePresetNames()) {
      const rb = synthesizeBlueprint(n);
      expect(rb, n).toBeTruthy();
      expect(rb!.class).toBe('prop');
      expect(rb!.preset).toBe(n);
      const parts = Object.values(rb!.parts ?? {});
      expect(parts.length).toBeGreaterThan(0);
      // Every bridge grounds its ends on at least two abutment-type parts. Multi-bay masonry
      // bridges add MORE of them (joint piers + plinth footings reuse the stepped-batter
      // abutment vocabulary), so the invariant is a floor, and always an even count (the
      // pier/plinth pairs come in twos, as do the end footings).
      const abuts = parts.filter((p) => p.type === 'abutment').length;
      expect(abuts, n).toBeGreaterThanOrEqual(2);
      expect(abuts % 2, n).toBe(0);
    }
  });

  it('bridgeBlueprintByName only resolves bridge names', () => {
    expect(bridgeBlueprintByName('bridge-stone-arch')).toBeTruthy();
    expect(bridgeBlueprintByName('tavern')).toBeUndefined();
  });

  it('surfaces bridges in the asset catalogue as infrastructure props', () => {
    const bridges = assetCatalogue().filter((e) => e.type.startsWith('bridge-'));
    expect(bridges.map((e) => e.type).sort()).toEqual(bridgePresetNames().sort());
    for (const e of bridges) {
      expect(e.class).toBe('prop');
      expect(e.category).toBe('infrastructure');
      expect(e.tags).toContain('bridge');
    }
  });
});
