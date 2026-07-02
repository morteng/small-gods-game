import { describe, it, expect } from 'vitest';
import {
  StorySession, createBusStoryHost, busAllowedVerbs,
  parsePack, STORY_PACK_SCHEMA,
  FateDirector, warmEnrichment, chooseNext, collectEnrichHints, snapshotScope, Scope,
} from '@/story';
import type { StoryPack, StoryAgent, EnrichmentCache } from '@/story';
import type { GameBus, CapabilityView } from '@/game/game-bus';
import type { Command } from '@/sim/command/types';
import { droughtOmenPack } from '@/story/samples/the-drought-omen';

// ── A fake GameBus that records emitted commands and serves canned query data ──
function fakeBus(verbs: string[], queryData: Record<string, unknown> = {}): {
  bus: GameBus; emitted: Command[];
} {
  const emitted: Command[] = [];
  const caps: CapabilityView[] = verbs.map((verb) => ({
    verb: verb as Command['verb'], tier: 'divine', cost: 1, targetKind: 'npc', targetKinds: ['npc'], implemented: true,
  }));
  const bus = {
    emit: (cmd: Omit<Command, 'seq'>) => emitted.push({ ...cmd, seq: emitted.length }),
    preview: () => null,
    capabilities: () => caps,
    query: {
      npc: (id: string) => (queryData.npc as Record<string, unknown>)?.[id] ?? null,
      beliefState: () => queryData.belief ?? {},
      timeline: () => ({ currentTick: queryData.tick ?? 0 }),
      worldSummary: () => queryData.world ?? {},
    } as unknown as GameBus['query'],
    subscribe: () => () => {},
  } as GameBus;
  return { bus, emitted };
}

describe('bus story host', () => {
  it('maps an effect to a Command and emits it on the bus', () => {
    const { bus, emitted } = fakeBus(['omen']);
    const host = createBusStoryHost(bus, { source: 'player' });
    host.dispatch({ verb: 'omen', args: { npc: 'elder-1', kind: 'clouds', intensity: 3 } });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      verb: 'omen', source: 'player',
      target: { kind: 'npc', npcId: 'elder-1' },
      params: { kind: 'clouds', intensity: 3 },
    });
  });

  it('drops effects whose verb is not a registered capability (sandbox)', () => {
    const { bus, emitted } = fakeBus(['omen']);
    const host = createBusStoryHost(bus, { source: 'player' });
    host.dispatch({ verb: 'rm_rf', args: {} });
    expect(emitted).toHaveLength(0);
  });

  it('busAllowedVerbs feeds the validator allowlist', () => {
    const { bus } = fakeBus(['omen', 'whisper']);
    expect([...busAllowedVerbs(bus)].sort()).toEqual(['omen', 'whisper']);
  });

  it('read() resolves dotted guards over the query facade', () => {
    const { bus } = fakeBus(['omen'], { npc: { 'elder-1': { faith: 4 } }, belief: { power: 12 }, tick: 99 });
    const host = createBusStoryHost(bus, { source: 'player' });
    expect(host.read!('npc.elder-1.faith')).toBe(4);
    expect(host.read!('belief.power')).toBe(12);
    expect(host.read!('world.tick')).toBe(99);
    expect(host.read!('npc.missing.faith')).toBeUndefined();
  });

  it('a storylet effect routed through the bus becomes a real command', () => {
    const { bus, emitted } = fakeBus(['omen', 'whisper', 'grant_belief']);
    const host = createBusStoryHost(bus, { source: 'player' });
    const session = new StorySession(droughtOmenPack, { host, seed: 3 });
    session.start('parched-prayer');
    pumpToEnd(session, [0]); // omen branch
    expect(emitted.map((c) => c.verb)).toContain('omen');
    expect(emitted.map((c) => c.verb)).toContain('grant_belief');
  });
});

describe('StorySession interactive flow', () => {
  it('surfaces lines and choices one stage at a time; effects do not stop play', () => {
    const session = new StorySession(droughtOmenPack, { seed: 3 });
    let stage = session.start('parched-prayer');
    const kinds: string[] = [];
    let guard = 0;
    while (stage.kind !== 'done' && guard++ < 100) {
      kinds.push(stage.kind);
      stage = stage.kind === 'choice' ? session.choose(0) : session.next();
    }
    expect(kinds).toContain('line');
    expect(kinds).toContain('choice');
    expect(session.done).toBe(true);
  });
});

