import { describe, it, expect } from 'vitest';
import { openMindPage, pathKey } from '@/game/mind-orchestrator';
import { CommandQueue } from '@/sim/command/command-queue';
import { NpcAttentionStore } from '@/llm/npc-attention-store';
import { LLMClient } from '@/llm/llm-client';
import { World } from '@/world/world';
import type { Entity, GameMap } from '@/core/types';
import type { Spirit } from '@/core/spirit';

function emptyMap(): GameMap {
  return { tiles: [], width: 32, height: 32, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

function maeve(): Entity {
  return { id: 'maeve', kind: 'npc', x: 1, y: 1, properties: {
    name: 'Maeve', role: 'farmer',
    personality: { assertiveness: 0.3, skepticism: 0.6, piety: 0.4, sociability: 0.5 },
    beliefs: { player: { faith: 0.4, understanding: 0.3, devotion: 0.1 } },
    needs: { safety: 0.4, prosperity: 0.3, community: 0.6, meaning: 0.3 },
    mood: 0.5, activity: 'work', recentEventIds: [], relationships: [], homePoiId: 'poi_east',
  } } as unknown as Entity;
}

// Stub client returning a canned emit_mind_page tool call. `LLMToolCall.arguments`
// is an already-parsed object in this codebase, so we pass the object directly.
function pageStub(prose: string, links: any[]): LLMClient {
  return new LLMClient({
    async generate() {
      return { content: '', toolCalls: [{ id: 'c0', name: 'emit_mind_page', arguments: { prose, links } }], latencyMs: 0 };
    },
  } as any);
}

function spirit(power: number): Spirit {
  return { id: 'player', name: 'You', sigil: '✶', color: '#fff', isPlayer: true, power, manifestation: null } as Spirit;
}

function mkDeps(over: any = {}) {
  const world = new World(emptyMap()); world.addEntity(maeve());
  const store = new NpcAttentionStore();
  const queue = new CommandQueue();
  const playerSpirit = over.playerSpirit ?? spirit(20);
  return {
    world, store, queue, playerSpirit,
    d: { world, store, queue, llm: over.llm ?? pageStub('She kneels in the furrows.', [{ label: 'fear', kind: 'concept' }]), playerSpirit, playerSpiritId: 'player' as const },
  };
}

describe('openMindPage', () => {
  it('surface (depth 0) is free, generates, and caches', async () => {
    const { d, store, playerSpirit } = mkDeps();
    const page = await openMindPage(maeve(), ['surface'], 0, d);
    expect(page?.prose).toContain('She kneels');
    expect(playerSpirit.power).toBe(20); // orchestrator does not spend; executor would (not run here)
    expect(store.getPage('maeve', pathKey(['surface']))).toBeDefined();
  });

  it('emits NO probe_mind command for a free depth-0 read', async () => {
    const { d } = mkDeps();
    await openMindPage(maeve(), ['surface'], 0, d);
    expect(d.queue.drain()).toHaveLength(0); // depth 0 is free → no spend record
  });

  it('passes recent whispers into the depth-0 surface prompt', async () => {
    const seen: string[] = [];
    const spyClient = new LLMClient({
      async generate(messages: any[]) {
        for (const m of messages) if (m.role === 'user') seen.push(m.content);
        return { content: '', toolCalls: [{ id: 'c0', name: 'emit_mind_page', arguments: { prose: 'p', links: [] } }], latencyMs: 0 };
      },
    } as any);
    const { d, store } = mkDeps({ llm: spyClient });
    store.appendTurn('maeve', { whisper: 'heed the river', dialogue: 'a voice?', tick: 1 });
    await openMindPage(maeve(), ['surface'], 0, d);
    expect(seen.join('\n')).toContain('heed the river');
  });

  it('a cache hit does not emit a command or re-generate', async () => {
    const { d, store, playerSpirit } = mkDeps();
    store.putPage('maeve', pathKey(['surface', 'fear']), { prose: 'cached', links: [], depth: 1 });
    const before = playerSpirit.power;
    const page = await openMindPage(maeve(), ['surface', 'fear'], 1, d);
    expect(page?.prose).toBe('cached');
    expect(playerSpirit.power).toBe(before);
    expect(d.queue.drain()).toHaveLength(0);
  });

  it('a depth-1 miss emits exactly one probe_mind command with depth payload', async () => {
    const { d } = mkDeps();
    await openMindPage(maeve(), ['surface', 'fear'], 1, d);
    const drained = d.queue.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0].verb).toBe('probe_mind');
    expect(drained[0].payload).toMatchObject({ depth: 1 });
  });

  it('aborts a drill the player cannot afford (no command, returns null)', async () => {
    const { d } = mkDeps({ playerSpirit: spirit(1) }); // depth 4 → cost 8 > 1
    const page = await openMindPage(maeve(), ['surface', 'a', 'b', 'c'], 4, d);
    expect(page).toBeNull();
    expect(d.queue.drain()).toHaveLength(0);
  });

  it('degrades a bad entity id to a concept link and caches the resolved page', async () => {
    const { d, store } = mkDeps({ llm: pageStub('p', [{ label: 'ghost', kind: 'entity', entityId: 'nope' }]) });
    const page = await openMindPage(maeve(), ['surface'], 0, d);
    expect(page?.links[0].kind).toBe('concept');
    expect(store.getPage('maeve', pathKey(['surface']))?.links[0].kind).toBe('concept');
  });

  it('returns an uncached fallback when the LLM yields no tool call', async () => {
    const noCall = new LLMClient({ async generate() { return { content: '', toolCalls: [], latencyMs: 0 }; } } as any);
    const { d, store } = mkDeps({ llm: noCall });
    const page = await openMindPage(maeve(), ['surface'], 0, d);
    expect(page?.prose.toLowerCase()).toMatch(/clouds over|nothing comes/);
    expect(store.getPage('maeve', pathKey(['surface']))).toBeUndefined(); // not cached
    expect(d.queue.drain()).toHaveLength(0); // no page → no probe_mind command → no charge
  });

  it('treats an empty-prose tool call as a failed read (fallback, no cache, no charge)', async () => {
    // A truncated/garbled tool call parses to empty args; it must not cache a blank
    // "…" page or charge the player — the read should stay retryable.
    const { d, store } = mkDeps({ llm: pageStub('   ', [{ label: 'fear', kind: 'concept' }]) });
    const page = await openMindPage(maeve(), ['surface'], 0, d);
    expect(page?.prose.toLowerCase()).toMatch(/clouds over|nothing comes/);
    expect(store.getPage('maeve', pathKey(['surface']))).toBeUndefined();
    expect(d.queue.drain()).toHaveLength(0);
  });

  it('does not emit a probe_mind command when the LLM throws (no charge on failure)', async () => {
    const throwing = new LLMClient({ async generate() { throw new Error('offline'); } } as any);
    const { d } = mkDeps({ llm: throwing });
    const page = await openMindPage(maeve(), ['surface', 'fear'], 1, d);
    expect(page?.prose.toLowerCase()).toMatch(/clouds over|nothing comes/);
    expect(d.queue.drain()).toHaveLength(0);
  });
});
