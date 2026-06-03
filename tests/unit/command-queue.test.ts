import { describe, it, expect } from 'vitest';
import { CommandQueue } from '@/sim/command/command-queue';
import type { Command } from '@/sim/command/types';

function cmd(verb: Command['verb'], npcId: string): Omit<Command, 'seq'> {
  return { verb, source: 'player', target: { kind: 'npc', npcId } };
}

describe('CommandQueue', () => {
  it('stamps a monotonic seq starting at 0', () => {
    const q = new CommandQueue();
    q.emit(cmd('whisper', 'a'));
    q.emit(cmd('whisper', 'b'));
    q.emit(cmd('whisper', 'c'));
    const drained = q.drain();
    expect(drained.map(c => c.seq)).toEqual([0, 1, 2]);
  });

  it('drains in FIFO order and empties', () => {
    const q = new CommandQueue();
    q.emit(cmd('whisper', 'a'));
    q.emit(cmd('dream', 'b'));
    const first = q.drain();
    expect(first.map(c => [c.verb, (c.target as { npcId: string }).npcId])).toEqual([
      ['whisper', 'a'], ['dream', 'b'],
    ]);
    expect(q.size()).toBe(0);
    expect(q.drain()).toEqual([]);
  });

  it('seq keeps advancing across drains', () => {
    const q = new CommandQueue();
    q.emit(cmd('whisper', 'a'));
    q.drain();
    q.emit(cmd('whisper', 'b'));
    expect(q.drain()[0].seq).toBe(1);
  });

  it('clear() empties pending without resetting seq', () => {
    const q = new CommandQueue();
    q.emit(cmd('whisper', 'a'));
    q.clear();
    expect(q.size()).toBe(0);
    q.emit(cmd('whisper', 'b'));
    expect(q.drain()[0].seq).toBe(1);
  });
});
