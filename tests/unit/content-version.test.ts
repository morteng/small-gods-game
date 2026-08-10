import { describe, it, expect } from 'vitest';
import { ART_RECIPE_VERSION, NPC_ART_RECIPE_VERSION, WORLD_CONTENT_VERSION } from '@/core/content-version';
import { SAVE_VERSION } from '@/core/save-file';

describe('content-version constants', () => {
  it('declares the current art recipe version (v37: Manning the Walls W4 — drum tower flank door at allure height + vice turret)', () => {
    expect(ART_RECIPE_VERSION).toBe('v37');
  });

  it('declares the current NPC sprite recipe version (n1: G0, the rig-frame img2img pipeline — nothing generated through it yet)', () => {
    expect(NPC_ART_RECIPE_VERSION).toBe('n1');
  });

  it('declares the current world content version (123: ONE hydrology per world — `POI.heightAnchor` freezes a POI\'s height influence at the position the terrain was built from, so `snapDrySettlementsOffWater` moving a settlement out of a lake no longer moves its elevation plateau and, with it, the lake; the drawn water / hydrology store / bridge-crossing seater now rebuild the SAME field biomes, rivers, settlements and roads were derived from)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(123);
  });

  it('declares the current save schema version (4: the event journal — `events` left the SaveFile blob for the event-journal IDB store; `eventCursor` + `playtimeMs` took its place, see save-file.ts)', () => {
    expect(SAVE_VERSION).toBe(4);
  });
});
