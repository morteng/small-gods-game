// tests/unit/lifecycle.test.ts
import { describe, it, expect } from 'vitest';
import { resolveAsset, synthesizeBlueprint } from '@/blueprint/presets';
import { plantStagePatch, stagePatch, stagesFor, defaultStageFor, PLANT_STAGES, PLANT_DEFAULT_STAGE } from '@/blueprint/lifecycle';
import { BUILDING_BLUEPRINTS } from '@/blueprint/presets';
import { canonicalJson } from '@/render/generated-art-cache';

const trunk = (rb: NonNullable<ReturnType<typeof resolveAsset>>) => rb.parts.find(p => p.type === 'tree')!;

describe('plantStagePatch', () => {
  it('scales the tree metric params down for a sapling', () => {
    const oak = BUILDING_BLUEPRINTS.oak_tree;
    const patch = plantStagePatch(oak, 'sapling');
    const tp = patch.parts!.trunk as { params: Record<string, number> };
    // oak is heightM 15 → sapling ~0.25
    expect(tp.params.heightM).toBeCloseTo(15 * 0.25, 1);
    expect(tp.params.crownM).toBeLessThan(8);   // crown thinned below mature
    expect(patch.stage).toBe('sapling');
  });

  it('the default stage (mature) is a no-op patch', () => {
    const patch = plantStagePatch(BUILDING_BLUEPRINTS.oak_tree, PLANT_DEFAULT_STAGE);
    expect(patch).toEqual({});
  });

  it('dying drops leaves (form → bare)', () => {
    const patch = plantStagePatch(BUILDING_BLUEPRINTS.oak_tree, 'dying');
    const tp = patch.parts!.trunk as { params: Record<string, unknown> };
    expect(tp.params.form).toBe('bare');
  });
});

describe('resolveAsset lifecycle stage', () => {
  it('a sapling oak is shorter than a mature oak', () => {
    const sapling = resolveAsset({ type: 'oak_tree', stage: 'sapling' })!;
    const mature = resolveAsset({ type: 'oak_tree', stage: 'mature' })!;
    expect((trunk(sapling).params.heightM as number)).toBeLessThan(trunk(mature).params.heightM as number);
    expect(sapling.stage).toBe('sapling');
  });

  it('requesting the default stage is library-safe (identical key to stageless)', () => {
    const bare = canonicalJson(resolveAsset({ type: 'oak_tree' })!);
    const mature = canonicalJson(resolveAsset({ type: 'oak_tree', stage: 'mature' })!);
    expect(mature).toBe(bare);
    expect(mature).toBe(canonicalJson(synthesizeBlueprint('oak_tree')!));
    expect('stage' in resolveAsset({ type: 'oak_tree' })!).toBe(false);
  });

  it('each plant stage yields a distinct canonical key (distinct sprites)', () => {
    const keys = PLANT_STAGES.map(s => canonicalJson(resolveAsset({ type: 'oak_tree', stage: s })!));
    // mature collapses onto the stageless key, so 6 stages → 6 distinct keys still
    expect(new Set(keys).size).toBe(PLANT_STAGES.length);
  });

  it('stage composes with descriptors', () => {
    const rb = resolveAsset({ type: 'oak_tree', stage: 'young', descriptors: { tags: ['sacred'] } })!;
    expect(rb.stage).toBe('young');
    expect(rb.descriptors?.tags).toContain('sacred');
  });
});

describe('stage registry', () => {
  it('plants have the six-stage timeline; buildings have none yet', () => {
    expect(stagesFor('plant')).toEqual(PLANT_STAGES);
    expect(defaultStageFor('plant')).toBe('mature');
    expect(stagesFor('building')).toEqual([]);
    expect(defaultStageFor('building')).toBeUndefined();
  });

  it('stagePatch is empty for a class with no lifecycle', () => {
    expect(stagePatch(BUILDING_BLUEPRINTS.cottage, 'ruin')).toEqual({});
  });
});
