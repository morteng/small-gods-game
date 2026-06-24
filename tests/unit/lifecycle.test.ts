// tests/unit/lifecycle.test.ts
import { describe, it, expect } from 'vitest';
import { resolveAsset, synthesizeBlueprint } from '@/blueprint/presets';
import { plantStagePatch, buildingStagePatch, stagePhrase, stagePatch, stagesFor, defaultStageFor, PLANT_STAGES, PLANT_DEFAULT_STAGE, BUILDING_STAGES } from '@/blueprint/lifecycle';
import { BUILDING_BLUEPRINTS } from '@/blueprint/presets';
import { canonicalJson } from '@/render/generated-art-cache';

const trunk = (rb: NonNullable<ReturnType<typeof resolveAsset>>) => rb.parts.find(p => p.type === 'branch_plant')!;
const body = (rb: NonNullable<ReturnType<typeof resolveAsset>>) => rb.parts.find(p => p.type === 'body')!;

describe('plantStagePatch', () => {
  it('scales the flora metric params down for a sapling', () => {
    const oak = BUILDING_BLUEPRINTS.oak_branched;
    const patch = plantStagePatch(oak, 'sapling');
    const tp = patch.parts!.trunk as { params: Record<string, number> };
    // oak_branched is heightM 15 → sapling ~0.25
    expect(tp.params.heightM).toBeCloseTo(15 * 0.25, 1);
    expect(tp.params.trunkR).toBeLessThan(0.20);   // trunk thinned below mature
    expect(patch.stage).toBe('sapling');
  });

  it('the default stage (mature) is a no-op patch', () => {
    const patch = plantStagePatch(BUILDING_BLUEPRINTS.oak_branched, PLANT_DEFAULT_STAGE);
    expect(patch).toEqual({});
  });

  it('dying drops the crown (crownShape → none)', () => {
    const patch = plantStagePatch(BUILDING_BLUEPRINTS.oak_branched, 'dying');
    const tp = patch.parts!.trunk as { params: Record<string, unknown> };
    expect(tp.params.crownShape).toBe('none');
  });
});

describe('resolveAsset lifecycle stage', () => {
  it('a sapling oak is shorter than a mature oak', () => {
    const sapling = resolveAsset({ type: 'oak_branched', stage: 'sapling' })!;
    const mature = resolveAsset({ type: 'oak_branched', stage: 'mature' })!;
    expect((trunk(sapling).params.heightM as number)).toBeLessThan(trunk(mature).params.heightM as number);
    expect(sapling.stage).toBe('sapling');
  });

  it('requesting the default stage is library-safe (identical key to stageless)', () => {
    const bare = canonicalJson(resolveAsset({ type: 'oak_branched' })!);
    const mature = canonicalJson(resolveAsset({ type: 'oak_branched', stage: 'mature' })!);
    expect(mature).toBe(bare);
    expect(mature).toBe(canonicalJson(synthesizeBlueprint('oak_branched')!));
    expect('stage' in resolveAsset({ type: 'oak_branched' })!).toBe(false);
  });

  it('each plant stage yields a distinct canonical key (distinct sprites)', () => {
    const keys = PLANT_STAGES.map(s => canonicalJson(resolveAsset({ type: 'oak_branched', stage: s })!));
    // mature collapses onto the stageless key, so 6 stages → 6 distinct keys still
    expect(new Set(keys).size).toBe(PLANT_STAGES.length);
  });

  it('stage composes with descriptors', () => {
    const rb = resolveAsset({ type: 'oak_branched', stage: 'young', descriptors: { tags: ['sacred'] } })!;
    expect(rb.stage).toBe('young');
    expect(rb.descriptors?.tags).toContain('sacred');
  });
});

describe('buildingStagePatch', () => {
  it('a ruin loses its roof + a storey and reads as dilapidated', () => {
    const patch = buildingStagePatch(BUILDING_BLUEPRINTS.tavern, 'ruin');   // tavern is 2 storeys
    const bp = patch.parts!.body as { params: Record<string, unknown> };
    expect(bp.params.roof).toBe('flat');
    expect(bp.params.levels).toBe(1);          // 2 → 1
    expect(patch.descriptors?.condition).toBe('dilapidated');
    expect(patch.descriptors?.tags).toContain('ruined');
    expect(patch.stage).toBe('ruin');
  });

  it('the default stage (complete) is a no-op patch', () => {
    expect(buildingStagePatch(BUILDING_BLUEPRINTS.cottage, 'complete')).toEqual({});
  });

  it('stagePhrase leads the img2img prompt for a building stage', () => {
    expect(stagePhrase('building', 'burnt')).toMatch(/burnt-out/);
    expect(stagePhrase('building', 'complete')).toBe('');   // the default stage has no phrase
    expect(stagePhrase('building', undefined)).toBe('');
    expect(stagePhrase('plant', 'sapling')).toBe('');       // plants drive geometry, not a phrase
  });
});

describe('resolveAsset building lifecycle', () => {
  it('a ruined cottage resolves roofless + records the stage', () => {
    const ruin = resolveAsset({ type: 'cottage', stage: 'ruin' })!;
    expect(body(ruin).params.roof).toBe('flat');
    expect(ruin.stage).toBe('ruin');
    expect(ruin.descriptors?.condition).toBe('dilapidated');
  });

  it('requesting complete is library-safe (identical key to stageless)', () => {
    const bare = canonicalJson(resolveAsset({ type: 'cottage' })!);
    const complete = canonicalJson(resolveAsset({ type: 'cottage', stage: 'complete' })!);
    expect(complete).toBe(bare);
    expect('stage' in resolveAsset({ type: 'cottage' })!).toBe(false);
  });

  it('every building stage yields a distinct canonical key', () => {
    const keys = BUILDING_STAGES.map(s => canonicalJson(resolveAsset({ type: 'tavern', stage: s })!));
    expect(new Set(keys).size).toBe(BUILDING_STAGES.length);
  });
});

describe('stage registry', () => {
  it('plants and buildings each have their own timeline', () => {
    expect(stagesFor('plant')).toEqual(PLANT_STAGES);
    expect(defaultStageFor('plant')).toBe('mature');
    expect(stagesFor('building')).toEqual(BUILDING_STAGES);
    expect(defaultStageFor('building')).toBe('complete');
    expect(stagesFor('barrier')).toEqual([]);
    expect(defaultStageFor('barrier')).toBeUndefined();
  });

  it('stagePatch dispatches by class', () => {
    expect(stagePatch(BUILDING_BLUEPRINTS.cottage, 'ruin').stage).toBe('ruin');
    expect(stagePatch(BUILDING_BLUEPRINTS.oak_branched, 'sapling').stage).toBe('sapling');
    expect(stagePatch(BUILDING_BLUEPRINTS.cottage, 'nonsense')).toEqual({});
  });
});
