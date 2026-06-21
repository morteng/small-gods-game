// src/studio/gallery-studio.ts
//
// Studio "Gallery" workspace (?studio=gallery | =arboretum | =buildings): a
// contact-sheet over the asset catalogue. Two display modes share one grid:
//
//   • SHEET (default) — one thumbnail per matching catalogue entry, each at its
//     default variant. Filter by class + free text. This is the "view everything"
//     surface: filter to plants → an ARBORETUM (all 26 flora species), filter to
//     buildings → the BUILDING GALLERY.
//   • MATRIX — pick one building subject + one variant axis (era / wealth / quality
//     / condition / lifecycle stage) → render that subject swept across every value
//     of the axis, side by side, for easy comparison.
//
// Thumbnails reuse the SAME geometry path as the object editor (resolveAsset /
// synthesizeBlueprint → toGeometry → composeStructure → structureResultToPack) and
// are CPU-composited 2D blits of the lit massing — no GPU scene per cell, so the
// sheet scales to hundreds of cells. Rendering is lazy (IntersectionObserver) and
// concurrency-capped, and every composed pack is cached by blueprint JSON so
// re-filtering is instant. Clicking a cell hands the type off to the Object editor.

import type { ResolvedBlueprint, Descriptors, Era } from '@/blueprint/types';
import { assetCatalogue, queryCatalogue, type CatalogueEntry } from '@/blueprint/catalogue';
import { synthesizeBlueprint, resolveAsset } from '@/blueprint/presets';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { ERA_LEVELS } from '@/blueprint/eras';
import { stagesFor } from '@/blueprint/lifecycle';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { composeStructure } from '@/assetgen/compose';
import { structureResultToPack } from '@/render/parametric-building-source';
import type { SpritePack } from '@/render/iso/sprite-canvas';
import { initManifoldWasm } from '@/assetgen/geometry/manifold-wasm-browser';
import { injectStudioTheme, COLORS, h } from './theme';

export interface StudioHandle { dispose(): void; }
export interface GalleryStudioOpts {
  /** Building-level handoff — opens the clicked type in the Object editor. */
  onEdit?: (kind: string) => void;
  /** Initial class filter / preset. 'plant' → arboretum, 'building' → building
   *  gallery, undefined/'all' → everything. */
  filter?: string;
}

type AxisKey = 'era' | 'wealth' | 'quality' | 'condition' | 'stage';
const CLASS_LABEL: Record<string, string> = {
  '': 'All', building: 'Buildings', plant: 'Flora', prop: 'Props', terrain_feature: 'Terrain',
};
const ICON: Record<string, string> = { building: '🏠', prop: '🪧', plant: '🌳', barrier: '🧱', terrain_feature: '⛰' };

