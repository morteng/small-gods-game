/**
 * F4 — portents + the gate (spec §5/§6/§7, fate-portent-gate):
 *
 *  - plant_portent guards: live arcId; kind ∈ the arc SHAPE's library-owned
 *    portentKinds (the model picks among them, never invents); required omen line;
 *    ≤1 per deliberation; subject falls back to the arc's cast; safe default when
 *    the ctx carries no arc metadata.
 *  - The PORTENTS-FIRST gate: a HEAVY beat (one landing a hard blow) armed on a
 *    live arc whose portent ledger is EMPTY is rejected — and the rejection text
 *    reaches the retry prompt (§7), scoped to [plant_portent, arm_staged_beat] so
 *    the model can foreshadow first, then re-arm. Same-response omens count.
 *  - Materialization: a validated portent becomes a soft discovery beat + a
 *    beatId-linked ledger entry + a portent_planted event; firing the beat flips
 *    the ledger entry to DISCOVERED (activation-system writeback); the event
 *    surfaces as an "omen gathers" inbox tiding.
 */
import { describe, it, expect } from 'vitest';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { createRng } from '@/core/rng';
import { EventLog } from '@/core/events';
import { CommandQueue } from '@/sim/command/command-queue';
import { PlotThreadStore } from '@/sim/threads/thread-store';
import { StagingBuffer } from '@/sim/threads/staging-buffer';
import { DiscoveryQueue } from '@/sim/threads/discovery-queue';
import { StagingActivationSystem } from '@/sim/threads/systems/staging-activation-system';
import { initNpcProps } from '@/world/npc-helpers';
import { createGameQuery, PORTENT_NOTICE_HORIZON_TICKS } from '@/game/game-query';
import type { SystemContext } from '@/core/scheduler';
import type { GameMap, Tile, Entity } from '@/core/types';
import type { GameState } from '@/core/state';
import { FateArcStore } from '@/sim/fate/arc-store';
import { ARC_LIBRARY, ARC_PORTENT_KINDS, getArcShape, openArcFromShape } from '@/sim/fate/arc-library';
import type { FateArc } from '@/sim/fate/arc-types';
import {
  parseFateToolCalls, portentGateRetryPrompt, PORTENT_RETRY_TOOLS,
  type FateToolCtx, type ArcToolMeta,
} from '@/game/fate/fate-tools';
import { FateBrainService } from '@/game/fate/fate-brain-service';
import type { FateFocus } from '@/game/fate/fate-context';
import {
  LLMClient, type LLMProvider, type LLMMessage, type LLMOptions, type LLMResponse,
  type LLMTool, type LLMToolCall,
} from '@/llm/llm-client';

// ─── harness ──────────────────────────────────────────────────────────────────

function map(): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 4; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 4; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: 4, height: 4, villages: [], seed: 1, success: true,
           worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}

function makeState(): GameState {
  const world = new World(map());
  const p = initNpcProps('r1', 'farmer', 7); p.homePoiId = 'poi1';
  world.addEntity({ id: 'r1', kind: 'npc', x: 1, y: 1, properties: p as unknown as Record<string, unknown> } as Entity);
  const plotThreads = new PlotThreadStore();
  const t = plotThreads.open('trial', { kind: 'settlement', poiId: 'poi1' }, 0);
  plotThreads.advance(t.id, 'hardship', 1, 0);
  const clock = new SimClock();
  return {
    world, plotThreads, staging: new StagingBuffer(), clock,
    eventLog: new EventLog(clock), spirits: new Map(),
    worldSeed: { name: 'T', pois: [{ id: 'poi1', name: 'Northvale', position: { x: 2, y: 2 } }] },
    fateArcs: new FateArcStore(),
  } as unknown as GameState;
}

/** Seed a strongman arc (portentKinds: dream|sky|beast) with poi1 as its cast. */
function seedArc(state: GameState, castPoiIds: string[] = ['poi1']): FateArc {
  return openArcFromShape(state.fateArcs, getArcShape('strongman_dies_abroad')!, { poiIds: castPoiIds, npcIds: [] }, 0);
}

function toolCtx(meta?: Map<number, ArcToolMeta>): FateToolCtx {
  return {
    validPoiIds: new Set(['poi1', 'causal:flood:0001']),
    now: 100,
    arcs: {
      liveArcIds: new Set(meta ? [...meta.keys()] : [1]),
      liveArcCount: meta?.size ?? 1,
      isShapeSeedable: () => true,
      arcMeta: meta,
    },
  };
}
const meta1 = (over?: Partial<ArcToolMeta>): Map<number, ArcToolMeta> =>
  new Map([[1, { shape: 'strongman_dies_abroad', castPoiIds: ['poi1'], portentCount: 0, ...over }]]);

