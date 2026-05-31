import { describe, it, expect } from 'vitest';
import { parseLLMJson, getNearbyNpcNames, getActiveEventsForPoi } from '@/game/llm-backfill';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import type { GameMap, Tile } from '@/core/types';

function makeMap(w = 10, h = 10): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: w, height: h, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

function makeWorld() {
  return new World(makeMap());
}

describe('parseLLMJson', () => {
  it('parses JSON content', () => { expect(parseLLMJson('{"narration":"hi"}')).toEqual({ narration: 'hi' }); });
  it('falls back to narration for non-JSON', () => { expect(parseLLMJson('just text')).toEqual({ narration: 'just text' }); });
});

describe('getNearbyNpcNames', () => {
  it('returns names of other npcs within radius, excluding self', () => {
    const world = makeWorld();
    const a = { id: 'a', kind: 'npc', x: 5, y: 5, properties: initNpcProps('Ana', 'farmer', 1) as any, tags: [] };
    const b = { id: 'b', kind: 'npc', x: 6, y: 5, properties: initNpcProps('Bo', 'farmer', 2) as any, tags: [] };
    world.addEntity(a); world.addEntity(b);
    expect(getNearbyNpcNames(world, a as any, 3)).toEqual(['Bo']);
  });
});

describe('getActiveEventsForPoi', () => {
  it('returns [] for undefined poi', () => { expect(getActiveEventsForPoi(makeWorld(), undefined)).toEqual([]); });
  it('maps active events to their types', () => {
    const world = makeWorld();
    world.activeEvents.set('poi1', [{ type: 'drought', poiId: 'poi1', severity: 1, durationTicks: 10, ticksElapsed: 0 }] as any);
    expect(getActiveEventsForPoi(world, 'poi1')).toEqual(['drought']);
  });
});
