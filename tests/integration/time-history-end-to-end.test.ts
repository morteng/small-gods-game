/**
 * End-to-end integration: time-history strip wired to the real sim.
 *
 * - Case A: a whisper emitted into the live event log appears as a chip in the
 *   DOM strip.
 * - Case B: after two whispers, scrub back to the first, commit(reroll) drops
 *   the second chip and appends a commit chip; the event log contains exactly
 *   one timeline_commit event at the cutoff tick.
 *
 * Uses the same createState + Scheduler + TimelineController pattern as the
 * other integration tests (spec-b-smoke, commit-no-reroll-equivalence). The
 * DOM is provided by the @vitest-environment jsdom directive.
 */
/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest';
import { createState } from '@/core/state';
import { TimelineController } from '@/core/timeline';
import { Scheduler } from '@/core/scheduler';
import { NpcMovementSystem } from '@/sim/systems/npc-movement-system';
import { NpcSimSystem } from '@/sim/systems/npc-sim-system';
import { SpiritSystem } from '@/sim/spirit-system';
import { PerceptionSystem } from '@/world/perception-system';
import { identityOracle } from '@/world/oracle';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import { whisper } from '@/sim/whisper';
import { mountTimeHistory } from '@/ui/panels/time-history';
import type { GameMap, Tile } from '@/core/types';

// ---------------------------------------------------------------------------
// Helpers shared across cases
// ---------------------------------------------------------------------------

function buildWorld(state: ReturnType<typeof createState>) {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 15; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 15; x++) {
      row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    }
    tiles.push(row);
  }
  const map: GameMap = {
    tiles, width: 15, height: 15, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
  state.map = map;
  state.world = new World(map);
  state.world.addEntity({
    id: 'n1', kind: 'npc', x: 7, y: 7,
    properties: initNpcProps('Aldric', 'farmer', 42) as unknown as Record<string, unknown>,
  });
  return state;
}

function buildSched(state: ReturnType<typeof createState>) {
  const sched = new Scheduler();
  sched.register(new NpcMovementSystem(() => state.map));
  sched.register(new NpcSimSystem());
  sched.register(new SpiritSystem());
  sched.register(new PerceptionSystem(identityOracle, () => state.map));
  return sched;
}

const STEP_MS = 1000 / 60; // one sim tick -- matches TimelineController.forwardSilent

function tickFor(
  state: ReturnType<typeof createState>,
  sched: Scheduler,
  tl: TimelineController,
  n: number,
): void {
  for (let i = 0; i < n; i++) {
    sched.tick(STEP_MS, {
      world: state.world!,
      spirits: state.spirits,
      log: state.eventLog,
      clock: state.clock,
      rng: state.rng,
    });
    tl.onAfterLiveTick();
  }
}

// Track containers so we can clean up after each test without touching innerHTML.
const containers: HTMLElement[] = [];

afterEach(() => {
  for (const c of containers) c.remove();
  containers.length = 0;
});

function makeContainer(): HTMLElement {
  const c = document.createElement('div');
  document.body.appendChild(c);
  containers.push(c);
  return c;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Spec C minimal -- time history strip end to end', () => {
  it('Case A: whisper appears as a chip in the history strip', () => {
    const state = buildWorld(createState());
    const sched = buildSched(state);
    const tl = new TimelineController({ state, scheduler: sched });

    // Advance a few ticks so the clock is non-zero and a snapshot exists.
    tickFor(state, sched, tl, 10);

    const container = makeContainer();
    const handle = mountTimeHistory(container, { eventLog: state.eventLog, timeline: tl });

    // Ensure player has power then whisper the NPC.
    const player = state.spirits.get('player')!;
    player.power = 10;
    const npc = state.world!.registry.get('n1')!;
    const ok = whisper(player, npc, state.eventLog);
    expect(ok).toBe(true);

    const chips = container.querySelectorAll('.sg-time-history__chip');
    expect(chips.length).toBeGreaterThanOrEqual(1);
    // The most-recent chip should be labelled "whisper".
    const lastChip = chips[chips.length - 1];
    expect(lastChip.textContent).toMatch(/whisper/i);

    handle.dispose();
  });

  it('Case B: scrub + commit(reroll) drops post-cutoff chips and adds a commit chip', () => {
    const state = buildWorld(createState());
    const sched = buildSched(state);
    const tl = new TimelineController({ state, scheduler: sched });

    // Prime the snapshot ring with enough ticks to give jumpTo something to
    // restore from.
    tickFor(state, sched, tl, 10);

    const container = makeContainer();
    const handle = mountTimeHistory(container, { eventLog: state.eventLog, timeline: tl });

    // -- First whisper -------------------------------------------------------
    const player = state.spirits.get('player')!;
    player.power = 20;
    const npc = state.world!.registry.get('n1')!;
    whisper(player, npc, state.eventLog);
    const earlyTick = state.eventLog.since(0).find(e => e.event.type === 'whisper')!.t;

    // Advance time so the clock progresses and we get a later tick.
    tickFor(state, sched, tl, 6); // ~6 sim frames

    // -- Second whisper ------------------------------------------------------
    // Cooldown may block; reset it so the second whisper lands.
    const npcProps = npc.properties as Record<string, unknown>;
    (npcProps as any).whisperCooldown = 0;
    player.power = 20;
    whisper(player, npc, state.eventLog);

    expect(container.querySelectorAll('.sg-time-history__chip').length).toBe(2);

    // -- Scrub back to the first whisper tick and commit with reroll ---------
    tl.jumpTo(earlyTick);
    tl.commit({ reroll: true });

    // Strip should now have: surviving whisper@earlyTick + commit@earlyTick.
    const afterChips = container.querySelectorAll('.sg-time-history__chip');
    expect(afterChips.length).toBe(2);

    const labels = Array.from(afterChips).map(el => el.textContent ?? '');
    expect(labels.some(l => /whisper/i.test(l))).toBe(true);
    expect(labels.some(l => /commit/i.test(l))).toBe(true);

    // -- Event log must have exactly one timeline_commit at earlyTick --------
    const commitEvents = state.eventLog.since(0).filter(e => e.event.type === 'timeline_commit');
    expect(commitEvents).toHaveLength(1);
    expect(commitEvents[0].t).toBe(earlyTick);

    handle.dispose();
  });
});
