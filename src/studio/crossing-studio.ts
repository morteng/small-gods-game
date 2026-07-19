// src/studio/crossing-studio.ts
//
// Studio "Crossings" workspace (?studio=crossings) — the road-wear economy's S0 tuning
// harness (spec §6 + the §10 redirect): ONE stream crossed at the FULL continuum — a
// "natural" band first (stepping stones: rock prims, a property of the WATER, not a store
// tier) then all SEVEN built rungs (log → twin-log → log-rail → plank-walk → timber-beam →
// timber-arch → stone-arch, all from BRIDGE_RECIPES) — PLUS a live SUBJECT crossing driven
// by use/wealth dials and a road-class picker through the REAL `tierForUse` (the exact pure
// function the sim slices wire to later, no forked logic). New in the §10 round:
//   · a STREAM-WIDTH dial — min-viable-structure readout through `minViableTier`/`tierSpans`
//     (a log spans ≤ ~2 tiles; wider demands bents; wider still only high tiers);
//   · a CROSSING-ANGLE dial (0°/22.5°/45°) — the subject re-composes at that yaw via the
//     compose pipeline's whole-model turntable (`ComposeOpts.yaw`), proving a composed
//     crossing sprite carries non-axis bearings;
//   · a VARIETY reroll — a fresh seeded variation (sfc32, shown in the readout) rebuilds the
//     low roundwood rungs through each recipe's `build(seed)`.
// Everything updates in place on input (studio never reloads to refresh); sprites are CPU-
// composited blits cached per (tier, seed, angle), so dial moves cost one canvas redraw.
import { resolveBlueprint } from '@/blueprint/resolve';
import { BRIDGE_RECIPES, bridgeBlueprint } from '@/blueprint/presets/bridges';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { composeStructure, type Part } from '@/assetgen/compose';
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
  CROSSING_EARN_USE, CROSSING_TIER_MAX_SPAN_T, minViableTier, tierSpans,
} from '@/world/road-use';
import { injectStudioTheme, COLORS, h } from './theme';

export interface StudioHandle { dispose(): void; }

// Same fixed 3/4 key light as the Gallery so cells bake identically across workspaces.
const SUN: [number, number, number] = sunDirFromAngles(-35, 56);

const ROW_H = 168;          // one ladder rung's band height (px, css)
const SUBJECT_H = 232;      // the live subject band
const N_TIERS = CROSSING_TIER_RECIPES.length;
const ROWS = N_TIERS + 1;   // + the natural band on top

/** The angle dial's stops (° CCW): axis, half-step, diagonal. */
const ANGLE_STOPS = [0, 22.5, 45] as const;

/** The natural band: stepping stones — 4 irregular flat-ish boulders a stride apart across
 *  the stream (rock prims, stone material), per the crossing-stepping-stones reference. Not
 *  a bridge recipe on purpose: a ford is a property of the water, not a built structure. */
