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

interface ToolbarDeps {
  invalidate: () => void;            // bust geometry/shadow caches (sun moved)
  zoomLabel: (z: number) => string;
  getZoom: () => number;
  zoomIn: () => void;
  zoomOut: () => void;
  openRender: () => void;
  getPrompt: () => string;           // current img2img prompt (for "copy")
  randomize: () => void;             // re-roll seeded params
  subjectInfo: () => string;         // "cottage · 3×2" readout
}
interface ToolbarHandle { el: HTMLElement; refresh: () => void }

const SHADOW_MODES: ShadowMode[] = ['geometry', 'silhouette', 'blob', 'off'];

export function buildToolbar(host: HTMLElement, state: StudioState, deps: ToolbarDeps): ToolbarHandle {
  const bar = h('div', {
    class: 'sg-bar',
    style: 'flex:0 0 auto;display:flex;align-items:center;gap:9px;padding:7px 10px;position:relative;z-index:12',
  });

  // ── brand + live subject readout ──
  const brand = h('div', { style: 'display:flex;align-items:center;gap:8px' },
    h('span', { class: 'sg-accent', style: 'font-size:15px', text: '⬡' }),
    h('span', { class: 'sg-title', style: 'font-size:13px', text: 'RENDER STUDIO' }),
  );
  const subjTag = h('span', { class: 'sg-tag' });
  bar.append(brand, h('span', { class: 'sg-vsep' }), subjTag, h('span', { style: 'flex:1 1 auto' }));

  // ── sun popover (azimuth + elevation) ──
  const sunBtn = h('button', { class: 'sg-btn', title: 'Sun direction', html: '☀ <span style="opacity:.7">Sun</span>' });
  const sunReadout = h('span', { class: 'sg-read', style: 'min-width:0;padding-left:8px' });
  const sliderRow = (label: string, min: number, max: number, get: () => number, set: (v: number) => void) => {
    const val = h('span', { class: 'sg-accent', style: 'min-width:38px;text-align:right' });
    const range = h('input', { class: 'sg-range', style: 'flex:1', attrs: { type: 'range', min: String(min), max: String(max), value: String(get()) } }) as HTMLInputElement;
    const paint = () => { val.textContent = `${get()}°`; };
    range.addEventListener('input', () => { set(Number(range.value)); paint(); });
    range.addEventListener('change', deps.invalidate);
    paint();
    return { row: h('div', { class: 'sg-field', style: 'margin-bottom:10px' }, h('label', { text: label }), h('div', { style: 'display:flex;align-items:center;gap:8px' }, range, val)), sync: () => { range.value = String(get()); paint(); } };
  };
  let syncSun = () => {};
  popover(sunBtn, (body) => {
    body.append(h('div', { class: 'sg-pop-title', text: 'Sun' }));
    const az = sliderRow('Azimuth', 0, 360, () => state.az, (v) => { state.az = v; });
    const el = sliderRow('Elevation', 0, 90, () => state.el, (v) => { state.el = v; });
    body.append(az.row, el.row);
    syncSun = () => { az.sync(); el.sync(); };
  }, { width: 240 });

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
      toggle('Debug overlays (grid + axis)', () => state.overlays, (v) => { state.overlays = v; }),
    );
  }, { width: 240 });

  // ── zoom group + fit toggle ──
  const zoomRead = h('span', { class: 'sg-read' });
  const zoomGroup = h('div', { class: 'sg-group' },
    h('button', { class: 'sg-btn', text: '−', title: 'Zoom out  [', on: { click: () => { deps.zoomOut(); state.fit = false; } } }),
    zoomRead,
    h('button', { class: 'sg-btn', text: '+', title: 'Zoom in  ]', on: { click: () => { deps.zoomIn(); state.fit = false; } } }),
  );
  const fitBtn = h('button', { class: 'sg-btn', html: '⤢ <span style="opacity:.7">Fit</span>', title: 'Fit subject to view  F', on: { click: () => { state.fit = true; } } });

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

  bar.append(sunBtn, sunReadout, dispBtn, h('span', { class: 'sg-vsep' }), zoomGroup, fitBtn, h('span', { class: 'sg-vsep' }), renderBtn, kebab);
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
      zoomRead.textContent = deps.zoomLabel(deps.getZoom());
      sunReadout.textContent = `${state.az}° / ${state.el}°`;
      fitBtn.classList.toggle('is-on', state.fit);
      syncSun();
    },
  };
}
