// src/studio/toolbar.ts
// Top toolbar — the editor menu bar that sits above the viewport. Replaces the
// old floating "Render Studio" modal (control-panel.ts): the object selector now
// lives in the left-pane Object Browser, so this bar carries only the viewport
// controls — sun, display/shadow, zoom/fit, render, and a QOL kebab — using
// popover dropdowns where a control needs more than one widget. Keyboard
// shortcuts (F/R/G/C/[ ]) drive the same actions.
import type { ShadowMode } from '@/render/lighting-state';
import type { StudioState } from './types';
import { h, popover } from './theme';
import { celestial, clockLabel, seasonLabel } from '@/render/solar';

interface ToolbarDeps {
  invalidate: () => void;            // bust geometry/shadow caches (sun moved)
  onSolarChange: (commit: boolean) => void;  // recompute az/el from time/season/moon (commit ⇒ re-bake shadow)
  zoomLabel: (z: number) => string;
  getZoom: () => number;
  zoomIn: () => void;
  zoomOut: () => void;
  openRender: () => void;
  getPrompt: () => string;           // current img2img prompt (for "copy")
  randomize: () => void;             // re-roll seeded params
  subjectInfo: () => string;         // "cottage · 3×2 · medieval · ruin" readout (HTML)
  keyStatus: () => string;           // OpenRouter key state (Render is paid)
  setYaw: (deg: number) => void;     // snap the turntable to an absolute yaw (4-way orient)
  getYaw: () => number;              // current turntable yaw in degrees
}

// The four placement orientations, labelled by the direction the building's (canonical
// south) door faces after that quarter-turn — orientation o = a turntable yaw of o×90°.
const FACE_SNAPS: { label: string; o: number; dir: string }[] = [
  { label: 'S', o: 0, dir: 'south' },
  { label: 'W', o: 1, dir: 'west' },
  { label: 'N', o: 2, dir: 'north' },
  { label: 'E', o: 3, dir: 'east' },
];

const moonLabel = (p: number): string =>
  p <= 0.03 ? 'new (dark)' : p >= 0.97 ? 'full' : `${Math.round(p * 100)}% ${p < 0.5 ? 'waxing' : 'gibbous'}`;
interface ToolbarHandle { el: HTMLElement; refresh: () => void }

const SHADOW_MODES: ShadowMode[] = ['geometry', 'silhouette', 'blob', 'off'];

