// src/game/affordance/alert-pins.ts
//
// P5 semantic-zoom: project the salience-ranked divine inbox into zoomed-out
// alert-pin views. Pure — the Game feeds the live camera + inbox each frame and
// hands the result to the UI runtime, so pins track pan/zoom with no swim (the
// projection IS the camera transform, recomputed per frame) and stay pixel-
// snapped (integer device px). Presentation only: never touches the sim or the
// Command stream.

import type { Camera } from '@/core/types';
import type { InboxItem } from '@/game/game-query';
import type { AlertPinView } from '@/render/ui/ui-runtime';
import { worldToScreen } from '@/render/iso/iso-projection';
import { isoStageTransform } from '@/render/iso/entity-draw-list';

/** Cap of simultaneously-drawn pins — aggregate visuals, not every soul (spec §6).
 *  The inbox arrives salience-ranked, so the first N anchored items ARE the top N. */
export const MAX_ALERT_PINS = 8;

/** The reserved pin id for the collapsed inspector selection (selection survives
 *  zoom, spec §6) — never collides with inbox ids (`prayer:`/`opp:`/`threat:`). */
export const PIN_SELECTION_ID = 'selection';

/** Iso-screen px the pin floats above the tile centre (≈ a sprite's head). */
const PIN_HEAD_LIFT = 40;

/** Project a tile anchor + vertical iso-lift to a pixel-snapped device-px centre
 *  (tile centre = +0.5). The live camera pans in ISO-SCREEN space, so this must
 *  go through the iso projection + stage transform — the flat `tile × TILE_SIZE`
 *  mapping is a different space and strands markers mid-ocean. Shared by alert
 *  pins (`projectPinCentre`) and the W1 world-band settlement labels
 *  (`affordance/world-labels.ts`) — one projection idiom, one place it can drift. */
export function projectWorldAnchor(
  anchor: { x: number; y: number },
  liftPx: number,
  cam: Camera,
  dpr: number,
): { x: number; y: number } {
  const iso = worldToScreen(anchor.x + 0.5, anchor.y + 0.5, liftPx, 0, 0);
  const t = isoStageTransform(cam);
  return {
    x: Math.round((iso.sx * t.scale + t.x) * dpr),
    y: Math.round((iso.sy * t.scale + t.y) * dpr),
  };
}

/** Project a tile anchor to a pixel-snapped device-px centre at the pin's fixed
 *  head-height lift. */
export function projectPinCentre(
  anchor: { x: number; y: number },
  cam: Camera,
  dpr: number,
): { x: number; y: number } {
  return projectWorldAnchor(anchor, PIN_HEAD_LIFT, cam, dpr);
}

/**
 * Project the top `max` anchored inbox items to device-px pin centres. Items
 * without a world anchor (placeless threats) are skipped and don't consume a
 * slot; ranking is the inbox's own salience order.
 */
export function projectAlertPins(
  items: readonly InboxItem[],
  cam: Camera,
  dpr: number,
  max: number = MAX_ALERT_PINS,
): AlertPinView[] {
  const pins: AlertPinView[] = [];
  for (const it of items) {
    if (pins.length >= max) break;
    if (!it.anchor) continue;
    pins.push({ id: it.id, kind: it.kind, ...projectPinCentre(it.anchor, cam, dpr), surfaced: it.surfaced });
  }
  return pins;
}
