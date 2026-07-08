import { describe, it, expect, beforeEach } from 'vitest';
import { makeStudioBus, setActiveStudioController, type StudioController } from '@/studio/studio-bridge';
import { dispatchBus } from '@/dev/bus-bridge-protocol';

function mockController(): StudioController & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    kinds: () => ['cottage', 'tavern'],
    get kind() { return 'cottage'; },
    setKind: async (k) => { calls.push(`setKind:${k}`); return true; },
    render: async (k) => { calls.push(`render:${k ?? ''}`); return 'data:image/png;base64,AAAA'; },
    grab: () => 'data:image/png;base64,BBBB',
    randomize: async () => { calls.push('randomize'); return true; },
    setTextured: (on) => { calls.push(`textured:${on}`); },
    rb: () => ({ preset: 'cottage' }),
    prompt: () => 'a cottage',
    renderPaid: async (k) => { calls.push(`paid:${k ?? ''}`); return { ok: true }; },
  };
}

const q = (bus: ReturnType<typeof makeStudioBus>, fn: string, args: unknown[] = [], allowWrite = false) =>
  dispatchBus(bus, 'query', { fn, args }, { allowWrite });

describe('studio bridge', () => {
  beforeEach(() => setActiveStudioController(null));

  it('lists kinds and state via query', async () => {
    setActiveStudioController(mockController());
    const bus = makeStudioBus(false);
    expect(await q(bus, 'studio_kinds')).toEqual(['cottage', 'tavern']);
    expect(await q(bus, 'studio_state')).toEqual({ kind: 'cottage' });
  });

  it('select routes to setKind and returns the pane screenshot data-uri', async () => {
    const c = mockController(); setActiveStudioController(c);
    const img = await q(makeStudioBus(false), 'studio_select', ['tavern']);
    expect(c.calls).toContain('setKind:tavern');
    expect(img).toBe('data:image/png;base64,BBBB');
  });

  it('render forwards the textured flag and the kind', async () => {
    const c = mockController(); setActiveStudioController(c);
    await q(makeStudioBus(false), 'studio_render', ['cottage', false]);
    expect(c.calls).toContain('textured:false');
    expect(c.calls).toContain('render:cottage');
  });

  it('the paid render is gated on ?bridge=rw', async () => {
    setActiveStudioController(mockController());
    await expect(q(makeStudioBus(false), 'studio_render_paid', [])).rejects.toThrow(/bridge=rw/);
    expect(await q(makeStudioBus(true), 'studio_render_paid', ['cottage'], true)).toEqual({ ok: true });
  });

  it('throws a helpful error when no studio is active', async () => {
    await expect(q(makeStudioBus(false), 'studio_kinds')).rejects.toThrow(/no active Object studio/);
  });

  it('the screenshot query returns the pane grab (so the existing MCP screenshot tool works)', async () => {
    setActiveStudioController(mockController());
    expect(await q(makeStudioBus(false), 'screenshot')).toBe('data:image/png;base64,BBBB');
  });

  it('rejects an unknown query fn', async () => {
    setActiveStudioController(mockController());
    await expect(q(makeStudioBus(false), 'studio_nope')).rejects.toThrow(/unknown query fn/);
  });
});
