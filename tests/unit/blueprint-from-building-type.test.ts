/**
 * The GENERATIVE catalogue → geometry bridge: a buildingType programme with no pinned
 * `BUILDING_BLUEPRINTS` preset is still expressed into real geometry by the layered fold
 * (`synthesizeBlueprint` falls back to `blueprintFromBuildingType`). This is the
 * foundational "preset = pinned shortcut, not the only path" capability — it unblocks
 * every primed-but-unplaced catalogue type (smithy/bakehouse/granary/…). The bridge is
 * ADDITIVE: it never shadows a hand preset, and adds no placement on its own.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadDefaultPacks } from '@/catalogue';
import { synthesizeBlueprint, BUILDING_BLUEPRINTS } from '@/blueprint/presets';
import { blueprintFromBuildingType } from '@/blueprint/presets/from-building-type';

beforeAll(() => loadDefaultPacks());

// Catalogue buildingTypes that carry a full programme but NO hand-authored preset.
const UNPINNED = ['smithy', 'bakehouse', 'brewhouse', 'granary', 'dovecote', 'inn', 'tithe-barn'];

describe('generative catalogue → geometry bridge', () => {
  it('every unpinned type has a catalogue programme but no BUILDING_BLUEPRINTS preset', () => {
    for (const id of UNPINNED) {
      expect(BUILDING_BLUEPRINTS[id], `${id} must stay unpinned`).toBeUndefined();
    }
  });

  it('synthesises real building geometry for each unpinned type', () => {
    for (const id of UNPINNED) {
      const rb = synthesizeBlueprint(id);
      expect(rb, `${id} should synthesise`).toBeDefined();
      expect(rb!.class).toBe('building');
      // A sane settlement-scale footprint and at least a body with a door.
      expect(rb!.footprint.w).toBeGreaterThanOrEqual(2);
      expect(rb!.footprint.w).toBeLessThanOrEqual(6);
      expect(rb!.footprint.h).toBeGreaterThanOrEqual(2);
      const body = rb!.parts.find((p) => p.type === 'body');
      expect(body, `${id} body`).toBeDefined();
      expect(body!.features.some((f) => f.type === 'door'), `${id} door`).toBe(true);
    }
  });

  it('derives the forge/oven flue from the hearth programme (smithy gets a vent)', () => {
    const smithy = synthesizeBlueprint('smithy')!;
    const body = smithy.parts.find((p) => p.type === 'body')!;
    // smithy's hearthRule names a forge-hearth → the smoke fold gives it a vent.
    expect(body.features.some((f) => f.type === 'vent')).toBe(true);
    expect(smithy.materials.walls).toBe('stone'); // from the catalogue defaultMaterials
  });

  it('is deterministic — same id yields identical geometry', () => {
    const a = JSON.stringify(synthesizeBlueprint('bakehouse'));
    const b = JSON.stringify(synthesizeBlueprint('bakehouse'));
    expect(a).toBe(b);
  });

  it('never shadows a pinned preset — cottage stays its hand-authored 3×3', () => {
    // A hand preset must win the resolution order; the bridge is the LAST fallback.
    const cottage = synthesizeBlueprint('cottage')!;
    expect(cottage.footprint).toEqual({ w: 3, h: 3 });
  });

  it('returns undefined for an unknown id (no phantom geometry)', () => {
    expect(blueprintFromBuildingType('no-such-building', 1)).toBeUndefined();
    expect(synthesizeBlueprint('no-such-building')).toBeUndefined();
  });
});
