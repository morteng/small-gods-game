// tests/unit/determinism.test.ts
import { describe, it, expect } from 'vitest';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { World } from '@/world/world';
import { Scheduler } from '@/core/scheduler';
import { NpcSimSystem } from '@/sim/systems/npc-sim-system';
import { SpiritSystem } from '@/sim/spirit-system';
import { PerceptionSystem } from '@/world/perception-system';
import { identityOracle } from '@/world/oracle';
import { initNpcProps } from '@/world/npc-helpers';
import { whisper } from '@/sim/whisper';
import type { GameMap, Tile } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';

function makeWorld(): { world: World; map: GameMap } {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 30; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 30; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'void' });
    tiles.push(row);
  }
  const map: GameMap = { tiles, width: 30, height: 30, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
  return { world: new World(map), map };
}

function runScenario(): string[] {
  const clock = new SimClock();
  const log = new EventLog(clock);
  const spirits = new Map<SpiritId, Spirit>([['player', {
    id: 'player', name: 'Fooob', sigil: '⊙', color: '#ffd700', isPlayer: true, power: 5, manifestation: null,
  }]]);
  const { world, map } = makeWorld();
  const npcProps = initNpcProps('Alice', 'farmer', 42);
  world.addEntity({ id: 'n1', kind: 'npc', x: 15, y: 15, properties: npcProps as unknown as Record<string, unknown> });

  const sched = new Scheduler();
  // Deliberately NOT registering NpcMovementSystem — its random walk breaks determinism.
  sched.register(new NpcSimSystem());
  sched.register(new SpiritSystem());
  sched.register(new PerceptionSystem(identityOracle, () => map));

  const ctx = { world, spirits, log, clock };

  // Run 10 sim seconds
  for (let i = 0; i < 30; i++) sched.tick(333, ctx);

  // Then whisper at fixed point
  const e = world.registry.get('n1')!;
  whisper(spirits.get('player')!, e, log);

  // Run another 5 seconds
  for (let i = 0; i < 15; i++) sched.tick(333, ctx);

  // Stringify each event's content (excluding wall-clock-derived fields if any)
  return log.since(0).map(a => JSON.stringify(a.event));
}

describe('determinism', () => {
  it('same scenario produces identical event log content', () => {
    const a = runScenario();
    const b = runScenario();
    expect(a).toEqual(b);
  });

  it('event count is stable across runs', () => {
    const a = runScenario();
    const b = runScenario();
    expect(a.length).toBe(b.length);
  });
});
