// src/game/affordance/world-labels.ts
//
// UI v2 W1/D4: the World band IS the map — settlement NAME labels replace both the
// parked alert pins (user: "no floating icons over the world") and the DOM minimap
// out here. Pure — the game feeds the live camera + worldSeed POIs + inbox + a
// per-settlement believer tally each frame and hands the result to the UI runtime,
// so labels track pan/zoom with no swim (the projection IS the camera transform,
// recomputed per frame) and stay pixel-snapped (integer device px). Presentation
// only: never touches the sim or the Command stream.

import type { Camera, POI } from '@/core/types';
import type { InboxItem } from '@/game/game-query';
import { projectWorldAnchor } from '@/game/affordance/alert-pins';
import { SETTLEMENT_TYPES } from '@/world/coastal-landmarks';

/** Cap of simultaneously-drawn labels — a legible map, not a gazetteer. */
export const MAX_WORLD_LABELS = 16;

/** Device-px margin beyond the viewport a label may still occupy before it's
 *  culled (mirrors the alert-pins off-screen cull, generous enough that a label
 *  straddling the edge doesn't pop in/out on a 1px pan). */
const LABEL_CULL_MARGIN = 40;

/** Iso-screen px a label floats above the settlement's tile centre — clears the
 *  rooftops of a typical cluster at world-band zoom so the name reads over open
 *  ground, not through a building. Empirical, retune allowed. */
const WORLD_LABEL_LIFT = 32;

/** One settlement's live believer tally — the game glue supplies this (a full
 *  NPC/cohort sweep), the builder only compares numbers so it stays pure and
 *  unit-testable. */
export interface SettlementContest {
  poiId: string;
  /** Practising believers loyal to the player at this settlement. */
  player: number;
  /** Every OTHER spirit with practising believers here (name + count); no entry
   *  needed for spirits with zero. */
  rivals: readonly { name: string; count: number }[];
}

export interface WorldLabelView {
  poiId: string;
  /** Settlement name (or the poiId as a last resort) — NOT upper-cased; the
   *  renderer owns the map-typography casing. */
  name: string;
  /** Label anchor in device px (already world→screen projected + pixel-snapped). */
  x: number;
  y: number;
  /** Count of divine-inbox items anchored to this settlement. */
  badge: number;
  /** True when this settlement is the current selection. */
  focused: boolean;
  /** Name of the leading NON-player spirit here, when its believer count is at
   *  least the player's — else null (uncontested or player-led). */
  contestedBy: string | null;
}

/** The leading non-player spirit at a settlement, or null when none out-numbers
 *  the player. Ties broken by name (alphabetical) — deterministic, no id leakage
 *  into the player-facing string. */
function leadingRival(entry: SettlementContest | undefined): string | null {
  if (!entry || entry.rivals.length === 0) return null;
  let best: { name: string; count: number } | null = null;
  for (const r of entry.rivals) {
    if (!best || r.count > best.count || (r.count === best.count && r.name < best.name)) best = r;
  }
  if (!best || best.count <= 0 || best.count < entry.player) return null;
  return best.name;
}

/**
 * Project every settlement POI to a device-px label view. Non-settlement POIs
 * (rivers, lakes, landmarks — `SETTLEMENT_TYPES` is the same set worldgen uses to
 * keep landmarks clear of towns) and positionless POIs are skipped. Pipeline:
 * filter → project → cull off-screen → sort by poiId (determinism, independent of
 * `pois` array order) → cap at `max`. Culling before capping means the labels
 * actually on screen are the ones that survive a crowded world.
 */
export function buildWorldLabels(
  pois: readonly POI[],
  inbox: readonly InboxItem[],
  contest: readonly SettlementContest[],
  focusedPoiId: string | null,
  cam: Camera,
  dpr: number,
  viewport: { w: number; h: number },
  max: number = MAX_WORLD_LABELS,
): WorldLabelView[] {
  const contestByPoi = new Map(contest.map((c) => [c.poiId, c]));
  const badgeByPoi = new Map<string, number>();
  for (const it of inbox) {
    if (it.target.kind === 'settlement') {
      badgeByPoi.set(it.target.poiId, (badgeByPoi.get(it.target.poiId) ?? 0) + 1);
    }
  }

  const candidates: WorldLabelView[] = [];
  for (const poi of pois) {
    if (!poi.position || !SETTLEMENT_TYPES.has(poi.type)) continue;
    const { x, y } = projectWorldAnchor(poi.position, WORLD_LABEL_LIFT, cam, dpr);
    if (x < -LABEL_CULL_MARGIN || y < -LABEL_CULL_MARGIN ||
        x > viewport.w + LABEL_CULL_MARGIN || y > viewport.h + LABEL_CULL_MARGIN) continue;
    candidates.push({
      poiId: poi.id,
      name: poi.name ?? poi.id,
      x, y,
      badge: badgeByPoi.get(poi.id) ?? 0,
      focused: poi.id === focusedPoiId,
      contestedBy: leadingRival(contestByPoi.get(poi.id)),
    });
  }
  candidates.sort((a, b) => (a.poiId < b.poiId ? -1 : a.poiId > b.poiId ? 1 : 0));
  return candidates.slice(0, max);
}
