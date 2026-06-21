import { describe, it, expect } from 'vitest';
import { dispatchBus, type BusLike } from '@/dev/bus-bridge-protocol';

function mockBus(): BusLike & { emitted: unknown[] } {
  const emitted: unknown[] = [];
  return {
    emitted,
    query: {
      worldSummary: () => ({ name: 'Test', npcs: 3 }),
      npc: (id: string) => (id === 'npc:1' ? { id, name: 'Ada' } : null),
      npcs: (filter?: unknown) => [{ id: 'npc:1', filter }],
    },
    capabilities: () => [{ verb: 'whisper', tier: 'divine', cost: 1, targetKind: 'npc', implemented: true }],
    preview: (cmd: unknown) => (cmd ? null : 'invalid_payload'),
    emit(cmd: unknown) { emitted.push(cmd); },
  };
}

const RO = { allowWrite: false };
const RW = { allowWrite: true };

describe('dispatchBus', () => {
  it('ping → pong', async () => {
    expect(await dispatchBus(mockBus(), 'ping', undefined, RO)).toBe('pong');
  });

  it('capabilities returns the verb vocabulary', async () => {
    const caps = (await dispatchBus(mockBus(), 'capabilities', undefined, RO)) as any[];
    expect(caps[0].verb).toBe('whisper');
  });

  it('query routes to the named fn with args', async () => {
    const bus = mockBus();
    expect(await dispatchBus(bus, 'query', { fn: 'worldSummary' }, RO)).toEqual({ name: 'Test', npcs: 3 });
    expect(await dispatchBus(bus, 'query', { fn: 'npc', args: ['npc:1'] }, RO)).toEqual({ id: 'npc:1', name: 'Ada' });
    expect(await dispatchBus(bus, 'query', { fn: 'npc', args: ['npc:999'] }, RO)).toBeNull();
  });

  it('query throws on a missing fn name', async () => {
    await expect(dispatchBus(mockBus(), 'query', {}, RO)).rejects.toThrow(/requires \{ fn \}/);
  });

  it('query throws on an unknown fn', async () => {
    await expect(dispatchBus(mockBus(), 'query', { fn: 'nope' }, RO)).rejects.toThrow(/unknown query fn: nope/);
  });

  it('preview delegates to the bus and requires a cmd', async () => {
    expect(await dispatchBus(mockBus(), 'preview', { cmd: { verb: 'whisper' } }, RO)).toBeNull();
    await expect(dispatchBus(mockBus(), 'preview', {}, RO)).rejects.toThrow(/requires \{ cmd \}/);
  });

  it('emit is rejected on a read-only bridge', async () => {
    const bus = mockBus();
    await expect(dispatchBus(bus, 'emit', { cmd: { verb: 'whisper' } }, RO)).rejects.toThrow(/read-only/);
    expect(bus.emitted).toHaveLength(0);
  });

  it('emit forwards to bus.emit on a read-write bridge', async () => {
    const bus = mockBus();
    const cmd = { verb: 'whisper', source: 'player', target: { kind: 'none' } };
    expect(await dispatchBus(bus, 'emit', { cmd }, RW)).toEqual({ accepted: true });
    expect(bus.emitted).toEqual([cmd]);
  });

  it('emit requires a cmd even when writes are allowed', async () => {
    await expect(dispatchBus(mockBus(), 'emit', {}, RW)).rejects.toThrow(/requires \{ cmd \}/);
  });

  it('throws on an unknown method', async () => {
    await expect(dispatchBus(mockBus(), 'bogus' as any, undefined, RW)).rejects.toThrow(/unknown method: bogus/);
  });
});