function plantCall(args: Record<string, unknown>, id = 'p0'): LLMToolCall {
  return { id, name: 'plant_portent', arguments: { arcId: 1, kind: 'dream', omen: 'A black sail in every sleeper\'s dream.', ...args } };
}
function armHeavy(args: Record<string, unknown> = {}, id = 'b0'): LLMToolCall {
  return { id, name: 'arm_staged_beat', arguments: { subjectPoiId: 'poi1', hard: 'inject_npc', arcId: 1, ...args } };
}

/** Scripted provider: returns the i-th canned tool-call list per generate() turn,
 *  recording each turn's messages + tool names so retry plumbing is assertable. */
class ScriptedProvider implements LLMProvider {
  calls: Array<{ tools?: string[]; messages: LLMMessage[] }> = [];
  private turn = 0;
  constructor(private readonly script: LLMToolCall[][]) {}
  async generate(m: LLMMessage[], opts?: LLMOptions): Promise<LLMResponse> {
    this.calls.push({ tools: opts?.tools?.map((t: LLMTool) => t.name), messages: [...m] });
    const toolCalls = this.script[Math.min(this.turn++, this.script.length - 1)];
    return { content: '', latencyMs: 0, toolCalls };
  }
  isAvailable(): boolean { return true; }
  name(): string { return 'scripted'; }
}

function brainFor(state: GameState, script: LLMToolCall[][]): { brain: FateBrainService; provider: ScriptedProvider } {
  const provider = new ScriptedProvider(script);
  const brain = new FateBrainService({
    getState: () => state, getCapableClient: () => new LLMClient(provider),
    isScrubbed: () => false, emitCommand: () => {},
  });
  return { brain, provider };
}
const focus = (): FateFocus => ({ kind: 'pulse' });

// ─── the library's portent vocabulary ───────────────────────────────────────────

describe('ARC_PORTENT_KINDS', () => {
  it('is the union of every shape\'s portentKinds (derived, never drifts)', () => {
    const expected = new Set(Object.values(ARC_LIBRARY).flatMap((s) => s.portentKinds));
    expect(new Set(ARC_PORTENT_KINDS)).toEqual(expected);
    expect(ARC_PORTENT_KINDS.length).toBeGreaterThan(0);
  });
});

// ─── parse-level: plant_portent guards ──────────────────────────────────────────

describe('parseFateToolCalls — plant_portent guards', () => {
  it('accepts a valid portent (live arc, shape-legal kind, omen, valid subject)', () => {
    const { arcPortents } = parseFateToolCalls([plantCall({ subjectPoiId: 'poi1' })], toolCtx(meta1()));
    expect(arcPortents).toEqual([{
      arcId: 1, kind: 'dream', text: 'A black sail in every sleeper\'s dream.', subjectPoiId: 'poi1',
    }]);
  });

  it('falls back to the arc\'s first cast settlement when the subject is omitted or unknown', () => {
    const omitted = parseFateToolCalls([plantCall({})], toolCtx(meta1()));
    expect(omitted.arcPortents[0].subjectPoiId).toBe('poi1');
    const unknown = parseFateToolCalls([plantCall({ subjectPoiId: 'ghost-town' })], toolCtx(meta1()));
    expect(unknown.arcPortents[0].subjectPoiId).toBe('poi1');
  });

  it('rejects an arcId that is not live', () => {
    const { arcPortents } = parseFateToolCalls([plantCall({ arcId: 99 })], toolCtx(meta1()));
    expect(arcPortents).toHaveLength(0);
  });

  it('rejects a kind outside the SHAPE\'s own portentKinds — even one legal elsewhere in the library', () => {
    // 'rumor' exists in the library union but strongman_dies_abroad owns dream|sky|beast.
    expect(ARC_PORTENT_KINDS).toContain('rumor');
    const { arcPortents } = parseFateToolCalls([plantCall({ kind: 'rumor' })], toolCtx(meta1()));
    expect(arcPortents).toHaveLength(0);
    // And a wholly invented kind is rejected too.
    expect(parseFateToolCalls([plantCall({ kind: 'comet' })], toolCtx(meta1())).arcPortents).toHaveLength(0);
  });

  it('rejects a missing or blank omen line', () => {
    expect(parseFateToolCalls([plantCall({ omen: undefined })], toolCtx(meta1())).arcPortents).toHaveLength(0);
    expect(parseFateToolCalls([plantCall({ omen: '   ' })], toolCtx(meta1())).arcPortents).toHaveLength(0);
  });

  it('accepts at most ONE portent per deliberation', () => {
    const { arcPortents } = parseFateToolCalls([
      plantCall({}, 'p0'),
      plantCall({ kind: 'sky', omen: 'The moon rises wrong.' }, 'p1'),
    ], toolCtx(meta1()));
    expect(arcPortents).toHaveLength(1);
    expect(arcPortents[0].kind).toBe('dream');
  });

  it('drops every plant_portent when the ctx carries no arc metadata (safe default)', () => {
    const noMeta = toolCtx(undefined);
    expect(parseFateToolCalls([plantCall({})], noMeta).arcPortents).toHaveLength(0);
    const noArcs: FateToolCtx = { validPoiIds: new Set(['poi1']), now: 0 };
    expect(parseFateToolCalls([plantCall({})], noArcs).arcPortents).toHaveLength(0);
  });

  it('drops a portent with nowhere durable to land (no subject, empty cast; sites refused)', () => {
    const emptyCast = meta1({ castPoiIds: [] });
    expect(parseFateToolCalls([plantCall({})], toolCtx(emptyCast)).arcPortents).toHaveLength(0);
    expect(parseFateToolCalls(
      [plantCall({ subjectPoiId: 'causal:flood:0001' })], toolCtx(emptyCast),
    ).arcPortents).toHaveLength(0);
  });
});

