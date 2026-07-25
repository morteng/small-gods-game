// src/render/ui/kit/tabbar.ts
//
// A row of tab buttons sharing `(x, y, w, h)` in equal integer-pixel columns
// (any remainder from `w / tabs.length` is absorbed by the LAST column, so
// every column is a whole pixel and the row still exactly fills `w`). Each tab
// is a plain `c.button()`, so keyboard/gamepad nav + the focus ring come for
// free. The selected tab gets a gold underline (drawn UNDER the button's own
// paint order — a separate, cheap "you are here" mark distinct from hover/
// focus, which the button already shows).

import type { UiContext } from '@/render/ui/ui-context';
import { COLOR, FS, STROKE } from '@/render/ui/ui-tokens';

export interface TabDef {
  id: string;
  label: string;
}

export interface TabbarOpts {
  id: string;
  tabs: readonly TabDef[];
  selected: string;
  x: number;
  y: number;
  w: number;
  h: number;
  scale?: number;
}

/** Returns the newly-selected tab id the frame a different tab is picked,
 *  else null. */
export function tabbar(c: UiContext, opts: TabbarOpts): string | null {
  const s = opts.scale ?? FS.body;
  const n = opts.tabs.length;
  if (n === 0) return null;
  const colW = Math.floor(opts.w / n);

  let picked: string | null = null;
  for (let i = 0; i < n; i++) {
    const tab = opts.tabs[i];
    const tx = opts.x + i * colW;
    const tw = i === n - 1 ? opts.w - colW * (n - 1) : colW; // last column absorbs the remainder
    const isSelected = tab.id === opts.selected;

    if (c.button(`${opts.id}.${tab.id}`, tab.label, tx, opts.y, tw, opts.h, { scale: s, alpha: isSelected ? 1 : 0.75 })) {
      picked = tab.id;
    }
    if (isSelected) {
      c.rect(tx, opts.y + opts.h - STROKE.focus, tw, STROKE.focus, COLOR.gold);
    }
  }
  return picked;
}
