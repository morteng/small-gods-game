import { describe, it, expect, beforeEach } from 'vitest';
import { generateWithNoise, snapDrySettlementsOffWater } from '@/map/map-generator';
import { getHydrologyResult, clearHydrologyCache } from '@/world/hydrology-store';
import { getHeightfield, clearHeightfieldCache } from '@/world/heightfield';
import { styledIslandSpec } from '@/terrain/island-mask';
import { styledShapeSpec } from '@/terrain/terrain-shape';
import type { GameMap, POI, WorldSeed } from '@/core/types';

// WCV 123 — ONE HYDROLOGY PER WORLD. The permanent guard against the "bridge beside
// the river" class of bug.
//
// Worldgen used to build the world from TWO different elevation fields:
//
//   1. `applyPoiInfluences` stamps the POI plateaus/caps at their LAYOUT positions,
//      and the whole TILE world derives from that field — biomes, hydrology, the
//      lake/river tile stamps, the widened river raster, settlement siting, roads.
//   2. `snapDrySettlementsOffWater` then MOVES a settlement that ended up standing in
//      a lake, mutating `poi.position` in place (up to 24 rings).
//   3. Every later derivation — the drawn water ribbon, the continuous water distance,
//      the `renderWaterAt` predicate the bridge-crossing detector seats abutments with
//      — rebuilds elevation through `getHeightfield` from `worldSeed.pois`, i.e. from
//      the SNAPPED positions.
//
// The mechanism is circular: snapping a settlement out of a lake moves its elevation
// cap, which moves the lake. Roads were therefore routed around water the drawn world
// had deleted, and abutments were seated inside lakes that grew over ground the walker
// had crossed dry (1,656 waterType cells diverged on default/777). No bridge-SEATING
// heuristic can fix that — three rounds of them tried — because the two deciders were
// looking at different worlds.
//
// `POI.heightAnchor` freezes the position the terrain was built from, and both
// elevation readers (`applyPoiInfluences`, `poiHeightSignature`) prefer it, so the
// post-gen field IS the in-gen field — the contract `computeHeightfield` documents in
// its own body ("Mirror map-generator EXACTLY … so this field equals the one biomes
// were classified from") but could not keep.
//
// Every parity assertion below is paired with a NON-VACUITY assertion on the same
// world with the anchors stripped: this world genuinely reproduces the bug (267
// elevation cells / 4 waterType cells diverge without the anchor), so the guard cannot
// quietly stop testing anything if a terrain tweak later moves the numbers.

const W = 64, H = 64;
// A mountain to the north whose flank is the only dry ground near a ponded basin, a
// settlement authored in the middle of that basin, and a gen seed where it actually
// snaps (asserted). The settlement types all carry a lower-only elevation `cap`, so
// the snap only moves the field when the DESTINATION is high ground — the mountain
// flank is what makes this world a faithful miniature of the shipped defect.
const SEED = 6;

function snapWorldSeed(villePos = { x: 32, y: 38 }): WorldSeed {
  return {
    name: 'snap-parity', size: { width: W, height: H }, biome: 'temperate',
    pois: [
      { id: 'mtn',   type: 'mountain', name: 'Crag',  position: { x: 32, y: 22 }, size: 'large' },
      { id: 'basin', type: 'lake',     name: 'Basin', position: { x: 32, y: 38 }, size: 'large' },
      { id: 'ville', type: 'city',     name: 'Ville', position: villePos,         size: 'huge'  },
    ],
    connections: [], constraints: [],
  } as unknown as WorldSeed;
}

/** The same map re-keyed onto a different POI array — same seed/dims/dams, so the
 *  stores reproduce their derivation from a different set of POI positions. */
function mapWithPois(map: GameMap, pois: POI[]): GameMap {
  return { ...map, worldSeed: { ...map.worldSeed!, pois } };
}

/** The live POIs with their anchors removed — i.e. exactly the pre-fix behaviour. */
function withoutAnchors(map: GameMap): POI[] {
  return structuredClone(map.worldSeed!.pois!).map((p) => { delete p.heightAnchor; return p; });
}