// ─── parse-level: the portents-first heavy-beat gate ────────────────────────────

describe('parseFateToolCalls — the heavy-beat gate', () => {
  it('REJECTS a heavy beat on an arc with an empty portent ledger, surfacing the rejection', () => {
    const { beats, portentRejections } = parseFateToolCalls([armHeavy()], toolCtx(meta1()));
    expect(beats).toHaveLength(0);
    expect(portentRejections).toHaveLength(1);
    expect(portentRejections[0]).toMatchObject({
      callId: 'b0', arcId: 1, shape: 'strongman_dies_abroad', subjectPoiId: 'poi1',
    });
    expect(portentRejections[0].reason).toMatch(/EMPTY portent ledger/);
  });

  it('arms a SOFT beat on an empty-ledger arc (only heavy blows are gated), carrying the arcId', () => {
    const { beats, portentRejections } = parseFateToolCalls(
      [armHeavy({ hard: 'none', soft: 'A hush falls.' })], toolCtx(meta1()),
    );
    expect(beats).toHaveLength(1);
    expect(beats[0].arcId).toBe(1);
    expect(portentRejections).toHaveLength(0);
  });

  it('arms a heavy beat once the arc\'s ledger is non-empty', () => {
    const { beats, portentRejections } = parseFateToolCalls([armHeavy()], toolCtx(meta1({ portentCount: 1 })));
    expect(beats).toHaveLength(1);
    expect(beats[0].arcId).toBe(1);
    expect(beats[0].hard).toHaveLength(1);
    expect(portentRejections).toHaveLength(0);
  });

  it('a heavy beat with NO arc ref is untouched by the gate (pre-F4 behavior preserved)', () => {
    const call: LLMToolCall = { id: 'b0', name: 'arm_staged_beat', arguments: { subjectPoiId: 'poi1', hard: 'inject_npc' } };
    const { beats, portentRejections } = parseFateToolCalls([call], toolCtx(meta1()));
    expect(beats).toHaveLength(1);
    expect(beats[0].arcId).toBeUndefined();
    expect(portentRejections).toHaveLength(0);
  });

  it('drops a hallucinated arcId as a ref (logged) — the beat still arms, ungated', () => {
    const { beats, portentRejections } = parseFateToolCalls([armHeavy({ arcId: 99 })], toolCtx(meta1()));
    expect(beats).toHaveLength(1);
    expect(beats[0].arcId).toBeUndefined();
    expect(portentRejections).toHaveLength(0);
  });

  it('counts a portent planted EARLIER in the same response — plant-then-land passes', () => {
    const { beats, arcPortents, portentRejections } = parseFateToolCalls(
      [plantCall({}, 'p0'), armHeavy({}, 'b0')], toolCtx(meta1()),
    );
    expect(arcPortents).toHaveLength(1);
    expect(beats).toHaveLength(1);
    expect(portentRejections).toHaveLength(0);
  });

  it('order matters deterministically: land-then-plant is still rejected', () => {
    const { beats, arcPortents, portentRejections } = parseFateToolCalls(
      [armHeavy({}, 'b0'), plantCall({}, 'p0')], toolCtx(meta1()),
    );
    expect(arcPortents).toHaveLength(1);
    expect(beats).toHaveLength(0);
    expect(portentRejections).toHaveLength(1);
  });
});

