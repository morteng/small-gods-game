// tests/unit/fate-author-retry.test.ts
// The self-correction loop: when a building fails the structural gate, its lints are fed
// back to the model for ONE bounded retry, scoped to the authoring tool so the follow-up
// can't duplicate other actions. The shipped presets all pass the gate (a good safety
// posture), so the gate is MOCKED here to force the failure→retry path — the orchestration
// (parser rejection sink + service retry), not the gate itself, is under test.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/blueprint/authoring', () => ({ authorBlueprint: vi.fn() }));

import { authorBlueprint } from '@/blueprint/authoring';
import { parseFateToolCalls, authoringRetryPrompt, type AuthoringRejection } from '@/game/fate/fate-tools';
import { LLMClient, type LLMProvider, type LLMMessage, type LLMOptions, type LLMResponse, type LLMToolCall, type LLMTool } from '@/llm/llm-client';
import { FateBrainService } from '@/game/fate/fate-brain-service';
import type { FateFocus } from '@/game/fate/fate-context';
import { World } from '@/world/world';
import { SimClock } from '@/core/clock';
import { PlotThreadStore } from '@/sim/threads/thread-store';
import { StagingBuffer } from '@/sim/threads/staging-buffer';
import { initNpcProps } from '@/world/npc-helpers';
import type { GameMap, Tile, Entity } from '@/core/types';
import type { GameState } from '@/core/state';
import type { Command } from '@/sim/command/types';

const mockAuthor = vi.mocked(authorBlueprint);
const FAIL = { ok: false, rb: undefined, lints: [{ code: 'eave_breach', severity: 'error' as const, message: 'the window is taller than the wall' }], summary: '1 error' };
const PASS = { ok: true, rb: { preset: 'shrine', parts: [], footprint: { w: 1, h: 1 } } as never, lints: [], summary: 'clean' };

const authorCall = (preset = 'shrine'): LLMToolCall[] => [{ id: 'a0', name: 'author_building', arguments: { subjectPoiId: 'poi1', preset } }];
const ctx = () => ({ validPoiIds: new Set(['poi1']), validRivalIds: new Set<string>(), now: 100 });

beforeEach(() => mockAuthor.mockReset());

describe('parseFateToolCalls — authoring rejection sink', () => {
  it('surfaces a gate failure (with its lints) and emits no command', () => {
    mockAuthor.mockReturnValue(FAIL as never);
    const { commands, authoringRejections } = parseFateToolCalls(authorCall(), ctx());
    expect(commands).toHaveLength(0);
    expect(authoringRejections).toHaveLength(1);
    expect(authoringRejections[0]).toMatchObject({ callId: 'a0', subjectPoiId: 'poi1', preset: 'shrine', summary: '1 error' });
    expect(authoringRejections[0].lints[0].message).toMatch(/taller than the wall/);
  });

  it('a passing gate produces a command and no rejection', () => {
    mockAuthor.mockReturnValue(PASS as never);
    const { commands, authoringRejections } = parseFateToolCalls(authorCall(), ctx());
    expect(commands).toHaveLength(1);
    expect(authoringRejections).toHaveLength(0);
  });

  it('a drift-guard drop (unknown preset) is NOT a fixable-geometry rejection', () => {
    mockAuthor.mockReturnValue(PASS as never);
    const { commands, authoringRejections } = parseFateToolCalls(authorCall('space_station'), ctx());
    expect(commands).toHaveLength(0);
    expect(authoringRejections).toHaveLength(0);   // never reached the gate
    expect(mockAuthor).not.toHaveBeenCalled();
  });
});

describe('authoringRetryPrompt', () => {
  it('lists each rejected building with its error-severity lints', () => {
    const rej: AuthoringRejection[] = [{
      callId: 'a0', subjectPoiId: 'poi1', preset: 'shrine', summary: '1 error',
      lints: [
        { code: 'eave_breach', severity: 'error', message: 'window taller than wall' },
        { code: 'part_off_footprint', severity: 'info', message: 'ignore me' },
      ],
    }];
    const p = authoringRetryPrompt(rej);
    expect(p).toMatch(/shrine/);
    expect(p).toMatch(/poi1/);
    expect(p).toMatch(/window taller than wall/);
    expect(p).not.toMatch(/ignore me/);          // advisory notes are not surfaced
    expect(p).toMatch(/Address ONLY the building/);
  });

  it('falls back to the summary when there are no error lints (a resolve failure)', () => {
    const p = authoringRetryPrompt([{ callId: 'a', subjectPoiId: 'poi1', preset: 'manor', summary: 'resolve failed: bad param', lints: [] }]);
    expect(p).toMatch(/resolve failed: bad param/);
  });
});

