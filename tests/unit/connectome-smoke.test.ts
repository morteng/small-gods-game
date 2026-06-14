import { describe, it, expect, beforeAll } from 'vitest';
import { CatalogueRegistry } from '@/catalogue/registry';
import { loadPack } from '@/catalogue/pack';
import { medievalEuropePack } from '@/catalogue/packs/medieval-europe';
import { expand } from '@/blueprint/connectome/grammar';
import { deriveSmokeEgress } from '@/blueprint/connectome/smoke';
import type { ExpandCtx } from '@/blueprint/connectome/types';

let registry: CatalogueRegistry;
const ctx = (over: Partial<ExpandCtx> = {}): ExpandCtx => ({ era: 'medieval', seed: 1, registry, ...over });

beforeAll(() => {
  registry = new CatalogueRegistry();
  loadPack(medievalEuropePack, registry);
});

function egressOf(buildingType: string, c: Partial<ExpandCtx>) {
  const con = deriveSmokeEgress(expand(buildingType, ctx(c)), ctx(c));
  return con.fixtures.find((f) => f.satisfies?.includes('smoke-egress'));
}

describe('hearth → smoke-egress derivation', () => {
  it('early/poor cottage → a louver or smoke-hole, NEVER a chimney', () => {
    const e = egressOf('cottage', { era: 'medieval', wealth: 'poor' });
    expect(e).toBeDefined();
    expect(['louver', 'smoke-hole']).toContain(e!.type);
    expect(e!.type).not.toBe('wall-chimney');
  });

  it('the egress fixture sits in the hearth zone', () => {
    const con = deriveSmokeEgress(expand('cottage', ctx()), ctx());
    const hearth = con.fixtures.find((f) => f.requires?.includes('smoke-egress'))!;
    const egress = con.fixtures.find((f) => f.satisfies?.includes('smoke-egress'))!;
    expect(egress.zoneId).toBe(hearth.zoneId);
  });

  it('late + rich → a wall-chimney (the upgrade path)', () => {
    const e = egressOf('cottage', { era: 'current', wealth: 'rich' });
    expect(e!.type).toBe('wall-chimney');
  });

  it('a hearthless building (barn) gets no egress fixture', () => {
    const con = deriveSmokeEgress(expand('farm_barn', ctx()), ctx());
    expect(con.fixtures.find((f) => f.satisfies?.includes('smoke-egress'))).toBeUndefined();
  });

  it('keep (vertical-stack stone) may take a wall-chimney even in medieval', () => {
    const e = egressOf('castle_keep', { era: 'medieval', wealth: 'modest' });
    expect(e!.type).toBe('wall-chimney');
  });

  it('is deterministic', () => {
    const a = JSON.stringify(deriveSmokeEgress(expand('cottage', ctx()), ctx()));
    const b = JSON.stringify(deriveSmokeEgress(expand('cottage', ctx()), ctx()));
    expect(a).toBe(b);
  });
});
