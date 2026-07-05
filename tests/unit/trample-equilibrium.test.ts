// tests/unit/trample-equilibrium.test.ts — desire-line visibility tuning, MEASURED (synthesis 2.5)
//
// A deterministic settlement-traffic simulation over the REAL systems (A* with trail coupling,
// TrampleDepositSystem cadence, promote/decay hysteresis): commuters walk home↔market legs at
// 1 tile/tick, the deposit pass samples positions every 20 ticks (the live 3 Hz : 0.25 Hz ratio
// = 12 deposit passes per decay pass), and one decay pass closes each "sim-day". The suite
// measures the promoted-cell EQUILIBRIUM this produces and pins the round-8 tuning:
//
//   • legacy constants (deposit 12, no spill)  → a faint handful of promoted cells ("too subtle",
//     the round-5 live observation: ~a dozen cells for a whole settlement);
//   • round-8 constants (deposit 24 + ×0.2 8-neighbour spill) → the settlement's main desire
//     lines visibly present at steady state (target band ~40–120 promoted cells), trunk routes
//     widened to 2–3 tiles by spill, side paths still single-file, hysteresis intact.
import { describe, it, expect } from 'vitest';
import { TrampleGrid, TRAMPLE } from '@/sim/trample';
import { TrampleDepositSystem } from '@/sim/systems/trample-system';
import { findPath } from '@/sim/pathfinding';
import { World } from '@/world/world';
import type { SystemContext } from '@/core/scheduler';
import type { GameMap, Tile } from '@/core/types';

const W = 64, H = 64;
const MARKET = { x: 32, y: 32 };
/** Trunk: one busy corridor east of the market (a hamlet-worth of commuters on one lane).
 *  Side: a quiet home due north — enough traffic to hold a trail, not enough to widen it. */
const TRUNK_HOME = { x: 50, y: 32 };
const SIDE_HOME = { x: 32, y: 12 };
const WALKERS_TRUNK = 10;
const WALKERS_SIDE = 1;

const TICKS_PER_DAY = 240;
/** ≈3 Hz like the live system, but CO-PRIME with the walkers' commute cycle: lockstep 1-tile/tick
 *  movement with a divisor-aligned sampler would alias (each walker sampled at the same 2 path
 *  cells forever) — an artifact real, non-lockstep NPC movement doesn't have. */
const DEPOSIT_EVERY = 19;
const DAYS = 40;

