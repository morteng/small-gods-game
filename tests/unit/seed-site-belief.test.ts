import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { initNpcProps, npcProps } from '@/world/npc-helpers';
import { getDomainBelief } from '@/sim/belief-domains';
import { seedSiteBelief } from '@/sim/divine-actions';
import type { Entity, GameMap, NpcProperties } from '@/core/types';
import type { CausalSite } from '@/world/causal-site';

const W = 20, H = 20;

function makeWorld(): World {
  return new World({
    tiles: [], width: W, height: H, villages: [], seed: 1,
    success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as GameMap);
}

let nextId = 0;
function addNpc(world: World, x: number, y: number): Entity {
  const props = initNpcProps('Pip', 'farmer', ++nextId) as NpcProperties;
  props.beliefs = { player: { faith: 1, understanding: 0.6, devotion: 1 } };
  const e = { id: `n${nextId}`, kind: 'npc', x, y, properties: props as unknown as Record<string, unknown> } as Entity;
  world.addEntity(e);
  return e;
}

/** A site whose footprint is the 5×5 block centred on (10,10). */
function siteAt(cells: number[], cause = 'player', intensity = 0.8): CausalSite {
  return {
    id: 'causal:flood:0000', kind: 'flood', name: 'The Drowned Reach',
    pos: { x: 10, y: 10 }, cells: Int32Array.from(cells),
    bornTick: 0, lifeTicks: 30, ageTicks: 0, intensity, cause,
  };
}

function block(cx: number, cy: number, r: number): number[] {
  const out: number[] = [];
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) out.push(y * W + x);
  return out;
}

describe('seedSiteBelief (W-I-c)', () => {
  it('seeds flood belief into an NPC standing in the footprint', () => {
    const world = makeWorld();
    const npc = addNpc(world, 10, 10);
    seedSiteBelief(world, siteAt(block(10, 10, 2)));
    expect(getDomainBelief(npcProps(npc), 'player', 'flood')).toBeGreaterThan(0);
  });

  it('seeds an NPC 4-adjacent to the footprint', () => {
    const world = makeWorld();
    const npc = addNpc(world, 13, 10);                 // one tile right of the 8..12 block edge
    seedSiteBelief(world, siteAt(block(10, 10, 2)));
    expect(getDomainBelief(npcProps(npc), 'player', 'flood')).toBeGreaterThan(0);
  });

  it('does NOT seed a distant NPC', () => {
    const world = makeWorld();
    const npc = addNpc(world, 0, 0);
    seedSiteBelief(world, siteAt(block(10, 10, 2)));
    expect(getDomainBelief(npcProps(npc), 'player', 'flood')).toBe(0);
  });

  it('attributes to the causing spirit, scales with intensity', () => {
    const world = makeWorld();
    const a = addNpc(world, 10, 10);
    const b = addNpc(world, 9, 10);
    seedSiteBelief(world, siteAt(block(10, 10, 2), 'player', 1.0));
    seedSiteBelief(world, siteAt(block(10, 10, 2), 'player', 0.2));
    // a got a strong then weak seed; both via 'player'. A 1.0-intensity seed > a 0.2 one.
    const strong = getDomainBelief(npcProps(a), 'player', 'flood');
    const weakOnly = (() => {
      const w2 = makeWorld(); const c = addNpc(w2, 10, 10);
      seedSiteBelief(w2, siteAt(block(10, 10, 2), 'player', 0.2));
      return getDomainBelief(npcProps(c), 'player', 'flood');
    })();
    expect(strong).toBeGreaterThan(weakOnly);
    expect(b).toBeTruthy();
  });

  it('credits no one for a natural flood (cause = nature)', () => {
    const world = makeWorld();
    const npc = addNpc(world, 10, 10);
    seedSiteBelief(world, siteAt(block(10, 10, 2), 'nature'));
    expect(getDomainBelief(npcProps(npc), 'player', 'flood')).toBe(0);
    expect(getDomainBelief(npcProps(npc), 'nature', 'flood')).toBe(0);
  });
});
