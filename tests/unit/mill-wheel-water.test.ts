// Believability round WP-1 — "the waterwheel is not in the river, and far too high above it".
//
// The rules under test, in the order the pipeline applies them:
//   1. `getMillSites` only tags a bank whose wheel cell is PAINTED water and whose own cell is
//      not, with a gap a wheel can reach.
//   2. `millWheelSubmerge` turns that gap into a per-site wheel depth, in prim-z units, via the
//      sprite↔terrain vertical reconciliation (`metresPerPrimZ`) — the easiest thing here to
//      get silently wrong, so it is pinned against first principles rather than a magic number.
//   3. The `mill.wheel-reaches-water` contract catches a mill that fails either half.
//   4. `watermill` no longer takes the vendored library's bare-preset fallback, without which
//      1–3 would be invisible in game (the shipped v31 sprite is painted for one fixed depth).
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Entity, GameMap } from '@/core/types';
import { createDefaultWorldSeed } from '@/core/schema';
import { worldStyleOf } from '@/core/world-style';
import { heightField } from '@/render/gpu/terrain-field';
import { ISO_TILE_W } from '@/render/scale-contract';
import {
  getMillSites, millWheelGapM, millWheelSubmerge, millWheelSubmergeForFootprint,
  millWaterDrawnAt, metresPerPrimZ, MAX_GAP_M, type MillFace,
} from '@/world/mill-site-store';
import { millWheelReachesWater } from '@/world/connectome/site-contracts';
import type { DiagnosticContext } from '@/world/connectome-diagnostics';
import { GeneratedBuildingArtSource } from '@/render/generated-building-art-source';

// A real generated world (the `water-surface-at.test.ts` fixture pattern): the rule under test
// is a relationship between the hydrology model, the curved bed and the painted water plane, so
// a hand-rolled grid would only be testing the fixture. Seed chosen for having rivers.
function world(seed = 4242): GameMap {
  const worldSeed = { ...createDefaultWorldSeed('mill-probe'), seed };
  return { width: 96, height: 96, tiles: [], worldSeed } as unknown as GameMap;
}

const FACE_VEC: Record<MillFace, [number, number]> = {
  north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0],
};

describe('metresPerPrimZ — the sprite↔terrain vertical reconciliation', () => {
  it('is (ISO_TILE_W/2) screen px per prim-z divided by the style\'s px per terrain metre', () => {
    const map = world();
    const zPxPerM = worldStyleOf(map.worldSeed).terrainVerticalExaggeration;
    expect(metresPerPrimZ(map)).toBeCloseTo((ISO_TILE_W / 2) / zPxPerM, 10);
  });

  it('is NOT the sprite metre (PX_PER_METRE) — the whole point of the constant', () => {
    // If someone "simplifies" this to METRES_PER_TILE the wheel depth is wrong by ~1.5×.
    const map = world();
    expect(metresPerPrimZ(map)).not.toBeCloseTo(2, 3);
  });
});

describe('getMillSites — every tagged site is millable', () => {
  const map = world();
  const sites = getMillSites(map);

  it('finds sites on a world with rivers', () => {
    expect(sites.length).toBeGreaterThan(0);
  });

  it('hangs the wheel over PAINTED water and stands the mill on dry ground', () => {
    for (const s of sites) {
      const [dx, dy] = FACE_VEC[s.waterFace];
      expect(millWaterDrawnAt(map, s.x + dx, s.y + dy)).toBe(true);   // wheel cell is blue
      expect(millWaterDrawnAt(map, s.x, s.y)).toBe(false);            // the mill is not
    }
  });

  it('never tags a bank the wheel cannot reach down to', () => {
    for (const s of sites) expect(s.gapM).toBeLessThanOrEqual(MAX_GAP_M);
  });

  it('stores the gap the gap function reports for that bank+flank', () => {
    const hf = heightField(map);
    const relief = worldStyleOf(map.worldSeed).mountainRelief;
    for (const s of sites.slice(0, 40)) {
      expect(millWheelGapM(map, s.x, s.y, s.waterFace, hf, relief)).toBeCloseTo(s.gapM, 6);
    }
  });

  it('is memoised: the same map returns the identical array', () => {
    expect(getMillSites(map)).toBe(sites);
  });
});

describe('millWheelGapM', () => {
  it('refuses a flank with no painted water beyond it', () => {
    const map = world();
    // A cell with no water painted on any of its orthogonal neighbours has no millable flank.
    let found = false;
    for (let y = 2; y < map.height - 2 && !found; y++) {
      for (let x = 2; x < map.width - 2 && !found; x++) {
        if (millWaterDrawnAt(map, x, y)) continue;
        const faces: MillFace[] = ['north', 'south', 'east', 'west'];
        if (faces.some((f) => millWaterDrawnAt(map, x + FACE_VEC[f][0], y + FACE_VEC[f][1]))) continue;
        found = true;
        for (const f of faces) expect(millWheelGapM(map, x, y, f)).toBeNull();
      }
    }
    expect(found).toBe(true);
  });

  it('reads out of bounds as "no water", never throws', () => {
    const map = world();
    expect(millWheelGapM(map, 0, 0, 'north')).toBeNull();
    expect(millWheelGapM(map, map.width - 1, map.height - 1, 'south')).toBeNull();
  });
});

