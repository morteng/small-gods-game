import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { initNpcProps } from '@/world/npc-helpers';
import type { Entity, GameMap, NpcProperties } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';
import type { CommandCtx } from '@/sim/command/types';
import { buildSituation, hoverChips } from '@/game/affordance/hover';

// ── scaffolding (mirrors command-affordance.test.ts) ─────────────────────────────
function makeWorld(): World {
  return new World({
    tiles: [], width: 10, height: 10, villages: [], seed: 1,
    success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as GameMap);
}
function spirit(id: string, power = 100): Spirit {
  return { id, name: id, sigil: '*', color: '#fff', isPlayer: true, power, manifestation: null };
}
function addNpc(world: World, id: string, opts: { worship?: boolean; faith?: number; meaning?: number } = {}): Entity {
  const props = initNpcProps('Pip', 'farmer', 1) as NpcProperties;
  props.beliefs = { player: { faith: opts.faith ?? 0.6, understanding: 0.5, devotion: 0.3 } };
  if (opts.worship) props.activity = 'worship';
  if (opts.meaning !== undefined) props.needs.meaning = opts.meaning;
  const e = { id, kind: 'npc', x: 0, y: 0, properties: props as unknown as Record<string, unknown> } as Entity;
  world.addEntity(e);
  return e;
}
function ctxWith(world: World, power = 100): CommandCtx {
  const spirits = new Map<SpiritId, Spirit>([['player', spirit('player', power)]]);
  return { world, spirits, log: new EventLog(new SimClock()) };
}

describe('buildSituation — the hover local lens mirrors the inbox', () => {
  it('reads a praying NPC as a prayer situation (faith × meaning-deficit, "praying")', () => {
    const world = makeWorld();
    const e = addNpc(world, 'n1', { worship: true, faith: 0.8, meaning: 0.25 });
    const tag = buildSituation({ kind: 'npc', npcId: e.id }, ctxWith(world), 'player');
    expect(tag).not.toBeNull();
    expect(tag!.situation).toEqual({ kind: 'prayer', faith: 0.8, needDeficit: 0.75 });
    expect(tag!.why).toBe('praying');
  });

  it('a plea with a SUBJECT (M0.b) scores by that need and names it in the why-tag', () => {
    const world = makeWorld();
    const e = addNpc(world, 'n1', { worship: true, faith: 0.8, meaning: 0.9 });
    const p = e.properties as unknown as NpcProperties;
    p.prayerNeed = 'prosperity';
    p.needs.prosperity = 0.1;
    const tag = buildSituation({ kind: 'npc', npcId: e.id }, ctxWith(world), 'player');
    expect(tag!.situation).toEqual({ kind: 'prayer', faith: 0.8, needDeficit: 0.9 });
    expect(tag!.why).toBe('prays for bread');
  });

  it('an idle (non-worshipping) NPC carries no situation', () => {
    const world = makeWorld();
    const e = addNpc(world, 'n1', { worship: false });
    expect(buildSituation({ kind: 'npc', npcId: e.id }, ctxWith(world), 'player')).toBeNull();
  });

  it('reads an ominous settlement event as an opportunity tagged with the event type', () => {
    const world = makeWorld();
    world.activeEvents.set('vale', [
      { type: 'festival', poiId: 'vale', severity: 0.9, durationTicks: 100, ticksElapsed: 0 },
      { type: 'drought', poiId: 'vale', severity: 0.6, durationTicks: 100, ticksElapsed: 0 },
    ]);
    const tag = buildSituation({ kind: 'settlement', poiId: 'vale' }, ctxWith(world), 'player');
    expect(tag).toEqual({ situation: { kind: 'opportunity', severity: 0.6 }, why: 'drought' });
  });

  it('a settlement with only benign events carries no situation', () => {
    const world = makeWorld();
    world.activeEvents.set('vale', [{ type: 'festival', poiId: 'vale', severity: 0.9, durationTicks: 100, ticksElapsed: 0 }]);
    expect(buildSituation({ kind: 'settlement', poiId: 'vale' }, ctxWith(world), 'player')).toBeNull();
  });
});

describe('hoverChips — top ranked affordances for the cursor', () => {
  it('floats the situation-preferred verb (answer_prayer) to the top for a praying NPC', () => {
    const world = makeWorld();
    const e = addNpc(world, 'n1', { worship: true, faith: 0.7, meaning: 0.3 });
    const chips = hoverChips({ kind: 'npc', npcId: e.id }, 'player', ctxWith(world), []);
    expect(chips.length).toBeGreaterThan(0);
    expect(chips.length).toBeLessThanOrEqual(3);
    expect(chips[0].verb).toBe('answer_prayer');
    expect(chips[0].why).toBe('praying'); // the why-tag rides only the preferred verb
    expect(chips.slice(1).every((c) => c.why === null)).toBe(true);
  });

  it('marks a belief-locked verb unaffordable/locked and ranks it below castable ones', () => {
    const world = makeWorld();
    const e = addNpc(world, 'n1', { worship: false });
    // smite locked (congregation doesn't believe it); whisper open. max wide enough
    // for EVERY npc verb — this test pins ranking, not the cap (the cap has its own
    // assertion above), and a locked verb ranks last so a tight cap would drop it.
    const chips = hoverChips({ kind: 'npc', npcId: e.id }, 'player', ctxWith(world), [{ verb: 'smite', unlocked: false }], 10);
    const smite = chips.find((c) => c.verb === 'smite');
    const whisper = chips.find((c) => c.verb === 'whisper');
    expect(smite!.unlocked).toBe(false);
    expect(whisper!.unlocked).toBe(true);
    expect(chips.indexOf(whisper!)).toBeLessThan(chips.indexOf(smite!));
  });

  it('derives place-verbs (omen preferred) for a settlement in ominous straits', () => {
    const world = makeWorld();
    world.activeEvents.set('vale', [{ type: 'plague', poiId: 'vale', severity: 0.8, durationTicks: 100, ticksElapsed: 0 }]);
    const chips = hoverChips({ kind: 'settlement', poiId: 'vale' }, 'player', ctxWith(world), []);
    expect(chips[0].verb).toBe('omen');
    expect(chips[0].why).toBe('plague');
    expect(new Set(chips.map((c) => c.verb)).size).toBe(chips.length); // no dupes
  });
});
