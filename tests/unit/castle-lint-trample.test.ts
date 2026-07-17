// M4 S5 — roads/lint/trample for a runtime castle (spike §4 S5, §7 Decision 2).
//
// No runtime road-topology path exists (roadGraph is immutable post-gen by
// design), so a castle ring's gate can never satisfy `gate.road-connected`:
// runtime complex rings (`ownerPoiId`-tagged) are EXEMPT from the ring contract
// declarations, with the note on `settlementRingContracts`. Fate's world-quality
// digest (evaluateContracts on every wake) must stay clean after a foundation.
//
// Organic access is the desire-line story: castle traffic deposits trample wear
// that promotes to real dirt trails — proven here beside a founded castle, with
// the road graph untouched (spike §1.7: trample needs no roadGraph mutation).
import { describe, it, expect } from 'vitest';
import { generateWithNoise } from '@/map/map-generator';
import { foundCastle, chooseCastleSite } from '@/world/found-castle';
import { createState } from '@/core/state';
import { evaluateContracts } from '@/world/connectome-contracts';
import { settlementRingContracts } from '@/world/connectome/wall-contracts';
import { defenseRingContracts } from '@/world/connectome/defense-contracts';
import { describeWorldQualityForFate } from '@/game/fate/fate-context';
import { TrampleGrid, TRAMPLE, isTrampleEligible } from '@/sim/trample';
import { heightMetresAt } from '@/world/heightfield';
import type { GameMap, WorldSeed } from '@/core/types';

function makeWs(size: number): WorldSeed {
  return {
    name: 'm4-s5', size: { width: size, height: size }, biome: 'temperate',
    pois: [], connections: [], constraints: [],
  } as unknown as WorldSeed;
}

/** A generated world; `size` 96 fits the verb's candidate lattice (margin =
 *  outer ring + 2 ⇒ a 64² map cannot hold a site ≥26 tiles from its centre). */
async function makeFoundedWorld(size = 64) {
  const ws = makeWs(size);
  const { map, world } = await generateWithNoise(size, size, 7, ws);
  const state = createState();
  state.map = map;
  state.world = world;
  state.worldSeed = ws;

  const c = size / 2;
  let centre = { x: c, y: c }, lowest = Infinity;
  for (let y = 12; y < size - 12; y++) for (let x = 12; x < size - 12; x++) {
    const h = heightMetresAt(map, x, y);
    if (h < lowest) { lowest = h; centre = { x, y }; }
  }
  return { state, map, world, ws, centre };
}

describe('runtime castle vs the lint contracts (M4 S5)', () => {
  it('founding a castle (verb-path siting) adds no lint errors and no castle-scoped ring declarations', async () => {
    const { state, map, world } = await makeFoundedWorld(96);
    const before = evaluateContracts({ world, map });

    // The HONEST siting path — chooseCastleSite's dry-land lattice (the verb's
    // seam). A hand-placed water site WOULD lint (barrier.over-water etc.); the
    // game path never commits one.
    const site = chooseCastleSite(map, { x: 48, y: 48 }, { seed: 5 });
    expect(site).toBeTruthy();
    const res = foundCastle(world, map, state, {
      centre: site!, seed: 7, era: 'medieval', cause: 'lord:test',
    })!;
    expect(res).toBeTruthy();
    const ringIds = (map.barrierRuns ?? []).filter(b => b.ownerPoiId === res.poiId).map(b => b.id);
    expect(ringIds.length).toBe(2);

    const after = evaluateContracts({ world, map });
    // Fate's world-quality digest stays clean: no NEW errors, and no diagnostic
    // of any severity names a castle ring under the road-connectivity contracts.
    expect(after.counts.error).toBe(before.counts.error);
    const castleRoadDiags = after.diagnostics.filter(d =>
      (d.rule === 'gate.road-connected' || d.rule === 'wall.crossing-only-at-gate') &&
      d.locus.entities?.some(id => ringIds.includes(id)));
    expect(castleRoadDiags).toHaveLength(0);

    // §7 Decision 2 made explicit: the ring-declaration builders skip owned
    // (runtime complex) rings, so a future re-declaration pass over a live map
    // can never volunteer the castle for gate.road-connected.
    const decls = [
      ...settlementRingContracts(map.barrierRuns ?? []),
      ...defenseRingContracts(map.barrierRuns ?? []),
    ];
    expect(decls.filter(d => d.scope.entities?.some(id => ringIds.includes(id)))).toHaveLength(0);

    // The Fate prompt digest carries no castle ring complaint either.
    const digest = describeWorldQualityForFate(state);
    for (const id of ringIds) expect(digest).not.toContain(id);
  });

  it('castle traffic deposits desire-line trails — soft ground promotes to dirt, roadGraph untouched', async () => {
    const { state, map, world, centre } = await makeFoundedWorld();
    const res = foundCastle(world, map, state, {
      centre, seed: 7, era: 'medieval', cause: 'lord:test',
    })!;
    expect(res).toBeTruthy();
    const revBefore = map.roadGraph?.rev ?? 0;
    const tilesRevBefore = map.tilesRev ?? 0;

    // A trample-eligible approach tile just outside the outer ring (radius 20):
    // scan outward from the gate side (due south, +y) for soft ground.
    let spot: { x: number; y: number } | null = null;
    outer: for (let dy = 21; dy < 30 && !spot; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        const x = centre.x + dx, y = centre.y + dy;
        if (isTrampleEligible(map.tiles[y]?.[x])) { spot = { x, y }; break outer; }
      }
    }
    expect(spot).toBeTruthy();                    // the approach has walkable soft ground

    // Garrison footfall: enough throttled passes to cross PROMOTE_HI.
    const grid = new TrampleGrid(map.width, map.height);
    const passes = Math.ceil(TRAMPLE.PROMOTE_HI / TRAMPLE.DEPOSIT_AMOUNT);
    for (let i = 0; i < passes; i++) grid.depositWithSpill(map, spot!.x, spot!.y);
    expect(grid.wearAt(spot!.x, spot!.y)).toBeGreaterThanOrEqual(TRAMPLE.PROMOTE_HI);

    grid.promoteDecay(map);
    expect(map.tiles[spot!.y][spot!.x].type).toBe('dirt');       // a real trail
    expect(map.tilesRev ?? 0).toBeGreaterThan(tilesRevBefore);   // repaint rides tilesRev
    expect(map.roadGraph?.rev ?? 0).toBe(revBefore);             // NO road-graph mutation
  });
});
