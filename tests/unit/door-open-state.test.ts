// @vitest-environment node
// EPHEMERAL door-open state (studio click-to-test). A door's leaf swings when its pick key
// (`<partId>/<featureId>`) carries `open > 0` in the compose-time `featureStates` arg — NEVER a
// blueprint param. Two hard contracts guarded here (mirroring the pick-channel opt-in contract):
//   1. CACHE-SAFE DEFAULT: omitting `featureStates`, OR passing an empty map, OR naming an unknown
//      key / a NON-door feature, leaves toGeometry(rb) output byte-identical to today — so the
//      parametric sprite cache + every generated-art exact key stay pinned (see the door.ts /
//      to-geometry.ts constraint comments). Only `open > 0` on a real door diverges.
//   2. The open leaf actually MOVED: it gains a `yaw` and a shifted `at` (the hinge-edge swing).
import { describe, it, expect, beforeAll } from 'vitest';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { synthesizeBlueprint } from '@/blueprint/presets';
import type { ResolvedBlueprint } from '@/blueprint/types';
import type { StructureSpec, Part } from '@/assetgen/compose';

/** The swinging LEAF prim for a door pick key: the door-material box the filler stamps with that
 *  key. (doorTrim also stamps the same key onto stone/metal boxes — filter to the leaf material.) */
function doorLeaf(spec: StructureSpec, key: string): Extract<Part, { prim: 'box' }> | undefined {
  return spec.parts.find(
    (p): p is Extract<Part, { prim: 'box' }> => p.prim === 'box' && p.srcId === key && p.material === 'door',
  );
}

describe('door-open ephemeral state (studio click-to-test)', () => {
  let rb: ResolvedBlueprint;
  let doorKey: string;   // `<bodyId>/<doorId>`
  let windowKey: string;

  beforeAll(() => {
    ensureBuildingTypesRegistered();
    rb = synthesizeBlueprint('tavern')!;
    expect(rb).toBeTruthy();
    const body = rb.parts.find((p) => p.features.some((f) => f.type === 'door'))!;
    const door = body.features.find((f) => f.type === 'door')!;
    const win = body.features.find((f) => f.type === 'window')!;
    expect(door).toBeTruthy(); expect(win).toBeTruthy();
    doorKey = `${body.id}/${door.id}`;
    windowKey = `${body.id}/${win.id}`;
  });

  it('absent / empty featureStates ⇒ output byte-identical to the default path (cache-safe)', () => {
    const base = JSON.stringify(toGeometry(rb));
    expect(JSON.stringify(toGeometry(rb, {}))).toBe(base);
    expect(JSON.stringify(toGeometry(rb, { featureStates: {} }))).toBe(base);
    // A door explicitly SHUT (open:0) is also the default geometry — nothing swings.
    expect(JSON.stringify(toGeometry(rb, { featureStates: { [doorKey]: { open: 0 } } }))).toBe(base);
  });

  it('opening a door CHANGES the geometry JSON (the whole point — a distinct compose)', () => {
    const base = JSON.stringify(toGeometry(rb));
    const open = JSON.stringify(toGeometry(rb, { featureStates: { [doorKey]: { open: 1 } } }));
    expect(open).not.toBe(base);
  });

  it('the open leaf prim has swung — it gains a yaw and its position shifts', () => {
    // pickIds stamps srcId so we can locate the exact leaf; the swing itself is independent of it.
    const closed = doorLeaf(toGeometry(rb, { pickIds: true }), doorKey);
    const opened = doorLeaf(toGeometry(rb, { pickIds: true, featureStates: { [doorKey]: { open: 1 } } }), doorKey);
    expect(closed).toBeDefined();
    expect(opened).toBeDefined();
    // Closed leaf on a flat face is axis-aligned (no yaw); the open one carries a real swing angle.
    expect(closed!.yaw ?? 0).toBe(0);
    expect(Math.abs(opened!.yaw ?? 0)).toBeGreaterThan(1);
    // Hinge-edge pivot ⇒ the box centre translates too (yaw rotates about the box centre, so `at`
    // must move to keep the hinge fixed): at least one XY coordinate differs from the closed pose.
    expect(opened!.at[0] !== closed!.at[0] || opened!.at[1] !== closed!.at[1]).toBe(true);
    // The vertical extent is untouched (a vertical hinge preserves height/sill).
    expect(opened!.at[2]).toBe(closed!.at[2]);
    expect(opened!.size).toEqual(closed!.size);
  });

  it('an unknown pick key is ignored gracefully (no throw, output = default)', () => {
    const base = JSON.stringify(toGeometry(rb));
    expect(() => toGeometry(rb, { featureStates: { 'no_such_part/no_such_feature': { open: 1 } } })).not.toThrow();
    expect(JSON.stringify(toGeometry(rb, { featureStates: { 'no_such_part/no_such_feature': { open: 1 } } }))).toBe(base);
  });

  it('a NON-door feature ignores `open` (windows do not swing)', () => {
    const base = JSON.stringify(toGeometry(rb));
    expect(JSON.stringify(toGeometry(rb, { featureStates: { [windowKey]: { open: 1 } } }))).toBe(base);
  });

  // The blueprint `open` PARAM (tree-authored — e.g. a door meant to read as ajar by default)
  // drives the very same swing, with `featureStates` (studio click-to-test) overriding it.
  describe('the `open` blueprint param drives the swing directly', () => {
    /** Deep-clone `rb` with the door feature's resolved `open` param set. */
    function withDoorParamOpen(value: number): ResolvedBlueprint {
      const clone: ResolvedBlueprint = JSON.parse(JSON.stringify(rb));
      const body = clone.parts.find((p) => p.features.some((f) => f.type === 'door'))!;
      const door = body.features.find((f) => f.type === 'door')!;
      door.params.open = value;
      return clone;
    }

    it('param absent/0 with no featureStates ⇒ byte-identical to the default (closed) pose', () => {
      const base = JSON.stringify(toGeometry(rb));
      expect(JSON.stringify(toGeometry(withDoorParamOpen(0)))).toBe(base);
    });

    it('param open:1, no featureStates ⇒ the leaf swings (param alone drives it)', () => {
      const paramOpenRb = withDoorParamOpen(1);
      const closed = doorLeaf(toGeometry(rb, { pickIds: true }), doorKey);
      const opened = doorLeaf(toGeometry(paramOpenRb, { pickIds: true }), doorKey);
      expect(closed!.yaw ?? 0).toBe(0);
      expect(Math.abs(opened!.yaw ?? 0)).toBeGreaterThan(1);
      expect(opened!.at[0] !== closed!.at[0] || opened!.at[1] !== closed!.at[1]).toBe(true);
    });

    it('featureStates {open:0} SHUTS a param-opened door (ephemeral override wins)', () => {
      const paramOpenRb = withDoorParamOpen(1);
      const shutClosedByOverride = JSON.stringify(
        toGeometry(paramOpenRb, { featureStates: { [doorKey]: { open: 0 } } }),
      );
      // Identical to a door that was never opened at all (param 0, no featureStates).
      const trulyDefault = JSON.stringify(toGeometry(rb));
      expect(shutClosedByOverride).toBe(trulyDefault);
    });

    it('featureStates open:1 on top of param open:1 is a no-op (already open)', () => {
      const paramOpenRb = withDoorParamOpen(1);
      const withoutFs = JSON.stringify(toGeometry(paramOpenRb, { pickIds: true }));
      const withFs = JSON.stringify(
        toGeometry(paramOpenRb, { pickIds: true, featureStates: { [doorKey]: { open: 1 } } }),
      );
      expect(withFs).toBe(withoutFs);
    });
  });
});