describe('FateDirector + StoryAgent seam', () => {
  const pack: StoryPack = {
    id: 'p', version: 1,
    storylets: [{
      id: 's', body: [
        { t: 'say', who: null, text: { fallback: 'plain', enrich: { slotId: 'a', exemplars: ['plain'] } } },
        { t: 'end' },
      ],
    }],
  };

  const upperAgent: StoryAgent = {
    enrich: async (req) => `AI:${req.hint.slotId}`,
    select: async (req) => req.candidates[req.candidates.length - 1].id,
  };

  it('warmEnrichment pre-warms the cache; FateDirector reads it synchronously', async () => {
    const cache: EnrichmentCache = await warmEnrichment(pack.storylets[0], upperAgent, {});
    expect(cache.get('a')).toBe('AI:a');
    const session = new StorySession(pack, { director: new FateDirector(cache) });
    const stage = session.start('s');
    expect(stage).toMatchObject({ kind: 'line', line: { text: 'AI:a' } });
  });

  it('an un-warmed (or declined) slot falls back — agent is never required', async () => {
    const declining: StoryAgent = { enrich: async () => null };
    const cache = await warmEnrichment(pack.storylets[0], declining, {});
    expect(cache.has('a')).toBe(false);
    const session = new StorySession(pack, { director: new FateDirector(cache) });
    expect(session.start('s')).toMatchObject({ kind: 'line', line: { text: 'plain' } });
  });

  it('a throwing agent does not break play (per-slot swallow)', async () => {
    const boom: StoryAgent = { enrich: async () => { throw new Error('llm down'); } };
    const cache = await warmEnrichment(pack.storylets[0], boom, {});
    expect(cache.size).toBe(0);
  });

  it('chooseNext lets the agent narrow the eligible pool, advisory only', async () => {
    const eligible = [
      { id: 'x', body: [] }, { id: 'y', body: [] }, { id: 'z', body: [] },
    ] as unknown as StoryPack['storylets'];
    expect(await chooseNext(eligible, upperAgent, {})).toBe('z'); // picks last
    // an agent returning an id outside the pool is ignored
    const liar: StoryAgent = { enrich: async () => null, select: async () => 'not-real' };
    expect(await chooseNext(eligible, liar, {})).toBeNull();
  });

  it('collectEnrichHints finds AI-optional slots incl. inside choices', () => {
    expect(collectEnrichHints(droughtOmenPack.storylets[0]).map((h) => h.slotId))
      .toContain('parched-prayer/plea');
  });

  it('snapshotScope projects owned fields for the agent', () => {
    const scope = new Scope(undefined, { a: 1, b: 'two', c: true });
    expect(snapshotScope(scope, ['a', 'b', 'missing'])).toEqual({ a: 1, b: 'two' });
  });
});

describe('agent authoring contract', () => {
  it('parsePack accepts a valid pack (object or JSON string)', () => {
    const r1 = parsePack(droughtOmenPack);
    expect(r1.errors).toEqual([]);
    expect(r1.pack).not.toBeNull();
    const r2 = parsePack(JSON.stringify(droughtOmenPack));
    expect(r2.errors).toEqual([]);
  });

  it('parsePack returns actionable errors for malformed input', () => {
    expect(parsePack('{ not json').errors[0]).toMatch(/invalid JSON/);
    expect(parsePack({ id: '', version: 1, storylets: [] }).errors.some((e) => /pack.id/.test(e))).toBe(true);
    expect(parsePack({ id: 'x', storylets: [{ id: 's' }] }).errors.some((e) => /version/.test(e))).toBe(true);
  });

  it('parsePack enforces the capability allowlist', () => {
    const pack = { id: 'p', version: 1, storylets: [
      { id: 's', body: [{ t: 'do', effect: { verb: 'nope' } }, { t: 'end' }] },
    ] };
    expect(parsePack(pack, { allowedVerbs: new Set(['omen']) })
      .errors.some((e) => /allowlist/.test(e))).toBe(true);
  });

  it('exposes a JSON Schema for agent tool-use', () => {
    expect(STORY_PACK_SCHEMA.title).toBe('StoryPack');
    expect(STORY_PACK_SCHEMA.required).toContain('storylets');
    // the no-key law is visible in the schema: fallback is required & non-empty
    const slot = STORY_PACK_SCHEMA.$defs.textSlot.oneOf.find(
      (o) => 'required' in o && (o.required as readonly string[]).includes('fallback'));
    expect(slot).toBeTruthy();
  });
});

// helper: pump a session to completion, taking the given choices in order then 0.
function pumpToEnd(session: StorySession, choices: number[]): void {
  let stage = session.current;
  const q = [...choices];
  let guard = 0;
  while (stage.kind !== 'done' && guard++ < 1000) {
    stage = stage.kind === 'choice' ? session.choose(q.length ? q.shift()! : 0) : session.next();
  }
}