describe('portentGateRetryPrompt', () => {
  it('carries each rejection\'s reason and instructs foreshadow-then-re-arm', () => {
    const p = portentGateRetryPrompt([{
      callId: 'b0', arcId: 3, shape: 'strongman_dies_abroad', subjectPoiId: 'poi1',
      reason: 'arc 3 "strongman_dies_abroad" has an EMPTY portent ledger — a heavy beat may not land unforeshadowed',
    }]);
    expect(p).toMatch(/EMPTY portent ledger/);
    expect(p).toMatch(/strongman_dies_abroad/);
    expect(p).toMatch(/poi1/);
    expect(p).toMatch(/plant_portent/);
    expect(p).toMatch(/Address ONLY the beat/);
  });

  it('the retry toolset is exactly [plant_portent, arm_staged_beat]', () => {
    expect(PORTENT_RETRY_TOOLS.map((t) => t.name).sort()).toEqual(['arm_staged_beat', 'plant_portent']);
  });
});

// ─── service-level: rejection text reaches the retry prompt (spec §7) ───────────

describe('FateBrainService — the gate + self-correction retry', () => {
  it('a heavy beat on an empty ledger is rejected and the rejection text reaches the retry prompt', async () => {
    const state = makeState();
    const arc = seedArc(state);
    const { brain, provider } = brainFor(state, [
      [armHeavy({ arcId: arc.id })],   // turn 1: unforeshadowed heavy beat
      [],                              // retry: model declines
    ]);
    await brain.deliberate(focus());

    expect(state.staging.armedByTrigger('discovery')).toHaveLength(0);   // rejected, nothing armed
    expect(provider.calls).toHaveLength(2);                              // one bounded retry happened
    // The retry turn is scoped to foreshadow + re-arm only.
    expect(provider.calls[1].tools?.sort()).toEqual(['arm_staged_beat', 'plant_portent']);
    // And the rejection text reached the retry prompt (§7).
    const retryMessages = provider.calls[1].messages;
    const retryUser = retryMessages[retryMessages.length - 1];
    expect(retryUser.role).toBe('user');
    expect(retryUser.content).toMatch(/EMPTY portent ledger/);
    expect(retryUser.content).toMatch(/strongman_dies_abroad/);
    expect(retryUser.content).toMatch(/plant_portent/);
  });

  it('the retry can foreshadow AND re-arm in one response: ledger entry + heavy beat both land', async () => {
    const state = makeState();
    const arc = seedArc(state);
    const { brain, provider } = brainFor(state, [
      [armHeavy({ arcId: arc.id })],                                    // turn 1: rejected
      [plantCall({ arcId: arc.id }, 'p0'), armHeavy({ arcId: arc.id }, 'b1')], // retry: plant, then land
    ]);
    await brain.deliberate(focus());

    expect(provider.calls).toHaveLength(2);
    const stored = state.fateArcs.get(arc.id)!;
    expect(stored.portents).toHaveLength(1);
    expect(stored.portents[0]).toMatchObject({ kind: 'dream', discovered: false });
    expect(stored.portents[0].beatId).toBeDefined();
    // Two armed beats: the portent's soft omen + the (now-passing) heavy beat.
    const armed = state.staging.armedByTrigger('discovery');
    expect(armed).toHaveLength(2);
    expect(armed.filter((b) => b.hard.length > 0)).toHaveLength(1);
    expect(armed.every((b) => b.arcId === arc.id)).toBe(true);
  });

  it('plant_portent alone: ledger entry + soft beat + portent_planted event, and NO retry turn', async () => {
    const state = makeState();
    const arc = seedArc(state);
    const { brain, provider } = brainFor(state, [[plantCall({ arcId: arc.id })]]);
    await brain.deliberate(focus());

    expect(provider.calls).toHaveLength(1);
    const stored = state.fateArcs.get(arc.id)!;
    expect(stored.portents).toHaveLength(1);
    expect(stored.portents[0].text).toBe('A black sail in every sleeper\'s dream.');
    const armed = state.staging.armedByTrigger('discovery');
    expect(armed).toHaveLength(1);
    expect(armed[0].hard).toHaveLength(0);
    expect(armed[0].soft?.text).toBe('A black sail in every sleeper\'s dream.');
    expect(armed[0].arcId).toBe(arc.id);
    expect(stored.portents[0].beatId).toBe(armed[0].id);
    const ev = state.eventLog.range(0, 1000).find((a) => a.event.type === 'portent_planted');
    expect(ev?.event).toMatchObject({ type: 'portent_planted', arcId: arc.id, kind: 'dream', poiId: 'poi1' });
  });

  it('skips the retry when another beat already armed this turn (stage at most one)', async () => {
    const state = makeState();
    const arc = seedArc(state);
    const { brain, provider } = brainFor(state, [[
      { id: 's0', name: 'arm_staged_beat', arguments: { subjectPoiId: 'poi1', hard: 'none', soft: 'A hush.' } },
      armHeavy({ arcId: arc.id }, 'b1'),                                // rejected, but a beat already armed
    ]]);
    await brain.deliberate(focus());
    expect(provider.calls).toHaveLength(1);                             // no second turn
    expect(state.staging.armedByTrigger('discovery')).toHaveLength(1);  // just the soft beat
  });
});

