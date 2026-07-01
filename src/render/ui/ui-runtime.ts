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
import { clamp01 } from '@/core/math';
import type { UiDrawGroup } from '@/render/ui/ui-batcher';
import { SettingsIsland } from '@/render/ui/ui-settings-island';
import type { ProviderConfig } from '@/llm/provider-factory';
import type { StorySession, Stage } from '@/story/story-session';
import type { BeliefPowerView, InboxItem } from '@/game/game-query';
import type { SiteCardView } from '@/game/causal-site-view';

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
  /** A story card opened/closed — the game pauses the sim while one is up. */
  onStoryToggle?: (active: boolean) => void;

  // ── Track B: belief-granted powers + the divine inbox ──
  /** The belief-granted powers to render in the skill panel (default []). */
  getBeliefPowers?: () => BeliefPowerView[];
  /** Cast an unlocked power (the Game picks/uses the current target). */
  onCastPower?: (verb: string) => void;
  /** Verb-first targeting in progress (reticle), or null — drives the aim hint bar. */
  getTargeting?: () => { label: string } | null;
  /** Top ranked affordances for whatever the cursor rests on — queried ONCE per
   *  dwell and frozen (the game resolves + freezes the target). Null ⇒ no popover. */
  getHoverAffordances?: () => { chips: HoverChipView[] } | null;
  /** Fire a hover-popover chip (the game acts on its frozen hover target). */
  onHoverChip?: (verb: string) => void;
  /** The triageable divine-inbox items, salience-ranked (default []). */
  getInbox?: () => InboxItem[];
  /** Triage: act on an item (route to the matching divine action). */
  onInboxAct?: (item: InboxItem) => void;
  /** Triage: investigate (focus the subject — mind page / backfill). */
  onInboxInvestigate?: (item: InboxItem) => void;

  // ── W-I-d: the selected CAUSAL SITE card (flood plain / drowned village) ──
  /** The card view for the currently-selected causal site, or null. The runtime
   *  draws nothing when this returns null (no selection). */
  getSelectedSite?: () => SiteCardView | null;
  /** Dismiss the site card (clears `state.selectedCausalSiteId`). */
  onCloseSite?: () => void;

  // ── legacy-chrome L0: camera cluster (HUD) ──
  /** Camera cluster (HUD). When all four are set, the HUD draws zoom controls. */
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onFitView?: () => void;
  onZoomActual?: () => void;
}

/** Which bottom-left side panel is open (mutually exclusive; below menu/story). */
type Panel = 'powers' | 'inbox' | null;

type Section = 'settings' | null;

/** A device-px rect (the DOM island's reserved region). */
interface Rect { x: number; y: number; w: number; h: number }

/** A hover-popover chip (game-derived; the runtime only draws + reports clicks). */
export interface HoverChipView {
  verb: string;
  label: string;
  cost: number;
  unlocked: boolean;
  affordable: boolean;
  why: string | null;
}

/** A frozen hover popover: the chips + the cursor anchor + the last-drawn rect. */
interface HoverPopover { ax: number; ay: number; chips: HoverChipView[]; rect: Rect }

/** Dwell before the hover popover appears (ms) + the grace margin (device px) that
 *  keeps it open as the cursor travels from the anchor onto the chips. */
const HOVER_DWELL_MS = 120;
const HOVER_GRACE_PX = 24;

/** Injectable timer seam (real timers in the app; a manual clock in tests). */
export interface UiTimers {
  set: (fn: () => void, ms: number) => number;
  clear: (id: number) => void;
}
const REAL_TIMERS: UiTimers = {
  set: (fn, ms) => setTimeout(fn, ms) as unknown as number,
  clear: (id) => clearTimeout(id),
};

export class UiRuntime {
  private ctx = new UiContext();
  private hooks: UiRuntimeHooks = {};

  // pointer state (device px)
  private ptr = { x: -1, y: -1, down: false };
  private pendingReleased = false;

  private menuOpen = false;
  private section: Section = null;

  /** The story card currently on screen (modal narrative beat), or null. */
  private story: StorySession | null = null;

  /** Open bottom-left side panel (powers / inbox), or null. Non-modal. */
  private panel: Panel = null;
  /** Inbox item ids the player has dismissed this session (local triage state). */
  private ignoredInbox = new Set<string>();

