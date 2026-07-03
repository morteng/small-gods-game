import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import { createGameQuery } from '@/game/game-query';
import { createState } from '@/core/state';
import type { Entity, GameMap, NpcProperties, ActiveEvent } from '@/core/types';
import type { Spirit } from '@/core/spirit';
import { scoreAffordance, FATE_SURFACE_BOOST } from '@/game/affordance/salience';

// ── deterministic scaffolding (fixed seeds → stable needs/personality) ─────────
// This is the P0 GOLDEN for `divineInbox`. It pins the exact salience-ranked output
// so the `scoreAffordance` extraction can be proven byte-identical (spec gate 7).
function makeWorld(): World {
  return new World({
    tiles: [], width: 10, height: 10, villages: [], seed: 1,
    success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as GameMap);
}
function addNpc(
  world: World,
  id: string,
  seed: number,
  opts: { faith?: number; activity?: string; rivalFaith?: number; rivalId?: string } = {},
): Entity {
  const props = initNpcProps('Pip', 'farmer', seed) as NpcProperties;
  props.beliefs = { player: { faith: opts.faith ?? 0.5, understanding: 0.5, devotion: 0.2 } };
  if (opts.rivalId) props.beliefs[opts.rivalId] = { faith: opts.rivalFaith ?? 0, understanding: 0, devotion: 0 };
  if (opts.activity) props.activity = opts.activity as NpcProperties['activity'];
  const e = { id, kind: 'npc', x: 0, y: 0, properties: props as unknown as Record<string, unknown> } as Entity;
  world.addEntity(e);
  return e;
}
function activeEvent(type: ActiveEvent['type'], poiId: string, severity: number): ActiveEvent {
  return { type, poiId, severity, durationTicks: 100, ticksElapsed: 0 };
}
function rival(id: string): Spirit {
  return { id, name: 'Rival', sigil: '×', color: '#000', isPlayer: false, power: 50, manifestation: null };
}

describe('divineInbox — P0 golden (byte-identical across scoreAffordance extraction)', () => {
  function build() {
    const world = makeWorld();
    const state = createState();
    state.world = world;
    state.spirits.set('rival', rival('rival'));
    // two prayers (distinct faith → distinct salience), one rival-believer for the threat,
    // and a drought opportunity over 'vale'.
    addNpc(world, 'pray-hi', 11, { faith: 0.8, activity: 'worship' });
    addNpc(world, 'pray-lo', 22, { faith: 0.3, activity: 'worship' });
    addNpc(world, 'apostate', 33, { faith: 0.1, rivalId: 'rival', rivalFaith: 0.6 });
    world.activeEvents.set('vale', [activeEvent('drought', 'vale', 0.9)]);
    return { world, state };
  }

  it('ranks prayers + opportunity + threat deterministically', () => {
    const { state } = build();
    const inbox = createGameQuery({ state }).divineInbox();
    expect(inbox).toMatchSnapshot();
  });

  it('Fate surfacing boosts a promoted item to the top by +1', () => {
    const { state } = build();
    state.surfacedInbox.add('threat:rival');
    const inbox = createGameQuery({ state }).divineInbox();
    expect(inbox[0].id).toBe('threat:rival');
    expect(inbox[0].surfaced).toBe(true);
    expect(inbox).toMatchSnapshot();
  });
});

// ── P5: world anchors on inbox items (drive the zoomed-out alert pins) ──────────
describe('divineInbox — P5 anchor derivation', () => {
  it('derives npc / settlement anchors and omits the anchor for placeless threats', () => {
    const world = makeWorld();
    const state = createState();
    state.world = world;
    state.spirits.set('rival', rival('rival'));
    const praying = addNpc(world, 'pray-hi', 11, { faith: 0.8, activity: 'worship' });
    world.updateEntity(praying.id, { x: 3, y: 7 }); // dual-index safe position move
    addNpc(world, 'apostate', 33, { faith: 0.1, rivalId: 'rival', rivalFaith: 0.6 });
    world.activeEvents.set('vale', [activeEvent('drought', 'vale', 0.9)]);
    state.worldSeed = {
      name: 'w', size: { width: 10, height: 10 }, biome: 'temperate',
      pois: [{ id: 'vale', type: 'village', name: 'Vale', position: { x: 5, y: 4 } }],
      connections: [], constraints: [],
    } as unknown as typeof state.worldSeed;

    const inbox = createGameQuery({ state }).divineInbox();
    const byId = new Map(inbox.map((it) => [it.id, it]));
    expect(byId.get('prayer:pray-hi')?.anchor).toEqual({ x: 3, y: 7 });   // npc → entity pos
    expect(byId.get('opp:vale')?.anchor).toEqual({ x: 5, y: 4 });         // settlement → poi pos
    expect(byId.get('threat:rival')?.anchor).toBeUndefined();             // none → omitted
  });

  it('omits the anchor when a settlement poi has no resolvable position', () => {
    const world = makeWorld();
    const state = createState();
    state.world = world;
    world.activeEvents.set('vale', [activeEvent('drought', 'vale', 0.9)]);
    const inbox = createGameQuery({ state }).divineInbox(); // no worldSeed at all
    expect(inbox.find((it) => it.id === 'opp:vale')?.anchor).toBeUndefined();
  });
});

// ── Track-3: rival-claim threats surface in the inbox ──────────────────────────
describe('divineInbox — rival prayer claims (Track 3)', () => {
  function rivalWithAi(id: string, settlements: string[]): Spirit {
    return {
      id, name: 'Sablethorn', sigil: '◆', color: '#a0f', isPlayer: false, power: 50, manifestation: null,
      ai: {
        policy: 'coexist', cooldowns: {},
        personality: { aggression: 0.3, subtlety: 0.5, territoriality: 0.5, assertiveness: 0.3, jealousy: 0.3 },
        settlements, lastActionTick: 0, actionCooldown: 0,
      },
    };
  }

  it('surfaces a contested prayer (aging, claimant present) as a threat item', () => {
    const world = makeWorld();
    const state = createState();
    state.world = world;
    state.clock.setNow(200);
    state.spirits.set('rival', rivalWithAi('rival', ['poi1']));
    const e = addNpc(world, 'pleader', 11, { faith: 0.6, activity: 'worship' });
    (e.properties as unknown as NpcProperties).homePoiId = 'poi1';
    (e.properties as unknown as NpcProperties).prayerSince = 100; // age 100 ≥ warning (72)

    const inbox = createGameQuery({ state }).divineInbox();
    const item = inbox.find(i => i.id === 'contest:pleader');
    expect(item).toBeDefined();
    expect(item!.kind).toBe('threat');
    expect(item!.target).toEqual({ kind: 'npc', npcId: 'pleader' });
    expect(item!.anchor).toEqual({ x: 0, y: 0 });
    // Contested outranks an ordinary prayer of the same faith.
    expect(item!.salience).toBeGreaterThan(0.6);
  });

  it('does NOT contest when no rival holds the settlement', () => {
    const world = makeWorld();
    const state = createState();
    state.world = world;
    state.clock.setNow(200);
    state.spirits.set('rival', rivalWithAi('rival', ['elsewhere']));
    const e = addNpc(world, 'pleader', 11, { faith: 0.6, activity: 'worship' });
    (e.properties as unknown as NpcProperties).homePoiId = 'poi1';
    (e.properties as unknown as NpcProperties).prayerSince = 100;

    const inbox = createGameQuery({ state }).divineInbox();
    expect(inbox.find(i => i.id === 'contest:pleader')).toBeUndefined();
    // It is still an ordinary prayer, though.
    expect(inbox.find(i => i.id === 'prayer:pleader')).toBeDefined();
  });

  it('surfaces a recent rival claim (answer_prayer by a rival) as a threat item', () => {
    const world = makeWorld();
    const state = createState();
    state.world = world;
    state.clock.setNow(300);
    state.spirits.set('rival', rivalWithAi('rival', ['poi1']));
    const e = addNpc(world, 'taken', 11, { faith: 0.2 });
    (e.properties as unknown as NpcProperties).homePoiId = 'poi1';
    // The claim happened as a logged answer_prayer by the rival at tick 290.
    state.clock.setNow(290);
    const appended = state.eventLog.append({ type: 'answer_prayer', spiritId: 'rival', npcId: 'taken' });
    state.clock.setNow(300);

    const inbox = createGameQuery({ state }).divineInbox();
    const item = inbox.find(i => i.id === `claimed:${appended.id}`);
    expect(item).toBeDefined();
    expect(item!.kind).toBe('threat');
    expect(item!.target).toEqual({ kind: 'npc', npcId: 'taken' });
    // A loss is the most salient threat there is.
    expect(item!.salience).toBeGreaterThan(0.9);
    // The player's own answers never surface as a claim.
    state.eventLog.append({ type: 'answer_prayer', spiritId: 'player', npcId: 'taken' });
    const inbox2 = createGameQuery({ state }).divineInbox();
    expect(inbox2.filter(i => i.kind === 'threat' && i.id.startsWith('claimed:')).length).toBe(1);
  });
});

// ── the extracted salience brain, directly (shared by inbox + hover P3) ─────────
describe('scoreAffordance — the shared salience brain', () => {
  it('reproduces the inbox formulas per situation kind', () => {
    expect(scoreAffordance({ kind: 'prayer', faith: 0.8, meaningDeficit: 0.5 }))
      .toBeCloseTo(0.8 * (0.4 + 0.6 * 0.5), 12);
    expect(scoreAffordance({ kind: 'opportunity', severity: 0.9 })).toBeCloseTo(0.95, 12);
    expect(scoreAffordance({ kind: 'threat', rivalBelievers: 1 })).toBeCloseTo(0.45, 12);
  });
  it('caps the threat term at +0.5 above the floor', () => {
    expect(scoreAffordance({ kind: 'threat', rivalBelievers: 999 })).toBeCloseTo(0.9, 12);
  });
  it('adds the Fate boost only when surfaced', () => {
    const base = scoreAffordance({ kind: 'opportunity', severity: 0.9 });
    expect(scoreAffordance({ kind: 'opportunity', severity: 0.9, surfaced: true }))
      .toBeCloseTo(base + FATE_SURFACE_BOOST, 12);
  });
});