describe('millWheelSubmerge — the per-site wheel depth', () => {
  const map = world();
  const sites = getMillSites(map);

  it('quantizes to clean 0.05 steps inside the part schema\'s bounds', () => {
    for (const s of sites.slice(0, 60)) {
      const q = millWheelSubmerge(map, s.x, s.y, s.waterFace);
      expect(q).not.toBeNull();
      expect(q!).toBeGreaterThanOrEqual(0);
      expect(q!).toBeLessThanOrEqual(1.5);
      // Exactly representable multiples of 0.05 — float drift here would fork the
      // content-addressed sprite cache into a variant per mill.
      expect(Math.round(q! * 100) % 5).toBe(0);
      expect(q).toBe(Number(q!.toFixed(2)));
    }
  });

  it('is deterministic — the same site always yields the same depth', () => {
    for (const s of sites.slice(0, 20)) {
      expect(millWheelSubmerge(map, s.x, s.y, s.waterFace))
        .toBe(millWheelSubmerge(map, s.x, s.y, s.waterFace));
    }
  });

  it('sinks the wheel PAST the water, never short of it', () => {
    const mpz = metresPerPrimZ(map);
    for (const s of sites.slice(0, 60)) {
      const q = millWheelSubmerge(map, s.x, s.y, s.waterFace)!;
      expect(q * mpz).toBeGreaterThan(s.gapM);   // the lower arc clears the fill line
    }
  });

  it('goes DEEPER on a higher bank — the whole reason it is per-site', () => {
    const mpz = metresPerPrimZ(map);
    const byGap = [...sites].sort((a, b) => a.gapM - b.gapM);
    const low = byGap[0], high = byGap[byGap.length - 1];
    if (high.gapM - low.gapM < mpz * 0.05) return;   // this world has no spread to test
    expect(millWheelSubmerge(map, high.x, high.y, high.waterFace)!)
      .toBeGreaterThan(millWheelSubmerge(map, low.x, low.y, low.waterFace)!);
  });

  it('measures from the footprint cell the wheel hangs off, not the origin', () => {
    // For a 2×2 seated with its EAST flank on the water, the bank cell is (ox+1, oy+1) —
    // reading the origin instead would measure a cell that is not under the wheel.
    const s = sites.find((q) => q.waterFace === 'east');
    if (!s) return;
    const ox = s.x - 1, oy = s.y - 1;
    expect(millWheelSubmergeForFootprint(map, ox, oy, 2, 2, 'east'))
      .toBe(millWheelSubmerge(map, s.x, s.y, 'east'));
  });
});

// ── the contract ───────────────────────────────────────────────────────────────────────────

/** A placed civic mill entity, as `building-placer` stamps one. */
function millEntity(
  x: number, y: number, face: MillFace, submerge: number, fp = { w: 2, h: 2 },
  id = 'poi_civic_mill',
): Entity {
  return {
    id, kind: 'watermill', x, y,
    properties: {
      civic: 'mill',
      waterFace: face,
      footprint: fp,
      blueprint: {
        rb: { preset: 'watermill', footprint: { w: 2, h: 2 }, parts: [
          { id: 'wheel', type: 'waterwheel', params: { submerge } },
        ] },
      },
    },
  } as unknown as Entity;
}

function ctxWith(map: GameMap, entities: Entity[]): DiagnosticContext {
  return { map, world: { query: () => entities } } as unknown as DiagnosticContext;
}