  /** Hit regions claimed by the LAST built frame — used by capture-phase input to
   *  decide whether a pointer-down belongs to the UI (consume) or the world. */
  private lastHits: readonly UiHit[] = [];

  /** DOM input island (provider/model/key). Its target region is returned by
   *  drawMenu each frame (a local — avoids `this`-field narrowing pitfalls). */
  private island: SettingsIsland | null = null;

  /** The frozen hover popover currently on screen (dwell → freeze), or null. */
  private hover: HoverPopover | null = null;
  /** Pending dwell timer id (armed on move, fires the popover), or null. */
  private dwellId: number | null = null;
  private readonly timers: UiTimers;

  constructor(timers: UiTimers = REAL_TIMERS) {
    this.timers = timers;
  }

  configure(hooks: UiRuntimeHooks): void {
    this.hooks = { ...this.hooks, ...hooks };
  }

  isMenuOpen(): boolean {
    return this.menuOpen;
  }

  /** Whether a story card is currently on screen. */
  hasStory(): boolean {
    return this.story !== null;
  }

  /**
   * Present a storylet as a modal card. The runtime OWNS starting it (the caller
   * passes an un-started session + the storylet id to enter), so the first stage
   * is pumped here. A pack that yields nothing (immediate end / no eligible
   * storylet) is dropped silently. Pauses the sim via `onStoryToggle`.
   */
  presentStory(session: StorySession, startId?: string): void {
    try {
      session.start(startId);
    } catch {
      return; // no eligible storylet / bad id — never crash the frame
    }
    if (session.done) return;
    this.clearHover(); // the modal card supersedes any hover popover
    this.story = session;
    this.hooks.onStoryToggle?.(true);
    this.hooks.requestRender?.();
  }

  /** Whether a pointer at (px,py device) should be eaten by the UI. The menu and
   *  an open story card are modal (eat everything); the HUD only eats taps on its
   *  own widgets. */
  consumesPointer(px: number, py: number): boolean {
    if (this.menuOpen || this.story) return true;
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
    this.updateHover(px, py);
    this.hooks.requestRender?.();
  }

  /** Hover-popover lifecycle on move: a shown popover stays while the cursor is in
   *  its grace zone; otherwise (re)arm the dwell timer. Suppressed while a modal
   *  (menu / story card) owns the screen. */
  private updateHover(px: number, py: number): void {
    if (this.menuOpen || this.story) { this.clearHover(); return; }
    if (this.hover) {
      if (this.withinGrace(px, py)) return; // sticky — don't re-dwell under the card
      this.hover = null;
    }
    if (this.dwellId != null) this.timers.clear(this.dwellId);
    this.dwellId = this.timers.set(() => { this.dwellId = null; this.handleDwell(); }, HOVER_DWELL_MS);
  }

  /** Dwell elapsed: ask the game for the frozen target's chips; show if any. Public
   *  so tests can fire the dwell deterministically without a real timer. */
  handleDwell(): void {
    if (this.menuOpen || this.story) return;
    const hv = this.hooks.getHoverAffordances?.();
    if (!hv || hv.chips.length === 0) return;
    // rect is filled at draw time; the anchor freezes the target the game resolved.
    this.hover = { ax: this.ptr.x, ay: this.ptr.y, chips: hv.chips, rect: { x: 0, y: 0, w: 0, h: 0 } };
    this.hooks.requestRender?.();
  }

  private clearHover(): void {
    if (this.dwellId != null) { this.timers.clear(this.dwellId); this.dwellId = null; }
    this.hover = null;
  }

