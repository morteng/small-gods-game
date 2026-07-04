// WP-C: faith/mood turning points reach the player. `belief_cross`/`mood_cross`
// used to surface only in the ?legacyui glyph strip; they now derive transient
// low-priority 'tiding' inbox items — event-log windowed (auto-expiring), coalesced
// per settlement, capped, and always ranked below threats/pleas.

import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import {
  createGameQuery, CROSSING_NOTICE_HORIZON_TICKS, MAX_TIDING_ITEMS,
} from '@/game/game-query';
import { createState } from '@/core/state';
import { scoreAffordance } from '@/game/affordance/salience';
import type { Entity, GameMap, NpcProperties } from '@/core/types';

function makeWorld(): World {
  return new World({
    tiles: [], width: 10, height: 10, villages: [], seed: 1,
    success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as GameMap);
}

function addNpc(world: World, id: string, poiId?: string): Entity {
  const props = initNpcProps('Pip', 'farmer', 7) as NpcProperties;
  if (poiId) props.homePoiId = poiId;
  const e = { id, kind: 'npc', x: 2, y: 3, properties: props as unknown as Record<string, unknown> } as Entity;
  world.addEntity(e);
  return e;
}

function build() {
  const world = makeWorld();
  const state = createState();
  state.world = world;
  state.worldSeed = {
    name: 'w', size: { width: 10, height: 10 }, biome: 'temperate',
    pois: [{ id: 'vale', type: 'village', name: 'Vale', position: { x: 5, y: 4 } }],
    connections: [], constraints: [],
  } as unknown as typeof state.worldSeed;
  return { world, state };
}

describe('divineInbox — tidings (faith/mood turning points, WP-C)', () => {
  it('surfaces a belief_cross as a coalesced per-settlement tiding with anchor', () => {
    const { world, state } = build();
    addNpc(world, 'n1', 'vale');
    addNpc(world, 'n2', 'vale');
    state.clock.setNow(100);
    state.eventLog.append({ type: 'belief_cross', npcId: 'n1', spiritId: 'player', kind: 'high', faith: 0.7 });
    state.eventLog.append({ type: 'belief_cross', npcId: 'n2', spiritId: 'player', kind: 'high', faith: 0.65 });
    state.clock.setNow(110);

    const inbox = createGameQuery({ state }).divineInbox();
    const tidings = inbox.filter(i => i.kind === 'tiding');
    expect(tidings).toHaveLength(1); // coalesced: one item for Vale, not two
    const t = tidings[0];
    expect(t.id).toBe('cross:vale');
    expect(t.title).toBe('Faith rises in Vale');
    expect(t.detail).toContain('2 soul(s) crossed into belief');
    expect(t.target).toEqual({ kind: 'settlement', poiId: 'vale' });
    expect(t.anchor).toEqual({ x: 5, y: 4 });
  });

  it('titles falls and mixes distinctly; folds mood crossings in', () => {
    const { world, state } = build();
    addNpc(world, 'n1', 'vale');
    addNpc(world, 'n2', 'vale');
    state.clock.setNow(100);
    state.eventLog.append({ type: 'belief_cross', npcId: 'n1', spiritId: 'player', kind: 'low', faith: 0.2 });
    state.eventLog.append({ type: 'mood_cross', npcId: 'n2', kind: 'low', mood: 0.2 });
    const inbox = createGameQuery({ state }).divineInbox();
    const t = inbox.find(i => i.id === 'cross:vale')!;
    expect(t.title).toBe('Faith falters in Vale');
    expect(t.detail).toContain('1 fell away');
    expect(t.detail).toContain('1 mood(s) turned');
  });

  it('auto-expires: crossings older than the horizon produce no item', () => {
    const { world, state } = build();
    addNpc(world, 'n1', 'vale');
    state.clock.setNow(100);
    state.eventLog.append({ type: 'belief_cross', npcId: 'n1', spiritId: 'player', kind: 'high', faith: 0.7 });
    state.clock.setNow(100 + CROSSING_NOTICE_HORIZON_TICKS + 1);
    const inbox = createGameQuery({ state }).divineInbox();
    expect(inbox.filter(i => i.kind === 'tiding')).toHaveLength(0);
  });

  it('ignores crossings toward OTHER spirits (a rival faith turn is not your news)', () => {
    const { world, state } = build();
    addNpc(world, 'n1', 'vale');
    state.clock.setNow(100);
    state.eventLog.append({ type: 'belief_cross', npcId: 'n1', spiritId: 'rival', kind: 'high', faith: 0.7 });
    const inbox = createGameQuery({ state }).divineInbox();
    expect(inbox.filter(i => i.kind === 'tiding')).toHaveLength(0);
  });

  it('caps concurrent tidings at MAX_TIDING_ITEMS across settlements', () => {
    const { world, state } = build();
    state.clock.setNow(100);
    for (let i = 0; i < MAX_TIDING_ITEMS + 2; i++) {
      addNpc(world, `n${i}`, `poi${i}`);
      state.eventLog.append({ type: 'belief_cross', npcId: `n${i}`, spiritId: 'player', kind: 'high', faith: 0.7 });
    }
    const inbox = createGameQuery({ state }).divineInbox();
    expect(inbox.filter(i => i.kind === 'tiding')).toHaveLength(MAX_TIDING_ITEMS);
  });

  it('never outranks threats/pleas: tiding salience stays below the 0.4 threat floor', () => {
    // The scoring contract itself…
    expect(scoreAffordance({ kind: 'tiding', count: 999 })).toBeLessThan(0.4);
    expect(scoreAffordance({ kind: 'threat', rivalBelievers: 1 })).toBeGreaterThanOrEqual(0.4);
    // …and in a live inbox with both present, the threat sorts first.
    const { world, state } = build();
    const apostate = addNpc(world, 'apostate', 'vale');
    (apostate.properties as unknown as NpcProperties).beliefs['rival'] = { faith: 0.6, understanding: 0, devotion: 0 };
    state.spirits.set('rival', { id: 'rival', name: 'Rival', sigil: '×', color: '#000', isPlayer: false, power: 50, manifestation: null });
    state.clock.setNow(100);
    state.eventLog.append({ type: 'belief_cross', npcId: 'apostate', spiritId: 'player', kind: 'low', faith: 0.1 });
    const inbox = createGameQuery({ state }).divineInbox();
    const threatIdx = inbox.findIndex(i => i.kind === 'threat');
    const tidingIdx = inbox.findIndex(i => i.kind === 'tiding');
    expect(threatIdx).toBeGreaterThanOrEqual(0);
    expect(tidingIdx).toBeGreaterThan(threatIdx);
  });

  it('falls back to an npc-targeted tiding for the homeless', () => {
    const { world, state } = build();
    addNpc(world, 'drifter'); // no homePoiId
    state.clock.setNow(100);
    state.eventLog.append({ type: 'belief_cross', npcId: 'drifter', spiritId: 'player', kind: 'high', faith: 0.7 });
    const inbox = createGameQuery({ state }).divineInbox();
    const t = inbox.find(i => i.kind === 'tiding')!;
    expect(t.id).toBe('cross:npc:drifter');
    expect(t.target).toEqual({ kind: 'npc', npcId: 'drifter' });
    expect(t.anchor).toEqual({ x: 2, y: 3 });
  });
});
