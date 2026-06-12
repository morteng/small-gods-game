// src/render/iso/npc-billboard.ts
// Metric NPC billboard sizing. The LPC body occupies only ~30px of its 64px
// frame (the rest is swing-room margin), so anchoring the FRAME to HUMAN_PX
// rendered villagers at ~0.79m apparent height — half the building scale.
// Instead the OPAQUE BODY anchors to HUMAN_PX via a nearest-INTEGER scale
// (1:1 pixel-perfect rule), and the feet (opaque bbox bottom) land on the tile.
import { HUMAN_PX } from '@/render/scale-contract';

/** Opaque row span of a frame: top inclusive, bottom exclusive. */
export interface BodyRows { top: number; bottom: number }

/** Adult LPC body in a 64px frame (measured: y 32..61) — fallback when a sheet
 *  can't be read back (jsdom tests, sheet not yet composed). */
export const LPC_DEFAULT_BODY: BodyRows = { top: 32, bottom: 62 };

const ALPHA_THRESHOLD = 8;

/** Scan RGBA data for the opaque row span; null if fully transparent. */
export function measureFrameOpaqueRows(
  data: Uint8ClampedArray, w: number, h: number,
): BodyRows | null {
  let top = -1, bottom = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3] > ALPHA_THRESHOLD) {
        if (top < 0) top = y;
        bottom = y + 1;
        break;
      }
    }
  }
  return top < 0 ? null : { top, bottom };
}

/** Nearest integer source-scale putting the body at HUMAN_PX (min 1). */
export function npcBillboardScale(bodyHpx: number): number {
  return Math.max(1, Math.round(HUMAN_PX / bodyHpx));
}

export interface NpcBillboard extends BodyRows { scale: number }

/** LPC sheets are 4 rows of 64px walk frames; row 2 faces south (camera). */
const FRAME = 64;
const MEASURE_ROW = 2;

const cache = new WeakMap<HTMLCanvasElement, NpcBillboard>();

/**
 * Billboard metrics for an NPC's composed LPC sheet: integer scale + the body's
 * opaque row span, measured once per sheet from the standing south-facing frame
 * (col 0, row 2 — hair/hats extend the span naturally; children come out shorter).
 * Falls back to the adult LPC defaults when the sheet is absent or unreadable.
 */
export function npcBillboard(sheet?: HTMLCanvasElement): NpcBillboard {
  const fallback: NpcBillboard = {
    ...LPC_DEFAULT_BODY,
    scale: npcBillboardScale(LPC_DEFAULT_BODY.bottom - LPC_DEFAULT_BODY.top),
  };
  if (!sheet) return fallback;
  const cached = cache.get(sheet);
  if (cached) return cached;

  let result = fallback;
  try {
    const ctx = sheet.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      const data = ctx.getImageData(0, MEASURE_ROW * FRAME, FRAME, FRAME).data;
      const rows = measureFrameOpaqueRows(data, FRAME, FRAME);
      if (rows) result = { ...rows, scale: npcBillboardScale(rows.bottom - rows.top) };
    }
  } catch {
    // jsdom / tainted canvas — keep the fallback, don't cache failure forever?
    // We do cache: the sheet is immutable once composed, a retry won't differ.
  }
  cache.set(sheet, result);
  return result;
}
