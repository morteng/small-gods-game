import { describe, it, expect, beforeEach } from 'vitest';
import { createGameBus } from '@/game/game-bus';
import { createGameQuery } from '@/game/game-query';
import { createState } from '@/core/state';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import { CommandQueue } from '@/sim/command/command-queue';
import { CommandExecutorSystem, previewCommand } from '@/sim/command/command-system';
import { listCapabilities } from '@/sim/command/registry';
import { createRng } from '@/core/rng';
import type { GameMap, Tile } from '@/core/types';
import type { Command } from '@/sim/command/types';

function miniMap(w = 8, h = 8): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    tiles[y] = [];
    for (let x = 0; x < w; x++) tiles[y][x] = { type: 'grass', x, y, walkable: true, state: 'realized' };
  }
  return { tiles, width: w, height: h, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

function setup() {
  const state = createState();
  const map = miniMap();
  state.map = map;
  state.world = new World(map);
  state.worldSeed = { name: 'Testland', pois: [] } as any;
  state.world.addEntity({
    id: 'n1', kind: 'npc', x: 1, y: 1, tags: [],
    properties: { ...initNpcProps('Ada', 'farmer', 7), beliefs: { player: { faith: 0.4, understanding: 0.2, devotion: 0.1 } }, lineageId: 'n1' },
  } as any);

  const queue = new CommandQueue();
  const query = createGameQuery({ state });
  const bus = createGameBus({ queue, state, query });
  const executor = new CommandExecutorSystem(queue);
  const drainTick = () => executor.tick({
    world: state.world!, spirits: state.spirits, log: state.eventLog,
    clock: state.clock, rng: createRng(1), dt: 16, now: state.clock.now(),
  });
  return { state, queue, query, bus, drainTick };
}

describe('game-bus', () => {
  let h: ReturnType<typeof setup>;
  beforeEach(() => { h = setup(); });

  it('emit enqueues onto the real queue; the command applies next tick', () => {
    expect(h.bus.query.beliefState().power).toBe(10);
    h.bus.emit({ verb: 'whisper', source: 'player', target: { kind: 'npc', npcId: 'n1' } });
    expect(h.queue.size()).toBe(1);

    h.drainTick();

    // Whisper paid 1 power, boosted faith, and appended a 'whisper' event.
    expect(h.bus.query.beliefState().power).toBe(9);
    expect(h.bus.query.npc('n1')!.faith).toBeGreaterThan(0.4);
    expect(h.bus.query.events().some(e => e.event.type === 'whisper')).toBe(true);
  });

  it('preview matches previewCommand against the same registry', () => {
    const ctx = { world: h.state.world!, spirits: h.state.spirits, log: h.state.eventLog };
    const ok: Command = { verb: 'whisper', source: 'player', target: { kind: 'npc', npcId: 'n1' }, seq: 0 };
    const bad: Command = { verb: 'whisper', source: 'player', target: { kind: 'npc', npcId: 'ghost' }, seq: 0 };
    expect(h.bus.preview(ok)).toBe(previewCommand(ok, ctx));
    expect(h.bus.preview(ok)).toBeNull();
    expect(h.bus.preview(bad)).toBe('invalid_target');
  });

  it('capabilities() projects every registry verb to plain data', () => {
    const caps = h.bus.capabilities();
    const reg = listCapabilities();
    expect(caps).toHaveLength(reg.length);
    const whisper = caps.find(c => c.verb === 'whisper')!;
    expect(whisper).toEqual({ verb: 'whisper', tier: 'divine', cost: 1, targetKind: 'npc', targetKinds: ['npc'], implemented: true });
    // Pure data: no functions leak through (JSON-serializable).
    expect(() => JSON.stringify(caps)).not.toThrow();
    for (const c of caps) expect(Object.keys(c)).not.toContain('describe');
  });

  it('subscribe fires on appended events and unsubscribe stops it', () => {
    const seen: string[] = [];
    const off = h.bus.subscribe(e => seen.push(e.event.type));
    h.state.eventLog.append({ type: 'power_depleted', spiritId: 'player' });
    expect(seen).toContain('power_depleted');
    off();
    h.state.eventLog.append({ type: 'power_depleted', spiritId: 'player' });
    expect(seen.filter(t => t === 'power_depleted')).toHaveLength(1);
  });
});
