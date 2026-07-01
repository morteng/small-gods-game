import { describe, it, expect } from 'vitest';
import { buildWhisperCard, dominantNeed, dominantDomain } from '@/game/affordance/whisper-card';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import type { GameMap, Tile, NpcProperties, ActiveEvent } from '@/core/types';
import type { CommandCtx, CommandTarget } from '@/sim/command/types';

function miniMap(w = 8, h = 8): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < h; y++) {
    tiles[y] = [];
    for (let x = 0; x < w; x++) tiles[y][x] = { type: 'grass', x, y, walkable: true, state: 'realized' };
  }
  return { tiles, width: w, height: h, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

function makeWorld(patch: Partial<NpcProperties>): World {
  const world = new World(miniMap());
  const props = { ...initNpcProps('Ada', 'farmer', 65), ...patch };
  world.addEntity({ id: 'n1', kind: 'npc', x: 1, y: 1, tags: [], properties: props } as any);
  return world;
}

function ctxOf(world: World): CommandCtx {
  // buildWhisperCard reads only ctx.world; a stub log/spirits keeps the fixture light.
  return { world, spirits: new Map(), log: {} as any };
}

const N1: CommandTarget = { kind: 'npc', npcId: 'n1' };

function event(type: ActiveEvent['type'], severity: number): ActiveEvent {
  return { type, poiId: 'poi1', severity, durationTicks: 100, ticksElapsed: 0 } as ActiveEvent;
}

describe('dominantNeed / dominantDomain', () => {
  it('picks the most acute (lowest) need, tie-broken by order', () => {
    expect(dominantNeed({ safety: 0.9, prosperity: 0.2, community: 0.5, meaning: 0.8 })).toBe('prosperity');
    // a tie resolves to the earliest in NEED_ORDER (safety before community)
    expect(dominantNeed({ safety: 0.1, prosperity: 0.9, community: 0.1, meaning: 0.9 })).toBe('safety');
  });

  it('picks the strongest domain belief above epsilon, else null', () => {
    const p = { domains: { player: { storm: 0.4, flood: 0.1 } } } as unknown as NpcProperties;
    expect(dominantDomain(p, 'player')).toBe('storm');
    expect(dominantDomain({} as NpcProperties, 'player')).toBeNull();
  });
});

describe('buildWhisperCard', () => {
  it('returns null for a non-NPC target or a missing NPC', () => {
    const world = makeWorld({});
    expect(buildWhisperCard({ kind: 'settlement', poiId: 'p' }, 'player', ctxOf(world))).toBeNull();
    expect(buildWhisperCard({ kind: 'npc', npcId: 'gone' }, 'player', ctxOf(world))).toBeNull();
  });

  it('always offers a soothe-the-need path with an NPC feeling line and belief bars', () => {
    const world = makeWorld({
      needs: { safety: 0.15, prosperity: 0.8, community: 0.8, meaning: 0.8 },
      beliefs: { player: { faith: 0.6, understanding: 0.3, devotion: 0.4 } },
    });
    const card = buildWhisperCard(N1, 'player', ctxOf(world))!;
    expect(card.title).toBe('Whisper to Ada');
    expect(card.body.some((b) => b.kind === 'npcLine' && b.who === 'Ada')).toBe(true);
    expect(card.body.some((b) => b.kind === 'beliefBar' && b.label === 'Faith')).toBe(true);
    // the acute deficit (safety) drives the always-present first path
    const first = card.choices[0];
    expect(first.command.verb).toBe('whisper');
    expect(first.command.params?.slant).toBe('need:safety');
    expect(typeof (first.command.payload as any)?.text).toBe('string');
    // with no event and no domain belief, a second affirm path backfills (≥2 choices)
    expect(card.choices.length).toBeGreaterThanOrEqual(2);
    expect(card.choices.some((c) => c.command.params?.slant === 'affirm')).toBe(true);
  });

  it('adds a name-the-omen path + an omen block when an ominous event grips the home', () => {
    const world = makeWorld({ homePoiId: 'poi1' });
    world.activeEvents.set('poi1', [event('festival', 0.9), event('drought', 0.7)]); // ignores non-ominous
    const card = buildWhisperCard(N1, 'player', ctxOf(world))!;
    expect(card.body.some((b) => b.kind === 'omen')).toBe(true);
    expect(card.choices.some((c) => c.command.params?.slant === 'event:drought')).toBe(true);
  });

  it('adds an affirm-the-domain path when the NPC already leans toward a power', () => {
    const world = makeWorld({ domains: { player: { storm: 0.4 } } });
    const card = buildWhisperCard(N1, 'player', ctxOf(world))!;
    expect(card.choices.some((c) => c.command.params?.slant === 'domain:storm')).toBe(true);
  });

  it('caps at 3 paths and is deterministic (same state ⇒ identical spec)', () => {
    const build = () => {
      const world = makeWorld({
        homePoiId: 'poi1',
        needs: { safety: 0.1, prosperity: 0.9, community: 0.9, meaning: 0.9 },
        domains: { player: { flood: 0.5 } },
      });
      world.activeEvents.set('poi1', [event('plague', 0.6)]);
      return buildWhisperCard(N1, 'player', ctxOf(world))!;
    };
    const a = build();
    const b = build();
    expect(a.choices).toHaveLength(3); // need + event + domain
    expect(a).toEqual(b);
  });
});