export function buildToolbar(host: HTMLElement, state: StudioState, deps: ToolbarDeps): ToolbarHandle {
  const bar = h('div', {
    class: 'sg-bar',
    style: 'flex:0 0 auto;display:flex;align-items:center;gap:9px;padding:7px 10px;position:relative;z-index:12',
  });

  // ── live status cluster (no brand — internal tool; the prime space carries
  // live state: the resolved subject + variant, and the paid-render key status) ──
  const subjTag = h('span', { class: 'sg-tag', style: 'font-size:12px' });
  const keyTag = h('span', { class: 'sg-tag', title: 'OpenRouter key for the paid Render call' });
  bar.append(subjTag, keyTag, h('span', { style: 'flex:1 1 auto' }));

  // ── sky popover: solar (time/season/latitude/moon → sun by day, moon by
  // night) or a manual az/el override for inspecting a fixed angle ──
  const sunIcon = h('span', { text: '☀' });
  const sunBtn = h('button', { class: 'sg-btn', title: 'Sky / sun & moon position' }, sunIcon, h('span', { style: 'opacity:.7', text: ' Sky' }));
  const sunReadout = h('span', { class: 'sg-read', style: 'min-width:0;padding-left:8px;white-space:nowrap' });

  // A labelled slider whose value span is formatted by `fmt`. `onInput` fires
  // live during a drag (cheap follow), `onCommit` on release (e.g. shadow re-bake).
  const labelledSlider = (
    label: string, min: number, max: number, step: number,
    get: () => number, set: (v: number) => void, fmt: (v: number) => string,
    onInput: () => void, onCommit: () => void,
  ) => {
    const val = h('span', { class: 'sg-accent', style: 'min-width:78px;text-align:right' });
    const range = h('input', { class: 'sg-range', style: 'flex:1', attrs: { type: 'range', min: String(min), max: String(max), step: String(step), value: String(get()) } }) as HTMLInputElement;
    const paint = () => { val.textContent = fmt(get()); };
    range.addEventListener('input', () => { set(Number(range.value)); paint(); onInput(); });
    range.addEventListener('change', onCommit);
    paint();
    return { row: h('div', { class: 'sg-field', style: 'margin-bottom:9px' }, h('label', { text: label }), h('div', { style: 'display:flex;align-items:center;gap:8px' }, range, val)), sync: () => { range.value = String(get()); paint(); } };
  };

  let syncSun = () => {};
  popover(sunBtn, (body) => {
    body.append(h('div', { class: 'sg-pop-title', text: 'Sky' }));

    // mode toggle
    const mkMode = (m: 'solar' | 'manual', label: string) =>
      h('button', { class: 'sg-btn', style: 'flex:1', text: label, on: { click: () => { state.sunMode = m; if (m === 'solar') deps.onSolarChange(true); syncSun(); } } });
    const solarBtn = mkMode('solar', 'Solar'), manualBtn = mkMode('manual', 'Manual');
    body.append(h('div', { class: 'sg-group', style: 'display:flex;margin-bottom:11px' }, solarBtn, manualBtn));

    const onIn = () => deps.onSolarChange(false), onCommit = () => deps.onSolarChange(true);
    const time = labelledSlider('Time of day', 0, 24, 0.25, () => state.hour, v => { state.hour = v; }, clockLabel, onIn, onCommit);
    const season = labelledSlider('Day of year', 0, 1, 0.01, () => state.yearFrac, v => { state.yearFrac = v; }, seasonLabel, onIn, onCommit);
    const lat = labelledSlider('Latitude', 0, 66, 1, () => state.lat, v => { state.lat = v; }, v => `${v}°N`, onIn, onCommit);
    const moon = labelledSlider('Moon phase', 0, 1, 0.05, () => state.moonPhase, v => { state.moonPhase = v; }, moonLabel, onIn, onCommit);
    const solarBox = h('div', {}, time.row, season.row, lat.row, moon.row);

    const az = labelledSlider('Azimuth', 0, 360, 1, () => state.az, v => { state.az = v; }, v => `${v}°`, () => {}, deps.invalidate);
    const el = labelledSlider('Elevation', 0, 90, 1, () => state.el, v => { state.el = v; }, v => `${v}°`, () => {}, deps.invalidate);
    const manualBox = h('div', {}, az.row, el.row);

    body.append(solarBox, manualBox);
    syncSun = () => {
      const solar = state.sunMode === 'solar';
      solarBox.style.display = solar ? 'block' : 'none';
      manualBox.style.display = solar ? 'none' : 'block';
      solarBtn.classList.toggle('is-on', solar);
      manualBtn.classList.toggle('is-on', !solar);
      time.sync(); season.sync(); lat.sync(); moon.sync(); az.sync(); el.sync();
    };
    syncSun();
  }, { width: 268 });

  // ── display popover (shadow mode + lighting/overlays toggles) ──
  const dispBtn = h('button', { class: 'sg-btn', title: 'Display options', html: '◐ <span style="opacity:.7">Display</span>' });
  popover(dispBtn, (body) => {
    body.append(h('div', { class: 'sg-pop-title', text: 'Display' }));
    const shadowSel = h('select', { class: 'sg-select', style: 'width:100%' }) as HTMLSelectElement;
    for (const m of SHADOW_MODES) shadowSel.append(h('option', { text: m, attrs: { value: m } }));
    shadowSel.value = state.lighting.shadowMode ?? 'geometry';
    shadowSel.addEventListener('change', () => { state.lighting.shadowMode = shadowSel.value as ShadowMode; deps.invalidate(); });
    body.append(h('div', { class: 'sg-field', style: 'margin-bottom:10px' }, h('label', { text: 'Cast shadow' }), shadowSel));

    const toggle = (label: string, get: () => boolean, set: (v: boolean) => void) => {
      const chk = h('input', { class: 'sg-check', attrs: { type: 'checkbox' } }) as HTMLInputElement;
      chk.checked = get();
      chk.addEventListener('change', () => set(chk.checked));
      return h('label', { class: 'sg-toggle', style: 'margin:6px 0' }, chk, document.createTextNode(label));
    };
    body.append(
      toggle('Lighting (sun + AO)', () => state.lighting.enabled, (v) => { state.lighting.enabled = v; }),
      toggle('Textured sprite (when generated)', () => state.textured, (v) => { state.textured = v; }),
      toggle('Debug overlays (grid + axis)', () => state.overlays, (v) => { state.overlays = v; }),
    );

    // ── ground skirt (apron) sub-section: on/off + margin + edge-fade ──
    // Each control re-composes the geometry, so they all call deps.invalidate().
    body.append(h('div', { class: 'sg-menu-sep', style: 'margin:8px 0' }));
    const skirtRow = h('div');
    const slider = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void) => {
      const val = h('span', { class: 'sg-read', style: 'min-width:34px;text-align:right' });
      const rng = h('input', { class: 'sg-range', attrs: { type: 'range', min: String(min), max: String(max), step: String(step) } }) as HTMLInputElement;
      const sync = () => { rng.value = String(get()); val.textContent = get().toFixed(2); };
      rng.addEventListener('input', () => { set(parseFloat(rng.value)); val.textContent = get().toFixed(2); deps.invalidate(); });
      sync();
      return h('div', { class: 'sg-field', style: 'margin:6px 0' }, h('label', { text: label }), h('div', { style: 'display:flex;gap:6px;align-items:center' }, rng, val));
    };
    const renderSkirtControls = () => {
      skirtRow.replaceChildren();
      if (!state.skirt) return;
      skirtRow.append(
        slider('Skirt margin (tiles)', 0, 1, 0.05, () => state.skirt!.margin, (v) => { state.skirt!.margin = v; }),
        slider('Edge fade → terrain', 0, 1, 0.05, () => state.skirt!.fade, (v) => { state.skirt!.fade = v; }),
      );
    };
    body.append(
      toggle('Ground skirt (wall lip)', () => !!state.skirt, (v) => { state.skirt = v ? { margin: 0.15, fade: 0 } : null; deps.invalidate(); renderSkirtControls(); }),
      skirtRow,
    );
    renderSkirtControls();
  }, { width: 248 });

  // ── zoom group + fit toggle ──
  const zoomRead = h('span', { class: 'sg-read' });
  const zoomGroup = h('div', { class: 'sg-group' },
    h('button', { class: 'sg-btn', text: '−', title: 'Zoom out  [', on: { click: () => { deps.zoomOut(); state.fit = false; } } }),
    zoomRead,
    h('button', { class: 'sg-btn', text: '+', title: 'Zoom in  ]', on: { click: () => { deps.zoomIn(); state.fit = false; } } }),
  );
  const fitBtn = h('button', { class: 'sg-btn', html: '⤢ <span style="opacity:.7">Fit</span>', title: 'Fit subject to view  F', on: { click: () => { state.fit = true; } } });
  // Scale mode: 'proper' = one fixed true-metric scale across every subject (a church
  // reads bigger than a cottage, both measured against the 1.7 m reference NPC);
  // 'game' = fit-to-fill each subject (the convenient ≈ in-game framing). Toggling
  // re-frames (state.fit) so the new scale takes effect immediately.
  const scaleBtn = h('button', {
    class: 'sg-btn', title: 'Scale: true metric (proper) ⇄ in-game fit',
    on: { click: () => { state.scaleMode = state.scaleMode === 'proper' ? 'game' : 'proper'; state.fit = true; } },
  });

  // ── 4-way placement orientation snap (turntable to each cardinal) ──
  const faceBtns = FACE_SNAPS.map(s => h('button', {
    class: 'sg-btn', text: s.label, title: `Orient: door faces ${s.dir} (orientation ${s.o})`,
    on: { click: () => deps.setYaw(s.o * 90) },
  }));
  const faceGroup = h('div', { class: 'sg-group' }, h('span', { class: 'sg-read', text: 'Face' }), ...faceBtns);

  // ── render + kebab ──
  const renderBtn = h('button', { class: 'sg-btn sg-btn-primary', text: '🎨 Render', title: 'Send to OpenRouter  R', on: { click: deps.openRender } });
  const kebab = h('button', { class: 'sg-icon-btn', text: '⋯', title: 'More actions' });
  const flash = (msg: string) => { const old = subjTag.textContent; subjTag.innerHTML = `<b>${msg}</b>`; setTimeout(() => { subjTag.innerHTML = old ?? ''; }, 1200); };
  popover(kebab, (body) => {
    const item = (icon: string, label: string, kbd: string, fn: () => void) => h('div', { class: 'sg-menu-item', on: { click: fn } },
      h('span', { style: 'width:16px;text-align:center', text: icon }), h('span', { text: label }), h('span', { class: 'sg-kbd', text: kbd }));
    body.append(h('div', { class: 'sg-menu' },
      item('📋', 'Copy img2img prompt', 'C', () => { void navigator.clipboard?.writeText(deps.getPrompt()).then(() => flash('prompt copied')); }),
      item('🎲', 'Randomize seed', 'G', deps.randomize),
      h('div', { class: 'sg-menu-sep' }),
      item('⤢', 'Reset / fit view', 'F', () => { state.fit = true; }),
    ));
  }, { align: 'right', width: 230 });

  bar.append(sunBtn, sunReadout, dispBtn, h('span', { class: 'sg-vsep' }), faceGroup, h('span', { class: 'sg-vsep' }), zoomGroup, fitBtn, scaleBtn, h('span', { class: 'sg-vsep' }), renderBtn, kebab);
  host.appendChild(bar);

  // ── keyboard shortcuts (ignored while typing in a field) ──
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key.toLowerCase()) {
      case 'f': state.fit = true; break;
      case 'r': deps.openRender(); break;
      case 'g': deps.randomize(); break;
      case 'c': void navigator.clipboard?.writeText(deps.getPrompt()).then(() => flash('prompt copied')); break;
      case '[': deps.zoomOut(); state.fit = false; break;
      case ']': deps.zoomIn(); state.fit = false; break;
      default: return;
    }
  });

  return {
    el: bar,
    refresh: () => {
      subjTag.innerHTML = deps.subjectInfo();
      const ks = deps.keyStatus();
      const noKey = /no key/i.test(ks);
      keyTag.innerHTML = `<span style="color:${noKey ? 'var(--bad)' : 'var(--ok)'}">●</span> ${ks}`;
      zoomRead.textContent = deps.zoomLabel(deps.getZoom());
      if (state.sunMode === 'solar') {
        const sky = celestial(state.hour, state.yearFrac, state.lat, state.moonPhase);
        sunIcon.textContent = sky.body === 'moon' ? '🌙' : '☀';
        sunReadout.textContent = `${clockLabel(state.hour)} · ${seasonLabel(state.yearFrac)} · ${state.el}°`;
      } else {
        sunIcon.textContent = '☀';
        sunReadout.textContent = `az ${state.az}° · el ${state.el}°`;
      }
      const curO = ((Math.round(deps.getYaw() / 90) % 4) + 4) % 4;
      faceBtns.forEach((b, i) => b.classList.toggle('is-on', i === curO));
      fitBtn.classList.toggle('is-on', state.fit);
      const proper = state.scaleMode === 'proper';
      scaleBtn.innerHTML = proper ? '📐 <span style="opacity:.7">Proper</span>' : '🎮 <span style="opacity:.7">Game</span>';
      scaleBtn.classList.toggle('is-on', proper);
      syncSun();
    },
  };
}
