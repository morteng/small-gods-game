/**
 * Layer 1 — STRUCTURE. `selectFrame` chooses a building's load system (frameType) from its
 * wall material + era/region (or an explicit hint); `annotateStructure` writes the chosen
 * frame + its limits onto the connectome; `connectomeStructure` projects those limits DOWN
 * onto the body parts as a cap patch (a solid wall can't jetty; a frame bears only so many
 * storeys). Different building types SHARE a frame (timber → box-frame/cruck) or not (stone
 * → mass-wall). Deterministic + content-free throughout.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { catalogue, loadDefaultPacks } from '@/catalogue';
import { selectFrame, annotateStructure, connectomeStructure } from '@/blueprint/connectome';
import type { ExpandCtx } from '@/blueprint/connectome';
import type { Blueprint } from '@/blueprint/types';

let ctx: ExpandCtx;
const pick = (over: Partial<ExpandCtx> = {}): ExpandCtx => ({ ...ctx, ...over });

beforeAll(() => {
  loadDefaultPacks();
  ctx = { era: 'medieval', wealth: 'modest', seed: 1, registry: catalogue };
});

describe('selectFrame — construction derived from material + region', () => {
  it('a stone wall ⇒ mass-wall (a solid wall, no frame)', () => {
    expect(selectFrame('stone', ctx)).toBe('mass-wall');
    expect(selectFrame('flagstone', ctx)).toBe('mass-wall');
  });

  it('a wattle/cob wall ⇒ cruck (the commoner timber truss)', () => {
    expect(selectFrame('wattle', ctx)).toBe('cruck');
    expect(selectFrame('cob', ctx)).toBe('cruck');
  });

  it('an explicit hint wins over the material derivation', () => {
    // timber would otherwise derive to a timber frame; the hint pins box-frame.
    expect(selectFrame('timber', ctx, 'box-frame')).toBe('box-frame');
    // a hint that does not resolve falls back to derivation.
    expect(selectFrame('stone', ctx, 'no-such-frame')).toBe('mass-wall');
  });

  it('region re-picks the frame for the SAME material (Scandinavia ⇒ stave)', () => {
    expect(selectFrame('log', pick({ region: 'scandinavia' }))).toBe('stave');
    // no region → the same log wall takes a different frame (not stave).
    expect(selectFrame('log', ctx)).not.toBe('stave');
  });

  it('is deterministic — same inputs, same frame', () => {
    expect(selectFrame('timber', ctx, 'box-frame')).toBe(selectFrame('timber', ctx, 'box-frame'));
    expect(selectFrame('stone', ctx)).toBe(selectFrame('stone', ctx));
  });
});

// Minimal blueprints exercising the projection (no geometry build needed).
const stoneBody = (jetty: number, levels: number): Blueprint => ({
  version: 1, class: 'building', preset: 't', footprint: { w: 3, h: 3 },
  materials: { walls: 'stone', roof: 'tile', ground: 'flagstone' },
  parts: { body: { type: 'body', size: { w: 3, h: 2 }, params: { plan: 'rect', levels, roof: 'gable', jetty } } },
});
const timberBody = (jetty: number): Blueprint => ({
  version: 1, class: 'building', preset: 't', footprint: { w: 3, h: 3 },
  materials: { walls: 'timber', roof: 'tile', ground: 'packed_dirt' },
  parts: { body: { type: 'body', size: { w: 3, h: 2 }, params: { plan: 'rect', levels: 2, roof: 'gable', jetty } } },
});
const conFor = (base: Blueprint, frameHint?: string) =>
  annotateStructure(
    { scale: 'building', zones: [], portals: [], fixtures: [], source: { type: frameHint ? '' : undefined } },
    base,
    ctx,
  );

describe('annotateStructure — the frame written onto the graph', () => {
  it('copies the chosen frame + its load limits onto con.structure', () => {
    const con = conFor(stoneBody(0, 1));
    expect(con.structure?.frame).toBe('mass-wall');
    expect(con.structure?.jettyMax).toBe(0);
    expect(con.structure?.maxStoreys).toBe(4);
    expect(con.structure?.bayModule).toBeGreaterThan(0);
  });
});

describe('connectomeStructure — the frame gates the form', () => {
  it('a solid (mass) wall cannot jetty — the overhang is capped to 0', () => {
    const base = stoneBody(0.12, 2);
    const patch = connectomeStructure(conFor(base), base);
    expect(patch.parts?.body?.params?.jetty).toBe(0);
  });

  it('a box-frame KEEPS its jetty (the timber-frame trick is allowed)', () => {
    const base = timberBody(0.12);
    const con = annotateStructure(
      { scale: 'building', zones: [], portals: [], fixtures: [], structure: undefined },
      base,
      ctx,
    );
    // force box-frame via the annotation so the test is independent of timber tie-break
    con.structure = { frame: 'box-frame', jettyMax: 0.15, maxStoreys: 3 };
    expect(connectomeStructure(con, base)).toEqual({}); // 0.12 ≤ 0.15, 2 ≤ 3 → no cap
  });

  it('caps storeys to what the frame bears', () => {
    const base = stoneBody(0, 6); // 6 storeys on a mass wall (max 4)
    const patch = connectomeStructure(conFor(base), base);
    expect(patch.parts?.body?.params?.levels).toBe(4);
  });

  it('a building already within its frame stays byte-identical (empty patch)', () => {
    const base = stoneBody(0, 2);
    expect(connectomeStructure(conFor(base), base)).toEqual({});
  });
});
