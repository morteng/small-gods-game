/**
 * Subject binding — pure helpers + bus-host integration.
 *
 * Proves a storylet armed "on" a ThreadSubject routes its `$subject`/`subject:true`
 * effects and reads to THAT subject's target, and that an un-subjected host is
 * byte-for-byte unchanged (the regression guard for the `__debug.playStory` path).
 */
import { describe, it, expect } from 'vitest';
import {
  subjectToTarget, effectTargetsSubject, rewriteSubjectReadPath, SUBJECT_ARG_KEYS,
  createBusStoryHost, StorySession,
} from '@/story';
import type { StoryPack } from '@/story';
import type { ThreadSubject } from '@/sim/threads/thread-types';
import type { GameBus, CapabilityView } from '@/game/game-bus';
import type { Command } from '@/sim/command/types';

const npcSubject: ThreadSubject = { kind: 'npc', npcId: 'elder-1' };
const setSubject: ThreadSubject = { kind: 'settlement', poiId: 'village-a' };
const sprSubject: ThreadSubject = { kind: 'spirit', spiritId: 'rival-x' };
const siteSubject: ThreadSubject = { kind: 'site', siteId: 'flood-plain-3' };

// ── A fake GameBus recording emitted commands + serving canned query data ──
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

describe('subjectToTarget', () => {
  it('maps npc → command npc target', () => {
    expect(subjectToTarget(npcSubject)).toEqual({ kind: 'npc', npcId: 'elder-1' });
  });
  it('maps settlement → command settlement target', () => {
    expect(subjectToTarget(setSubject)).toEqual({ kind: 'settlement', poiId: 'village-a' });
  });
  it('maps spirit and site → no target (v1 scope cut)', () => {
    expect(subjectToTarget(sprSubject)).toEqual({ kind: 'none' });
    expect(subjectToTarget(siteSubject)).toEqual({ kind: 'none' });
  });
});

describe('effectTargetsSubject', () => {
  it('detects the subject:true sentinel', () => {
    expect(effectTargetsSubject({ verb: 'omen', args: { subject: true, kind: 'clouds' } })).toBe(true);
  });
  it("detects npc:'$subject' and settlement:'$subject'", () => {
    expect(effectTargetsSubject({ verb: 'whisper', args: { npc: '$subject' } })).toBe(true);
    expect(effectTargetsSubject({ verb: 'omen', args: { settlement: '$subject' } })).toBe(true);
  });
  it('is false for a literal target or no args', () => {
    expect(effectTargetsSubject({ verb: 'omen', args: { npc: 'elder-1' } })).toBe(false);
    expect(effectTargetsSubject({ verb: 'omen', args: { subject: 'elder' } })).toBe(false); // legacy string, not sentinel
    expect(effectTargetsSubject({ verb: 'omen' })).toBe(false);
  });
});

describe('rewriteSubjectReadPath', () => {
  it('rewrites a subject-rooted field to the npc query path', () => {
    expect(rewriteSubjectReadPath('subject.faith', npcSubject)).toBe('npc.elder-1.faith');
    expect(rewriteSubjectReadPath('subject.name', npcSubject)).toBe('npc.elder-1.name');
  });
  it('rewrites a bare subject root to the npc root', () => {
    expect(rewriteSubjectReadPath('subject', npcSubject)).toBe('npc.elder-1');
  });
  it('returns null for a non-subject root (caller keeps the original path)', () => {
    expect(rewriteSubjectReadPath('world.tick', npcSubject)).toBeNull();
    expect(rewriteSubjectReadPath('npc.other.faith', npcSubject)).toBeNull();
  });
  it('returns null for unsupported subject kinds (fall through to default read)', () => {
    expect(rewriteSubjectReadPath('subject.faith', siteSubject)).toBeNull();
    expect(rewriteSubjectReadPath('subject.faith', setSubject)).toBeNull();
    expect(rewriteSubjectReadPath('subject.faith', sprSubject)).toBeNull();
  });
});

describe('SUBJECT_ARG_KEYS', () => {
  it('covers the sentinel + literal target keys', () => {
    expect([...SUBJECT_ARG_KEYS].sort()).toEqual(['npc', 'settlement', 'subject']);
  });
});

