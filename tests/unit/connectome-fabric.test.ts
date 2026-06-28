/**
 * Layer 3a — FABRIC. STRUCTURE gates the fabric: the frame the building is built in
 * decides how its walls open and how its hearth vents. Two content-free, deterministic
 * gates:
 *   1. Openings rhythm — a mass wall takes few, widely-spaced lights; a box frame's
 *      panels glaze generously. `connectomeOpenings` reads `con.structure.fenestration`.
 *   2. Smoke egress — a masonry wall-chimney needs a flue-capable frame. A cruck/stave
 *      build can never grow a stone stack and keeps its ridge smokehole however rich.
 * The gates engage only once structure is annotated; an un-annotated connectome keeps
 * the neutral defaults (so the legacy smoke path is untouched).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { CatalogueRegistry } from '@/catalogue/registry';
import { loadPack } from '@/catalogue/pack';
import { medievalEuropePack } from '@/catalogue/packs/medieval-europe';
import { deriveSmokeEgress } from '@/blueprint/connectome/smoke';
import { connectomeOpenings, GEN_OPENINGS_TAG } from '@/blueprint/connectome/openings';
import type { Connectome, ExpandCtx } from '@/blueprint/connectome/types';
import type { Blueprint, BlueprintPatch, Feature } from '@/blueprint/types';

let registry: CatalogueRegistry;
const ctx = (over: Partial<ExpandCtx> = {}): ExpandCtx => ({ era: 'medieval', wealth: 'rich', seed: 1, registry, ...over });

beforeAll(() => {
  registry = new CatalogueRegistry();
  loadPack(medievalEuropePack, registry);
});

// A hearth-bearing single-room connectome with an explicit frame annotation.
const hearthCon = (frame: string): Connectome => ({
  scale: 'building',
  zones: [{ id: 'z0', type: 'r', scale: 'room' }],
  portals: [],
  fixtures: [{ id: 'hearth', type: 'h', zoneId: 'z0', requires: ['smoke-egress'] }],
  structure: { frame },
  source: { type: '', topology: 'tripartite-linear' },
});

const egressType = (frame: string, c: Partial<ExpandCtx> = {}): string | undefined => {
  const con = deriveSmokeEgress(hearthCon(frame), ctx(c));
  return con.fixtures.find((f) => f.satisfies?.includes('smoke-egress'))?.type;
};

describe('connectomeFabric — structure gates the hearth egress', () => {
  it('a flue-capable frame (box-frame) admits the masonry wall-chimney when rich', () => {
    expect(egressType('box-frame', { wealth: 'rich' })).toBe('wall-chimney');
  });

  it('a mass wall hosts the wall-chimney in its thickness', () => {
    expect(egressType('mass-wall', { wealth: 'rich' })).toBe('wall-chimney');
  });

  it('a cruck frame is barred from a stone stack — keeps a ridge smokehole even when rich', () => {
    const e = egressType('cruck', { wealth: 'rich' });
    expect(e).not.toBe('wall-chimney');
    expect(['smoke-hood', 'louver', 'smoke-hole']).toContain(e);
  });

  it('a stave frame likewise never grows a chimney', () => {
    expect(egressType('stave', { wealth: 'rich' })).not.toBe('wall-chimney');
  });

  it('an un-annotated connectome keeps the legacy egress (no frame constraint)', () => {
    const con: Connectome = { ...hearthCon('cruck'), structure: undefined };
    const e = deriveSmokeEgress(con, ctx({ wealth: 'rich' })).fixtures.find((f) =>
      f.satisfies?.includes('smoke-egress'),
    )?.type;
    expect(e).toBe('wall-chimney'); // default: flue allowed
  });
});

// A lit, doored body that opts into generative openings, with a long wall run so the
// frame's per-face cap actually bites.
const litBase = (): Blueprint => ({
  version: 1, class: 'building', preset: 'd', footprint: { w: 6, h: 4 },
  materials: { walls: 'timber', roof: 'tile', ground: 'packed_dirt' },
  parts: { body: { type: 'body', size: { w: 6, h: 4 }, tags: [GEN_OPENINGS_TAG], params: { plan: 'rect', levels: 1, roof: 'gable' } } },
});
const litCon = (fenestration?: { maxPerFace?: number; spacing?: number }): Connectome => ({
  scale: 'building',
  zones: [{ id: 'z0', type: 'r', scale: 'room', tags: ['needs-light'] }],
  portals: [{ id: 'p0', type: 'd', from: 'OUTSIDE', to: 'z0', face: 'south', main: true }],
  fixtures: [],
  ...(fenestration ? { structure: { frame: 'f', fenestration } } : {}),
  source: { type: '', topology: 'tripartite-linear' },
});

const windowCount = (patch: BlueprintPatch): number =>
  Object.values(patch.parts ?? {})
    .flatMap((p) => Object.values((p as { features?: Record<string, Feature> })?.features ?? {}))
    .filter((f) => f.type === 'window').length;

describe('connectomeFabric — structure gates the opening rhythm', () => {
  it('a box frame glazes more generously than a mass wall on the same wall run', () => {
    const base = litBase();
    const boxed = windowCount(connectomeOpenings(litCon({ maxPerFace: 3, spacing: 1.5 }), base, 'medieval'));
    const massed = windowCount(connectomeOpenings(litCon({ maxPerFace: 2, spacing: 2.3 }), base, 'medieval'));
    expect(boxed).toBeGreaterThan(massed);
  });

  it('falls back to the neutral fenestration default when no frame is annotated', () => {
    const base = litBase();
    const a = connectomeOpenings(litCon(), base, 'medieval');
    const b = connectomeOpenings(litCon({ maxPerFace: 3, spacing: 1.6 }), base, 'medieval');
    expect(windowCount(a)).toBe(windowCount(b)); // default mirrors the constant
  });

  it('is deterministic', () => {
    const base = litBase();
    const a = JSON.stringify(connectomeOpenings(litCon({ maxPerFace: 2, spacing: 2.3 }), base, 'medieval'));
    const b = JSON.stringify(connectomeOpenings(litCon({ maxPerFace: 2, spacing: 2.3 }), base, 'medieval'));
    expect(a).toBe(b);
  });
});
