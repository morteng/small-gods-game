// src/render/ui/shell/load-screen.ts
//
// The LOAD screen (UI v3 P3b) — the honesty half of the save workstream (spec
// §5.2). An empty slot or one written by an older save/world version renders
// DISABLED and SAYS WHY, and still offers Delete; the game never loads-then-
// regenerates over a slot it cannot actually open. Shares its layout with
// `save-screen.ts`'s `drawSlotsScreen` — see that module's header for why.

import type { UiContext } from '@/render/ui/ui-context';
import type { SlotRow, ScreenRow } from '@/render/ui/shell/save-screen';
import { drawSlotsScreen } from '@/render/ui/shell/save-screen';
import type { SaveSlot } from '@/services/save-store';

export type { SlotRow };

export interface LoadScreenView { rows: SlotRow[] }

export type LoadAction =
  | { kind: 'load'; slot: SaveSlot }
  | { kind: 'delete'; slot: SaveSlot }
  | { kind: 'back' };

/**
 * The load screen's rows: an EMPTY slot is disabled (nothing to load) but a
 * valid save is not — the inverse of the save screen's autosave rule. A
 * `stale-save`/`stale-world` slot is disabled and states its `staleReason`
 * (already carrying the real version numbers, prebuilt by the caller); Delete
 * stays offered either way, because "I can't open this" must never mean "I
 * can't get rid of it either".
 */
export function loadRows(view: LoadScreenView): ScreenRow[] {
  return view.rows.map((data): ScreenRow => {
    if (data.empty) {
      return {
        id: `load.${data.slot}`, slot: data.slot, data,
        // No reason line: the TILE already reads "EMPTY SLOT", so a caption
        // repeating it below was pure duplication (seen live, 2026-07-25). This
        // is exactly the "disabled for a reason too obvious to spell out" case
        // `ScreenRow.reason` documents. The agent surface loses nothing — the
        // choice still reports `enabled: false` with an "EMPTY SLOT" label.
        enabled: false, deletable: false, reason: null,
      };
    }
    if (data.compat !== 'ok') {
      return {
        id: `load.${data.slot}`, slot: data.slot, data,
        enabled: false, deletable: true,
        reason: data.staleReason ?? 'THIS SAVE CANNOT BE OPENED',
      };
    }
    return {
      id: `load.${data.slot}`, slot: data.slot, data,
      enabled: true, deletable: true, reason: null,
    };
  });
}

/** Paint the load screen. Returns the action the player triggered this frame,
 *  or null — same contract every shell screen follows. */
export function drawLoadScreen(c: UiContext, w: number, h: number, s: number, view: LoadScreenView): LoadAction | null {
  const outcome = drawSlotsScreen(c, w, h, s, 'LOAD GAME', loadRows(view), 'load.back');
  if (!outcome) return null;
  if (outcome.kind === 'back') return { kind: 'back' };
  if (outcome.kind === 'delete') return { kind: 'delete', slot: outcome.slot };
  return { kind: 'load', slot: outcome.slot };
}
