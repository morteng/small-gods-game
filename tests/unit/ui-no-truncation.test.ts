import { describe, it, expect } from 'vitest';
import { UiContext } from '@/render/ui/ui-context';
import { drawTitleScreen, titleRows } from '@/render/ui/shell/title-screen';
import { drawSettingsScreen, keymapRows, type SettingsScreenView } from '@/render/ui/shell/settings-screen';
import { DEFAULT_KEYMAP } from '@/game/input/keymap';
import { shellTypeScaleFor } from '@/render/ui/ui-tokens';

/**
 * TRUNCATION IS THE SYMPTOM OF A HARDCODED WIDTH.
 *
 * When the shell's type tier grew, the layout metrics did not grow with it, and
 * text began ellipsizing where it never had: title captions cut to
 * "…· 08:00 · BE…", every CONTROLS label to "TOGGLE LA…", and every rebind button
 * to "REB…". A button truncating its OWN verb is the purest form of the bug — the
 * container was sized independently of the text it must hold.
 *
 * The kit-wide rule these pin: layout metrics derive from the same tokens as the
 * type tier. Text that must be readable gets a container measured from it.
 */

const S = 2;
/** The viewport the user actually reported the problem at (1389x868 @ DPR 2). */
const W = 1389 * S, H = 868 * S;

function titleView() {
  return {
    // Realistic worst case: the real metadata line that was being cut.
    continueLine: 'Y1 SPRING · 2/96 · 08:00 · BELIEF 6.8',
    continueBlocked: null,
    hasAnySave: true,
    buildLine: 'WORLD 118',
  };
}

function settingsView(tab: SettingsScreenView['tab']): SettingsScreenView {
  return {
    tab,
    musicOn: true, musicVolume: 0.7, sfxOn: true, sfxVolume: 0.5, voiceOn: false,
    halfResWater: true, uiScale: 1, lighting: true,
    keymap: DEFAULT_KEYMAP, capturing: null, keymapNote: null,
  } as SettingsScreenView;
}

/** Every text run the screen drew, reconstructed from the labels it asked for.
 *  `UiContext.ellipsize` is the single chokepoint for truncation, so spying on it
 *  catches every case regardless of which widget did it. */
function collectEllipsized(draw: (c: UiContext) => void): string[] {
  const c = new UiContext();
  const cut: string[] = [];
  const realEllipsize = c.ellipsize.bind(c);
  c.ellipsize = (text: string, scale: number, maxW: number): string => {
    const out = realEllipsize(text, scale, maxW);
    if (out !== text) cut.push(`${text} -> ${out}`);
    return out;
  };
  c.begin();
  draw(c);
  c.end();
  return cut;
}

describe('no truncation at the reported viewport', () => {
  it('the TITLE screen never ellipsizes a label or a caption', () => {
    const cut = collectEllipsized((c) => { drawTitleScreen(c, W, H, S, titleView()); });
    expect(cut, `title truncated: ${cut.join(' | ')}`).toEqual([]);
  });

  it('the CONTROLS tab never ellipsizes an action label or a button verb', () => {
    const cut = collectEllipsized((c) => { drawSettingsScreen(c, W, H, S, settingsView('controls')); });
    expect(cut, `controls truncated: ${cut.join(' | ')}`).toEqual([]);
  });

  it('the AUDIO and VIDEO tabs never ellipsize either', () => {
    for (const tab of ['audio', 'video'] as const) {
      const cut = collectEllipsized((c) => { drawSettingsScreen(c, W, H, S, settingsView(tab)); });
      expect(cut, `${tab} truncated: ${cut.join(' | ')}`).toEqual([]);
    }
  });

  it('a REBIND button is always wide enough for BOTH its verbs', () => {
    // It must not resize (or truncate) when it flips to CANCEL mid-capture.
    const capturing = { ...settingsView('controls'), capturing: keymapRows(settingsView('controls'))[0].action };
    const cut = collectEllipsized((c) => { drawSettingsScreen(c, W, H, S, capturing as SettingsScreenView); });
    expect(cut, `capturing state truncated: ${cut.join(' | ')}`).toEqual([]);
  });
});

