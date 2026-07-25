// src/render/ui/kit/list.ts
//
// A focusable row list built on `UiContext.scrollList` (the existing
// row-granular D2 scroll primitive — this module adds NOTHING to scrolling
// itself, only click + keyboard/gamepad focus per row). Each visible row gets
// a chrome-less `hotspot()` covering its full width — which, per
// `UiContext.hotspot`, ALSO registers it into the focus ring via
// `focusable()` — so Tab/dpad navigation walks the visible rows in draw
// order. `drawRow` receives whether ITS row currently holds focus, so the
// caller can paint its own highlight (a list row's visual shape varies too
// much — text, icons, a thumbnail — to have the kit paint a generic one).

import type { UiContext } from '@/render/ui/ui-context';

export interface ListOpts {
  id: string;
  rect: { x: number; y: number; w: number; h: number };
  rowH: number;
  rowCount: number;
  drawRow: (index: number, rowY: number, focused: boolean) => void;
}

/** Returns the row index activated THIS frame (clicked, or ACTIVATEd while
 *  focused) — else null. */
export function list(c: UiContext, opts: ListOpts): number | null {
  let activated: number | null = null;
  c.scrollList(opts.id, opts.rect, opts.rowH, opts.rowCount, (i, rowY) => {
    const rowId = `${opts.id}.row.${i}`;
    // hotspot() first: it sets keyboard focus on hover before we read
    // `c.focusId`, matching the same ordering `button()` uses internally.
    const clicked = c.hotspot(rowId, opts.rect.x, rowY, opts.rect.w, opts.rowH);
    if (clicked) activated = i;
    opts.drawRow(i, rowY, c.focusId === rowId);
  });
  return activated;
}
