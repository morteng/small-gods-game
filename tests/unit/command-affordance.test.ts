import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { EventLog } from '@/core/events';
import { initNpcProps } from '@/world/npc-helpers';
import { addDomainBelief } from '@/sim/belief-domains';
import type { Entity, GameMap, NpcProperties } from '@/core/types';
import type { Spirit, SpiritId } from '@/core/spirit';
import type { Command, CommandCtx, CommandTarget } from '@/sim/command/types';
import { derivePreview } from '@/sim/command/preview';
import { SMITE_COST, WHISPER_COST } from '@/sim/divine-actions';
import { affordancesForTarget } from '@/game/affordance/derive';

// ── scaffolding ────────────────────────────────────────────────────────────────
function makeWorld(): World {
  return new World({
    tiles: [], width: 10, height: 10, villages: [], seed: 1,
    success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as GameMap);
}
function spirit(id: string, power = 100): Spirit {
  return { id, name: id, sigil: '*', color: '#fff', isPlayer: true, power, manifestation: null };
}
function addNpc(world: World, id: string, seed: number, opts: { faith?: number; devotion?: number; storm?: number } = {}): Entity {
  const props = initNpcProps('Pip', 'farmer', seed) as NpcProperties;
  props.beliefs = { player: { faith: opts.faith ?? 0.5, understanding: 0.5, devotion: opts.devotion ?? 0.2 } };
  if (opts.storm !== undefined) addDomainBelief(props, 'player', 'storm', opts.storm);
  const e = { id, kind: 'npc', x: 0, y: 0, properties: props as unknown as Record<string, unknown> } as Entity;
  world.addEntity(e);
  return e;
}
function ctxWith(world: World, power = 100): CommandCtx {
  const spirits = new Map<SpiritId, Spirit>([['player', spirit('player', power)]]);
  return { world, spirits, log: new EventLog(new SimClock()) };
}
function cmd(verb: Command['verb'], target: CommandTarget): Command {
  return { verb, source: 'player', target, seq: 0 };
}

describe('derivePreview — structured preview over previewCommand', () => {
  it('reports cost + affordable + null block when the command would apply', () => {
    const world = makeWorld();
    const e = addNpc(world, 'n1', 1);
    const p = derivePreview(cmd('whisper', { kind: 'npc', npcId: e.id }), ctxWith(world));
    expect(p).toEqual({ cost: WHISPER_COST, affordable: true, blockedReason: null });
  });

  it('marks insufficient_power as unaffordable', () => {
    const world = makeWorld();
    const e = addNpc(world, 'n1', 1);
    const p = derivePreview(cmd('whisper', { kind: 'npc', npcId: e.id }), ctxWith(world, WHISPER_COST - 1));
    expect(p.affordable).toBe(false);
    expect(p.blockedReason).toBe('insufficient_power');
  });

  it('a belief-locked verb the spirit CAN pay for is affordable but precondition-blocked', () => {
    const world = makeWorld();
    const e = addNpc(world, 'n1', 1, { faith: 0.5, storm: 0 }); // congregation does not yet believe in the storm
    const p = derivePreview(cmd('smite', { kind: 'npc', npcId: e.id }), ctxWith(world, SMITE_COST + 5));
    expect(p.cost).toBe(SMITE_COST);
    expect(p.affordable).toBe(true);
    expect(p.blockedReason).toBe('precondition_failed');
  });
});

describe('affordancesForTarget — registry ∩ belief-unlock ∩ preview', () => {
  it('derives the npc-verb set with branch/leaf shapes', () => {
    const world = makeWorld();
    const e = addNpc(world, 'n1', 1);
    const affs = affordancesForTarget({ kind: 'npc', npcId: e.id }, 'player', ctxWith(world), []);
    const byVerb = new Map(affs.map((a) => [a.verb, a]));
    // divine npc verbs
    expect(new Set(affs.map((a) => a.verb))).toEqual(new Set(['whisper', 'answer_prayer', 'dream', 'probe_mind', 'smite']));
    // influence/speech verbs branch; visceral/utility verbs are leaves
    expect(byVerb.get('whisper')!.shape).toBe('branch');
    expect(byVerb.get('dream')!.shape).toBe('branch');
    expect(byVerb.get('answer_prayer')!.shape).toBe('branch');
    expect(byVerb.get('smite')!.shape).toBe('leaf');
    // all point footprints in v1
    expect(affs.every((a) => a.footprint === 'point')).toBe(true);
  });

  it('reflects belief-unlock: locked verbs are included but marked unlocked=false', () => {
    const world = makeWorld();
    const e = addNpc(world, 'n1', 1);
    const target: CommandTarget = { kind: 'npc', npcId: e.id };
    const locked = affordancesForTarget(target, 'player', ctxWith(world), [{ verb: 'smite', unlocked: false }]);
    expect(locked.find((a) => a.verb === 'smite')!.unlocked).toBe(false);
    // ungated verbs are always unlocked regardless of the unlocks list
    expect(locked.find((a) => a.verb === 'whisper')!.unlocked).toBe(true);
    const unlocked = affordancesForTarget(target, 'player', ctxWith(world), [{ verb: 'smite', unlocked: true }]);
    expect(unlocked.find((a) => a.verb === 'smite')!.unlocked).toBe(true);
  });

  it('derives settlement verbs for a settlement target', () => {
    const world = makeWorld();
    const affs = affordancesForTarget({ kind: 'settlement', poiId: 'vale' }, 'player', ctxWith(world), []);
    expect(new Set(affs.map((a) => a.verb))).toEqual(new Set(['omen', 'miracle', 'summon_storm']));
  });
});
