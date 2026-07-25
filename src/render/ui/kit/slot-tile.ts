// src/render/ui/kit/slot-tile.ts
//
// A save-slot card: a thumbnail well on the left, name/date/tier/playtime
// lines on the right, and an optional DELETE button in the bottom-right
// corner. The tile only RESERVES and outlines the thumbnail rect — it never
// decodes an image itself (that's a device/DOM concern, and this module must
// stay CPU-pure); the caller supplies `drawThumb(rect)` to paint into it (a
// blitted texture quad, a placeholder glyph, whatever they have), or omits it
// for an empty/ground-filled well (an unused slot).
//
// Geometry contract: the whole `(x, y, w, h)` rect minus the delete button's
// reserved corner is ONE hotspot returning 'activate'; the delete button (when
// `deletable`) is a second, independent hit region returning 'delete'. Only
// one of the two fires per frame (they don't overlap).

import type { UiContext } from '@/render/ui/ui-context';
import { COLOR, FS, SPACING, STROKE } from '@/render/ui/ui-tokens';
import { withAlpha } from '@/render/ui/ui-color';
import type { Rect } from '@/render/ui/kit/rect';

export interface SlotTileOpts {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
  /** In-world date line, PRE-FORMATTED by the caller (never a raw tick here). */
  dateLabel: string;
  tierLabel: string;
  /** Real playtime, PRE-FORMATTED by the caller (this module does no clock math). */
  playtimeLabel: string;
  deletable?: boolean;
  /** True for a slot that holds no save at all. Distinguishes "nothing here"
   *  from "a real save whose picture is missing" in the thumbnail well. */
  empty?: boolean;
  drawThumb?: (rect: Rect) => void;
  /** Scale for the tile's PRIMARY text (the slot name) and the DELETE button —
   *  this is an interactive row, so callers pass the `menu` tier. */
  scale?: number;
  /** Scale for the three METADATA lines (date / tier / playtime). Defaults to
   *  `scale`; callers pass the `caption` tier so metadata is smaller-but-never-
   *  below-the-floor while the name stays at full menu size. */
  metaScale?: number;
}

export function slotTile(c: UiContext, opts: SlotTileOpts): 'activate' | 'delete' | null {
  const s = opts.scale ?? FS.menu;
  const ms = opts.metaScale ?? s;
  const bodyId = `${opts.id}.body`;
  const deleteId = `${opts.id}.delete`;

  // Reserve a square thumbnail well on the left, inset by SPACING.sm.
  const thumbSize = opts.h - 2 * SPACING.sm;
  const thumb: Rect = { x: opts.x + SPACING.sm, y: opts.y + SPACING.sm, w: thumbSize, h: thumbSize };

  const lh = c.lineHeight(s);
  const delW = opts.deletable ? Math.ceil(c.measure('DELETE', s)) + 2 * SPACING.md : 0;
  const delH = opts.deletable ? lh + SPACING.sm : 0;

  // Body hotspot excludes the delete button's corner so the two never overlap.
  const bodyClicked = c.hotspot(bodyId, opts.x, opts.y, opts.w, opts.h - (opts.deletable ? delH : 0));
  const focused = c.focusId === bodyId;

  c.rect(opts.x, opts.y, opts.w, opts.h, COLOR.parchment);
  c.batcher.border(opts.x, opts.y, opts.w, opts.h, STROKE.hairline, focused ? COLOR.gold : COLOR.ink);

  c.batcher.border(thumb.x, thumb.y, thumb.w, thumb.h, STROKE.hairline, COLOR.inkDim);
  if (opts.drawThumb) {
    opts.drawThumb(thumb);
  } else if (!opts.empty) {
    // No image to show for a REAL save (either it predates thumbnails, or the
    // decode path isn't wired yet). A flat grey fill read as a broken image in a
    // live pass, so draw a deliberate placeholder instead: a recessed well with a
    // centred divine sigil, which reads as "no picture" rather than "failed".
    c.rect(thumb.x, thumb.y, thumb.w, thumb.h, COLOR.ground);
    const glyph = '✦';
    const gw = c.measure(glyph, s);
    const gh = c.lineHeight(s);
    c.label(
      glyph,
      Math.round(thumb.x + (thumb.w - gw) / 2),
      Math.round(thumb.y + (thumb.h - gh) / 2),
      s,
      withAlpha(COLOR.inkDim, 0.45),
    );
  } else {
    // An empty slot has no world at all — leave the well as bare parchment so it
    // reads as "nothing here", visibly different from a save whose picture is
    // merely missing.
    c.rect(thumb.x, thumb.y, thumb.w, thumb.h, withAlpha(COLOR.ground, 0.35));
  }

  // Name at the interactive tier, metadata at the caption tier beneath it. The
  // metadata rows advance by their OWN line height, not the name's.
  const textX = thumb.x + thumb.w + SPACING.sm;
  const textY = opts.y + SPACING.sm;
  const mlh = c.lineHeight(ms);
  c.label(opts.name.toUpperCase(), textX, textY, s, COLOR.ink);
  c.label(opts.dateLabel.toUpperCase(), textX, textY + lh, ms, COLOR.inkDim);
  c.label(opts.tierLabel.toUpperCase(), textX, textY + lh + mlh, ms, COLOR.inkDim);
  c.label(opts.playtimeLabel.toUpperCase(), textX, textY + lh + 2 * mlh, ms, COLOR.inkDim);

  let result: 'activate' | 'delete' | null = bodyClicked ? 'activate' : null;
  if (opts.deletable) {
    const delX = opts.x + opts.w - delW - SPACING.sm;
    const delY = opts.y + opts.h - delH;
    if (c.button(deleteId, 'DELETE', delX, delY, delW, delH, { scale: s })) {
      result = 'delete';
    }
  }
  return result;
}