  /** Whether (px,py) is within the shown popover's rect or the anchor→card corridor
   *  (plus a margin) — the grace zone that keeps the popover from flickering shut. */
  private withinGrace(px: number, py: number): boolean {
    const h = this.hover;
    if (!h) return false;
    const x0 = Math.min(h.rect.x, h.ax) - HOVER_GRACE_PX;
    const y0 = Math.min(h.rect.y, h.ay) - HOVER_GRACE_PX;
    const x1 = Math.max(h.rect.x + h.rect.w, h.ax) + HOVER_GRACE_PX;
    const y1 = Math.max(h.rect.y + h.rect.h, h.ay) + HOVER_GRACE_PX;
    return px >= x0 && px <= x1 && py >= y0 && py <= y1;
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
    this.clearHover(); // a popover must never linger behind the modal menu
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
    } else if (this.story) {
      this.drawStory(c, wDev, hDev, s);
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
  private drawHud(c: UiContext, w: number, h: number, s: number): void {
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

    // ── Track B affordances: POWERS + INBOX toggles along the bottom strip ──
    const bh = 28 * s;
    const by = h - bh - pad;
    let bx = ox + orb + 64 * s;
    const powers = this.hooks.getBeliefPowers?.() ?? [];
    const unlocked = powers.filter((p) => p.unlocked).length;
    const pLabel = `⚡ POWERS${unlocked > 0 ? ` (${unlocked})` : ''}`;
    const pw = Math.ceil(c.measure(pLabel, FS_BODY * s)) + 24 * s;
    if (c.button('ui.powers', pLabel, bx, by, pw, bh, { scale: FS_BODY * s })) {
      this.panel = this.panel === 'powers' ? null : 'powers';
    }
    bx += pw + 10 * s;

    const inbox = (this.hooks.getInbox?.() ?? []).filter((it) => !this.ignoredInbox.has(it.id));
    const iLabel = `✉ INBOX${inbox.length > 0 ? ` (${inbox.length})` : ''}`;
    const iw = Math.ceil(c.measure(iLabel, FS_BODY * s)) + 24 * s;
    if (c.button('ui.inbox', iLabel, bx, by, iw, bh, { scale: FS_BODY * s })) {
      this.panel = this.panel === 'inbox' ? null : 'inbox';
    }

    if (this.panel === 'powers') this.drawPowers(c, w, h, s, powers, by - pad);
    else if (this.panel === 'inbox') this.drawInbox(c, w, h, s, inbox, by - pad);

    const site = this.hooks.getSelectedSite?.() ?? null;
    if (site) this.drawSiteCard(c, w, s, site);

    this.drawCameraCluster(c, w, h, s);

    // ── verb-first targeting: a top-centre reticle hint while aiming a cast ──
    const aim = this.hooks.getTargeting?.() ?? null;
    if (aim) {
      const fs = FS_BODY * s;
      const msg = `◎ CHOOSE A TARGET — ${aim.label.toUpperCase()}   ·   right-click to cancel`;
      const tw = Math.ceil(c.measure(msg, fs)) + 32 * s;
      const th = 34 * s;
      const tx = Math.round((w - tw) / 2);
      const ty = 16 * s;
      c.panel(tx, ty, tw, th);
      c.label(msg, tx + 16 * s, ty + (th - c.lineHeight(fs)) / 2, fs, UI_PALETTE.accent);
    }

    // ── hover popover: top ranked affordance chips at the cursor (dwell → freeze) ──
    if (this.hover && !aim) this.drawHover(c, w, h, s);
  }

  /** The frozen hover popover: a small stack of chip buttons anchored at the cursor.
   *  A castable chip fires its verb; locked / unaffordable chips render disabled. */
  private drawHover(c: UiContext, w: number, h: number, s: number): void {
    const pop = this.hover!;
    const fs = FS_BODY * s;
    const pad = 10 * s;
    const rowH = 26 * s;
    const gap = 4 * s;
    const labels = pop.chips.map((ch) => hoverChipLabel(ch));
    let widest = 0;
    for (const l of labels) widest = Math.max(widest, c.measure(l, fs));
    const pw = Math.ceil(widest) + pad * 2;
    const ph = pad * 2 + pop.chips.length * rowH + Math.max(0, pop.chips.length - 1) * gap;

    // anchor lower-right of the cursor, clamped to stay on-screen
    let x = pop.ax + 18 * s;
    let y = pop.ay + 18 * s;
    if (x + pw > w) x = Math.max(0, pop.ax - pw - 18 * s);
    if (y + ph > h) y = Math.max(0, h - ph);
    pop.rect = { x, y, w: pw, h: ph };

    c.panel(x, y, pw, ph);
    let ry = y + pad;
    pop.chips.forEach((ch, i) => {
      const castable = ch.unlocked && ch.affordable;
      if (c.button(`hover.chip.${ch.verb}`, labels[i], x + pad, ry, pw - pad * 2, rowH,
        { scale: fs, disabled: !castable })) {
        this.hooks.onHoverChip?.(ch.verb);
        this.clearHover();
        this.hooks.requestRender?.();
      }
      ry += rowH + gap;
    });
  }

  // ── W-I-d: the selected causal-site card (a focused ephemeral place) ────────
  // A non-modal banner near the top centre: name, attribution, an intensity bar,
  // and the lifecycle line. The whole card registers a hotspot so a tap on it is
  // eaten by the UI (doesn't fall through to the world and deselect); the ✕ button
  // dismisses. Mirrors `drawInbox`'s panel/label/rect vocabulary.
  private drawSiteCard(c: UiContext, w: number, s: number, view: SiteCardView): void {
    const pad = 16 * s;
    const cw = 320 * s;
    const cx = Math.round((w - cw) / 2);
    const cy = pad;
    const fsName = 3 * s;
    const fsBody = FS_BODY * s;
    const nameLh = c.lineHeight(fsName);
    const lh = c.lineHeight(fsBody);
    const barH = 8 * s;
    const ch = 18 * s + nameLh + 6 * s + lh + 12 * s + barH + 10 * s + lh + 16 * s;

    c.panel(cx, cy, cw, ch);
    c.hotspot('ui.sitecard', cx, cy, cw, ch); // eat clicks on the card body

    const innerX = cx + 18 * s;
    const innerW = cw - 36 * s;
    let y = cy + 18 * s;

    c.label(view.name, innerX, y, fsName, UI_PALETTE.text);
    const close = 22 * s;
    if (c.button('ui.sitecard.close', '✕', cx + cw - close - 12 * s, cy + 12 * s, close, close, { scale: fsBody })) {
      this.hooks.onCloseSite?.();
    }
    y += nameLh + 6 * s;

    c.label(view.subtitle, innerX, y, fsBody, UI_PALETTE.textDim);
    y += lh + 12 * s;

    c.rect(innerX, y, innerW, barH, withAlpha(shade(UI_PALETTE.panelBg, -0.3), 0.85));
    const fillW = Math.round(innerW * clamp01(view.intensity));
    if (fillW > 0) c.rect(innerX, y, fillW, barH, UI_PALETTE.accent);
    y += barH + 10 * s;

    c.label(view.status, innerX, y, fsBody, UI_PALETTE.textDim);
  }

  // ── skill panel: belief-granted powers, locked→unlocked with progress ──────
  private drawPowers(c: UiContext, _w: number, _h: number, s: number, powers: BeliefPowerView[], bottom: number): void {
    const pad = 16 * s;
    const pw = 360 * s;
    const px = pad;
    const top = Math.max(pad, 80 * s);
    const ph = bottom - top;
    c.panel(px, top, pw, ph);

    const innerX = px + 20 * s;
    const innerW = pw - 40 * s;
    let y = top + 20 * s;
    c.label('POWERS', innerX, y, FS_BODY * s, UI_PALETTE.textDim);
    y += c.lineHeight(FS_BODY * s) + 14 * s;

    if (powers.length === 0) {
      c.label('No powers yet. Make them believe.', innerX, y, FS_BODY * s, UI_PALETTE.textDim);
      return;
    }

    const rowH = 86 * s;
    for (const p of powers) {
      const accent = p.unlocked ? UI_PALETTE.accent : UI_PALETTE.textDim;
      c.label(p.label.toUpperCase(), innerX, y, FS_BODY * s, p.unlocked ? UI_PALETTE.text : UI_PALETTE.textDim);
      let ry = y + c.lineHeight(FS_BODY * s) + 6 * s;

      // progress bar: conviction vs threshold
      const barW = innerW;
      const barH = 8 * s;
      c.rect(innerX, ry, barW, barH, withAlpha(shade(UI_PALETTE.panelBg, -0.3), 0.9));
      const conv = Math.max(0, Math.min(1, p.conviction));
      if (conv > 0) c.rect(innerX, ry, Math.round(barW * conv), barH, accent);
      // threshold tick
      const tx = innerX + Math.round(barW * Math.max(0, Math.min(1, p.threshold)));
      c.rect(tx, ry - 2 * s, Math.max(1, Math.round(s)), barH + 4 * s, UI_PALETTE.text);
      ry += barH + 8 * s;

      const pct = Math.round(p.conviction * 100);
      const need = Math.round(p.threshold * 100);
      if (p.unlocked) {
        c.label(`believed by ${p.reach} — ${pct}%`, innerX, ry, FS_BODY * s, UI_PALETTE.textDim);
        const bw = 110 * s;
        const bh = 26 * s;
        if (c.button(`power.cast.${p.verb}`, 'CAST ⚡', innerX + innerW - bw, ry - 4 * s, bw, bh, { scale: FS_BODY * s })) {
          this.hooks.onCastPower?.(p.verb);
        }
      } else {
        c.label(`not yet believed — ${pct}% of ${need}% needed`, innerX, ry, FS_BODY * s, UI_PALETTE.textDim);
      }
      y += rowH;
      if (y > bottom - rowH) break;
    }
  }

  // ── divine inbox: triageable prayers / opportunities / threats ─────────────
  private drawInbox(c: UiContext, _w: number, _h: number, s: number, items: InboxItem[], bottom: number): void {
    const pad = 16 * s;
    const pw = 400 * s;
    const px = pad;
    const top = Math.max(pad, 80 * s);
    const ph = bottom - top;
    c.panel(px, top, pw, ph);

    const innerX = px + 20 * s;
    const innerW = pw - 40 * s;
    let y = top + 20 * s;
    c.label(`DIVINE INBOX (${items.length})`, innerX, y, FS_BODY * s, UI_PALETTE.textDim);
    y += c.lineHeight(FS_BODY * s) + 14 * s;

    if (items.length === 0) {
      c.label('All quiet. For now.', innerX, y, FS_BODY * s, UI_PALETTE.textDim);
      return;
    }

    const rowH = 92 * s;
    for (const it of items) {
      const tag = it.surfaced ? UI_PALETTE.accent : kindColor(it.kind);
      // kind dot + title
      c.rect(innerX, y + 4 * s, 8 * s, 8 * s, tag);
      c.label(it.title, innerX + 16 * s, y, FS_BODY * s, UI_PALETTE.text);
      let ry = y + c.lineHeight(FS_BODY * s) + 4 * s;
      c.label(it.detail.length > 44 ? it.detail.slice(0, 43) + '…' : it.detail,
        innerX, ry, FS_BODY * s, UI_PALETTE.textDim);
      ry += c.lineHeight(FS_BODY * s) + 8 * s;

      // triage row: ACT · LOOK · IGNORE
      const bh = 24 * s;
      const gap = 8 * s;
      const bw = (innerW - 2 * gap) / 3;
      if (it.target.kind !== 'none' &&
          c.button(`inbox.act.${it.id}`, 'ACT', innerX, ry, bw, bh, { scale: FS_BODY * s })) {
        this.hooks.onInboxAct?.(it);
      }
      if (c.button(`inbox.look.${it.id}`, 'LOOK', innerX + (bw + gap), ry, bw, bh, { scale: FS_BODY * s })) {
        this.hooks.onInboxInvestigate?.(it);
      }
      if (c.button(`inbox.ignore.${it.id}`, 'IGNORE', innerX + 2 * (bw + gap), ry, bw, bh, { scale: FS_BODY * s })) {
        this.ignoredInbox.add(it.id);
        this.hooks.requestRender?.();
      }
      y += rowH;
      if (y > bottom - rowH) break;
    }
  }

  // ── story card: a modal narrative beat (line / choice) over a dim backdrop ──
  private drawStory(c: UiContext, w: number, h: number, s: number): void {
    const session = this.story;
    if (!session) return;
    const stage: Stage = session.current;

    // dim the world so the beat reads as the focus
    c.rect(0, 0, w, h, withAlpha([0, 0, 0, 1], 0.45));

    const fsBody = FS_BODY * s;
    const fsName = FS_BODY * s;
    const lh = c.lineHeight(fsBody);

    // bottom-anchored card spanning most of the width
    const margin = 40 * s;
    const cardH = Math.max(160 * s, Math.round(h * 0.34));
    const cx = margin;
    const cy = h - cardH - margin;
    const cw = w - margin * 2;
    c.panel(cx, cy, cw, cardH);

    const innerX = cx + 28 * s;
    const innerW = cw - 56 * s;
    let y = cy + 24 * s;

    if (stage.kind === 'line') {
      if (stage.line.who) {
        c.label(stage.line.who.toUpperCase(), innerX, y, fsName, UI_PALETTE.accent);
        y += lh + 8 * s;
      }
      this.drawWrapped(c, stage.line.text, innerX, y, innerW, fsBody, UI_PALETTE.text);

      const bw = 150 * s;
      const bh = 30 * s;
      if (c.button('story.next', 'CONTINUE ▸', cx + cw - bw - 24 * s, cy + cardH - bh - 14 * s, bw, bh, { scale: fsBody })) {
        this.advanceStory(() => session.next());
      }
    } else if (stage.kind === 'choice') {
      // options stack upward from the button strip; one button each.
      const bh = 30 * s;
      const gap = 8 * s;
      const opts = stage.options;
      const stackH = opts.length * bh + Math.max(0, opts.length - 1) * gap;
      let by = cy + cardH - 14 * s - stackH; // bottom-aligned block of options
      const bw = innerW;
      opts.forEach((opt) => {
        if (c.button(`story.opt.${opt.index}`, opt.text, innerX, by, bw, bh, { scale: fsBody })) {
          this.advanceStory(() => session.choose(opt.index));
        }
        by += bh + gap;
      });
    }
  }

  /** Greedy word-wrap a run into the card width; returns the y past the last line. */
  private drawWrapped(c: UiContext, text: string, x: number, y: number, maxW: number, scale: number, color = UI_PALETTE.text): number {
    const lh = c.lineHeight(scale);
    let line = '';
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const probe = line ? `${line} ${word}` : word;
      if (line && c.measure(probe, scale) > maxW) {
        c.label(line, x, y, scale, color);
        y += lh + 2 * scale;
        line = word;
      } else {
        line = probe;
      }
    }
    if (line) { c.label(line, x, y, scale, color); y += lh + 2 * scale; }
    return y;
  }