describe('all settings tabs share one interactive tier', () => {
  it('AUDIO/VIDEO/GAMEPLAY/CONTROLS rows all draw at the SAME menu scale', () => {
    // AUDIO sitting at the old body scale while CONTROLS sat at menu tier looked
    // broken on a single screen. One tier, or the screen reads as half-migrated.
    const T = shellTypeScaleFor(W, S);
    for (const tab of ['audio', 'video', 'gameplay', 'controls'] as const) {
      const c = new UiContext();
      const used = new Set<number>();
      const realLabel = c.label.bind(c);
      c.label = (text: string, x: number, y: number, scale = 1, ...rest: never[]): void => {
        if (text.trim()) used.add(scale);
        (realLabel as unknown as (...a: unknown[]) => void)(text, x, y, scale, ...rest);
      };
      c.begin();
      drawSettingsScreen(c, W, H, S, settingsView(tab));
      c.end();
      expect([...used], `${tab} drew no text`).not.toEqual([]);
      expect(
        used.has(T.menu),
        `${tab} never used the menu tier (${T.menu}); saw ${[...used].join(',')}`,
      ).toBe(true);
      expect(
        Math.min(...used),
        `${tab} drew below the caption floor`,
      ).toBeGreaterThanOrEqual(T.caption);
    }
  });
});

describe('the title column still fits a short viewport', () => {
  it('draws all five rows without clipping at 768-tall', () => {
    // The degradation ladder must still cope now that the type is bigger.
    const c = new UiContext();
    c.begin();
    drawTitleScreen(c, 1366 * S, 768 * S, S, titleView());
    const { hits } = c.end();
    const ids = hits.filter((h) => h.id.startsWith('title.')).map((h) => h.id);
    expect(ids).toHaveLength(titleRows(titleView()).length);
    for (const h of hits) {
      expect(h.y, `${h.id} above the viewport`).toBeGreaterThanOrEqual(0);
      expect(h.y + h.h, `${h.id} clipped at the bottom`).toBeLessThanOrEqual(768 * S);
    }
  });
});

describe("button boxes are sized by the widget's OWN metric", () => {
  /**
   * WHY THE ELLIPSIZE SPY WASN'T ENOUGH.
   *
   * That spy asserts a SYMPTOM ("nothing got cut"), and the REBIND box happened
   * to come out EXACTLY equal to its text width: `ellipsize` returns the string
   * unchanged when `measure <= maxW`, so `216 <= 216` passed here while the same
   * arithmetic tipped over in the live path and truncated. A guard sitting on a
   * knife edge is false confidence.
   *
   * This asserts the INVARIANT instead: every button box is at least
   * `c.buttonWidth(label, scale)` -- the widget's own metric, padding included.
   * That has margin by construction and cannot pass by coincidence.
   */
  function assertButtonsFit(draw: (c: UiContext) => void, label: string): void {
    const c = new UiContext();
    const violations: string[] = [];
    const realButton = c.button.bind(c);
    c.button = (id, text, x, y, w, h, opts = {}): boolean => {
      const scale = opts.scale ?? 1;
      const need = c.buttonWidth(text, scale);
      if (w < need) violations.push(`${id} "${text}" box ${w} < required ${need}`);
      return realButton(id, text, x, y, w, h, opts);
    };
    c.begin();
    draw(c);
    c.end();
    expect(violations, `${label}: ${violations.join(' | ')}`).toEqual([]);
  }

  it('every settings button fits its own label, on every tab', () => {
    for (const tab of ['audio', 'video', 'gameplay', 'controls'] as const) {
      assertButtonsFit((c) => { drawSettingsScreen(c, W, H, S, settingsView(tab)); }, tab);
    }
  });

  it('the REBIND button fits BOTH verbs, including mid-capture', () => {
    const capturing = {
      ...settingsView('controls'),
      capturing: keymapRows(settingsView('controls'))[0].action,
    } as SettingsScreenView;
    assertButtonsFit((c) => { drawSettingsScreen(c, W, H, S, capturing); }, 'capturing');
  });

  it('every title button fits its own label', () => {
    assertButtonsFit((c) => { drawTitleScreen(c, W, H, S, titleView()); }, 'title');
  });

  it('holds at narrow viewports too, where boxes are tightest', () => {
    for (const vw of [900, 1100, 1389, 1920]) {
      assertButtonsFit(
        (c) => { drawSettingsScreen(c, vw * S, H, S, settingsView('controls')); },
        `controls@${vw}`,
      );
    }
  });
});