function steppingStonesParts(): Part[] {
  const stones: Array<[number, number, number, number]> = [   // x, y, radius(t), rockSeed
    [0.9, 1.55, 0.40, 3], [1.75, 1.35, 0.30, 7], [2.55, 1.6, 0.46, 11], [3.35, 1.4, 0.33, 17],
  ];
  return stones.map(([x, y, radius, seed]) => ({
    prim: 'rock', center: [x, y] as [number, number], baseZ: -0.12,
    radius, seed, aspect: 0.5, jitter: 0.35, mat: 'stone',
  }));
}

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

  // ── state: the dials ────────────────────────────────────────────────────────
  const state = {
    use: 0.4, wealth: 0.3, cls: 'road' as RoadClass,
    widthT: 3,          // stream width dial (tiles bank→bank; 1 tile = 2 m)
    angleIdx: 0,        // index into ANGLE_STOPS — the subject's compose yaw
    seed: 0,            // variation seed (0 = canonical; reroll steps it, seeded builds)
  };

  // ── sprite cache: composed ONCE per (tier|seed|angle), then blits ───────────
  // The masonry tiers (≥ 4) ignore the variation seed by design, so they cache at seed 0.
  const packCache = new Map<string, SpritePack | null | 'pending'>();
  let fordPack: SpritePack | null | undefined;

  function packFor(tier: number, angleDeg: number): SpritePack | null | undefined {
    const effSeed = tier <= 3 ? state.seed : 0;
    const key = `${tier}|${effSeed}|${angleDeg}`;
    const hit = packCache.get(key);
    if (hit !== undefined) return hit === 'pending' ? undefined : hit;
    packCache.set(key, 'pending');
    void (async () => {
      try {
        const name = `bridge-${CROSSING_TIER_RECIPES[tier]}`;
        const rb = resolveBlueprint([bridgeBlueprint(BRIDGE_RECIPES[CROSSING_TIER_RECIPES[tier]], name, effSeed)], 1);
        const yaw = (angleDeg * Math.PI) / 180;
        const pack = structureResultToPack(await composeStructure(toGeometry(rb), SUN, yaw ? { yaw } : undefined));
        if (disposed) return;
        packCache.set(key, pack);
      } catch {
        packCache.set(key, null);
      }
      redraw();
    })();
    return undefined;
  }

  void (async () => {
    try {
      const pack = structureResultToPack(await composeStructure({ parts: steppingStonesParts() }, SUN));
      if (disposed) return;
      fordPack = pack;
    } catch {
      fordPack = null;
    }
    redraw();
  })();

  // ── the scene: one stream running down the canvas, crossed at every band ────
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let cssW = 0;
  const cssH = ROW_H * ROWS + SUBJECT_H;
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

  function streamHalf(): number {
    return 10 + state.widthT * 11;   // px per side; the width dial visibly widens the water
  }

  function drawStream(): void {
    // ONE stream flowing down the whole scene; every band crosses the SAME water. Deterministic
    // sine meander — no RNG in the studio scene either.
    const cx = cssW * 0.52, half = streamHalf();
    ctx.save();
    for (const [w, col] of [[half + 10, 'rgba(94,132,112,.35)'], [half, '#1c3d52'], [Math.max(6, half - 14), '#245273']] as const) {
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

  function blitPack(pack: SpritePack | null | undefined, cy: number, maxH: number): void {
    const cx = streamXAt(cy);
    if (pack === undefined) { note('composing…', cx, cy, '#5b6878'); return; }
    if (pack === null) { note('✕ no geometry', cx, cy, '#c2603a'); return; }
    const src = pack.albedo!, sw = src.width, sh = src.height; // studio packs are canvas-backed
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
    const tier = tierForUse(state.use, state.cls, state.wealth);
    if (!ctx2d) { syncReadout(tier); return; }
    ctx.clearRect(0, 0, cssW, cssH);
    // Ground + stream.
    ctx.fillStyle = '#182016';
    ctx.fillRect(0, 0, cssW, cssH);
    drawStream();

    ctx.textAlign = 'left'; ctx.textBaseline = 'top';

    // Band 0 — the NATURAL crossing: stepping stones. Not a rung; the ladder's "before".
    ctx.strokeStyle = 'rgba(255,255,255,.07)';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(cssW, 0); ctx.stroke();
    ctx.font = '600 12px ui-monospace, monospace';
    ctx.fillStyle = '#8fb996';
    ctx.fillText('ford / natural — not store-built', 14, 10);
    ctx.font = '400 10px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(143,185,150,.65)';
    ctx.fillText('stepping stones: a property of the water (no crossing entity)', 14, 26);
    blitPack(fordPack, ROW_H / 2 + 8, ROW_H);

    // The seven built rungs, side by side along the stream.
    for (let t = 0; t < N_TIERS; t++) {
      const y0 = (t + 1) * ROW_H;
      ctx.strokeStyle = 'rgba(255,255,255,.07)';
      ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(cssW, y0); ctx.stroke();
      const active = t === tier;
      const spans = tierSpans(t as CrossingTier, state.widthT);
      ctx.font = `${active ? 700 : 600} 12px ui-monospace, monospace`;
      ctx.fillStyle = active ? '#ffc24b' : '#9fb2c8';
      ctx.fillText(`tier ${t} — ${CROSSING_TIER_LABELS[t]}`, 14, y0 + 10);
      ctx.font = '400 10px ui-monospace, monospace';
      ctx.fillStyle = 'rgba(159,178,200,.6)';
      ctx.fillText(`bridge-${CROSSING_TIER_RECIPES[t]} · earn ≥ ${CROSSING_EARN_USE[t].toFixed(2)} · spans ≤ ${CROSSING_TIER_MAX_SPAN_T[t]}t`, 14, y0 + 26);
      if (!spans) {
        ctx.fillStyle = '#c2603a';
        ctx.fillText(`✕ cannot span ${state.widthT}t of water`, 14, y0 + 42);
      } else if (active) {
        ctx.fillStyle = '#ffc24b';
        ctx.fillText('◀ the dials land here', 14, y0 + 42);
      }
      blitPack(packFor(t, 0), y0 + ROW_H / 2 + 8, ROW_H);
    }

    // The SUBJECT band: the same stream, crossed by whatever the dials have earned — composed
    // at the angle dial's bearing (whole-blueprint compose yaw: non-axis crossings, proven).
    const sy = ROW_H * ROWS;
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
    ctx.fillText(`use ${state.use.toFixed(2)} · wealth ${state.wealth.toFixed(2)} · class ${state.cls} · seed ${state.seed}`, 14, sy + 28);
    ctx.fillText(`→ tier ${tier} (${CROSSING_TIER_LABELS[tier]}) @ ${ANGLE_STOPS[state.angleIdx]}°`, 14, sy + 44);
    blitPack(packFor(tier, ANGLE_STOPS[state.angleIdx]), sy + SUBJECT_H / 2 + 20, SUBJECT_H);

    syncReadout(tier);
  }

  // ── left controls: the dials the §4 constants get tuned with ────────────────
  panel.appendChild(h('div', { class: 'sg-eyebrow', style: 'margin-bottom:7px', text: 'Crossings' }));
  panel.appendChild(h('div', { class: 'sg-muted', style: 'margin-bottom:12px',
    text: 'The full continuum: a natural ford, then seven built rungs. The subject band recomputes through tierForUse() as the dials move — the same pure fn the sim wires to.' }));

  const label = (t: string): HTMLElement => h('div', { class: 'sg-muted', style: 'font:600 10px var(--font-mono);letter-spacing:.06em;text-transform:uppercase;margin:10px 0 4px', text: t });

  function dial(name: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string = (v) => v.toFixed(2)): void {
    panel.appendChild(label(name));
    const row = h('div', { style: 'display:flex;align-items:center;gap:8px' });
    const val = h('span', { class: 'sg-accent', style: 'min-width:40px', text: fmt(get()) });
    const slider = h('input', { class: 'sg-range', style: 'flex:1', attrs: { type: 'range', min: String(min), max: String(max), step: String(step), value: String(get()) } }) as HTMLInputElement;
    slider.oninput = () => { set(+slider.value); val.textContent = fmt(get()); redraw(); };
    row.append(slider, val);
    panel.appendChild(row);
  }
  dial('Use (edge use.ema01)', 0, 1, 0.01, () => state.use, (v) => { state.use = v; });
  dial('Wealth (endpoint purse)', 0, 1, 0.01, () => state.wealth, (v) => { state.wealth = v; });

  panel.appendChild(label('Road class (the cap)'));
  const clsSel = h('select', { class: 'sg-select', style: 'width:100%' }) as HTMLSelectElement;
  for (const c of ROAD_CLASS_LADDER) clsSel.appendChild(h('option', { text: `${c} (tier cap ${CLASS_CROSSING_TIER[c]})`, attrs: { value: c } }));
  clsSel.value = state.cls;
  clsSel.onchange = () => { state.cls = clsSel.value as RoadClass; redraw(); };
  panel.appendChild(clsSel);

  dial('Stream width (tiles)', 1, 8, 0.5, () => state.widthT, (v) => { state.widthT = v; }, (v) => `${v}t`);

  panel.appendChild(label('Crossing angle (compose yaw)'));
  const angleRow = h('div', { style: 'display:flex;gap:6px' });
  const angleBtns: HTMLButtonElement[] = [];
  ANGLE_STOPS.forEach((deg, i) => {
    const b = h('button', { class: `sg-btn${i === state.angleIdx ? ' is-on' : ''}`, style: 'flex:1', text: `${deg}°` }) as HTMLButtonElement;
    b.onclick = () => {
      state.angleIdx = i;
      angleBtns.forEach((bb, j) => bb.classList.toggle('is-on', j === i));
      redraw();
    };
    angleBtns.push(b);
    angleRow.appendChild(b);
  });
  panel.appendChild(angleRow);

  panel.appendChild(label('Variety ("the spice")'));
  const rerollBtn = h('button', { class: 'sg-btn', style: 'width:100%', text: 'Reroll variation seed' }) as HTMLButtonElement;
  rerollBtn.onclick = () => { state.seed += 1; redraw(); };
  panel.appendChild(rerollBtn);
  panel.appendChild(h('div', { class: 'sg-muted', style: 'margin-top:4px',
    text: 'Seeded (sfc32) — the low roundwood rungs re-build; seed 0 is the canonical pinned build.' }));

  panel.appendChild(label('Computed'));
  const readout = h('div', { style: 'white-space:pre-wrap;line-height:1.7' });
  panel.appendChild(readout);

  panel.appendChild(label('Thresholds (named constants)'));
  panel.appendChild(h('div', { class: 'sg-muted', style: 'white-space:pre-wrap;line-height:1.7',
    text: CROSSING_EARN_USE.map((u, t) => `earn tier ${t} ≥ ${u.toFixed(3)}`).slice(1).join('\n') +
      `\nLAG ${CROSSING_LAG} · rich buyback ≥ ${RICH_CROSSING_MIN}\n` +
      `class promote pts ${PROMOTE_USE.track}/${PROMOTE_USE.road}/${PROMOTE_USE.highway}` }));

  function syncReadout(tier: CrossingTier): void {
    const rich = state.wealth >= RICH_CROSSING_MIN;
    let earned = 0;
    for (let t = 1; t < CROSSING_EARN_USE.length; t++) if (state.use >= CROSSING_EARN_USE[t]) earned = t;
    const minV = minViableTier(state.widthT);
    const viable = CROSSING_TIER_MAX_SPAN_T
      .map((_, t) => t)
      .filter((t) => tierSpans(t as CrossingTier, state.widthT));
    readout.textContent =
      `earned rung   ${earned}\n` +
      `class cap     ${CLASS_CROSSING_TIER[state.cls]} (${state.cls})\n` +
      `lag           ${rich ? `0 (rich ≥ ${RICH_CROSSING_MIN})` : String(CROSSING_LAG)}\n` +
      `tier          ${tier} — ${CROSSING_TIER_LABELS[tier]}\n` +
      `seed          ${state.seed}\n` +
      `── width ${state.widthT}t (${state.widthT * 2} m) ──\n` +
      `min viable    ${minV === null ? 'NONE — a ferry, not a bridge' : `tier ${minV} (${CROSSING_TIER_LABELS[minV]})`}\n` +
      `can span      ${viable.length ? viable.join(', ') : 'none'}\n` +
      (tierSpans(tier, state.widthT) ? '' : `⚠ earned tier ${tier} cannot span this water`);
  }

  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(viewPane);

  // Scripting hook (studio-only, mirrors __gallery/__siteStudio).
  (window as unknown as { __crossings?: unknown }).__crossings = {
    set(use?: number, wealth?: number, cls?: RoadClass, widthT?: number, angleDeg?: number, seed?: number): CrossingTier {
      if (use !== undefined) state.use = use;
      if (wealth !== undefined) state.wealth = wealth;
      if (cls !== undefined) state.cls = cls;
      if (widthT !== undefined) state.widthT = widthT;
      if (angleDeg !== undefined) {
        const i = ANGLE_STOPS.findIndex((a) => a === angleDeg);
        if (i >= 0) state.angleIdx = i;
      }
      if (seed !== undefined) state.seed = seed;
      redraw();
      return tierForUse(state.use, state.cls, state.wealth);
    },
    reroll(): number { state.seed += 1; redraw(); return state.seed; },
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
