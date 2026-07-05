// tests/unit/fate-author-building.test.ts
// The runtime endpoint of the building-authoring harness: Fate's `author_building` tool
// gates every building through `authorBlueprint` (resolve + lint) and emits a
// `place_building` command carrying the ALREADY-resolved blueprint — so a runtime agent
// physically cannot stamp a broken structure, and what is placed is exactly what was gated.
import { describe, it, expect } from 'vitest';
import type { LLMToolCall } from '@/llm/llm-client';
import { FATE_TOOLS, FATE_BUILDING_PRESETS, parseFateToolCalls } from '@/game/fate/fate-tools';
import { authorBlueprint } from '@/blueprint/authoring';
import { CAPABILITY_REGISTRY } from '@/sim/command/registry';
import { World } from '@/world/world';
import { EventLog } from '@/core/events';
import { SimClock } from '@/core/clock';
import { createRng } from '@/core/rng';
import { blueprintOf } from '@/blueprint/entity';
import type { GameMap } from '@/core/types';
import type { ApplyCtx } from '@/sim/command/types';

const call = (args: Record<string, unknown>): LLMToolCall => ({ id: 'c0', name: 'author_building', arguments: args });
const ctx = () => ({ validPoiIds: new Set(['poi1', 'poi2']), validRivalIds: new Set<string>(), now: 100 });

describe('author_building — the Fate tool', () => {
  it('is exposed with a preset enum drawn from the live building vocabulary', () => {
    const tool = FATE_TOOLS.find((t) => t.name === 'author_building')!;
    expect(tool).toBeDefined();
    const presetEnum = (tool.parameters.properties as Record<string, { enum?: string[] }>).preset.enum!;
    expect(presetEnum).toEqual([...FATE_BUILDING_PRESETS]);
    expect(presetEnum).toContain('shrine');
    expect(presetEnum).not.toContain('nope');
  });

  it('gates a valid building through to a place_building command carrying the resolved blueprint', () => {
    const { commands, beats } = parseFateToolCalls([call({ subjectPoiId: 'poi1', preset: 'shrine' })], ctx());
    expect(beats).toHaveLength(0);
    expect(commands).toHaveLength(1);
    const cmd = commands[0];
    expect(cmd.verb).toBe('place_building');
    expect(cmd.source).toBe('fate');
    expect(cmd.target).toEqual({ kind: 'settlement', poiId: 'poi1' });
    // The gated, already-resolved blueprint rides through verbatim — no re-resolution.
    const resolved = (cmd.payload as { resolved?: unknown }).resolved as { parts?: unknown[]; preset?: string };
    expect(Array.isArray(resolved.parts)).toBe(true);
    expect(resolved.preset).toBe('shrine');
  });

  it('what the tool emits equals what the gate resolves (byte-identical parts)', () => {
    const { commands } = parseFateToolCalls([call({ subjectPoiId: 'poi1', preset: 'cottage' })], ctx());
    const emitted = (commands[0].payload as { resolved: { parts: unknown[] } }).resolved;
    const gated = authorBlueprint({ preset: 'cottage' }).rb!;
    expect(emitted.parts).toEqual(gated.parts);
  });

  it('restyle descriptors ride through the gate onto the resolved blueprint', () => {
    const { commands } = parseFateToolCalls(
      [call({ subjectPoiId: 'poi2', preset: 'manor', wealth: 'opulent', quality: 'ornate', style: 'guild' })],
      ctx(),
    );
    expect(commands).toHaveLength(1);
    const resolved = (commands[0].payload as { resolved: { descriptors?: Record<string, unknown> } }).resolved;
    expect(resolved.descriptors).toMatchObject({ wealth: 'opulent', quality: 'ornate', style: 'guild' });
  });

  it('drops an unknown subjectPoiId (drift guard)', () => {
    const { commands } = parseFateToolCalls([call({ subjectPoiId: 'ghost', preset: 'shrine' })], ctx());
    expect(commands).toHaveLength(0);
  });

  it('drops an unknown preset (never hallucinates a building type)', () => {
    const { commands } = parseFateToolCalls([call({ subjectPoiId: 'poi1', preset: 'space_station' })], ctx());
    expect(commands).toHaveLength(0);
  });

  it('drops a causal site subject — a transient place cannot hold a building', () => {
    const siteCtx = { validPoiIds: new Set(['causal:flood:0003']), validRivalIds: new Set<string>(), now: 50 };
    const { commands } = parseFateToolCalls([call({ subjectPoiId: 'causal:flood:0003', preset: 'shrine' })], siteCtx);
    expect(commands).toHaveLength(0);
  });

  it('ignores unknown descriptor-enum values rather than forwarding them', () => {
    const { commands } = parseFateToolCalls(
      [call({ subjectPoiId: 'poi1', preset: 'cottage', wealth: 'fabulously-rich' })],
      ctx(),
    );
    // Unknown wealth is dropped; the building still resolves cleanly (no descriptors).
    const resolved = (commands[0].payload as { resolved: { descriptors?: Record<string, unknown> } }).resolved;
    expect(resolved.descriptors?.wealth).toBeUndefined();
  });
});

// --- the far end: place_building accepts and stamps the pre-resolved blueprint ---

function realizedMap(w = 40, h = 40): GameMap {
  const tiles = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) row.push({ type: 'grass', x, y, walkable: true, state: 'realized' as const });
    tiles.push(row);
  }
  return { tiles, width: w, height: h, villages: [], seed: 1, success: true,
    worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap;
}

describe('place_building — pre-resolved blueprint path', () => {
  it('stamps a building from a `{ resolved }` payload verbatim (what Fate emits)', () => {
    const cap = CAPABILITY_REGISTRY.place_building;
    const rb = authorBlueprint({ preset: 'cottage' }).rb!;
    const world = new World(realizedMap());
    const applyCtx: ApplyCtx = { world, spirits: new Map(), log: new EventLog(new SimClock()), rng: createRng(7), now: 100 };
    const cmd = {
      verb: 'place_building' as const, source: 'fate' as const,
      target: { kind: 'none' as const }, payload: { resolved: rb, at: { x: 10, y: 10 } }, seq: 1,
    };
    expect(cap.precondition!(cmd, applyCtx)).toBeNull();
    expect(cap.apply!(cmd, applyCtx)).toBe(true);
    const placed = world.query({}).filter((e) => e.tags?.includes('building'));
    expect(placed).toHaveLength(1);
    expect(blueprintOf(placed[0])!.rb.preset).toBe('cottage');
  });
});
