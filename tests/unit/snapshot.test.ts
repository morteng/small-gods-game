import { describe, it, expect } from 'vitest';
import { createState } from '@/core/state';
import { captureSnapshot, restoreSnapshot } from '@/core/snapshot';
import { initNpcProps } from '@/world/npc-helpers';
import { World } from '@/world/world';
import type { GameMap, Tile } from '@/core/types';
import type { RoadGraph } from '@/world/road-graph';

/** A one-edge graph whose single carved cell sits at (5,5) — the road tile an NPC there stands on. */
function roadGraphAt(x: number, y: number): RoadGraph {
  return {
    nodes: [], rev: 0,
    edges: [{ id: 'e0', a: 'a', b: 'b', polyline: [{ x, y }], feature: 'road', class: 'track', surface: 'dirt', bridgeCells: [] }],
  };
}

function attachWorld(state: ReturnType<typeof createState>): void {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 10; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 10; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'void' });
    tiles.push(row);
  }
  const map: GameMap = {
    tiles, width: 10, height: 10, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  };
  state.map = map;
  state.world = new World(map);
  const props = initNpcProps('Alice', 'farmer', 42);
  state.world.addEntity({ id: 'n1', kind: 'npc', x: 5, y: 5, properties: props as unknown as Record<string, unknown> });
}

describe('snapshot', () => {
  it('captures clock, rng state, spirits, and entity positions', () => {
    const s = createState();
    attachWorld(s);
    s.clock.advance(1234);
    s.rng.next(); s.rng.next();

    const capturedTick = s.clock.now();
    const snap = captureSnapshot(s);

    s.clock.advance(99999);
    s.rng.next();
    s.world!.registry.update('n1', { x: 9, y: 9 });

    restoreSnapshot(s, snap);
    expect(s.clock.now()).toBe(capturedTick);
    expect(s.world!.registry.get('n1')!.x).toBe(5);
    expect(s.world!.registry.get('n1')!.y).toBe(5);
  });

  it('rng state survives the round-trip', () => {
    const s = createState();
    attachWorld(s);
    s.rng.next(); s.rng.next(); s.rng.next();
    const snap = captureSnapshot(s);
    const after = s.rng.next();
    restoreSnapshot(s, snap);
    expect(s.rng.next()).toBe(after);
  });

  it('spirits added after capture are dropped on restore (snapshot is authoritative)', () => {
    const s = createState();
    attachWorld(s);
    const snap = captureSnapshot(s);
    s.spirits.set('rival', {
      id: 'rival', name: 'The Wandering Minstrel', sigil: '◐', color: '#a55',
      isPlayer: false, power: 7, manifestation: null,
      ai: { policy: 'tempt-merchants', cooldowns: { whisper: 12 } },
    });
    expect(s.spirits.size).toBe(2);
    restoreSnapshot(s, snap);
    expect(s.spirits.size).toBe(1);
    expect(s.spirits.has('rival')).toBe(false);
  });

  it('spirit ai cooldowns are deep-cloned and survive the round-trip', () => {
    const s = createState();
    attachWorld(s);
    s.spirits.set('rival', {
      id: 'rival', name: 'Rival', sigil: '◐', color: '#a55',
      isPlayer: false, power: 4, manifestation: null,
      ai: { policy: 'aggressive', cooldowns: { miracle: 5, whisper: 2 } },
    });
    const snap = captureSnapshot(s);
    // Mutate the live state.
    s.spirits.get('rival')!.ai!.cooldowns.miracle = 99;
    s.spirits.get('rival')!.power = 0;
    restoreSnapshot(s, snap);
    expect(s.spirits.get('rival')!.ai!.cooldowns.miracle).toBe(5);
    expect(s.spirits.get('rival')!.power).toBe(4);
  });

  it('road-use tally scrubs with the timeline (raw passes + window anchor revert)', () => {
    const s = createState();
    attachWorld(s);
    s.map!.roadGraph = roadGraphAt(5, 5);
    s.roadUse.sinceTick = 100;
    s.roadUse.noteFootfall(s.map!.roadGraph, 5, 5, 10, 10);
    s.roadUse.noteFootfall(s.map!.roadGraph, 5, 5, 10, 10);
    const snap = captureSnapshot(s);
    // Footfall accrued AFTER capture is the "future" a scrub must undo.
    s.roadUse.noteFootfall(s.map!.roadGraph, 5, 5, 10, 10);
    s.roadUse.sinceTick = 999;
    expect(s.roadUse.rawPasses('e0')).toBe(3);
    restoreSnapshot(s, snap);
    expect(s.roadUse.rawPasses('e0')).toBe(2);           // reverted to capture time
    expect(s.roadUse.serialize().sinceTick).toBe(100);   // window anchor reverted too
  });

  it('a pre-S1 snapshot (no roadUse field) restores to an empty tally', () => {
    const s = createState();
    attachWorld(s);
    s.map!.roadGraph = roadGraphAt(5, 5);
    s.roadUse.noteFootfall(s.map!.roadGraph, 5, 5, 10, 10);
    const snap = captureSnapshot(s);
    delete (snap as { roadUse?: unknown }).roadUse;      // simulate an older save
    restoreSnapshot(s, snap);
    expect(s.roadUse.activeEdges()).toBe(0);
  });

  it('the contention ladder scrubs with the timeline (escalation state reverts)', () => {
    const s = createState();
    attachWorld(s);
    // Drive poi1 to holy war (near-even, populous), then capture.
    const census = new Map([['poi1', new Map([['player', 30], ['rival-1', 28]])]]);
    for (let i = 0; i < 3; i++) s.contention.step(census, new Map(), i);
    expect(s.contention.stateOf('poi1')).toBe('holy_war');
    const snap = captureSnapshot(s);
    // The "future" a scrub must undo: the rivalry collapses and cools away.
    const collapsed = new Map([['poi1', new Map([['player', 30]])]]);
    for (let i = 0; i < 60; i++) s.contention.step(collapsed, new Map(), 100 + i);
    expect(s.contention.stateOf('poi1')).toBe('calm');
    restoreSnapshot(s, snap);
    expect(s.contention.stateOf('poi1')).toBe('holy_war');       // reverted to capture time
    expect(s.contention.claimMultiplier('poi1')).toBeLessThan(1); // teeth restored too
  });

  it('a pre-contention snapshot (no contention field) restores to an empty ledger', () => {
    const s = createState();
    attachWorld(s);
    const census = new Map([['poi1', new Map([['player', 30], ['rival-1', 28]])]]);
    for (let i = 0; i < 3; i++) s.contention.step(census, new Map(), i);
    const snap = captureSnapshot(s);
    delete (snap as { contention?: unknown }).contention;   // simulate an older save
    restoreSnapshot(s, snap);
    expect(s.contention.all()).toEqual([]);
    expect(s.contention.stateOf('poi1')).toBe('calm');
  });
});
