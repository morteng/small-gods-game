// @vitest-environment node
// The OPT-IN pick channel (studio click-to-select): blueprint part/feature ids threaded
// through toGeometry(srcId) → compose facets (src) → a per-pixel Uint16 pick buffer written
// under the SAME z-test as every colour channel, so the pick pixel is exactly the visible
// pixel. Two hard contracts guarded here:
//   1. OPT-IN: without the flags, the spec JSON carries NO srcId (the runtime parametric
//      sprite cache keys on canonicalJson(spec) — a default-path id would bust every key)
//      and the result carries NO pick buffer (the golden hashes stay pinned).
//   2. Per-storey window copies (`win_s_l1` from expandStoreyOpenings) resolve to the
//      AUTHORED feature id, so clicking an upper-storey window selects the `win_s` node.
import { describe, it, expect, beforeAll } from 'vitest';
import { composeStructure, type StructureResult } from '@/assetgen/compose';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { synthesizeBlueprint } from '@/blueprint/presets';
import type { ResolvedBlueprint } from '@/blueprint/types';

/** Scan the pick buffer for every pixel owned by `key` → its pixel bbox, or null if unused. */
function keyBBox(r: StructureResult, key: string): { x0: number; y0: number; x1: number; y1: number; count: number } | null {
  const pick = r.pick!;
  const idx = pick.table.indexOf(key) + 1;     // buffer values are 1-based (0 = none)
  if (idx === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, count = 0;
  for (let y = 0; y < pick.height; y++) for (let x = 0; x < pick.width; x++) {
    if (pick.data[y * pick.width + x] !== idx) continue;
    count++;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return count ? { x0, y0, x1, y1, count } : null;
}

describe('compose pick buffer (opt-in provenance)', () => {
  // The tavern is the richest single-part subject: an authored door, TWO chimney vents,
  // perStorey-ranked windows on a 2-storey body — every pick-atom kind in one blueprint.
  let rb: ResolvedBlueprint;
  let r: StructureResult;
  let bodyId: string;
  let doorKey: string, windowKey: string;
  let ventKeys: string[];

  beforeAll(async () => {
    rb = synthesizeBlueprint('tavern')!;
    expect(rb).toBeTruthy();
    const body = rb.parts.find((p) => p.features.length > 0)!;
    bodyId = body.id;
    const door = body.features.find((f) => f.type === 'door')!;
    const win = body.features.find((f) => f.type === 'window')!;
    const vents = body.features.filter((f) => f.type === 'vent');
    expect(door).toBeTruthy(); expect(win).toBeTruthy(); expect(vents.length).toBeGreaterThan(0);
    doorKey = `${bodyId}/${door.id}`;
    windowKey = `${bodyId}/${win.id}`;
    ventKeys = vents.map((v) => `${bodyId}/${v.id}`);
    r = await composeStructure(toGeometry(rb, { pickIds: true }), undefined, { pickIds: true });
  });

  it('emits a pick buffer aligned with the (uncropped) compose canvas', () => {
    expect(r.pick).toBeDefined();
    const pick = r.pick!;
    // Pick shares the grey/normal/… frame exactly: full uncropped size×size.
    expect(pick.width).toBe(r.size);
    expect(pick.height).toBe(r.size);
    expect(pick.data.length).toBe(r.size * r.size);
    expect(pick.table.length).toBeGreaterThan(0);
  });

  it('table names the body part, door, window and at least one vent by blueprint id', () => {
    expect(r.pick!.table).toContain(bodyId);
    expect(r.pick!.table).toContain(doorKey);
    expect(r.pick!.table).toContain(windowKey);
    // Wall-face vents can be back-facing on some massings; the ridge stack always reads.
    expect(ventKeys.some((k) => r.pick!.table.includes(k))).toBe(true);
  });

  it('window-furniture pixels exist, lie within the sprite, and are visible pixels', () => {
    // Derive the expected location from the RESULT (no magic pixel numbers): every pixel the
    // buffer attributes to the window must fall inside the sprite's opaque bbox (the window
    // pane/trim is part of the building's silhouette) and be an opaque albedo pixel.
    const bb = keyBBox(r, windowKey);
    expect(bb).not.toBeNull();
    expect(bb!.count).toBeGreaterThan(4);       // a real window, not a stray speck
    expect(bb!.x0).toBeGreaterThanOrEqual(Math.floor(r.bbox.x));
    expect(bb!.y0).toBeGreaterThanOrEqual(Math.floor(r.bbox.y));
    expect(bb!.x1).toBeLessThanOrEqual(Math.ceil(r.bbox.x + r.bbox.w));
    expect(bb!.y1).toBeLessThanOrEqual(Math.ceil(r.bbox.y + r.bbox.h));
    // The pick pixel is the VISIBLE pixel: sample the bbox's first owned pixel's alpha.
    const pick = r.pick!;
    const idx = pick.table.indexOf(windowKey) + 1;
    outer: for (let y = bb!.y0; y <= bb!.y1; y++) for (let x = bb!.x0; x <= bb!.x1; x++) {
      if (pick.data[y * pick.width + x] !== idx) continue;
      expect(r.grey[(y * r.size + x) * 4 + 3]).toBe(255);
      break outer;
    }
  });

  it('per-storey window copies resolve to the AUTHORED feature id (no _l<N> keys)', () => {
    // expandStoreyOpenings ranks perStorey windows up the floors as `win_s_l1`, `win_s_l2`…;
    // the pick key strips the suffix so every storey's copy selects the authored tree node.
    expect(rb.parts.some((p) => (p.params.levels as number) > 1)).toBe(true);   // the premise
    for (const key of r.pick!.table) expect(key).not.toMatch(/_l\d+$/);
  });

  it('without the flag: no pick buffer, and the spec JSON carries no srcId (cache-key safe)', async () => {
    // The runtime sprite cache keys on canonicalJson(toGeometry(rb)) — the default path must
    // stay byte-identical or every warm boot recomposes. Guarded at the JSON level.
    expect(JSON.stringify(toGeometry(rb))).not.toContain('srcId');
    const plain = await composeStructure(toGeometry(rb));
    expect(plain.pick).toBeUndefined();
  });
});
