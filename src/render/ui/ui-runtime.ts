// src/render/ui/ui-runtime.ts
//
// The live UI runtime (S2/S3): the one stateful object tying the immediate-mode
// `UiContext` to the running game. It owns
//   - the per-frame INPUT snapshot (pointer pos / down / released), fed from
//     capture-phase canvas listeners so UI clicks consume BEFORE world input;
//   - the barebones HUD (a diegetic presence orb + a MENU affordance);
//   - the Esc-summoned pause menu (left nav + a game-style settings panel).
//
// It is a module singleton (`getUiRuntime()`) so the GPU render frame can pull
// draw groups without threading a reference through the renderer factory, exactly
// like the `?connectome` overlay reads its flag. The Game calls `attach()` once on
// boot to wire input + state hooks. Pure-ish: geometry build is CPU/Node-testable
// (`frame()`), only `attach()` touches the DOM.

import { UiContext, type UiInput, type UiHit } from '@/render/ui/ui-context';
import { uiScaleFor } from '@/render/ui/ui-layer';
import { UI_PALETTE } from '@/render/ui/ui-palette';
import { shade, withAlpha } from '@/render/ui/ui-color';
import type { UiDrawGroup } from '@/render/ui/ui-batcher';
import { SettingsIsland } from '@/render/ui/ui-settings-island';
import type { ProviderConfig } from '@/llm/provider-factory';

/** Bigger-font multipliers (× the integer DPR scale). The S1 demo drew at 1×s
 *  which read tiny; the HUD/menu want chunky, legible pixel text. */
const FS_TITLE = 4;
const FS_BODY = 2;

/** What the runtime needs from the game to be live. All optional so the singleton
 *  renders a sane gray-box even before `attach()`. */
export interface UiRuntimeHooks {
  /** Force a frame (pointer events must redraw even while paused/idle). */
  requestRender?: () => void;
  /** Player presence in 0..1 (drives the orb fill). */
  getPower?: () => number;
  /** Menu "NEW WORLD". */
  onNewWorld?: () => void;
  /** Menu opened/closed — the game pauses while the menu is up. */
  onMenuToggle?: (open: boolean) => void;
  /** Toggle scene lighting (settings). Returns the new state. */
  onToggleLighting?: () => boolean;
  /** Current lighting state for the settings row. */
  getLighting?: () => boolean;
  /** Persist + live-apply a new LLM provider config (from the DOM input island). */
  onSaveLlmConfig?: (cfg: ProviderConfig) => void;
}

type Section = 'settings' | null;

/** A device-px rect (the DOM island's reserved region). */
interface Rect { x: number; y: number; w: number; h: number }

export class UiRuntime {
  private ctx = new UiContext();
  private hooks: UiRuntimeHooks = {};

  // pointer state (device px)
  private ptr = { x: -1, y: -1, down: false };
  private pendingReleased = false;

  private menuOpen = false;
  private section: Section = null;

  /** Hit regions claimed by the LAST built frame — used by capture-phase input to
   *  decide whether a pointer-down belongs to the UI (consume) or the world. */
  private lastHits: readonly UiHit[] = [];

  /** DOM input island (provider/model/key). Its target region is returned by
   *  drawMenu each frame (a local — avoids `this`-field narrowing pitfalls). */
  private island: SettingsIsland | null = null;

  configure(hooks: UiRuntimeHooks): void {
    this.hooks = { ...this.hooks, ...hooks };
  }

  isMenuOpen(): boolean {
    return this.menuOpen;
  }

  /** Whether a pointer at (px,py device) should be eaten by the UI. The menu is
   *  modal (eats everything); the HUD only eats taps on its own widgets. */
  consumesPointer(px: number, py: number): boolean {
    if (this.menuOpen) return true;
    return this.lastHits.some((h) => px >= h.x && px < h.x + h.w && py >= h.y && py < h.y + h.h);
  }

  /** Hit regions claimed by the last built frame (for an external router / tests). */
  hitRegions(): readonly UiHit[] {
    return this.lastHits;
  }

  // ── input edges (called by the canvas listeners in attach, and by tests) ──
  pointerMove(px: number, py: number): void {
    this.ptr.x = px;
    this.ptr.y = py;
    this.hooks.requestRender?.();
  }
  pointerDown(px: number, py: number): void {
    this.ptr.x = px;
    this.ptr.y = py;
    this.ptr.down = true;
    this.hooks.requestRender?.();
  }
  pointerUp(px: number, py: number): void {
    this.ptr.x = px;
    this.ptr.y = py;
    this.ptr.down = false;
    this.pendingReleased = true; // consumed by the next frame() as the click edge
    this.hooks.requestRender?.();
  }

