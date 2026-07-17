// src/studio/crossing-studio.ts
//
// Studio "Crossings" workspace (?studio=crossings) — the road-wear economy's S0 tuning
// harness (spec §6): ONE stream, crossed side by side at ALL FIVE crossing tiers
// (log → log-plank → timber-beam → timber-arch → stone-arch, all from BRIDGE_RECIPES via
// synthesizeBlueprint), PLUS a live SUBJECT crossing driven by a use dial + a wealth dial
// (and a road-class picker) whose tier recomputes through the REAL `tierForUse` — the exact
// pure function the sim slices wire to later, no forked logic. Everything updates in place
// on input (studio never reloads to refresh); sprites are CPU-composited blits like the
// Gallery (composeStructure once per tier, cached), so dial moves cost one canvas redraw.
import { synthesizeBlueprint } from '@/blueprint/presets';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { composeStructure } from '@/assetgen/compose';
import { structureResultToPack } from '@/render/parametric-building-source';
import type { SpritePack } from '@/render/iso/sprite-canvas';
import { initManifoldWasm } from '@/assetgen/geometry/manifold-wasm-browser';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { sunDirFromAngles } from '@/render/solar';
import type { RoadClass } from '@/world/road-graph';
import {
  tierForUse, type CrossingTier,
  CROSSING_TIER_RECIPES, CROSSING_TIER_LABELS, CLASS_CROSSING_TIER,
  ROAD_CLASS_LADDER, PROMOTE_USE, RICH_CROSSING_MIN, CROSSING_LAG,
} from '@/world/road-use';
import { injectStudioTheme, COLORS, h } from './theme';

export interface StudioHandle { dispose(): void; }

// Same fixed 3/4 key light as the Gallery so cells bake identically across workspaces.
const SUN: [number, number, number] = sunDirFromAngles(-35, 56);

const ROW_H = 168;          // one ladder rung's band height (px, css)
const SUBJECT_H = 208;      // the live subject band