// A pleasant fixed 3/4 key light for thumbnails (az -35°, el 56°) — same convention
// as the object editor's sunDir, but constant so cells bake identically.
const SUN: [number, number, number] = (() => {
  const a = (-35 * Math.PI) / 180, e = (56 * Math.PI) / 180;
  const v: [number, number, number] = [-Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
})();

/** Resolve one (type, axis, value) into a concrete blueprint. A null axis → the
 *  default variant (works for buildings AND flora via synthesizeBlueprint); an axis
 *  sweep uses resolveAsset (building-only) and falls back to the default. */
function rbFor(type: string, axis: AxisKey | null, value: string): ResolvedBlueprint | null {
  if (!axis) return synthesizeBlueprint(type) ?? null;
  if (axis === 'era') return resolveAsset({ type, era: value as Era }) ?? synthesizeBlueprint(type) ?? null;
  if (axis === 'stage') return resolveAsset({ type, stage: value }) ?? synthesizeBlueprint(type) ?? null;
  return resolveAsset({ type, descriptors: { [axis]: value } as Descriptors }) ?? synthesizeBlueprint(type) ?? null;
}

/** The values a given catalogue entry supports on an axis (empty ⇒ axis N/A). */
function axisValues(e: CatalogueEntry, axis: AxisKey): readonly string[] {
  if (axis === 'era') return ERA_LEVELS;
  if (axis === 'stage') return stagesFor(e.class);
  return e.descriptorAxes[axis] ?? [];
}

/** Mount the Gallery workspace. Returns synchronously with a dispose handle; the
 *  thumbnail bakes run async and bail cleanly once disposed. */
export function mountGalleryStudio(container: HTMLElement, opts: GalleryStudioOpts = {}): StudioHandle {
  let disposed = false;
  ensureBuildingTypesRegistered();
  initManifoldWasm();

  injectStudioTheme(container);
  container.style.position = 'relative';
  container.style.background = COLORS.bg0;

  const root = h('div', { style: 'position:absolute;inset:0;display:flex;flex-direction:row;overflow:hidden' });
  const panel = h('div', { class: 'sg-panel', style: 'flex:0 0 auto;width:240px;border-right:1px solid var(--line);overflow:auto;padding:9px 10px;font:400 11px/1.4 var(--font-mono);color:var(--ink-0)' });
  const grid = h('div', { style: 'flex:1 1 auto;min-width:0;overflow:auto;padding:14px;align-content:flex-start;display:flex;flex-wrap:wrap;gap:12px' });
  root.append(panel, grid);
  container.appendChild(root);

  const entries = assetCatalogue();
  const byType = new Map(entries.map((e) => [e.type, e]));
  const classes = ['', ...[...new Set(entries.map((e) => e.class))].sort()];

  // ── view state ─────────────────────────────────────────────────────────────
  const initFilter = opts.filter && opts.filter !== 'all' ? opts.filter : '';
  const state = {
    cls: classes.includes(initFilter) ? initFilter : '',
    text: '',
    subject: '' as string,   // '' = sheet of all matches; else a single type
    axis: null as AxisKey | null,
  };

  // ── thumbnail bake: lazy + concurrency-capped + cached by blueprint JSON ─────
  const cache = new Map<string, SpritePack | null>();
  const cellRun = new WeakMap<Element, () => void>();
  let io: IntersectionObserver | null = null;
  let active = 0;
  const jobs: (() => Promise<void>)[] = [];
  function pump(): void {
    while (active < 3 && jobs.length) {
      const job = jobs.shift()!;
      active++;
      void job().finally(() => { active--; pump(); });
    }
  }

  function drawPack(cv: HTMLCanvasElement, pack: SpritePack): void {
    const g = cv.getContext('2d'); if (!g) return;
    g.clearRect(0, 0, cv.width, cv.height);
    g.imageSmoothingEnabled = false;
    const src = pack.albedo, sw = src.width, sh = src.height, pad = 12;
    const s = Math.min((cv.width - pad * 2) / sw, (cv.height - pad * 2) / sh);
    const dw = Math.max(1, Math.round(sw * s)), dh = Math.max(1, Math.round(sh * s));
    g.drawImage(src, Math.round((cv.width - dw) / 2), Math.round(cv.height - pad - dh), dw, dh);
  }
  function drawNote(cv: HTMLCanvasElement, note: string, colour: string): void {
    const g = cv.getContext('2d'); if (!g) return;
    g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = colour; g.font = '12px ui-monospace, monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(note, cv.width / 2, cv.height / 2);
  }

  /** Build one grid cell: a thumbnail canvas + label, lazily baked on scroll-in. */
  function makeCell(type: string, label: string, axis: AxisKey | null, value: string): HTMLElement {
    const cell = h('div', {
      style: 'flex:0 0 auto;width:128px;cursor:pointer;border:1px solid var(--line);border-radius:8px;'
        + 'background:linear-gradient(180deg,#11161f,#0c1017);overflow:hidden;transition:border-color .12s',
      on: {
        click: () => opts.onEdit?.(type),
        mouseenter: () => { cell.style.borderColor = 'rgba(255,194,75,.5)'; },
        mouseleave: () => { cell.style.borderColor = 'var(--line)'; },
      },
    });
    const cv = document.createElement('canvas');
    cv.width = 232; cv.height = 200;
    cv.style.cssText = 'display:block;width:128px;height:110px;image-rendering:pixelated';
    drawNote(cv, '…', '#5b6878');
    const cap = h('div', {
      style: 'padding:5px 7px;border-top:1px solid var(--line);font:600 10px/1.25 var(--font-mono);'
        + 'color:var(--ink-0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis',
      text: label,
    });
    cell.append(cv, cap);

    let started = false;
    cellRun.set(cell, () => {
      if (started || disposed) return; started = true;
      jobs.push(async () => {
        if (disposed) return;
        const rb = rbFor(type, axis, value);
        if (!rb) { drawNote(cv, 'no blueprint', '#c2603a'); return; }
        const key = JSON.stringify(rb);
        let pack = cache.get(key);
        if (pack === undefined) {
          try { pack = structureResultToPack(await composeStructure(toGeometry(rb), SUN)); }
          catch { pack = null; }
          cache.set(key, pack);
        }
        if (disposed) return;
        if (pack) drawPack(cv, pack); else drawNote(cv, '✕ no geometry', '#c2603a');
      });
      pump();
    });
    io?.observe(cell);
    return cell;
  }

  // ── grid build ───────────────────────────────────────────────────────────────
  function renderGrid(): void {
    io?.disconnect();
    io = new IntersectionObserver((obs) => {
      for (const o of obs) if (o.isIntersecting) cellRun.get(o.target)?.();
    }, { root: grid, rootMargin: '300px' });
    grid.replaceChildren();

    if (state.subject && state.axis) {
      // MATRIX: one subject swept across the axis.
      const e = byType.get(state.subject);
      const vals = e ? axisValues(e, state.axis) : [];
      for (const v of vals) grid.appendChild(makeCell(state.subject, v, state.axis, v));
      if (!vals.length) grid.appendChild(noteCard(`${state.subject} has no ${state.axis} axis`));
      return;
    }
    // SHEET: every matching catalogue entry at its default variant.
    const matches = queryCatalogue(entries, { class: state.cls || undefined, text: state.text || undefined });
    for (const e of matches) grid.appendChild(makeCell(e.type, `${ICON[e.class] ?? '•'} ${e.type}`, null, ''));
    if (!matches.length) grid.appendChild(noteCard('no assets match'));
  }
  function noteCard(msg: string): HTMLElement {
    return h('div', { class: 'sg-muted', style: 'padding:20px', text: msg });
  }

  // ── left controls ─────────────────────────────────────────────────────────────
  panel.appendChild(h('div', { class: 'sg-eyebrow', style: 'margin-bottom:7px', text: 'Gallery' }));

  // Class filter chips.
  const chipWrap = h('div', { style: 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:7px' });
  const chips: { v: string; el: HTMLElement }[] = [];
  const paintChips = (): void => { for (const c of chips) c.el.classList.toggle('is-on', state.cls === c.v); };
  for (const c of classes) {
    const el = h('span', {
      class: 'sg-chip', text: CLASS_LABEL[c] ?? c,
      on: { click: () => { state.cls = c; state.subject = ''; state.axis = null; paintChips(); syncSubject(); renderGrid(); } },
    });
    chips.push({ v: c, el }); chipWrap.appendChild(el);
  }
  panel.appendChild(chipWrap);

  // Free-text search (sheet only).
  const search = h('input', { class: 'sg-search', style: 'margin-bottom:9px', attrs: { type: 'search', placeholder: 'search name / tag…' } }) as HTMLInputElement;
  search.oninput = () => { state.text = search.value.trim().toLowerCase(); if (!state.subject) renderGrid(); };
  panel.appendChild(search);

  // Matrix controls: subject + axis. Subject options follow the class/text filter.
  panel.appendChild(h('div', { style: 'border-top:1px solid var(--line);margin:4px 0 7px' }));
  panel.appendChild(h('div', { class: 'sg-eyebrow', style: 'margin-bottom:5px', text: 'Variant matrix' }));
  const subjectSel = h('select', { class: 'sg-select', style: 'width:100%;margin-bottom:5px' }) as HTMLSelectElement;
  const axisSel = h('select', { class: 'sg-select', style: 'width:100%' }) as HTMLSelectElement;
  const axisRow = h('div', {}, axisSel);

  function syncSubject(): void {
    const matches = queryCatalogue(entries, { class: state.cls || undefined, text: state.text || undefined });
    subjectSel.replaceChildren(h('option', { text: '(all — contact sheet)', attrs: { value: '' } }));
    for (const e of matches) {
      const o = h('option', { text: e.type, attrs: { value: e.type } }) as HTMLOptionElement;
      o.selected = e.type === state.subject; subjectSel.appendChild(o);
    }
    if (!matches.some((e) => e.type === state.subject)) state.subject = '';
    syncAxis();
  }
  function syncAxis(): void {
    const e = state.subject ? byType.get(state.subject) : undefined;
    // Variant sweeps are resolveAsset-backed → building/prop only. Flora/terrain are
    // distinct species rows in the sheet, with no era/descriptor axis to sweep.
    const sweepable = !!e && (e.class === 'building' || e.class === 'prop');
    const avail: AxisKey[] = sweepable
      ? (['era', 'wealth', 'quality', 'condition', 'stage'] as AxisKey[]).filter((a) => axisValues(e!, a).length > 1)
      : [];
    axisRow.style.display = avail.length ? 'block' : 'none';
    axisSel.replaceChildren(h('option', { text: 'axis: (single)', attrs: { value: '' } }));
    for (const a of avail) {
      const o = h('option', { text: a, attrs: { value: a } }) as HTMLOptionElement;
      o.selected = a === state.axis; axisSel.appendChild(o);
    }
    if (state.axis && !avail.includes(state.axis)) state.axis = null;
  }
  subjectSel.onchange = () => { state.subject = subjectSel.value; state.axis = null; syncAxis(); renderGrid(); };
  axisSel.onchange = () => { state.axis = (axisSel.value || null) as AxisKey | null; renderGrid(); };
  panel.append(subjectSel, axisRow);

  paintChips();
  syncSubject();
  renderGrid();

  return {
    dispose(): void {
      disposed = true;
      io?.disconnect();
      jobs.length = 0;
    },
  };
}
