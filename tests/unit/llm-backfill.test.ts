import { describe, it, expect } from 'vitest';
import { parseLLMJson, getNearbyNpcNames, getActiveEventsForPoi, LlmBackfillService } from '@/game/llm-backfill';
import { World } from '@/world/world';
import { initNpcProps, npcProps } from '@/world/npc-helpers';
import { createState } from '@/core/state';
import { LLMClient, type LLMProvider } from '@/llm/llm-client';
import type { GameMap, Tile, Entity } from '@/core/types';

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

// C5: the barebones game never mounts the legacy DOM narration card, so the
// service runs with llmDisplay:null — the writeback (memory + belief) must
// still land; only the DOM presentation is skipped.
describe('trigger with llmDisplay: null (barebones)', () => {
  it('applies the writeback without a display handle', async () => {
    const state = createState();
    state.map = makeMap(5, 5);
    state.world = new World(state.map);
    const npc: Entity = { id: 'n1', kind: 'npc', x: 2, y: 2, tags: [], properties: initNpcProps('Aelith', 'farmer', 1) as any };
    state.world.addEntity(npc);

    const provider: LLMProvider = {
      isAvailable: () => true,
      async generate() {
        return { content: JSON.stringify({ dialogue: 'I feel watched', belief_delta: { faith: 0.1 } }), latencyMs: 0 };
      },
    } as unknown as LLMProvider;

    const faithBefore = npcProps(npc).beliefs['player']?.faith ?? 0;
    const svc = new LlmBackfillService({ state, llmDisplay: null, client: new LLMClient(provider) });
    await svc.trigger(npc);

    expect(npcProps(npc).memories ?? []).toHaveLength(1); // interaction memory recorded
    expect(npcProps(npc).beliefs['player']?.faith ?? 0).toBeGreaterThan(faithBefore); // belief delta applied
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
