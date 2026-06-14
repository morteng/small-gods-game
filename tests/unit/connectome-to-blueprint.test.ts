import { describe, it, expect, beforeAll } from 'vitest';
import { CatalogueRegistry } from '@/catalogue/registry';
import { loadPack } from '@/catalogue/pack';
import { medievalEuropePack } from '@/catalogue/packs/medieval-europe';
import { expand } from '@/blueprint/connectome/grammar';
import { deriveSmokeEgress } from '@/blueprint/connectome/smoke';
import { connectomeToBlueprint } from '@/blueprint/connectome/to-blueprint';
import type { ExpandCtx } from '@/blueprint/connectome/types';
import type { Blueprint } from '@/blueprint/types';

// NOTE: tested against the connectome modules + a synthetic base Blueprint directly,
// NOT via resolveAsset/presets — that integration test is added once the flora lane
// (co-editing presets/index.ts) is separated. Core derivation is fully covered here.

let registry: CatalogueRegistry;
const ctx = (over: Partial<ExpandCtx> = {}): ExpandCtx => ({ era: 'medieval', seed: 1, registry, ...over });

const baseCottage: Blueprint = {
  version: 4,
  class: 'building',
  preset: 'cottage',
  footprint: { w: 3, h: 3 },
  materials: { walls: 'wattle', roof: 'thatch' },
  parts: { body: { type: 'body', size: { w: 3, h: 2 }, params: { plan: 'rect' }, features: {} } },
};

beforeAll(() => {
  registry = new CatalogueRegistry();
  loadPack(medievalEuropePack, registry);
});

function ventOf(buildingType: string, base: Blueprint, c: Partial<ExpandCtx>) {
  const con = deriveSmokeEgress(expand(buildingType, ctx(c)), ctx(c));
  const patch = connectomeToBlueprint(con, base);
  const feats = patch.parts?.body?.features ?? {};
  return Object.values(feats).find((f) => f.type === 'vent');
}

describe('connectome → blueprint (hearth derives the vent)', () => {
  it('early-medieval cottage → a vent of kind smokehole (louver), NOT a chimney', () => {
    const v = ventOf('cottage', baseCottage, { era: 'medieval', wealth: 'poor' });
    expect(v).toBeDefined();
    expect(v!.params!.kind).toBe('smokehole');
  });

  it('the derived vent is centred over the single hearth bay (t≈0.5)', () => {
    const v = ventOf('cottage', baseCottage, { era: 'medieval' });
    expect(v!.params!.t).toBeCloseTo(0.5, 5);
  });

  it('late + rich → a wall chimney (placement wall ⇒ kind chimney)', () => {
    const v = ventOf('cottage', baseCottage, { era: 'current', wealth: 'rich' });
    expect(v!.params!.kind).toBe('chimney');
  });

  it('a hearthless building (barn) yields an empty patch — no vent', () => {
    const con = deriveSmokeEgress(expand('farm_barn', ctx()), ctx());
    expect(connectomeToBlueprint(con, baseCottage)).toEqual({});
  });

  it('targets the body part id of the base blueprint', () => {
    const con = deriveSmokeEgress(expand('cottage', ctx()), ctx());
    const patch = connectomeToBlueprint(con, baseCottage);
    expect(Object.keys(patch.parts ?? {})).toEqual(['body']);
  });
});