/** The elevation field a post-gen consumer (renderer, hydrology store, crossing
 *  seater) reads — the exact `getHeightfield` call `hydrology-store` makes. */
function elevationOf(map: GameMap): Float32Array {
  clearHeightfieldCache();
  return new Float32Array(getHeightfield(
    map.seed, map.width, map.height,
    styledIslandSpec(map.worldSeed), map.worldSeed?.pois ?? null, styledShapeSpec(map.worldSeed),
  ));
}

function waterTypeOf(map: GameMap): Uint8Array {
  clearHydrologyCache();
  clearHeightfieldCache();
  return new Uint8Array(getHydrologyResult(map).waterType);
}

function countDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

describe('hydrology snap parity (WCV 123) — one hydrology per world', () => {
  beforeEach(() => {
    clearHydrologyCache();
    clearHeightfieldCache();
  });

  it('post-gen elevation and hydrology equal the generator\'s own, on a world where a settlement snapped', async () => {
    const worldSeed = snapWorldSeed();
    // The LAYOUT positions — what the in-gen `applyPoiInfluences` stamped from, and
    // therefore what the biomes / rivers / tiles / roads of this world were derived
    // from. Captured before `generateWithNoise` mutates them.
    const layoutPois: POI[] = structuredClone(worldSeed.pois!);

    const { map } = await generateWithNoise(W, H, SEED, worldSeed);

    // The world must actually exercise the snap, or the parity below is trivially true.
    const ville = map.worldSeed!.pois!.find((p) => p.id === 'ville')!;
    expect(ville.heightAnchor).toEqual({ x: 32, y: 38 });
    expect(ville.position).not.toEqual(ville.heightAnchor);

    const inGenElev = elevationOf(mapWithPois(map, layoutPois));
    const inGenWater = waterTypeOf(mapWithPois(map, layoutPois));

    // ONE world: what the renderer/seater rebuild is what the generator classified from.
    expect(countDiff(inGenElev, elevationOf(map))).toBe(0);
    expect(countDiff(inGenWater, waterTypeOf(map))).toBe(0);

    // NON-VACUITY: the same world without the anchors is the shipped bug.
    const preFix = mapWithPois(map, withoutAnchors(map));
    expect(countDiff(inGenElev, elevationOf(preFix))).toBeGreaterThan(0);
    expect(countDiff(inGenWater, waterTypeOf(preFix))).toBeGreaterThan(0);
  }, 30000);

  it('a POI that never snapped carries no anchor, so an unsnapped world is bit-identical', async () => {
    // The same authored world with the settlement well clear of the basin: nothing
    // moves, no anchor is minted, and both readers fall through to `position`.
    const worldSeed = snapWorldSeed({ x: 8, y: 8 });
    const layoutPois: POI[] = structuredClone(worldSeed.pois!);

    const { map } = await generateWithNoise(W, H, SEED, worldSeed);

    for (const p of map.worldSeed!.pois!) {
      expect(p.heightAnchor).toBeUndefined();
      expect(p.position).toEqual(layoutPois.find((q) => q.id === p.id)!.position);
    }
    expect(countDiff(elevationOf(mapWithPois(map, layoutPois)), elevationOf(map))).toBe(0);
    expect(countDiff(waterTypeOf(mapWithPois(map, layoutPois)), waterTypeOf(map))).toBe(0);
  }, 30000);

  it('the anchor freezes the FIRST position the terrain was built from, not an intermediate one', async () => {
    // `??=`: were a POI ever to be snapped twice, the field was still only ever
    // stamped from the layout position, so that is what must survive.
    const worldSeed = snapWorldSeed();
    const { map } = await generateWithNoise(W, H, SEED, worldSeed);
    const ville = map.worldSeed!.pois!.find((p) => p.id === 'ville')!;

    snapDrySettlementsOffWater(
      map.worldSeed!.pois!, W, H, getHydrologyResult(map).waterType, map.tiles);
    expect(ville.heightAnchor).toEqual({ x: 32, y: 38 });
  }, 30000);
});
