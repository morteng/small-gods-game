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
import { CausalSiteStore } from '@/world/causal-site';
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
  const sites = new CausalSiteStore(3, 3, new Set(), []);
  const sys = new StagingActivationSystem(
    discovery, queue, () => staging, () => threads, (subject, beat) => soft.push({ subject, beat }),
    undefined, () => sites,
  );
  const ctx = (now: number): SystemContext => ({
    world: new World(makeMap()), spirits: new Map(), log, clock, rng: createRng(1), dt: 2000, now,
  });
  return { staging, threads, discovery, queue, sys, soft, captured, ctx, sites };
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

  it('W-I: expires a beat armed at a causal site once the site has faded', () => {
    const t = setup();
    // A live site the beat is armed against.
    t.sites.hydrate({ nextId: 1, sites: [{
      id: 'causal:flood:0000', kind: 'flood', name: 'The Drowned Reach',
      x: 1, y: 1, cells: [4], bornTick: 0, lifeTicks: 30, ageTicks: 0, intensity: 0.6, cause: 'player',
    }] });
    const subject: ThreadSubject = { kind: 'site', siteId: 'causal:flood:0000' };
    t.staging.arm({ subject, trigger: { kind: 'discovery' }, hard: [],
      soft: { kind: 'location_vibe', text: 'The reeds drip.' }, stagedTick: 0 });

    t.sys.tick(t.ctx(10));                       // site still alive → beat survives
    expect(t.staging.armedFor(subject)).toHaveLength(1);

    t.sites.reset();                             // the flood drained, site gone
    t.sys.tick(t.ctx(20));
    expect(t.staging.armedFor(subject)).toHaveLength(0);   // reaped
    expect(t.staging.get(1)!.status).toBe('expired');
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
