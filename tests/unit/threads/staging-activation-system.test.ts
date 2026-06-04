import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { EventLog, type AppendedEvent } from '@/core/events';
import { SimClock } from '@/core/clock';
import { createRng } from '@/core/rng';
import { CommandQueue } from '@/sim/command/command-queue';
import { PlotThreadStore } from '@/sim/threads/thread-store';
import { StagingBuffer } from '@/sim/threads/staging-buffer';
import { DiscoveryQueue } from '@/sim/threads/discovery-queue';
import { StagingActivationSystem } from '@/sim/threads/systems/staging-activation-system';
import type { SystemContext } from '@/core/scheduler';
import type { Command } from '@/sim/command/types';
import type { GameMap, Tile } from '@/core/types';
import type { SoftBeat } from '@/sim/threads/staging-types';
import type { ThreadSubject } from '@/sim/threads/thread-types';

function makeMap(): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 3; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 3; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: 3, height: 3, villages: [], seed: 1, success: true,
           worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

const modifyCmd: Command = {
  verb: 'author_modify_npc', source: 'fate', target: { kind: 'npc', npcId: 'n1' },
  payload: { entityId: 'n1', name: 'Stranger' }, seq: 0,
};

function setup() {
  const clock = new SimClock();
  const log = new EventLog(clock);
  const captured: AppendedEvent[] = [];
  log.subscribe(e => captured.push(e));
  const staging = new StagingBuffer();
  const threads = new PlotThreadStore();
  const discovery = new DiscoveryQueue();
  const queue = new CommandQueue();
  const soft: { subject: ThreadSubject; beat: SoftBeat }[] = [];
  const sys = new StagingActivationSystem(
    discovery, queue, () => staging, () => threads, (subject, beat) => soft.push({ subject, beat }),
  );
  const ctx = (now: number): SystemContext => ({
    world: new World(makeMap()), spirits: new Map(), log, clock, rng: createRng(1), dt: 2000, now,
  });
  return { staging, threads, discovery, queue, sys, soft, captured, ctx };
}

describe('StagingActivationSystem', () => {
  it('fires a discovery beat: emits commands, primes soft, marks fired', () => {
    const t = setup();
    const subject: ThreadSubject = { kind: 'npc', npcId: 'n1' };
    t.staging.arm({ subject, trigger: { kind: 'discovery' }, hard: [modifyCmd],
      soft: { kind: 'npc_thought', text: 'Who is this?' }, stagedTick: 0 });

    t.discovery.push({ subject });
    t.sys.tick(t.ctx(10));

    expect(t.queue.drain()).toHaveLength(1);
    expect(t.soft).toHaveLength(1);
    expect(t.captured.some(e => e.event.type === 'beat_fired')).toBe(true);
    expect(t.staging.armedFor(subject)).toHaveLength(0);
  });

  it('does not fire a discovery beat without a matching signal', () => {
    const t = setup();
    const subject: ThreadSubject = { kind: 'npc', npcId: 'n1' };
    t.staging.arm({ subject, trigger: { kind: 'discovery' }, hard: [modifyCmd], stagedTick: 0 });
    t.sys.tick(t.ctx(10)); // no discovery push
    expect(t.staging.armedFor(subject)).toHaveLength(1);
  });

  it('after_tick fires once now passes the tick', () => {
    const t = setup();
    const subject: ThreadSubject = { kind: 'settlement', poiId: 'p1' };
    t.staging.arm({ subject, trigger: { kind: 'after_tick', tick: 100 }, hard: [], stagedTick: 0 });
    t.sys.tick(t.ctx(50));
    expect(t.staging.armedFor(subject)).toHaveLength(1); // too early
    t.sys.tick(t.ctx(150));
    expect(t.staging.armedFor(subject)).toHaveLength(0); // fired
  });

  it('activates a staged owning thread on fire', () => {
    const t = setup();
    const subject: ThreadSubject = { kind: 'npc', npcId: 'n1' };
    const thread = t.threads.open('monomyth', subject, 0);
    thread.status = 'staged'; // simulate a pre-staged thread
    t.staging.arm({ subject, threadId: thread.id, trigger: { kind: 'discovery' }, hard: [], stagedTick: 0 });
    t.discovery.push({ subject });
    t.sys.tick(t.ctx(10));
    expect(t.threads.get(thread.id)!.status).toBe('active');
  });
});