// ─── discovery flips the ledger (activation-system writeback) ───────────────────

describe('portent discovery — the activation system flips the ledger', () => {
  it('firing the portent\'s beat marks the ledger entry DISCOVERED', () => {
    const state = makeState();
    const arc = seedArc(state);
    // Materialize a portent by hand, exactly as the brain does.
    const armed = state.staging.arm({
      subject: { kind: 'settlement', poiId: 'poi1' }, trigger: { kind: 'discovery' },
      hard: [], soft: { kind: 'location_vibe', text: 'The moon rises wrong.' },
      arcId: arc.id, stagedTick: 0,
    });
    state.fateArcs.plantPortent(arc.id, { tick: 0, kind: 'sky', discovered: false, text: 'The moon rises wrong.', beatId: armed.id });

    const discovery = new DiscoveryQueue();
    const sys = new StagingActivationSystem(
      discovery, new CommandQueue(), () => state.staging, () => state.plotThreads,
      undefined, undefined, undefined, () => state.fateArcs,
    );
    discovery.push({ subject: { kind: 'settlement', poiId: 'poi1' } });
    const ctx: SystemContext = {
      world: state.world!, spirits: new Map(), log: state.eventLog, clock: state.clock,
      rng: createRng(1), dt: 2000, now: 10,
    };
    sys.tick(ctx);

    expect(state.staging.get(armed.id)!.status).toBe('fired');
    expect(state.fateArcs.get(arc.id)!.portents[0].discovered).toBe(true);
  });

  it('plantPortent refuses a folded arc; markPortentDiscovered ignores unknown beatIds', () => {
    const state = makeState();
    const arc = seedArc(state);
    state.fateArcs.abandon(arc.id, 'folded');
    expect(state.fateArcs.plantPortent(arc.id, { tick: 0, kind: 'dream', discovered: false })).toBe(false);
    expect(state.fateArcs.get(arc.id)!.portents).toHaveLength(0);
    state.fateArcs.markPortentDiscovered(12345);   // no-op, no throw
  });
});

// ─── the inbox tiding ───────────────────────────────────────────────────────────

describe('divineInbox — "an omen gathers" tiding (portent_planted)', () => {
  it('surfaces a recent portent as a settlement-targeted tiding with anchor', () => {
    const state = makeState();
    state.clock.setNow(100);
    state.eventLog.append({ type: 'portent_planted', arcId: 1, kind: 'dream', poiId: 'poi1', beatId: 7 });
    const inbox = createGameQuery({ state }).divineInbox();
    const t = inbox.find((i) => i.id.startsWith('portent:'))!;
    expect(t).toBeDefined();
    expect(t.kind).toBe('tiding');
    expect(t.title).toBe('An omen gathers over Northvale');
    expect(t.detail.length).toBeGreaterThan(0);
    expect(t.target).toEqual({ kind: 'settlement', poiId: 'poi1' });
    expect(t.anchor).toEqual({ x: 2, y: 2 });
  });

  it('auto-expires past the notice horizon', () => {
    const state = makeState();
    state.clock.setNow(100);
    state.eventLog.append({ type: 'portent_planted', arcId: 1, kind: 'sky', poiId: 'poi1', beatId: 7 });
    state.clock.setNow(100 + PORTENT_NOTICE_HORIZON_TICKS + 1);
    const inbox = createGameQuery({ state }).divineInbox();
    expect(inbox.some((i) => i.id.startsWith('portent:'))).toBe(false);
  });
});
