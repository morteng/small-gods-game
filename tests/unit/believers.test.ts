import { describe, it, expect } from 'vitest';
import { isDurable, countPlayerBelievers, countDurableBelievers, npcStatusHint, PLAYER_SPIRIT_ID } from '@/sim/believers';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import type { GameMap, NpcNeeds, SpiritBelief } from '@/core/types';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}
function add(world: World, id: string, b: SpiritBelief) {
  const p = initNpcProps(id, 'farmer', 7);
  p.beliefs['player'] = b;
  world.addEntity({ id, kind: 'npc', x: 0, y: 0, properties: p as unknown as Record<string, unknown> });
}
const needs = (meaning: number): NpcNeeds => ({ safety: 0.5, prosperity: 0.5, community: 0.5, meaning });

describe('believer accounting', () => {
  it('exposes the player spirit id', () => {
    expect(PLAYER_SPIRIT_ID).toBe('player');
  });

  it('isDurable requires faith>0.3 and devotion>0.4', () => {
    expect(isDurable({ faith: 0.5, understanding: 0, devotion: 0.5 })).toBe(true);
    expect(isDurable({ faith: 0.5, understanding: 0, devotion: 0.3 })).toBe(false);
    expect(isDurable({ faith: 0.2, understanding: 0, devotion: 0.5 })).toBe(false);
    expect(isDurable(undefined)).toBe(false);
  });

  it('counts active believers (faith ≥ the believer line) and durable believers separately', () => {
    const world = new World(emptyMap());
    add(world, 'a', { faith: 0.5,  understanding: 0, devotion: 0.5 }); // durable
    add(world, 'b', { faith: 0.5,  understanding: 0, devotion: 0.0 }); // believer, not durable
    add(world, 'c', { faith: 0.0,  understanding: 0, devotion: 0.0 }); // never a believer
    add(world, 'd', { faith: 0.05, understanding: 0, devotion: 0.0 }); // lapsed ex-believer: lingers, doesn't count
    expect(countPlayerBelievers(world)).toBe(2);
    expect(countDurableBelievers(world)).toBe(1);
  });
});

describe('npcStatusHint', () => {
  it('flags a turned-away ex-believer at the floor', () => {
    expect(npcStatusHint({ faith: 0.02, understanding: 0, devotion: 0 }, needs(0.5), 'idle'))
      .toBe('turned away from you');
  });
  it('flags fading faith below the believer line first', () => {
    expect(npcStatusHint({ faith: 0.1, understanding: 0, devotion: 0 }, needs(0.5), 'idle'))
      .toBe('faith fading');
  });
  it('flags praying', () => {
    expect(npcStatusHint({ faith: 0.5, understanding: 0, devotion: 0 }, needs(0.1), 'worship'))
      .toBe('praying — needs you now');
  });
  it('flags comfortable drifters', () => {
    expect(npcStatusHint({ faith: 0.5, understanding: 0, devotion: 0.1 }, needs(0.8), 'idle'))
      .toBe('comfortable — drifting away');
  });
  it('flags devoted and ripe-to-deepen', () => {
    expect(npcStatusHint({ faith: 0.5, understanding: 0, devotion: 0.6 }, needs(0.5), 'idle')).toBe('devoted');
    expect(npcStatusHint({ faith: 0.5, understanding: 0, devotion: 0.1 }, needs(0.5), 'idle')).toBe('ripe to deepen');
  });
  it('falls back to wavering for a mid believer who is none of the above', () => {
    expect(npcStatusHint({ faith: 0.2, understanding: 0, devotion: 0 }, needs(0.5), 'idle')).toBe('wavering');
  });
});