// --- service-level: failure on turn 1 → one scoped retry → success ---

function map(): GameMap {
  const tiles: Tile[][] = [];
  for (let y = 0; y < 4; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < 4; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row);
  }
  return { tiles, width: 4, height: 4, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] };
}
function makeState(): GameState {
  const world = new World(map());
  const p = initNpcProps('r1', 'farmer', 7); p.homePoiId = 'poi1';
  world.addEntity({ id: 'r1', kind: 'npc', x: 1, y: 1, properties: p as unknown as Record<string, unknown> } as Entity);
  const plotThreads = new PlotThreadStore();
  const t = plotThreads.open('trial', { kind: 'settlement', poiId: 'poi1' }, 0);
  plotThreads.advance(t.id, 'hardship', 1, 0);
  return { world, plotThreads, staging: new StagingBuffer(), clock: new SimClock(),
    worldSeed: { name: 'T', pois: [{ id: 'poi1', name: 'Northvale' }] } } as unknown as GameState;
}
const focus = (): FateFocus => ({ event: { type: 'thread_advanced', threadId: 1, phase: 'turning', weight: 'climax' }, threadId: 1 });

/** Records every generate() call's tools so the test can assert the retry's scoping. */
class RecordingProvider implements LLMProvider {
  toolsPerCall: (string[] | undefined)[] = [];
  constructor(private readonly toolCalls: LLMToolCall[]) {}
  async generate(_m: LLMMessage[], opts?: LLMOptions): Promise<LLMResponse> {
    this.toolsPerCall.push(opts?.tools?.map((t: LLMTool) => t.name));
    return { content: '', latencyMs: 0, toolCalls: this.toolCalls };
  }
  isAvailable(): boolean { return true; }
  name(): string { return 'recording'; }
}

describe('FateBrainService — building self-correction', () => {
  it('retries once (scoped to author_building) when the first attempt fails, then emits the corrected building', async () => {
    mockAuthor.mockReturnValueOnce(FAIL as never).mockReturnValue(PASS as never);
    const provider = new RecordingProvider(authorCall());
    const emitted: Array<Omit<Command, 'seq'>> = [];
    const brain = new FateBrainService({
      getState: () => makeState(), getCapableClient: () => new LLMClient(provider),
      isScrubbed: () => false, emitCommand: (c) => emitted.push(c),
    });
    await brain.deliberate(focus());
    // two turns: the full toolset, then just the authoring tool
    expect(provider.toolsPerCall).toHaveLength(2);
    expect(provider.toolsPerCall[0]).toContain('author_building');
    expect(provider.toolsPerCall[0]!.length).toBeGreaterThan(1);
    expect(provider.toolsPerCall[1]).toEqual(['author_building']);
    // the retry passed the gate → exactly one place_building emitted
    expect(emitted.filter((c) => c.verb === 'place_building')).toHaveLength(1);
  });

  it('does not retry when the first attempt already placed a building', async () => {
    mockAuthor.mockReturnValue(PASS as never);
    const provider = new RecordingProvider(authorCall());
    const brain = new FateBrainService({
      getState: () => makeState(), getCapableClient: () => new LLMClient(provider),
      isScrubbed: () => false, emitCommand: () => {},
    });
    await brain.deliberate(focus());
    expect(provider.toolsPerCall).toHaveLength(1);   // no second turn
  });

  it('does not retry when the model called no building tool at all', async () => {
    mockAuthor.mockReturnValue(PASS as never);
    const provider = new RecordingProvider([{ id: 'n0', name: 'nudge_event_severity', arguments: { subjectPoiId: 'poi1', delta: 0.2 } }]);
    const brain = new FateBrainService({
      getState: () => makeState(), getCapableClient: () => new LLMClient(provider),
      isScrubbed: () => false, emitCommand: () => {},
    });
    await brain.deliberate(focus());
    expect(provider.toolsPerCall).toHaveLength(1);
    expect(mockAuthor).not.toHaveBeenCalled();
  });
});
