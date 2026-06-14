// src/studio/control-panel.ts
// Control panel (object select + sun sliders + shadow/zoom/toggles + render).
// Moved out of studio.ts (pure refactor).
import type { ShadowMode } from '@/render/lighting-state';
import { BUILDING_BLUEPRINTS, isPlantPreset } from '@/blueprint/presets';
import type { StudioState } from './types';

// ── control panel ────────────────────────────────────────────────────────────
interface PanelDeps {
  setSubject: (k: string) => void;
  invalidate: () => void;
  zoomLabel: (z: number) => string;
  getZoom: () => number;
  zoomIn: () => void;
  zoomOut: () => void;
  openRender: () => void;
}
interface PanelHandle { refresh: () => void; }

export function buildPanel(host: HTMLElement, state: StudioState, deps: PanelDeps): PanelHandle {
  const { setSubject, invalidate, zoomLabel, getZoom, zoomIn, zoomOut, openRender } = deps;
  const panel = document.createElement('div');
  panel.style.cssText = [
    'position:absolute', 'top:12px', 'right:12px', 'width:230px', 'padding:10px 12px',
    'background:rgba(20,20,32,0.92)', 'border:1px solid #3a3a52', 'border-radius:8px',
    'font:12px monospace', 'color:#cfe', 'z-index:10', 'user-select:none',
  ].join(';');

  const kinds = Object.keys(BUILDING_BLUEPRINTS).sort((a, b) => {
    const ca = isPlantPreset(a) ? 0 : 1, cb = isPlantPreset(b) ? 0 : 1;
    return ca - cb || a.localeCompare(b);
  });

  const row = (label: string, el: HTMLElement): HTMLElement => {
    const d = document.createElement('div');
    d.style.cssText = 'margin:6px 0;display:flex;flex-direction:column;gap:3px';
    const l = document.createElement('label'); l.textContent = label; l.style.opacity = '0.75';
    d.append(l, el); return d;
  };

  const sel = document.createElement('select');
  sel.style.cssText = 'width:100%;background:#11111a;color:#cfe;border:1px solid #3a3a52;padding:3px';
  for (const k of kinds) {
    const o = document.createElement('option'); o.value = k;
    o.textContent = (isPlantPreset(k) ? '🌳 ' : '🏠 ') + k; o.selected = k === state.kind;
    sel.appendChild(o);
  }
  sel.onchange = () => { setSubject(sel.value); };

  const slider = (min: number, max: number, val: number, set: (v: number) => void): HTMLInputElement => {
    const s = document.createElement('input');
    s.type = 'range'; s.min = String(min); s.max = String(max); s.value = String(val); s.style.width = '100%';
    s.oninput = () => set(Number(s.value));
    return s;
  };

  const azLabel = document.createElement('span');
  const elLabel = document.createElement('span');
  const setAz = (v: number) => { state.az = v; azLabel.textContent = ` ${v}°`; };
  const setEl = (v: number) => { state.el = v; elLabel.textContent = ` ${v}°`; };
  setAz(state.az); setEl(state.el);

  const shadowSel = document.createElement('select');
  shadowSel.style.cssText = sel.style.cssText;
  for (const m of ['geometry', 'silhouette', 'blob', 'off'] as ShadowMode[]) {
    const o = document.createElement('option'); o.value = m; o.textContent = m;
    o.selected = (state.lighting.shadowMode ?? 'geometry') === m; shadowSel.appendChild(o);
  }
  shadowSel.onchange = () => { state.lighting.shadowMode = shadowSel.value as ShadowMode; };

  const lightChk = document.createElement('input'); lightChk.type = 'checkbox'; lightChk.checked = state.lighting.enabled;
  lightChk.onchange = () => { state.lighting.enabled = lightChk.checked; };
  const ovChk = document.createElement('input'); ovChk.type = 'checkbox'; ovChk.checked = state.overlays;
  ovChk.onchange = () => { state.overlays = ovChk.checked; };
  const fitChk = document.createElement('input'); fitChk.type = 'checkbox'; fitChk.checked = state.fit;
  fitChk.onchange = () => { state.fit = fitChk.checked; };

  const btn = (t: string, on: () => void): HTMLButtonElement => {
    const b = document.createElement('button'); b.textContent = t;
    b.style.cssText = 'background:#21213a;color:#cfe;border:1px solid #3a3a52;border-radius:4px;padding:2px 9px;cursor:pointer;font:12px monospace';
    b.onclick = on; return b;
  };
  const zoomRead = document.createElement('span');
  zoomRead.style.cssText = 'flex:1 1 auto;text-align:center';
  const zoomCtl = document.createElement('div');
  zoomCtl.style.cssText = 'display:flex;gap:6px;align-items:center';
  zoomCtl.append(
    btn('−', () => { zoomOut(); fitChk.checked = false; }),
    zoomRead,
    btn('+', () => { zoomIn(); fitChk.checked = false; }),
  );

  const azS = slider(0, 360, state.az, setAz); azS.addEventListener('change', invalidate);
  const elS = slider(0, 90, state.el, setEl); elS.addEventListener('change', invalidate);
  const azWrap = document.createElement('div'); azWrap.append(azS, azLabel);
  const elWrap = document.createElement('div'); elWrap.append(elS, elLabel);
  const toggles = document.createElement('div');
  toggles.style.cssText = 'display:flex;gap:14px;margin-top:4px';
  const mk = (c: HTMLInputElement, t: string) => { const w = document.createElement('label'); w.style.cssText = 'display:flex;gap:5px;align-items:center'; w.append(c, document.createTextNode(t)); return w; };
  toggles.append(mk(lightChk, 'lighting'), mk(ovChk, 'overlays'), mk(fitChk, 'fit'));

  const renderBtn = btn('🎨 Render via OpenRouter', openRender);
  renderBtn.style.cssText += ';width:100%;margin-top:8px;padding:6px;color:#ffd35a';

  const title = document.createElement('div');
  title.textContent = '🎬 Render Studio';
  title.style.cssText = 'font-weight:bold;margin-bottom:6px;color:#ffd35a';

  panel.append(title, row('object', sel), row('sun azimuth', azWrap), row('sun elevation', elWrap),
    row('shadow mode', shadowSel), row('zoom', zoomCtl), toggles, renderBtn);
  host.appendChild(panel);

  return {
    refresh: () => {
      zoomRead.textContent = `${zoomLabel(getZoom())}${state.fit ? '  (fit)' : ''}`;
      if (fitChk.checked !== state.fit) fitChk.checked = state.fit;
    },
  };
}