function grassMap(): GameMap {
  const tiles: Tile[][] = Array.from({ length: H }, (_, y) =>
    Array.from({ length: W }, (_, x) => ({ type: 'grass', x, y, walkable: true, state: 'realized' as const })));
  return {
    tiles, width: W, height: H, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as unknown as GameMap;
}

interface Walker { id: string; path: { x: number; y: number }[]; i: number; leg: 'out' | 'back'; home: { x: number; y: number } }

/**
 * Run the traffic simulation for `days`, calling `depositAt` for every walker position each
 * deposit pass (the harness seam that lets one run use the legacy deposit and another the real
 * spill system). Walkers are phase-staggered so the 20-tick sampling doesn't alias against the
 * commute period. Fully deterministic: A* is deterministic, movement is 1 tile/tick, no rng.
 */
function simulate(
  days: number,
  deposit: (map: GameMap, world: World, grid: TrampleGrid) => void,
): { map: GameMap; grid: TrampleGrid; promotedByDay: number[] } {
  const map = grassMap();
  const world = new World(map);
  const grid = new TrampleGrid(W, H);

  const walkers: Walker[] = [];
  let n = 0;
  const spawn = (home: { x: number; y: number }, count: number): void => {
    for (let k = 0; k < count; k++) {
      const id = `w${n++}`;
      world.addEntity({ id, kind: 'npc', x: home.x, y: home.y, properties: {} });
      walkers.push({ id, path: [], i: 0, leg: 'out', home });
    }
  };
  spawn(TRUNK_HOME, WALKERS_TRUNK);
  spawn(SIDE_HOME, WALKERS_SIDE);

  const promotedByDay: number[] = [];
  const promotedCount = (): number => {
    let c = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (grid.isPromoted(x, y)) c++;
    return c;
  };

  let tick = 0;
  for (let day = 0; day < days; day++) {
    for (let t = 0; t < TICKS_PER_DAY; t++, tick++) {
      walkers.forEach((wk, wi) => {
        if (tick < wi * 7) return;                      // phase stagger vs the 20-tick sampler
        if (wk.i >= wk.path.length) {
          const from = world.registry.get(wk.id)!;
          const to = wk.leg === 'out' ? MARKET : wk.home;
          const res = findPath(map, from.x, from.y, to.x, to.y);
          wk.path = res ? res.path : [];
          wk.i = 0;
          wk.leg = wk.leg === 'out' ? 'back' : 'out';
          return;
        }
        const p = wk.path[wk.i++];
        world.updateEntity(wk.id, { x: p.x, y: p.y });
      });
      if (tick % DEPOSIT_EVERY === 0) deposit(map, world, grid);
    }
    grid.promoteDecay(map);
    promotedByDay.push(promotedCount());
  }
  return { map, grid, promotedByDay };
}

/** The REAL runtime deposit path — TrampleDepositSystem (eligibility gate + spill). */
function systemDeposit(): (map: GameMap, world: World, grid: TrampleGrid) => void {
  return (map, world, grid) => {
    const sys = new TrampleDepositSystem(() => map, () => grid);
    sys.tick({ world } as unknown as SystemContext);
  };
}

describe('trample equilibrium — measured visibility tuning', () => {
  it('legacy constants (deposit 12, no spill) equilibrate too subtle — the round-5 observation', () => {
    const { grid, promotedByDay } = simulate(DAYS, (map, world, g) => {
      for (const e of world.registry.all()) {
        if (e.kind !== 'npc') continue;
        const tx = Math.floor(e.x), ty = Math.floor(e.y);
        const tile = map.tiles[ty]?.[tx];
        if ((tile && tile.type === 'grass') || g.isPromoted(tx, ty)) g.deposit(tx, ty, 12);
      }
    });
    void grid;
    const eq = promotedByDay[DAYS - 1];
    console.log(`[trample-eq] legacy (deposit 12, no spill): ${eq} promoted cells at day ${DAYS}`);
    // Document, don't over-pin: the legacy tuning leaves the main desire lines mostly latent.
    expect(eq).toBeLessThan(40);
  });

  it('round-8 constants (deposit 24 + spill 0.2) hold the main desire lines at 40–120 promoted cells', () => {
    const { promotedByDay } = simulate(DAYS, systemDeposit());
    const eq = promotedByDay[DAYS - 1];
    console.log(`[trample-eq] round-8 (deposit 24, spill 0.2): day series ${promotedByDay.join(',')}`);
    expect(eq).toBeGreaterThanOrEqual(40);
    expect(eq).toBeLessThanOrEqual(120);
    // Steady state, not a spike: the last 5 days stay within a tight band (hysteresis holds).
    const tail = promotedByDay.slice(-5);
    expect(Math.max(...tail) - Math.min(...tail)).toBeLessThanOrEqual(Math.ceil(eq * 0.15));
  });

  it('spill widens the busy trunk to 2–3 tiles; the side path stays single-file', () => {
    const { grid } = simulate(DAYS, systemDeposit());
    // Trunk cross-sections between market and the east homes: promoted width ≥ 2 somewhere,
    // never more than 3 (the spill reaches one cell each side of the walked lane).
    let maxTrunkWidth = 0;
    for (let x = 38; x <= 46; x++) {
      let width = 0;
      for (let y = 28; y <= 36; y++) if (grid.isPromoted(x, y)) width++;
      maxTrunkWidth = Math.max(maxTrunkWidth, width);
    }
    expect(maxTrunkWidth).toBeGreaterThanOrEqual(2);
    expect(maxTrunkWidth).toBeLessThanOrEqual(3);
    // Side path cross-sections (mid-run, clear of both endpoints): single-file.
    for (let y = 16; y <= 26; y++) {
      let width = 0;
      for (let x = 28; x <= 36; x++) if (grid.isPromoted(x, y)) width++;
      expect(width).toBeLessThanOrEqual(1);
    }
  });

  it('trails revert when the traffic that carved them stops (no residue, no flicker)', () => {
    const { map, grid } = simulate(15, systemDeposit());
    // Freeze all traffic; decay alone must walk every trail back to grass.
    for (let day = 0; day < 30; day++) grid.promoteDecay(map);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        expect(grid.isPromoted(x, y)).toBe(false);
        expect(map.tiles[y][x].type).toBe('grass');
      }
    }
  });
});
