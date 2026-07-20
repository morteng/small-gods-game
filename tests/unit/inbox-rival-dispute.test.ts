// D7 (rival power-economics + contention, docs/superpowers/specs/
// 2026-07-20-rival-power-economics-contention.md): `rival_dispute` events (D6,
// logged by the sim's RivalSystem when one non-player rival's action targets
// another) reach the player as a coalesced per-settlement tiding —
// "Spirits contend over {settlement}" — event-log windowed and auto-expiring,
// same pattern as the belief/mood crossings (WP-C) and claim notices (Track 3).
//
// Synthetic events are injected straight into the log rather than driving the
// real rival system — the generator's contract is the event, not the emitter.

import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import {
  createGameQuery, RIVAL_DISPUTE_NOTICE_HORIZON_TICKS,
} from '@/game/game-query';
import { createState } from '@/core/state';
import type { Entity, GameMap, NpcProperties } from '@/core/types';
import type { SpiritId } from '@/core/spirit';

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

/** Append a synthetic `rival_dispute` (D6 shape) — the inbox generator reads
 *  the log, so tests inject events directly instead of driving `RivalSystem`. */
function appendDispute(
  state: ReturnType<typeof createState>,
  spiritId: SpiritId,
  otherRivalId: SpiritId,
  poiId: string,
) {
  state.eventLog.append({ type: 'rival_dispute', spiritId, data: { otherRivalId, poiId } });
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

describe('divineInbox — rival contention tidings (D7)', () => {
  it('surfaces a rival_dispute as a coalesced per-settlement tiding with anchor', () => {
    const { state } = build();
    state.clock.setNow(100);
    appendDispute(state, 'rival1', 'rival2', 'vale');
    state.clock.setNow(110);

    const inbox = createGameQuery({ state }).divineInbox();
    const item = inbox.find(i => i.id === 'dispute:vale');
    expect(item).toBeDefined();
    expect(item!.kind).toBe('tiding');
    expect(item!.title).toBe('Spirits contend over Vale');
    expect(item!.target).toEqual({ kind: 'settlement', poiId: 'vale' });
    expect(item!.anchor).toEqual({ x: 5, y: 4 });
  });

  it('coalesces multiple disputes in one settlement into ONE item', () => {
    const { state } = build();
    state.clock.setNow(100);
    appendDispute(state, 'rival1', 'rival2', 'vale');
    appendDispute(state, 'rival2', 'rival1', 'vale');
    appendDispute(state, 'rival1', 'rival3', 'vale');
    state.clock.setNow(110);

    const inbox = createGameQuery({ state }).divineInbox();
    const disputeItems = inbox.filter(i => i.id.startsWith('dispute:'));
    expect(disputeItems).toHaveLength(1);
    expect(disputeItems[0].detail).toContain('3 disputes');
  });

  it('auto-expires: disputes older than the horizon produce no item', () => {
    const { state } = build();
    state.clock.setNow(100);
    appendDispute(state, 'rival1', 'rival2', 'vale');
    state.clock.setNow(100 + RIVAL_DISPUTE_NOTICE_HORIZON_TICKS + 1);

    const inbox = createGameQuery({ state }).divineInbox();
    expect(inbox.find(i => i.id === 'dispute:vale')).toBeUndefined();
  });

  it('omits the anchor when the settlement has no resolvable POI position', () => {
    const world = makeWorld();
    const state = createState();
    state.world = world;
    // no worldSeed at all ⇒ poi lookup can never resolve
    state.clock.setNow(100);
    appendDispute(state, 'rival1', 'rival2', 'ghost-poi');

    const inbox = createGameQuery({ state }).divineInbox();
    const item = inbox.find(i => i.id === 'dispute:ghost-poi');
    expect(item).toBeDefined();
    expect(item!.anchor).toBeUndefined();
    expect(item!.title).toBe('Spirits contend over ghost-poi');
  });

  it('stays a low-salience tiding, never outranking a threat', () => {
    const { world, state } = build();
    const apostate = addNpc(world, 'apostate', 'vale');
    (apostate.properties as unknown as NpcProperties).beliefs['rival'] = { faith: 0.6, understanding: 0, devotion: 0 };
    state.spirits.set('rival', { id: 'rival', name: 'Rival', sigil: '×', color: '#000', isPlayer: false, power: 50, manifestation: null });
    state.clock.setNow(100);
    appendDispute(state, 'rival1', 'rival2', 'vale');

    const inbox = createGameQuery({ state }).divineInbox();
    const threatIdx = inbox.findIndex(i => i.kind === 'threat');
    const disputeIdx = inbox.findIndex(i => i.id === 'dispute:vale');
    expect(threatIdx).toBeGreaterThanOrEqual(0);
    expect(disputeIdx).toBeGreaterThan(threatIdx);
  });
});
