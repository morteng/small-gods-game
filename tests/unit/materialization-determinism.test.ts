/**
 * P2 MaterializationSystem — DETERMINISM. Same cohorts + focus sequence ⇒
 * identical entity ids, placement, beliefs, and drawCount across two runs; a
 * snapshot → hydrate → continue re-adopts the extras from materializedTemp and
 * reproduces; drawCount advances monotonically and mints fresh ids after a fold.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadDefaultPacks } from '@/catalogue';
import { createRng } from '@/core/rng';
import { cohortPopulation } from '@/sim/cohorts';
import { queryNpcs, npcProps } from '@/world/npc-helpers';
import { MaterializationSystem } from '@/sim/systems/materialization-system';
import { makeHarness } from './materialization-harness';

beforeAll(() => loadDefaultPacks());

function fingerprint(world: ReturnType<typeof makeHarness>['world']) {
  return queryNpcs(world)
    .filter(e => npcProps(e).materializedTemp === true)
    .map(e => ({ id: e.id, x: e.x, y: e.y, faith: npcProps(e).beliefs['player']?.faith ?? 0, role: npcProps(e).role }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

describe('MaterializationSystem determinism', () => {
  it('two runs yield identical ids, placement, beliefs and drawCount', () => {
    const a = makeHarness({ cottages: 8, souls: 30 });
    const b = makeHarness({ cottages: 8, souls: 30 });
    a.materializeFully('village');
    b.materializeFully('village');
    expect(fingerprint(a.world)).toEqual(fingerprint(b.world));
    expect(a.cohorts.get('village')!.drawCount).toBe(b.cohorts.get('village')!.drawCount);
    // Ids follow the monotonic drawCount anchor.
    expect(fingerprint(a.world)[0].id).toMatch(/^village-mat-\d+$/);
  });

  it('snapshot → hydrate → continue re-adopts and reproduces', () => {
    const h = makeHarness({ cottages: 8, souls: 30 });
    h.materializeFully('village');
    const liveBefore = h.liveCount('village');
    const drawCountAtSnap = h.cohorts.get('village')!.drawCount;
    const snapState = h.sys.serialize();

    // A fresh system over the SAME restored world + cohorts (rebuild-on-load).
    const sys2 = new MaterializationSystem(() => h.cohorts, () => h.map, () => ({ poiId: 'village', band: 'settlement' as const }));
    sys2.hydrate(snapState);
    sys2.tick({ world: h.world, spirits: new Map(), log: h.log, clock: h.clock, rng: createRng(1), dt: 250, now: h.now + 50 });

    // live set rebuilt from the world's materializedTemp entities.
    let live2 = 0;
    for (const r of sys2.liveRefs().values()) if (r.poiId === 'village') live2++;
    expect(live2).toBe(liveBefore);
    // Continuing on the restored world neither re-draws nor loses souls.
    expect(h.cohorts.get('village')!.drawCount).toBe(drawCountAtSnap);
    expect(cohortPopulation(h.cohorts.get('village')!) + live2).toBe(30);
  });

  it('drawCount never decreases and mints fresh ids after a fold', () => {
    const h = makeHarness({ cottages: 8, souls: 30 });
    h.materializeFully('village');
    const firstIds = new Set(fingerprint(h.world).map(f => f.id));
    const dcAfterFirst = h.cohorts.get('village')!.drawCount;

    h.foldFully();
    expect(h.cohorts.get('village')!.drawCount).toBe(dcAfterFirst); // fold never bumps

    h.materializeFully('village');
    const secondIds = fingerprint(h.world).map(f => f.id);
    // Second wave draws AFTER the first → strictly higher indices, no collisions.
    expect(h.cohorts.get('village')!.drawCount).toBeGreaterThan(dcAfterFirst);
    expect(secondIds.some(id => firstIds.has(id))).toBe(false);
  });
});
