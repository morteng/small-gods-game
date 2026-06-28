/**
 * Layer 2 — FORM. `connectomeForm` derives a `gen-form` body's vertical massing
 * (plan/levels/jetty/storeyM) from the program (topology + rooms) and the structure (the
 * frame's caps), within those caps. The headline: the SAME program reads differently
 * through a different frame — a box-frame dwelling stacks a jettied upper storey, a cruck
 * one stays a single low range. Footprint/roof are left authored (placement unchanged).
 * Content-free + deterministic; opt-in via the gen-form tag.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { catalogue, loadDefaultPacks } from '@/catalogue';
import { connectomeForm, GEN_FORM_TAG, annotateStructure } from '@/blueprint/connectome';
import type { ExpandCtx, Connectome } from '@/blueprint/connectome';
import type { Blueprint } from '@/blueprint/types';

let ctx: ExpandCtx;
beforeAll(() => {
  loadDefaultPacks();
  ctx = { era: 'medieval', wealth: 'modest', seed: 1, registry: catalogue };
});

// A minimal gen-form dwelling blueprint with the given wall material.
const dwelling = (walls: string): Blueprint => ({
  version: 1, class: 'building', preset: 'd', footprint: { w: 3, h: 3 },
  materials: { walls, roof: 'tile', ground: 'packed_dirt' },
  parts: { body: { type: 'body', size: { w: 3, h: 2 }, tags: [GEN_FORM_TAG], params: { plan: 'rect', levels: 1, roof: 'gable', jetty: 0 } } },
});
// A two-room program (so the box-frame dwelling has reason to stack a storey).
const con = (topology = 'tripartite-linear', zones = 2): Connectome => ({
  scale: 'building',
  zones: Array.from({ length: zones }, (_, i) => ({ id: `z${i}`, type: 'r', scale: 'room' as const })),
  portals: [], fixtures: [], source: { type: '', topology },
});

describe('connectomeForm — form follows construction', () => {
  it('a box-frame dwelling stacks a jettied upper storey', () => {
    const base = dwelling('timber');
    const c = annotateStructure(con(), base, ctx);
    c.structure = { frame: 'box-frame', maxStoreys: 3, jettyMax: 0.15 };
    const patch = connectomeForm(c, base, ctx);
    expect(patch.parts?.body?.params?.levels).toBe(2);
    expect(patch.parts?.body?.params?.jetty).toBe(0.15);
  });

  it('a cruck dwelling of the SAME program stays a single low range, no jetty', () => {
    const base = dwelling('wattle');
    const c = annotateStructure(con(), base, ctx); // wattle ⇒ cruck (jettyMax 0)
    expect(c.structure?.frame).toBe('cruck');
    const patch = connectomeForm(c, base, ctx);
    expect(patch.parts?.body?.params?.levels).toBe(1);
    expect(patch.parts?.body?.params?.jetty).toBe(0);
  });

  it('never out-builds the frame — storeys clamp to maxStoreys', () => {
    const base = dwelling('timber');
    const c = con('vertical-stack', 6); // 6 stacked zones …
    c.structure = { frame: 'box-frame', maxStoreys: 3, jettyMax: 0.15 };
    const patch = connectomeForm(c, base, ctx);
    expect(patch.parts?.body?.params?.levels).toBe(3); // … capped to 3
  });

  it('a sacred body is built tall (storeyM raised)', () => {
    const base = dwelling('stone');
    const c = con('church-axial', 2);
    c.structure = { frame: 'mass-wall', maxStoreys: 4, jettyMax: 0 };
    const patch = connectomeForm(c, base, ctx);
    expect(patch.parts?.body?.params?.storeyM).toBe(4.5);
    expect(patch.parts?.body?.params?.jetty).toBe(0); // mass wall never jetties
  });

  it('leaves a body that has not opted in untouched', () => {
    const base = dwelling('timber');
    base.parts.body.tags = []; // no gen-form
    const c = annotateStructure(con(), base, ctx);
    expect(connectomeForm(c, base, ctx)).toEqual({});
  });

  it('is deterministic', () => {
    const base = dwelling('timber');
    const c = annotateStructure(con(), base, ctx);
    expect(connectomeForm(c, base, ctx)).toEqual(connectomeForm(c, base, ctx));
  });
});