describe('mill.wheel-reaches-water contract', () => {
  const map = world();
  const sites = getMillSites(map);

  it('is silent on a mill seated and sunk the way the placer does it', () => {
    const s = sites[0];
    // Seat a 2×2 whose `waterFace` flank sits on the tagged bank cell.
    const [dx, dy] = FACE_VEC[s.waterFace];
    const ox = s.x - (dx > 0 ? 1 : 0), oy = s.y - (dy > 0 ? 1 : 0);
    const q = millWheelSubmergeForFootprint(map, ox, oy, 2, 2, s.waterFace)!;
    const found = millWheelReachesWater.evaluate(ctxWith(map, [millEntity(ox, oy, s.waterFace, q)]), {});
    expect(found).toEqual([]);
  });

  it('flags a mill whose wheel hangs over dry ground', () => {
    // Turn a good site's mill to face AWAY from the water: the wheel now spins over the bank.
    // 1×1 so the bank cell IS the tagged cell and the wheel cell is its opposite neighbour.
    const s = sites.find((q) => {
      const away: Record<MillFace, MillFace> = { north: 'south', south: 'north', east: 'west', west: 'east' };
      const [dx, dy] = FACE_VEC[away[q.waterFace]];
      return !millWaterDrawnAt(map, q.x + dx, q.y + dy);
    });
    expect(s).toBeDefined();
    const away: Record<MillFace, MillFace> = { north: 'south', south: 'north', east: 'west', west: 'east' };
    const face = away[s!.waterFace];
    const found = millWheelReachesWater.evaluate(
      ctxWith(map, [millEntity(s!.x, s!.y, face, 0.4, { w: 1, h: 1 })]), {});
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('no DRAWN water');
    expect(found[0].locus.entities).toEqual(['poi_civic_mill']);
  });

  it('flags a mill over real water whose wheel stops short of it', () => {
    // A site with a real gap, given the OLD behaviour: submerge 0 (wheel bottom at the foot).
    const s = [...sites].sort((a, b) => b.gapM - a.gapM)[0];
    if (s.gapM <= 0.4) return;   // this world's banks are all flush; nothing to under-reach
    const [dx, dy] = FACE_VEC[s.waterFace];
    const ox = s.x - (dx > 0 ? 1 : 0), oy = s.y - (dy > 0 ? 1 : 0);
    const found = millWheelReachesWater.evaluate(ctxWith(map, [millEntity(ox, oy, s.waterFace, 0)]), {});
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('short by');
    expect(found[0].metrics!.shortfallM).toBeGreaterThan(0);
  });

  it('says nothing about a legacy mill with no declared water face', () => {
    const e = millEntity(sites[0].x, sites[0].y, 'north', 0.38, { w: 1, h: 1 });
    delete (e.properties as Record<string, unknown>).waterFace;
    expect(millWheelReachesWater.evaluate(ctxWith(map, [e]), {})).toEqual([]);
  });

  it('ignores non-mill entities entirely', () => {
    const e = millEntity(sites[0].x, sites[0].y, 'north', 0, { w: 1, h: 1 });
    (e.properties as Record<string, unknown>).civic = 'well';
    expect(millWheelReachesWater.evaluate(ctxWith(map, [e]), {})).toEqual([]);
  });

  it('registers itself where evaluateContracts will actually run it', async () => {
    const { contractRegistry } = await import('@/world/connectome-contracts');
    const c = contractRegistry()['mill.wheel-reaches-water'];
    expect(c).toBeDefined();
    // `evaluateContracts` runs undeclared contracts only at world level + invariant kind; a
    // 'site'/'requirement' registration would silently never execute (see the module header).
    expect(c.level).toBe('world');
    expect(c.kind).toBe('invariant');
  });
});

// ── the vendored-library denylist ──────────────────────────────────────────────────────────

describe('watermill is excluded from the bare-preset art fallback', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  /** Manifest with one seeded row per preset; every key is a bare-preset seed key, so an
   *  in-world variant can only match via the preset-name fallback. */
  function stubFetch(): void {
    globalThis.fetch = vi.fn(async (url: unknown) => {
      if (String(url).endsWith('manifest.json')) {
        return {
          ok: true,
          json: async () => ({ entries: {
            'v0:cottage': { file: 'cottage.png', targetWidth: 64, preset: 'cottage' },
            'v0:watermill': { file: 'watermill.png', targetWidth: 64, preset: 'watermill' },
          } }),
        } as unknown as Response;
      }
      return { ok: true, blob: async () => new Blob([new Uint8Array([1])]) } as unknown as Response;
    }) as unknown as typeof fetch;
  }

  function source() {
    return new GeneratedBuildingArtSource({
      // Paid generation OFF, so the ONLY way a sprite resolves is the vendored library.
      enabled: () => false, canSpend: () => false, model: () => 'm',
      generate: async () => new Blob(),
      cacheGet: async () => null,
      cacheFailed: async () => false,
      decodeImage: async () => ({ data: new Uint8ClampedArray(4), w: 1, h: 1 }),
      rasterToSprite: () => ({} as unknown as HTMLCanvasElement),
    });
  }

  /** An in-world variant: its exact key never matches the bare-preset seed key. */
  function variant(preset: string): Entity {
    return { id: `e_${preset}`, kind: preset, x: 0, y: 0, properties: { blueprint: { rb: {
      preset, footprint: { w: 2, h: 2 }, parts: [{ id: 'p', type: 'body', params: { variantSalt: 7 } }],
    } } } } as unknown as Entity;
  }

  it('still serves OTHER presets from the fallback (the denylist is not a blanket off-switch)', async () => {
    stubFetch();
    const src = source();
    const e = variant('cottage');
    src.warm(e);
    await vi.waitFor(() => expect(src.pending()).toBe(0));
    expect(src.peek(e)).not.toBeNull();
    expect(src.peekMeta(e)?.resolved).toBe('preset-fallback');
  });

  it('refuses the fallback for watermill, so the per-site wheel renders parametrically', async () => {
    stubFetch();
    const src = source();
    const e = variant('watermill');
    src.warm(e);
    await vi.waitFor(() => expect(src.pending()).toBe(0));
    // Null ⇒ `pickBuildingSource` falls through to the parametric source, which recomposes
    // from the PATCHED blueprint. A non-null here would be the stale v31 painted sprite.
    expect(src.peek(e)).toBeNull();
  });
});
