// tests/unit/anchor-query.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { mountAnchorsOf, queryMountAnchors } from '@/world/anchor-query';
import { blueprintEntity } from '@/blueprint/entity';
import { resolveBlueprint } from '@/blueprint/resolve';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { BLUEPRINT_VERSION, type Blueprint } from '@/blueprint/types';
import type { Entity } from '@/core/types';

beforeAll(() => ensureBuildingTypesRegistered());

const cottage: Blueprint = {
  version: BLUEPRINT_VERSION, class: 'building', footprint: { w: 4, h: 4 },
  materials: { walls: 'wattle', roof: 'thatch' },
  parts: { body: { type: 'body', size: { w: 4, h: 2 }, params: { plan: 'rect', levels: 1, roof: 'gable' },
    features: {
      door: { type: 'door', face: 'south', params: { main: true } },
      smoke: { type: 'vent', params: { kind: 'chimney', t: 0.5 } },
    } } },
};

function placedCottage(x = 12, y = 30): Entity {
  return blueprintEntity('cottage#1', resolveBlueprint([cottage], 0), x, y);
}

describe('queryMountAnchors / mountAnchorsOf', () => {
  it('reads a placed building’s mount sockets, owner + id stamped', () => {
    const all = mountAnchorsOf(placedCottage());
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(a => a.ownerId === 'cottage#1')).toBe(true);
    expect(all.every(a => typeof a.id === 'string')).toBe(true);
    // ids are unique + stable (full-set index)
    expect(new Set(all.map(a => a.id)).size).toBe(all.length);
  });

  it('finds every perch — the bird-landing query', () => {
    const perches = queryMountAnchors(placedCottage(), { accepts: 'perch' });
    expect(perches.length).toBeGreaterThan(0);
    expect(perches.every(a => a.accepts?.includes('perch'))).toBe(true);
    // ridge + 2 gables + chimney all perchable
    expect(perches.map(a => a.kind).sort()).toContain('roof_ridge');
  });

  it('filters by socket role', () => {
    const lintels = queryMountAnchors(placedCottage(), { role: 'lintel' });
    expect(lintels).toHaveLength(1);
    expect(lintels[0].accepts).toEqual(['sign', 'lamp']);
    const peaks = queryMountAnchors(placedCottage(), { role: ['gable_peak', 'roof_ridge'] });
    expect(peaks.every(a => a.kind === 'gable_peak' || a.kind === 'roof_ridge')).toBe(true);
  });

  it('keeps socket ids stable across different queries', () => {
    const e = placedCottage();
    const fromAll = mountAnchorsOf(e).find(a => a.kind === 'lintel')!;
    const fromQuery = queryMountAnchors(e, { role: 'lintel' })[0];
    expect(fromQuery.id).toBe(fromAll.id);
  });

  it('reflects the placement origin (anchors move with the building)', () => {
    const a = mountAnchorsOf(placedCottage(0, 0));
    const b = mountAnchorsOf(placedCottage(100, 0));
    const la = a.find(x => x.kind === 'lintel')!, lb = b.find(x => x.kind === 'lintel')!;
    expect(lb.x - la.x).toBe(100);
  });

  it('returns [] for an entity with no blueprint', () => {
    const bare = { id: 'rock', kind: 'boulder', x: 1, y: 1, tags: [], properties: {} } as unknown as Entity;
    expect(mountAnchorsOf(bare)).toEqual([]);
    expect(queryMountAnchors(bare, { accepts: 'perch' })).toEqual([]);
  });
});
