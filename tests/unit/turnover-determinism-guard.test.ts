import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog, type SimEvent } from '@/core/events';
import { createRng } from '@/core/rng';
import { initNpcProps } from '@/world/npc-helpers';
import { MortalitySystem } from '@/sim/systems/mortality-system';
import { BirthSystem } from '@/sim/systems/birth-system';
import { TICKS_PER_YEAR } from '@/sim/mortality';
import type { GameMap, Entity } from '@/core/types';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

function runOnce(seed: number): string[] {
  const world = new World(emptyMap());
  for (let i = 0; i < 10; i++) {
    const id = `n${i}`;
    const p = initNpcProps(id, 'farmer', (i * 2654435761) | 0);
    p.lineageId = id;
    p.birthTick = -(20 + i * 7) * TICKS_PER_YEAR; // mix of young adults and elders
    p.homePoiId = 'village';
    const e: Entity = { id, kind: 'npc', x: 0, y: 0, properties: p as unknown as Record<string, unknown> };
    world.addEntity(e);
  }
  const clock = new SimClock();
  const log = new EventLog(clock);
  const trace: string[] = [];
  log.subscribe((a: { event: SimEvent; t: number }) => {
    if (a.event.type === 'npc_death') trace.push(`death:${a.event.npcId}@${a.t}`);
    if (a.event.type === 'npc_birth') trace.push(`birth:${a.event.lineageId}@${a.t}`);
  });
  const rng = createRng(seed);
  const ctx = { world, spirits: new Map(), log, clock, rng, dt: 1000, now: 0 };
  const mort = new MortalitySystem();
  const birth = new BirthSystem();
  for (let t = 0; t < 4000; t++) {
    mort.tick({ ...ctx, now: t });
    birth.tick({ ...ctx, now: t });
  }
  return trace;
}

describe('turnover determinism guard', () => {
  it('same seed -> identical death/birth trace', () => {
    expect(runOnce(2026)).toEqual(runOnce(2026));
  });
  it('produces a non-trivial trace (the guard is non-vacuous)', () => {
    expect(runOnce(2026).length).toBeGreaterThan(0);
  });
});
