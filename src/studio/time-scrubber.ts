// src/studio/time-scrubber.ts
// The studio's TIME-OF-DAY SCRUBBER — a slim horizontal scrub bar floated over the view
// pane (bottom-centre, clear of the ambient dials at top-centre and the dock below). It's
// the promoted 90%-case control for time of day; the toolbar's Sky popover keeps season /
// latitude / moon-phase + the manual az/el override.
//
// The bar draws a 24h track painted with the day-cycle gradient (deep night → dawn → noon
// → dusk → night), a draggable handle whose icon is ☀ by day / 🌙 by night (from the
// canonical celestial() body — NOT re-derived here), and a mono clock label + a muted
// season label.
//
// Seams (studio.ts owns the state; this widget only reads + reports):
//  · onScrubStart() — fired once per drag/jump BEFORE the first value, so the studio can
//      flip sunMode manual→solar (dragging time implies driving the sun by the clock).
//  · onInput(hour)  — cheap live path during a drag: set hour + recompute sun WITHOUT the
//      geometry cast-shadow re-bake (the same commit=false path the popover sliders use).
//  · onCommit(hour) — release: set hour + recompute WITH the shadow re-bake.
//  · visible()      — gate the whole bar on state.overlays (same as the HUD).
// Two-way sync is by the per-frame refresh(): the studio calls it each frame, so a change
// from the toolbar popover moves the handle here, and a drag here moves the popover slider
// + sun readout on the next frame (both read the one owned state).
//
// Dev-only (the studio is tree-shaken from prod). No keyboard (project rule: buttons over
// shortcuts). Cosmetic — no sim, no seed.
import { h } from './theme';
import { celestial, clockLabel, seasonLabel } from '@/render/solar';
import { scrubFraction, scrubHour, dayGradientCss } from './sky-hud';

export interface TimeScrubberDeps {
  getHour: () => number;
  getYearFrac: () => number;
  getLat: () => number;
  getMoonPhase: () => number;
  visible: () => boolean;
  /** Fired once at the start of a drag/jump — flip manual→solar before the first value. */
  onScrubStart: () => void;
  /** Live drag: set hour + cheap sun recompute (no cast-shadow re-bake). */
  onInput: (hour: number) => void;
  /** Release: set hour + sun recompute WITH the cast-shadow re-bake. */
  onCommit: (hour: number) => void;
}

export interface TimeScrubber { el: HTMLElement; refresh: () => void }

export function buildTimeScrubber(viewPane: HTMLElement, deps: TimeScrubberDeps): TimeScrubber {
  // ── layout: [icon · clock · season] over the gradient track ──
  const icon = h('span', { style: 'font-size:14px;line-height:1;width:16px;text-align:center' });
  const clock = h('span', { class: 'sg-accent', style: 'font:600 12px/1 var(--font-mono);min-width:44px' });
  const season = h('span', { class: 'sg-muted', style: 'font:500 11px/1 var(--font-mono)' });
  const readRow = h('div', { style: 'display:flex;align-items:center;gap:8px;justify-content:center;margin-bottom:5px' }, icon, clock, season);

  // The track carries the day-cycle gradient; the handle rides it as a % of its width.
  const handle = h('div', {
    style: 'position:absolute;top:50%;width:12px;height:20px;transform:translate(-50%,-50%);'
      + 'border-radius:4px;background:var(--accent);border:1px solid #1a1206;'
      + 'box-shadow:0 1px 3px rgba(0,0,0,0.55);pointer-events:none',
  });
  const track = h('div', {
    style: 'position:relative;height:14px;border-radius:8px;cursor:pointer;'
      + `background:${dayGradientCss()};border:1px solid var(--line);`
      + 'box-shadow:inset 0 1px 2px rgba(0,0,0,0.45)',
  }, handle);

  const wrap = h('div', {
    style: 'position:absolute;bottom:16px;left:50%;transform:translateX(-50%);z-index:6;'
      + 'width:min(560px,66%);padding:8px 12px 9px;border-radius:11px;'
      + 'background:rgba(16,18,24,0.72);border:1px solid var(--line);'
      + 'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);box-shadow:0 2px 12px rgba(0,0,0,0.4)',
  }, readRow, track);
  viewPane.appendChild(wrap);

  // ── drag / click-to-jump. Pointer-capture keeps the drag alive off the track. ──
  const hourFromEvent = (clientX: number): number => {
    const r = track.getBoundingClientRect();
    return scrubHour((clientX - r.left) / Math.max(1, r.width));
  };
  let dragging = false;
  track.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    dragging = true;
    track.setPointerCapture(e.pointerId);
    deps.onScrubStart();               // manual→solar before the first value lands
    deps.onInput(hourFromEvent(e.clientX));
  });
  track.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    deps.onInput(hourFromEvent(e.clientX));   // cheap path — no shadow re-bake mid-drag
  });
  const end = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    try { track.releasePointerCapture(e.pointerId); } catch { /* capture may be gone */ }
    deps.onCommit(hourFromEvent(e.clientX));   // release → re-bake the cast shadow once
  };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', end);

  return {
    el: wrap,
    refresh: () => {
      const show = deps.visible();
      wrap.style.display = show ? 'block' : 'none';
      if (!show) return;
      const hour = deps.getHour();
      handle.style.left = `${(scrubFraction(hour) * 100).toFixed(2)}%`;
      clock.textContent = clockLabel(hour);
      season.textContent = seasonLabel(deps.getYearFrac());
      // Icon from the canonical sky model — the moon rides once the sun is down.
      const sky = celestial(hour, deps.getYearFrac(), deps.getLat(), deps.getMoonPhase());
      icon.textContent = sky.body === 'moon' ? '🌙' : '☀';
    },
  };
}
