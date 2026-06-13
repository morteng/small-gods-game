// tests/unit/settlement-plan-s4.test.ts — frontage gradient, back-lane growth,
// civic catalogue (S4 constraint catalogue).
import { describe, it, expect } from 'vitest';
import {
  planSettlement, subdivideLots, widenMarket, frontageValue, extendBackLane,
  extendThroughStreet, planCivics, CIVIC_RULES, registerCivicRule, BUILDABLE_TERRAIN,
  type SettlementPlan,
} from '@/world/settlement-plan';
import { getZoneRule } from '@/map/poi-zones';
import { Random } from '@/core/noise';
import type { Tile } from '@/core/types';

function grassTiles(w = 48, h = 48): Tile[][] {
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) =>
      ({ x, y, type: 'grass', walkable: true }) as unknown as Tile));
}

const CENTER = { x: 24, y: 24 };
const villageRule = getZoneRule('village');

function freshPlan(tiles = grassTiles(), seed = 7): SettlementPlan {
  const plan = planSettlement(CENTER, villageRule, tiles, [{ dx: 1, dy: 0 }], new Random(seed));
  widenMarket(plan, tiles);
  subdivideLots(plan, tiles, seed);
  return plan;
}

describe('frontageValue', () => {
  it('is highest at the founding node and decays monotonically with distance', () => {
    const tiles = grassTiles();
    const plan = freshPlan(tiles);
    expect(plan.lots.length).toBeGreaterThan(1);
    for (const lot of plan.lots) {
      const v = frontageValue(plan, lot);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // a central lot scores above a rim lot
    const byDist = [...plan.lots].sort((a, b) =>
      (Math.abs(a.frontage[0].x - CENTER.x) + Math.abs(a.frontage[0].y - CENTER.y))
      - (Math.abs(b.frontage[0].x - CENTER.x) + Math.abs(b.frontage[0].y - CENTER.y)));
    expect(frontageValue(plan, byDist[0])).toBeGreaterThanOrEqual(frontageValue(plan, byDist[byDist.length - 1]));
  });
});

describe('extendBackLane', () => {
  it('branches a perpendicular lane and re-subdivides into fresh lots', () => {
    const tiles = grassTiles();
    const plan = freshPlan(tiles);
    // Back lanes follow ribbon growth: ribbon turns an end node into a junction
    // the lane can branch from (the medieval ribbon-then-back-lane sequence).
    extendThroughStreet(plan, tiles, 7);
    const nodesBefore = plan.nodes.length;
    const laneEdgesBefore = plan.edges.filter(e => e.kind === 'lane').length;
    const lotKeysBefore = new Set(plan.lots.map(l => l.id));

    const run = extendBackLane(plan, tiles, 7);
    expect(run).not.toBeNull();
    expect(run!.length).toBeGreaterThanOrEqual(2);
    expect(plan.nodes.length).toBeGreaterThan(nodesBefore);
    expect(plan.edges.filter(e => e.kind === 'lane').length).toBeGreaterThan(laneEdgesBefore);
    // new lots appeared along the branch
    const fresh = plan.lots.filter(l => !lotKeysBefore.has(l.id));
    expect(fresh.length).toBeGreaterThan(0);
    // the new lane runs perpendicular to the main (E–W) street → it moves in y
    const ys = new Set(run!.map(t => t.y));
    expect(ys.size).toBeGreaterThan(1);
  });

  it('carries existing lot claims across re-subdivision', () => {
    const tiles = grassTiles();
    const plan = freshPlan(tiles);
    const claimed = plan.lots[0];
    claimed.buildingId = 'keep-me';
    extendBackLane(plan, tiles, 7);
    const after = plan.lots.find(l => l.id === claimed.id);
    expect(after?.buildingId).toBe('keep-me');
  });

  it('is deterministic and stops at the node cap', () => {
    const branched = (seed: number) => {
      const t = grassTiles();
      const p = freshPlan(t, seed);
      extendThroughStreet(p, t, seed);
      return extendBackLane(p, t, seed);
    };
    const ra = branched(7);
    expect(ra).not.toBeNull();
    expect(branched(7)).toEqual(ra);
    // exhaust the node budget — eventually returns null rather than growing forever
    const t = grassTiles();
    const plan = freshPlan(t);
    let guard = 0;
    while ((extendThroughStreet(plan, t, 7) || extendBackLane(plan, t, 7)) && guard < 200) guard++;
    expect(extendBackLane(plan, t, 7)).toBeNull();
    expect(extendThroughStreet(plan, t, 7)).toBeNull();
  });
});

describe('planCivics (constraint catalogue)', () => {
  it('reserves a well on the green and a graveyard on the rim, off lots and roads', () => {
    const tiles = grassTiles();
    const plan = freshPlan(tiles);
    const civics = planCivics(plan, tiles, 7);
    const well = civics.find(c => c.type === 'well');
    const yard = civics.find(c => c.type === 'graveyard');
    expect(well).toBeDefined();
    expect(yard).toBeDefined();

    const roadSet = new Set(plan.edges.flatMap(e => e.tiles.map(t => `${t.x},${t.y}`)));
    const lotSet = new Set(plan.lots.flatMap(l => l.tiles.map(t => `${t.x},${t.y}`)));
    for (const c of civics) {
      for (let dy = 0; dy < c.h; dy++) {
        for (let dx = 0; dx < c.w; dx++) {
          const k = `${c.x + dx},${c.y + dy}`;
          expect(BUILDABLE_TERRAIN.has(tiles[c.y + dy][c.x + dx].type)).toBe(true);
          expect(roadSet.has(k), `civic ${c.type} on road`).toBe(false);
          expect(lotSet.has(k), `civic ${c.type} on lot`).toBe(false);
        }
      }
    }
    // the well sits nearer the founding node than the graveyard (green vs rim)
    const dWell = Math.abs(well!.x - CENTER.x) + Math.abs(well!.y - CENTER.y);
    const dYard = Math.abs(yard!.x - CENTER.x) + Math.abs(yard!.y - CENTER.y);
    expect(dWell).toBeLessThan(dYard);
  });

  it('only sites a mill when water is in range', () => {
    const dry = grassTiles();
    const dryPlan = freshPlan(dry);
    expect(planCivics(dryPlan, dry, 7).some(c => c.type === 'mill')).toBe(false);

    const wet = grassTiles();
    for (let x = 0; x < 48; x++) for (const y of [29, 30]) wet[y][x].type = 'river';
    const wetPlan = freshPlan(wet);
    expect(planCivics(wetPlan, wet, 7).some(c => c.type === 'mill')).toBe(true);
  });

  it('is deterministic and excludes civic ground from re-subdivided lots', () => {
    const t1 = grassTiles(); const p1 = freshPlan(t1);
    const t2 = grassTiles(); const p2 = freshPlan(t2);
    const c1 = planCivics(p1, t1, 7);
    const c2 = planCivics(p2, t2, 7);
    expect(c2).toEqual(c1);

    // after civics exist, re-subdividing never lots over a reserved precinct
    subdivideLots(p1, t1, 7);
    const civicSet = new Set(c1.flatMap(c => {
      const ks: string[] = [];
      for (let dy = 0; dy < c.h; dy++) for (let dx = 0; dx < c.w; dx++) ks.push(`${c.x + dx},${c.y + dy}`);
      return ks;
    }));
    for (const lot of p1.lots) {
      for (const tile of lot.tiles) expect(civicSet.has(`${tile.x},${tile.y}`)).toBe(false);
    }
  });

  it('honours an agent-registered civic rule (open registry)', () => {
    registerCivicRule('shrine_stone', { size: { w: 1, h: 1 }, site: 'green' });
    expect(CIVIC_RULES.shrine_stone).toBeDefined();
    const tiles = grassTiles();
    const plan = freshPlan(tiles);
    const civics = planCivics(plan, tiles, 7);
    expect(civics.some(c => c.type === 'shrine_stone')).toBe(true);
    delete CIVIC_RULES.shrine_stone;
  });
});
