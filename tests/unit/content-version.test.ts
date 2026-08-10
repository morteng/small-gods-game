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

  it('declares the current world content version (122: bridge decks seat on the road the game DRAWS — the span pass re-detects crossings on the POST-reconcile graph, after `reconcileCenterlineBows`/`reconcileCenterlineLegality` have written the `edge.pins` the drawn ribbon is smoothed through, instead of reusing specs detected ~200 lines earlier against an unpinned Catmull-Rom that bows up to ~1.6 tiles off it; this also aligns the deck entity id with the opening id the crossing-tier store joins on)', () => {
    expect(WORLD_CONTENT_VERSION).toBe(122);
  });

  it('declares the current save schema version (4: the event journal — `events` left the SaveFile blob for the event-journal IDB store; `eventCursor` + `playtimeMs` took its place, see save-file.ts)', () => {
    expect(SAVE_VERSION).toBe(4);
  });
});
