// tests/unit/world-manager.test.ts
// WorldManager.loadNamed / loadDefault (src/map/world-manager.ts) — the named
// playable-world loader added for the New Game epic. fetch is stubbed with a
// minimal WorldSeed (validation is loud-but-never-fatal, so a minimal body is
// fine): the tests pin WHICH file is requested and that the canonical id is
// stamped on every load path.
import { describe, it, expect, afterEach } from 'vitest';
import { WorldManager } from '@/map/world-manager';

const MINIMAL_SEED = { name: 'Verdant Vale', size: { width: 128, height: 128 }, biome: 'temperate_grassland', pois: [], connections: [], constraints: [] };

const realFetch = globalThis.fetch;
function stubFetch(urls: string[]): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const u = String(input);
    urls.push(u);
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(MINIMAL_SEED)) } as Response;
  }) as typeof fetch;
}
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('WorldManager named world loading', () => {
  it('loadNamed(default) requests the default.json, stamps id=default', async () => {
    const urls: string[] = [];
    stubFetch(urls);
    const ws = await WorldManager.loadNamed('default');
    expect(urls.length).toBe(1);
    expect(urls[0]).toContain('data/worlds/default.json');
    expect(ws.id).toBe('default');
  });

  it('loadDefault delegates to loadNamed(default)', async () => {
    const urls: string[] = [];
    stubFetch(urls);
    const ws = await WorldManager.loadDefault();
    expect(urls[0]).toContain('data/worlds/default.json');
    expect(ws.id).toBe('default');
  });

  it('an unknown name falls back to the default file (never throws)', async () => {
    const urls: string[] = [];
    stubFetch(urls);
    const ws = await WorldManager.loadNamed('dawnwood');
    expect(urls[0]).toContain('data/worlds/default.json');
    expect(ws.id).toBe('default');
  });
});