  /** Toggle the pause menu (Esc / gear). */
  toggleMenu(): void {
    this.setMenu(!this.menuOpen);
  }
  private setMenu(open: boolean): void {
    if (open === this.menuOpen) return;
    this.menuOpen = open;
    this.section = open ? 'settings' : null;
    this.hooks.onMenuToggle?.(open);
    this.hooks.requestRender?.();
  }

  /**
   * Attach to the live canvas: capture-phase pointer + Esc key listeners. Capture
   * phase + `stopPropagation()` when the UI owns the event means `attachControls`
   * (pan/zoom/divine clicks) never sees taps that belong to the menu or HUD.
   * Returns a teardown fn.
   */
  attach(canvas: HTMLCanvasElement): () => void {
    // The DOM input island lives in the canvas's positioned container so its
    // css-px coords share the canvas origin.
    const container = canvas.parentElement;
    if (container && !this.island) {
      this.island = new SettingsIsland(container, (cfg) => this.hooks.onSaveLlmConfig?.(cfg));
    }
    const toDevice = (e: PointerEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      const sx = ((e.clientX - r.left) / Math.max(1, r.width)) * canvas.width;
      const sy = ((e.clientY - r.top) / Math.max(1, r.height)) * canvas.height;
      return [sx, sy];
    };
    const move = (e: PointerEvent) => {
      const [x, y] = toDevice(e);
      this.pointerMove(x, y);
      if (this.menuOpen) e.stopPropagation();
    };
    const down = (e: PointerEvent) => {
      const [x, y] = toDevice(e);
      if (this.consumesPointer(x, y)) e.stopPropagation();
      this.pointerDown(x, y);
    };
    const up = (e: PointerEvent) => {
      const [x, y] = toDevice(e);
      const consume = this.consumesPointer(x, y);
      this.pointerUp(x, y);
      if (consume) e.stopPropagation();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.toggleMenu();
        e.stopPropagation(); // pause menu owns Esc (supersedes time-bar dismiss)
        e.preventDefault();
      }
    };
    // capture phase so we run before attachControls' bubble-phase handlers
    canvas.addEventListener('pointermove', move, true);
    canvas.addEventListener('pointerdown', down, true);
    canvas.addEventListener('pointerup', up, true);
    window.addEventListener('keydown', key, true);
    return () => {
      canvas.removeEventListener('pointermove', move, true);
      canvas.removeEventListener('pointerdown', down, true);
      canvas.removeEventListener('pointerup', up, true);
      window.removeEventListener('keydown', key, true);
      this.island?.destroy();
      this.island = null;
    };
  }

  /** Build this frame's UI draw groups (device px, integer DPR scale). */
  frame(wDev: number, hDev: number, dpr: number): UiDrawGroup[] {
    const c = this.ctx;
    const input: UiInput = {
      px: this.ptr.x,
      py: this.ptr.y,
      down: this.ptr.down,
      released: this.pendingReleased,
    };
    this.pendingReleased = false;
    c.begin(input);

    const s = uiScaleFor(dpr);
    let r: Rect | null = null;
    if (this.menuOpen) {
      const clickAt = input.released ? { x: input.px, y: input.py } : null;
      r = this.drawMenu(c, wDev, hDev, s, clickAt);
    } else {
      this.drawHud(c, wDev, hDev, s);
    }

    const { hits } = c.end();
    this.lastHits = hits;

    // Position/show the DOM input island over the GPU settings panel (device→css px).
    if (this.island) {
      if (r) {
        this.island.layout({ x: r.x / dpr, y: r.y / dpr, w: r.w / dpr, h: r.h / dpr });
        this.island.show();
      } else {
        this.island.hide();
      }
    }
    return c.batcher.flush();
  }

  // ── barebones HUD: a single presence orb that also opens the menu ─────────
  private drawHud(c: UiContext, _w: number, h: number, s: number): void {
    const pad = 16 * s;
    const orb = 30 * s;
    const ox = pad;
    const oy = h - orb - pad;
    const power = clamp01(this.hooks.getPower?.() ?? 0);

    // The orb IS the menu button: a click anywhere on it (or its hint) opens the
    // pause menu. Register the hotspot first so `hot()` reflects this frame.
    const clicked = c.hotspot('ui.orb', ox, oy, orb, orb);
    const hot = c.hot() === 'ui.orb';

    // orb: dark socket + accent fill rising with power + bright rim (gray-box;
    // a true round emissive orb is the S3.5 skin pass). Brightens on hover.
    c.rect(ox, oy, orb, orb, withAlpha(shade(UI_PALETTE.panelBg, -0.3), 0.85));
    const fill = Math.round(orb * power);
    const accent = hot ? shade(UI_PALETTE.accent, 0.25) : UI_PALETTE.accent;
    if (fill > 0) c.rect(ox, oy + (orb - fill), orb, fill, accent);
    c.batcher.border(ox, oy, orb, orb, Math.max(1, Math.round(s * (hot ? 2 : 1))), accent);

    // tiny "MENU" hint to the orb's right so the affordance is discoverable.
    c.label('MENU', ox + orb + 10 * s, oy + (orb - c.lineHeight(FS_BODY * s)) / 2,
      FS_BODY * s, hot ? UI_PALETTE.text : UI_PALETTE.textDim);

    if (clicked) this.setMenu(true);
  }

  // ── Esc pause menu: dim backdrop + left nav + settings panel ──────────────
  /** Returns the DOM-island region (device px) when the settings form is shown.
   *  A click on the dim backdrop (outside the nav + panel) resumes the game. */
  private drawMenu(c: UiContext, w: number, h: number, s: number, clickAt: { x: number; y: number } | null): Rect | null {
    // full-screen dim so the world reads as "paused behind glass"
    c.rect(0, 0, w, h, withAlpha([0, 0, 0, 1], 0.62));

    const fsBody = FS_BODY * s;
    const fsTitle = FS_TITLE * s;

    // title
    c.label('SMALL GODS', 48 * s, 40 * s, fsTitle, UI_PALETTE.text);

    // ── left nav ──
    const navX = 48 * s;
    const navTop = 100 * s;
    let navY = navTop;
    const navW = 200 * s;
    const navH = 34 * s;
    const gap = 12 * s;
    const nav = (id: string, label: string, active: boolean): boolean => {
      // selected nav row gets an accent spine
      if (active) c.rect(navX - 8 * s, navY, 4 * s, navH, UI_PALETTE.accent);
      const clicked = c.button(id, label, navX, navY, navW, navH, { scale: fsBody });
      navY += navH + gap;
      return clicked;
    };
    if (nav('nav.resume', 'RESUME', false)) { this.setMenu(false); return null; }
    if (nav('nav.settings', 'SETTINGS', this.section === 'settings')) this.section = 'settings';
    if (nav('nav.world', 'NEW WORLD', false)) { this.setMenu(false); this.hooks.onNewWorld?.(); return null; }
    // the nav column's interactive box (covers all three rows + the spine)
    const navBox: Rect = { x: navX - 8 * s, y: navTop, w: navW + 8 * s, h: navY - navTop };

    // ── settings panel ──
    let island: Rect | null = null;
    let panelBox: Rect | null = null;
    if (this.section === 'settings') {
      const px = navX + navW + 40 * s;
      const py = 100 * s;
      const pw = Math.min(w - px - 48 * s, 460 * s);
      const ph = h - py - 48 * s;
      panelBox = { x: px, y: py, w: pw, h: ph };
      c.panel(px, py, pw, ph);

      const innerX = px + 24 * s;
      let rowY = py + 28 * s;
      const rowH = 30 * s;
      const rowGap = 18 * s;
      const ctrlW = 150 * s;
      const ctrlX = px + pw - ctrlW - 24 * s;

      // section header
      c.label('SETTINGS', innerX, rowY, fsBody, UI_PALETTE.textDim);
      rowY += rowH + rowGap;

      // LIGHTING toggle (stays a GPU button — no text input needed)
      c.label('LIGHTING', innerX, rowY + 6 * s, fsBody, UI_PALETTE.text);
      const lit = this.hooks.getLighting?.() ?? true;
      if (c.button('set.lighting', lit ? 'ON' : 'OFF', ctrlX, rowY, ctrlW, rowH, { scale: fsBody })) {
        this.hooks.onToggleLighting?.();
      }
      rowY += rowH + rowGap + 8 * s;

      // The provider FORM (provider/model/key) needs typed input → it renders in
      // the DOM island, positioned over this reserved region. We only reserve the
      // rect here; the island draws the actual fields (see frame()).
      island = { x: innerX, y: rowY, w: px + pw - 24 * s - innerX, h: py + ph - 20 * s - rowY };
    }

    // Backdrop click (outside the nav column and the settings panel) → resume.
    if (clickAt && !inRect(clickAt, navBox) && !(panelBox && inRect(clickAt, panelBox))) {
      this.setMenu(false);
      return null;
    }
    return island;
  }
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function inRect(p: { x: number; y: number }, r: Rect): boolean {
  return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
}

let singleton: UiRuntime | null = null;

/** The shared live UI runtime. Lazily created; the render frame and the Game
 *  both reach it through this. */
export function getUiRuntime(): UiRuntime {
  if (!singleton) singleton = new UiRuntime();
  return singleton;
}