describe('createBusStoryHost with a subject', () => {
  it('routes a subject:true effect to the subject target and strips the sentinel from params/payload', () => {
    const { bus, emitted } = fakeBus(['omen']);
    const host = createBusStoryHost(bus, { source: 'player', subject: npcSubject });
    host.dispatch({ verb: 'omen', args: { subject: true, kind: 'clouds', intensity: 3 } });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      verb: 'omen', source: 'player',
      target: { kind: 'npc', npcId: 'elder-1' },
      params: { kind: 'clouds', intensity: 3 },
    });
    // the sentinel never leaks into params/payload
    expect(emitted[0].params).not.toHaveProperty('subject');
    expect(emitted[0].payload ?? {}).not.toHaveProperty('subject');
  });

  it("routes an npc:'$subject' effect to a settlement subject target", () => {
    const { bus, emitted } = fakeBus(['omen']);
    const host = createBusStoryHost(bus, { source: 'player', subject: setSubject });
    host.dispatch({ verb: 'omen', args: { settlement: '$subject', kind: 'clouds' } });
    expect(emitted[0].target).toEqual({ kind: 'settlement', poiId: 'village-a' });
    expect(emitted[0].params).not.toHaveProperty('settlement');
  });

  it('leaves a literal-target effect resolving to that literal (subject only binds the sentinel)', () => {
    const { bus, emitted } = fakeBus(['omen']);
    const host = createBusStoryHost(bus, { source: 'player', subject: npcSubject });
    host.dispatch({ verb: 'omen', args: { npc: 'someone-else', kind: 'clouds' } });
    expect(emitted[0].target).toEqual({ kind: 'npc', npcId: 'someone-else' });
  });

  it('resolves $subject reads/guards through the query facade', () => {
    const { bus } = fakeBus(['omen'], { npc: { 'elder-1': { faith: 4, name: 'Nhumrod' } } });
    const host = createBusStoryHost(bus, { source: 'player', subject: npcSubject });
    expect(host.read!('subject.faith')).toBe(4);
    expect(host.read!('subject.name')).toBe('Nhumrod');
    // non-subject paths still resolve through the default read
    expect(host.read!('npc.elder-1.faith')).toBe(4);
  });
});

describe('createBusStoryHost WITHOUT a subject (regression guard)', () => {
  it('reproduces the pre-change literal-target resolution exactly', () => {
    const { bus, emitted } = fakeBus(['omen']);
    const host = createBusStoryHost(bus, { source: 'player' });
    host.dispatch({ verb: 'omen', args: { npc: 'elder-1', kind: 'clouds', intensity: 3 } });
    expect(emitted[0]).toMatchObject({
      verb: 'omen', source: 'player',
      target: { kind: 'npc', npcId: 'elder-1' },
      params: { kind: 'clouds', intensity: 3 },
    });
  });

  it('a subject:true effect with no subject resolves to no target (unchanged), sentinel still stripped', () => {
    const { bus, emitted } = fakeBus(['omen']);
    const host = createBusStoryHost(bus, { source: 'player' });
    host.dispatch({ verb: 'omen', args: { subject: true, kind: 'clouds' } });
    expect(emitted[0].target).toEqual({ kind: 'none' });
    expect(emitted[0].params).not.toHaveProperty('subject');
  });

  it('leaves subject.* reads unresolved (verbatim → undefined), same as an unknown path', () => {
    const { bus } = fakeBus(['omen'], { npc: { 'elder-1': { faith: 4 } } });
    const host = createBusStoryHost(bus, { source: 'player' });
    expect(host.read!('subject.faith')).toBeUndefined();
  });
});

describe('StorySession over an inline pack — end-to-end subject targeting', () => {
  const pack: StoryPack = {
    id: 'subject-demo', version: 1,
    storylets: [{
      id: 'beat', body: [
        { t: 'do', effect: { verb: 'omen', args: { subject: true, kind: 'clouds' } } },
        { t: 'end' },
      ],
    }],
  };

  it('a subject host emits the omen on the beat subject', () => {
    const { bus, emitted } = fakeBus(['omen']);
    const host = createBusStoryHost(bus, { source: 'player', subject: npcSubject });
    const session = new StorySession(pack, { host, seed: 1 });
    let stage = session.start('beat');
    let guard = 0;
    while (stage.kind !== 'done' && guard++ < 50) {
      stage = stage.kind === 'choice' ? session.choose(0) : session.next();
    }
    expect(emitted.map((c) => c.verb)).toEqual(['omen']);
    expect(emitted[0].target).toEqual({ kind: 'npc', npcId: 'elder-1' });
  });

  it('the same pack with NO subject emits the omen with no target (regression)', () => {
    const { bus, emitted } = fakeBus(['omen']);
    const host = createBusStoryHost(bus, { source: 'player' });
    const session = new StorySession(pack, { host, seed: 1 });
    let stage = session.start('beat');
    let guard = 0;
    while (stage.kind !== 'done' && guard++ < 50) {
      stage = stage.kind === 'choice' ? session.choose(0) : session.next();
    }
    expect(emitted[0].target).toEqual({ kind: 'none' });
  });
});
