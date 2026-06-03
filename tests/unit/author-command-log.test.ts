import { describe, it, expect } from 'vitest';
import { AuthorCommandLog } from '@/sim/command/author-command-log';
import type { Command } from '@/sim/command/types';

function cmd(verb: Command['verb'], payload: Record<string, unknown> = {}): Command {
  return { verb, source: 'author', target: { kind: 'none' }, payload, seq: 0 };
}

describe('AuthorCommandLog', () => {
  it('records and retrieves commands by exact tick', () => {
    const log = new AuthorCommandLog();
    log.record(5, cmd('author_remove_entity', { entityId: 'a' }));
    log.record(5, cmd('author_spawn_npc', { role: 'farmer' }));
    log.record(9, cmd('author_move_entity', { entityId: 'b' }));

    expect(log.at(5).map(c => c.verb)).toEqual(['author_remove_entity', 'author_spawn_npc']);
    expect(log.at(9)).toHaveLength(1);
    expect(log.at(7)).toEqual([]);
    expect(log.size()).toBe(3);
  });

  it('preserves insertion order within a tick', () => {
    const log = new AuthorCommandLog();
    log.record(1, cmd('author_spawn_npc', { role: 'a' }));
    log.record(1, cmd('author_spawn_npc', { role: 'b' }));
    expect(log.at(1).map(c => c.payload?.role)).toEqual(['a', 'b']);
  });

  it('truncateAfter drops entries strictly after the cutoff', () => {
    const log = new AuthorCommandLog();
    log.record(2, cmd('author_remove_entity'));
    log.record(5, cmd('author_remove_entity'));
    log.record(8, cmd('author_remove_entity'));
    log.truncateAfter(5);
    expect(log.all().map(e => e.tick)).toEqual([2, 5]);
  });

  it('reset clears everything', () => {
    const log = new AuthorCommandLog();
    log.record(1, cmd('author_remove_entity'));
    log.reset();
    expect(log.size()).toBe(0);
    expect(log.at(1)).toEqual([]);
  });
});
