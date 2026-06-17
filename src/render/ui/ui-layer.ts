// src/render/ui/ui-layer.ts
//
// Façade tying the immediate-mode context to the frame: build a widget list from
// game state, flush it to `UiDrawGroup`s, hand them to the scene's UI pass. In S1
// this only carries the DISPOSABLE `?uidemo` widgets that prove the pipeline (a
// gray-box panel + label + button + orb placeholder). The real HUD — presence
// orb, summoned time chip, contextual inspector, divine radial — is S3, and the
// input snapshot seam (`UiContext.begin(input)`) is filled by S2.
//
// CPU-only (builds geometry); the device lives in `UiPass`, owned by `GpuScene`.

import { UiContext } from '@/render/ui/ui-context';
import { UI_PALETTE } from '@/render/ui/ui-palette';
import type { UiDrawGroup } from '@/render/ui/ui-batcher';

/** Integer HUD scale from device-pixel-ratio (keeps gray-box marks crisp). */
export function uiScaleFor(dpr: number): number {
  return Math.max(1, Math.round(dpr));
}

export class UiLayer {
  private ctx = new UiContext();

  /**
   * Disposable S1 demo: a bottom-left gray-box panel proving panel/label/button
   * /accent all render at the given device size + integer scale. Returns the
   * uploadable groups (empty input ⇒ the button is inert, as in S1).
   */
  buildDemo(wDev: number, hDev: number, dpr: number): UiDrawGroup[] {
    const c = this.ctx;
    const s = uiScaleFor(dpr);
    c.begin();

    const pad = 14 * s;
    const pw = 184 * s;
    const ph = 92 * s;
    const px = pad;
    const py = hDev - ph - pad; // anchored bottom-left

    c.panel(px, py, pw, ph);
    c.label('SMALL GODS · UI S1', px + 12 * s, py + 12 * s, s);

    // presence-orb placeholder (real diegetic orb = S3): an accent block.
    c.rect(px + 12 * s, py + 34 * s, 20 * s, 20 * s, UI_PALETTE.accent);
    c.label('PRESENCE', px + 40 * s, py + 40 * s, s, UI_PALETTE.textDim);

    c.button('demo', 'WHISPER', px + 12 * s, py + ph - 28 * s, 92 * s, 20 * s);

    void wDev;
    return c.batcher.flush();
  }
}
