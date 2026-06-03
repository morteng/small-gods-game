import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountCreatePanel } from '@/dev/CreatePanel';
import { World } from '@/world/world';
import { initNpcProps } from '@/world/npc-helpers';
import { LLMClient } from '@/llm/llm-client';
import type { GameState } from '@/core/state';
import type { GameMap, NpcProperties } from '@/core/types';
import type { LLMToolCall } from '@/llm/llm-client';

function bigMap(n = 10): GameMap {
  const tiles: GameMap['tiles'] = [];
  for (let y = 0; y < n; y++) {
    const row = [];
    for (let x = 0; x < n; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' });
    tiles.push(row as never);
  }
  return { tiles, width: n, height: n, villages: [], seed: 1, success: true, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

function state(): GameState {
  const world = new World(bigMap());
  const p = initNpcProps('Aldous', 'farmer' as NpcProperties['role'], 7);
  p.homePoiId = 'northvale';
  world.addEntity({ id: 'n1', kind: 'npc', x: 5, y: 5, properties: p as unknown as Record<string, unknown> });
  return {
    world,
    spirits: new Map([['player', { id: 'player', name: 'You', sigil: '✦', color: '#fff', isPlayer: true, power: 100, manifestation: null }]]),
    eventLog: { append: vi.fn() },
    worldSeed: { name: 'Testlands', size: { width: 10, height: 10 }, pois: [{ id: 'northvale', name: 'Northvale', type: 'village', position: { x: 5, y: 5 } }] },
  } as unknown as GameState;
}

/** A capable client whose provider returns the given canned tool calls. */
function mockCapable(toolCalls: LLMToolCall[]): LLMClient {
  return new LLMClient({
    name: () => 'mock', isAvailable: () => true,
    async generate() { return { content: '', latencyMs: 0, toolCalls }; },
  });
}

function button(root: HTMLElement, text: string): HTMLButtonElement {
  const b = Array.from(root.querySelectorAll('button')).find(x => x.textContent?.includes(text));
  if (!b) throw new Error(`no button "${text}"`);
  return b as HTMLButtonElement;
}

describe('CreatePanel', () => {
  let container: HTMLElement;
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); });

  it('mounts with a prompt textarea and a Send button', () => {
    const panel = mountCreatePanel({ container, getState: () => state(), queue: { emit: vi.fn() } as never, getLlmCapable: () => null });
    expect(panel.element.querySelector('textarea')).toBeTruthy();
    expect(() => button(panel.element, 'Send')).not.toThrow();
  });

  it('shows a hint and disables Send when no capable client is configured', () => {
    const panel = mountCreatePanel({ container, getState: () => state(), queue: { emit: vi.fn() } as never, getLlmCapable: () => null });
    expect(button(panel.element, 'Send').disabled).toBe(true);
    expect(panel.element.textContent).toMatch(/capable model/i);
  });

  it('on Send → renders a preview line per tool call', async () => {
    const queue = { emit: vi.fn() };
    const capable = mockCapable([{ id: 'c1', name: 'author_spawn_npc', arguments: { role: 'priest', count: 2, near: 'northvale' } }]);
    const panel = mountCreatePanel({ container, getState: state, queue: queue as never, getLlmCapable: () => capable });

    panel.element.querySelector('textarea')!.value = 'add 2 priests to northvale';
    await panel.send();

    expect(panel.element.textContent).toMatch(/spawn 2× priest/i);
    expect(queue.emit).not.toHaveBeenCalled(); // preview only — not yet emitted
  });

  it('on Confirm → emits valid editor commands with source author', async () => {
    const queue = { emit: vi.fn() };
    const capable = mockCapable([{ id: 'c1', name: 'author_spawn_npc', arguments: { role: 'priest', count: 1, near: 'northvale' } }]);
    const panel = mountCreatePanel({ container, getState: state, queue: queue as never, getLlmCapable: () => capable });

    panel.element.querySelector('textarea')!.value = 'add a priest';
    await panel.send();
    button(panel.element, 'Confirm').dispatchEvent(new Event('click'));

    expect(queue.emit).toHaveBeenCalledWith(expect.objectContaining({
      verb: 'author_spawn_npc', source: 'author', payload: expect.objectContaining({ role: 'priest' }),
    }));
  });

  it('marks an invalid tool call as rejected in the preview and does not emit it', async () => {
    const queue = { emit: vi.fn() };
    // missing role → previewCommand rejects invalid_payload
    const capable = mockCapable([{ id: 'c1', name: 'author_spawn_npc', arguments: { near: 'northvale' } }]);
    const panel = mountCreatePanel({ container, getState: state, queue: queue as never, getLlmCapable: () => capable });

    panel.element.querySelector('textarea')!.value = 'add someone';
    await panel.send();
    expect(panel.element.textContent).toMatch(/invalid_payload|rejected/i);

    button(panel.element, 'Confirm').dispatchEvent(new Event('click'));
    expect(queue.emit).not.toHaveBeenCalled();
  });
});