export function mountCrossingStudio(container: HTMLElement): StudioHandle {
  let disposed = false;
  ensureBuildingTypesRegistered();
  initManifoldWasm();

  injectStudioTheme(container);
  container.style.position = 'relative';
  container.style.background = COLORS.bg0;

  const root = h('div', { style: 'position:absolute;inset:0;display:flex;flex-direction:row;overflow:hidden' });
  const panel = h('div', { class: 'sg-panel', style: 'flex:0 0 auto;width:264px;border-right:1px solid var(--line);overflow:auto;padding:12px;font:400 11px/1.5 var(--font-mono);color:var(--ink-0)' });
  const viewPane = h('div', { style: 'position:relative;flex:1 1 auto;min-width:0;overflow:auto' });
  root.append(panel, viewPane);
  container.appendChild(root);

  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  viewPane.appendChild(canvas);
  const ctx2d = canvas.getContext('2d');   // null-tolerant (headless/jsdom): dials still work
  const ctx = ctx2d as CanvasRenderingContext2D;

  // ── state: the two dials + the class picker ────────────────────────────────
  const state = { use: 0.4, wealth: 0.3, cls: 'road' as RoadClass };

  // ── tier sprites: composed ONCE per tier, then every redraw is a cached blit ─
  const packs: (SpritePack | null | undefined)[] = CROSSING_TIER_RECIPES.map(() => undefined);
  for (let t = 0; t < CROSSING_TIER_RECIPES.length; t++) {
    void (async () => {
      try {
        const rb = synthesizeBlueprint(`bridge-${CROSSING_TIER_RECIPES[t]}`);
        if (!rb) { packs[t] = null; return; }
        const pack = structureResultToPack(await composeStructure(toGeometry(rb), SUN));
        if (disposed) return;
        packs[t] = pack;
      } catch {
        packs[t] = null;
      }
      redraw();
    })();
  }

  // ── the scene: one stream running down the canvas, crossed at every tier ────
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let cssW = 0;
  const cssH = ROW_H * CROSSING_TIER_RECIPES.length + SUBJECT_H;
  function resize(): void {
    const r = viewPane.getBoundingClientRect();
    cssW = Math.max(320, Math.floor(r.width));
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    ctx2d?.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw();
  }

  function drawStream(): void {
    // ONE stream flowing down the whole scene; every rung crosses the SAME water. Deterministic
    // sine meander — no RNG in the studio either.
    const cx = cssW * 0.52, half = 42;
    ctx.save();
    for (const [w, col] of [[half + 10, 'rgba(94,132,112,.35)'], [half, '#1c3d52'], [half - 14, '#245273']] as const) {
      ctx.beginPath();
      for (let y = 0; y <= cssH; y += 8) {
        const x = cx + Math.sin(y * 0.011) * 26 + Math.sin(y * 0.031 + 2) * 9;
        if (y === 0) ctx.moveTo(x - w, y); else ctx.lineTo(x - w, y);
      }
      for (let y = cssH; y >= 0; y -= 8) {
        const x = cx + Math.sin(y * 0.011) * 26 + Math.sin(y * 0.031 + 2) * 9;
        ctx.lineTo(x + w, y);
      }
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
    }
    ctx.restore();
  }

  function streamXAt(y: number): number {
    return cssW * 0.52 + Math.sin(y * 0.011) * 26 + Math.sin(y * 0.031 + 2) * 9;
  }

  function blitPack(tier: number, cy: number, maxH: number): void {
    const pack = packs[tier];
    const cx = streamXAt(cy);
    if (pack === undefined) { note('composing…', cx, cy, '#5b6878'); return; }
    if (pack === null) { note('✕ no geometry', cx, cy, '#c2603a'); return; }
    const src = pack.albedo, sw = src.width, sh = src.height;
    // 1:1-friendly integer-ish scale, capped so the stone arch doesn't dwarf its band.
    const s = Math.min(1, (maxH - 18) / sh, (cssW * 0.5) / sw);
    const dw = Math.max(1, Math.round(sw * s)), dh = Math.max(1, Math.round(sh * s));
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, Math.round(cx - dw / 2), Math.round(cy - dh / 2), dw, dh);
  }
  function note(msg: string, x: number, y: number, col: string): void {
    ctx.fillStyle = col;
    ctx.font = '12px ui-monospace, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(msg, x, y);
  }

  function redraw(): void {
    if (disposed || !cssW) return;
    if (!ctx2d) { syncReadout(tierForUse(state.use, state.cls, state.wealth)); return; }
    ctx.clearRect(0, 0, cssW, cssH);
    // Ground + stream.
    ctx.fillStyle = '#182016';
    ctx.fillRect(0, 0, cssW, cssH);
    drawStream();

    const tier = tierForUse(state.use, state.cls, state.wealth);

    // The five rungs, side by side along the stream (tier 0 at the top).
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    for (let t = 0; t < CROSSING_TIER_RECIPES.length; t++) {
      const y0 = t * ROW_H;
      ctx.strokeStyle = 'rgba(255,255,255,.07)';
      ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(cssW, y0); ctx.stroke();
      const active = t === tier;
      ctx.font = `${active ? 700 : 600} 12px ui-monospace, monospace`;
      ctx.fillStyle = active ? '#ffc24b' : '#9fb2c8';
      ctx.fillText(`tier ${t} — ${CROSSING_TIER_LABELS[t]}`, 14, y0 + 10);
      ctx.font = '400 10px ui-monospace, monospace';
      ctx.fillStyle = 'rgba(159,178,200,.6)';
      ctx.fillText(`bridge-${CROSSING_TIER_RECIPES[t]}`, 14, y0 + 26);
      if (active) { ctx.fillStyle = '#ffc24b'; ctx.fillText('◀ the dials land here', 14, y0 + 42); }
      blitPack(t, y0 + ROW_H / 2 + 8, ROW_H);
    }

    // The SUBJECT band: the same stream, crossed by whatever the dials have earned.
    const sy = ROW_H * CROSSING_TIER_RECIPES.length;
    ctx.fillStyle = 'rgba(255,194,75,.06)';
    ctx.fillRect(0, sy, cssW, SUBJECT_H);
    ctx.strokeStyle = 'rgba(255,194,75,.45)';
    ctx.strokeRect(0.5, sy + 0.5, cssW - 1, SUBJECT_H - 1);
    ctx.font = '700 12px ui-monospace, monospace';
    ctx.fillStyle = '#ffc24b';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('SUBJECT crossing (live)', 14, sy + 10);
    ctx.font = '400 11px ui-monospace, monospace';
    ctx.fillStyle = '#c9d6e6';
    ctx.fillText(`use ${state.use.toFixed(2)} · wealth ${state.wealth.toFixed(2)} · class ${state.cls}`, 14, sy + 28);
    ctx.fillText(`→ tier ${tier} (${CROSSING_TIER_LABELS[tier]})`, 14, sy + 44);
    blitPack(tier, sy + SUBJECT_H / 2 + 16, SUBJECT_H);

    syncReadout(tier);
  }

  // ── left controls: the dials the §4 constants get tuned with ────────────────
  panel.appendChild(h('div', { class: 'sg-eyebrow', style: 'margin-bottom:7px', text: 'Crossings' }));
  panel.appendChild(h('div', { class: 'sg-muted', style: 'margin-bottom:12px',
    text: 'One stream, five crossing tiers. The subject band recomputes through tierForUse() as the dials move — the same pure fn the sim wires to.' }));

  const label = (t: string): HTMLElement => h('div', { class: 'sg-muted', style: 'font:600 10px var(--font-mono);letter-spacing:.06em;text-transform:uppercase;margin:10px 0 4px', text: t });

  function dial(name: string, get: () => number, set: (v: number) => void): void {
    panel.appendChild(label(name));
    const row = h('div', { style: 'display:flex;align-items:center;gap:8px' });
    const val = h('span', { class: 'sg-accent', style: 'min-width:40px', text: get().toFixed(2) });
    const slider = h('input', { class: 'sg-range', style: 'flex:1', attrs: { type: 'range', min: '0', max: '1', step: '0.01', value: String(get()) } }) as HTMLInputElement;
    slider.oninput = () => { set(+slider.value); val.textContent = get().toFixed(2); redraw(); };
    row.append(slider, val);
    panel.appendChild(row);
  }
  dial('Use (edge use.ema01)', () => state.use, (v) => { state.use = v; });
  dial('Wealth (endpoint purse)', () => state.wealth, (v) => { state.wealth = v; });

  panel.appendChild(label('Road class (the cap)'));
  const clsSel = h('select', { class: 'sg-select', style: 'width:100%' }) as HTMLSelectElement;
  for (const c of ROAD_CLASS_LADDER) clsSel.appendChild(h('option', { text: `${c} (tier cap ${CLASS_CROSSING_TIER[c]})`, attrs: { value: c } }));
  clsSel.value = state.cls;
  clsSel.onchange = () => { state.cls = clsSel.value as RoadClass; redraw(); };
  panel.appendChild(clsSel);

  panel.appendChild(label('Computed'));
  const readout = h('div', { style: 'white-space:pre-wrap;line-height:1.7' });
  panel.appendChild(readout);

  panel.appendChild(label('Thresholds (named constants)'));
  panel.appendChild(h('div', { class: 'sg-muted', style: 'white-space:pre-wrap;line-height:1.7',
    text: `earn tier 2 ≥ ${PROMOTE_USE.track}\nearn tier 3 ≥ ${PROMOTE_USE.road}\nearn tier 4 ≥ ${PROMOTE_USE.highway}\nLAG ${CROSSING_LAG} · rich buyback ≥ ${RICH_CROSSING_MIN}` }));

  function syncReadout(tier: CrossingTier): void {
    const rich = state.wealth >= RICH_CROSSING_MIN;
    const earned = state.use >= PROMOTE_USE.highway ? 4 : state.use >= PROMOTE_USE.road ? 3 : state.use >= PROMOTE_USE.track ? 2 : 1;
    readout.textContent =
      `earned rung  ${earned}\n` +
      `class cap    ${CLASS_CROSSING_TIER[state.cls]} (${state.cls})\n` +
      `lag          ${rich ? `0 (rich ≥ ${RICH_CROSSING_MIN})` : String(CROSSING_LAG)}\n` +
      `tier         ${tier} — ${CROSSING_TIER_LABELS[tier]}`;
  }

  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(viewPane);

  // Scripting hook (studio-only, mirrors __gallery/__siteStudio).
  (window as unknown as { __crossings?: unknown }).__crossings = {
    set(use?: number, wealth?: number, cls?: RoadClass): CrossingTier {
      if (use !== undefined) state.use = use;
      if (wealth !== undefined) state.wealth = wealth;
      if (cls !== undefined) state.cls = cls;
      redraw();
      return tierForUse(state.use, state.cls, state.wealth);
    },
    grab: () => canvas.toDataURL('image/png'),
  };

  return {
    dispose(): void {
      disposed = true;
      ro.disconnect();
      delete (window as unknown as { __crossings?: unknown }).__crossings;
    },
  };
}