  /** Run one story step; dismiss when the beat ends. */
  private advanceStory(step: () => Stage): void {
    if (!this.story) return;
    const next = step();
    if (next.kind === 'done') this.dismissStory();
    this.hooks.requestRender?.();
  }

  private dismissStory(): void {
    if (!this.story) return;
    this.story = null;
    this.hooks.onStoryToggle?.(false);
    this.hooks.requestRender?.();
  }

  /** Right-edge zoom controls (in/out/fit/1:1) — the GPU port of the legacy DOM
   *  `cameraControls`. Drawn only when the camera hooks are wired. */
  private drawCameraCluster(c: UiContext, w: number, h: number, s: number): void {
    const { onZoomIn, onZoomOut, onFitView, onZoomActual } = this.hooks;
    if (!onZoomIn || !onZoomOut || !onFitView || !onZoomActual) return;

    const pad = 16 * s;
    const bw = 38 * s;
    const bh = 32 * s;
    const gap = 4 * s;
    const fs = FS_BODY * s;
    const rows: Array<[string, string, () => void]> = [
      ['cam.in', '+', onZoomIn],
      ['cam.out', '-', onZoomOut],
      ['cam.fit', 'FIT', onFitView],
      ['cam.one', '1:1', onZoomActual],
    ];
    const bx = w - bw - pad;
    // vertically centred cluster on the right edge
    let by = Math.round((h - (bh * rows.length + gap * (rows.length - 1))) / 2);
    for (const [id, label, fn] of rows) {
      if (c.button(id, label, bx, by, bw, bh, { scale: fs })) fn();
      by += bh + gap;
    }
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

function inRect(p: { x: number; y: number }, r: Rect): boolean {
  return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
}

/** Chip caption: "WHISPER · 1  (praying)" with a lock glyph when belief-gated. */
function hoverChipLabel(ch: HoverChipView): string {
  const cost = ch.cost > 0 ? ` · ${ch.cost}` : '';
  const why = ch.why ? `  (${ch.why})` : '';
  const lock = ch.unlocked ? '' : ' 🔒';
  return `${ch.label.toUpperCase()}${cost}${why}${lock}`;
}

/** Inbox kind → dot colour (surfaced items override with the accent). */
function kindColor(kind: InboxItem['kind']): [number, number, number, number] {
  switch (kind) {
    case 'prayer': return UI_PALETTE.accent as [number, number, number, number];
    case 'opportunity': return [0.55, 0.7, 0.9, 1]; // storm-sky
    case 'threat': return [0.85, 0.32, 0.27, 1];    // rival red
  }
}

let singleton: UiRuntime | null = null;

/** The shared live UI runtime. Lazily created; the render frame and the Game
 *  both reach it through this. */
export function getUiRuntime(): UiRuntime {
  if (!singleton) singleton = new UiRuntime();
  return singleton;
}
