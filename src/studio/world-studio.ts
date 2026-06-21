// src/studio/world-studio.ts
//
// Studio "World Browser" mode (?studio=world): the world-level counterpart to the
// single-object editor in studio.ts. Boots the real default world on the GPU
// renderer with the whole-world connectome overlay, and adds:
//   • a left World Browser panel — pick a config, type/roll a seed, pick a scale
//     preset → the world regenerates live;
//   • drill-down — click a settlement POI to focus it (spotlit), click one of its
//     buildings to focus that, with a breadcrumb to pop back up;
//   • an inspector of the focused node's connectome fields, and at the building
//     level an "Edit in studio ↗" handoff that opens that blueprint in the object
//     editor (?studio=<templateId>).
//
// Read-only over the sim (no entities materialised): the connectome view wants
// terrain + graph, so it needs no asset library / art resolvers.

import type { RenderContext, Camera, GameMap, POI, BuildingInstance } from '@/core/types';
import type { SettlementPlan } from '@/world/settlement-plan';
import type { WorldSeed } from '@/core/types';
import type { ScalePreset } from '@/core/world-style';
import { World } from '@/world/world';
import { WorldManager } from '@/map/world-manager';
import { generateWithNoise } from '@/map/map-generator';
import { planWorldLayout } from '@/world/poi-layout';
import { Autotiler } from '@/map/autotiler';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { initManifoldWasm } from '@/assetgen/geometry/manifold-wasm-browser';
import { createGpuRenderMap } from '@/render/gpu/gpu-renderer';
import { drawWorldConnectome, projectConnectome } from '@/render/connectome-overlay';
import { DEFAULT_LIGHTING } from '@/render/lighting-state';
import { ISO_TILE_W, ISO_TILE_H } from '@/render/iso/iso-constants';
import { injectStudioTheme, COLORS, h } from './theme';
import { layerFlag, type RenderLayer } from '@/render/layer-visibility';
import { TERRAIN_MODES, terrainModeValue, type TerrainModeId } from '@/render/gpu/terrain-field';
import { computeDetailMask, coalescePatches, type DetailPatch } from '@/world/terrain-detail';
import { DETAIL_PATCH_TILES } from '@/render/gpu/detail-field';
import { ParametricBuildingSource } from '@/render/parametric-building-source';
import { ParametricPlantSource } from '@/render/parametric-plant-source';
import type { DevModeState, Entity } from '@/core/types';
import { buildWorldBrowser, type InspectorModel, type CrumbLevel } from './world-browser';
import { type Focus, planForPoi, buildingsOf, planBounds, pickPoi, pickBuilding } from './world-picking';

const HALF_W = ISO_TILE_W / 2;
const HALF_H = ISO_TILE_H / 2;

/** Iso screen extent (pre-camera) of a tile rect, sampling its four corners. */
function tileRectScreen(minTx: number, minTy: number, maxTx: number, maxTy: number): {
  minX: number; maxX: number; minY: number; maxY: number;
} {
  const corners = [[minTx, minTy], [maxTx, minTy], [minTx, maxTy], [maxTx, maxTy]];
  const xs = corners.map(([x, y]) => (x - y) * HALF_W);
  const ys = corners.map(([x, y]) => (x + y) * HALF_H);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/** Fit the camera to a tile-space rect (flat-plane bounds + margin). */
function fitTiles(cam: Camera, minTx: number, minTy: number, maxTx: number, maxTy: number, vw: number, vh: number, margin = 0.86): void {
  const r = tileRectScreen(minTx, minTy, maxTx, maxTy);
  const w = Math.max(1, r.maxX - r.minX), hh = Math.max(1, r.maxY - r.minY);
  const zoom = Math.min(vw / w, vh / hh) * margin;
  cam.zoom = Math.max(0.02, Math.min(8, zoom));
  cam.x = (r.minX + r.maxX) / 2 - (vw / 2) / cam.zoom;
  cam.y = (r.minY + r.maxY) / 2 - (vh / 2) / cam.zoom;
}

export interface StudioHandle { dispose(): void; }
export interface WorldStudioOpts {
  /** Building-level handoff target — invoked by "Edit in studio". When absent, a
   *  full ?studio=<kind> page navigation is used instead. */
  onEdit?: (templateId: string) => void;
}

/** Mount the World Browser into `container`. Returns synchronously with a dispose
 *  handle (async bring-up runs internally and bails cleanly if disposed first). */
export function mountWorldStudio(container: HTMLElement, opts: WorldStudioOpts = {}): StudioHandle {
  let disposed = false;
  let rafId = 0;
  let ro: ResizeObserver | null = null;
  const ac = new AbortController();
  const { signal } = ac;
  const dispose = (): void => { disposed = true; cancelAnimationFrame(rafId); ac.abort(); ro?.disconnect(); };

  void (async () => {
  ensureBuildingTypesRegistered();
  initManifoldWasm();

  container.style.position = 'relative';
  container.style.background = COLORS.bg0;
  injectStudioTheme(container);

  // ── scaffold: [browser | view] ─────────────────────────────────────────────
  const root = document.createElement('div');
  root.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:row;overflow:hidden';
  const panel = document.createElement('div');
  panel.className = 'sg-panel';
  panel.style.cssText = 'flex:0 0 auto;width:288px;border-right:1px solid var(--line);overflow:auto';
  const viewPane = document.createElement('div');
  viewPane.style.cssText = 'position:relative;flex:1 1 auto;min-width:0;overflow:hidden';
  root.append(panel, viewPane);
  container.appendChild(root);

  // WebGPU SCENE canvas (terrain) + a transparent 2D OVERLAY canvas on top (the
  // connectome graph, focus veil, title). The GPU frame builder renders straight to
  // its swap chain — it needs a real on-screen canvas to be visible.
  const sceneCanvas = document.createElement('canvas');
  sceneCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;z-index:0';
  viewPane.appendChild(sceneCanvas);
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab;z-index:1';
  viewPane.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;

  const title = document.createElement('div');
  title.style.cssText =
    'position:absolute;top:10px;left:12px;z-index:5;font:600 12px var(--font-mono);' +
    'color:#e8eef6;background:rgba(10,14,20,.72);border:1px solid rgba(120,170,220,.25);' +
    'padding:5px 9px;border-radius:6px;pointer-events:none';
  title.textContent = 'World connectome — loading…';
  viewPane.appendChild(title);

  // ── world generation params (driven by the browser) ────────────────────────
  const gen = { config: 'default', seed: 0x5109, scale: null as ScalePreset | null };
  let map: GameMap = null as unknown as GameMap;
  let world = new World({ tiles: [], width: 0, height: 0, villages: [], seed: 0, success: false, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as GameMap);
  let visualMap: ReturnType<typeof Autotiler.computeVisualMap> | null = null;
  let wsName = 'default';
  let regenToken = 0;
  let focus: Focus = { level: 'world' };
  let selectedPoi: POI | null = null;          // world-level POI selection (no plan)
  let focusFootprint: { w: number; h: number } | null = null;

  const lighting = { ...DEFAULT_LIGHTING };
  const cam: Camera = { x: 0, y: 0, zoom: 1, dragging: false, lastX: 0, lastY: 0 };

  // ── layer toggles ───────────────────────────────────────────────────────────
  // A partial DevModeState carried into the render context: the terrain pass honors
  // showTerrain/showRoads/showRivers via isLayerHidden (a flag === false hides). The
  // connectome overlay is a separate 2D pass, gated by `showConnectome`. The frame
  // loop reads both by reference every frame, so a toggle applies on the next frame
  // with no manual invalidate.
  const dev: Partial<DevModeState> = {};
  let showConnectome = true;
  let showDetailPatches = false;

  // Adaptive detail-patch regions (coast/river/road/slope), memoised per world —
  // the same importance map the GPU detail pass instances. Drawn as a 2D overlay
  // so they're legible at any zoom, unlike the GPU patches (zoom ≥ 2 only).
  let patchMemo: { map: GameMap; patches: DetailPatch[] } | null = null;
  function detailPatches(): DetailPatch[] {
    if (!map) return [];
    if (patchMemo && patchMemo.map === map) return patchMemo.patches;
    const mask = computeDetailMask(map);
    const patches = coalescePatches(mask, map.width, map.height, DETAIL_PATCH_TILES);
    patchMemo = { map, patches };
    return patches;
  }

  // Parametric art sources for the entity pass — grey lit massing for buildings &
  // trees (img2img is the funded-reseed path, OFF here). peek/warm is the frame-safe
  // contract: peek is the sync read, warm kicks async generation off the frame path.
  const buildingSource = new ParametricBuildingSource();
  const plantSource = new ParametricPlantSource();

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let cssW = 0, cssH = 0;
  function resize(): void {
    const r = viewPane.getBoundingClientRect();
    cssW = Math.max(1, Math.floor(r.width));
    cssH = Math.max(1, Math.floor(r.height));
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    sceneCanvas.width = canvas.width;
    sceneCanvas.height = canvas.height;   // GPU swap chain follows this size
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  ro = new ResizeObserver(resize); ro.observe(viewPane);

  // ── regenerate ──────────────────────────────────────────────────────────────
  async function regenerate(refit = true): Promise<void> {
    const token = ++regenToken;
    title.textContent = `World connectome — regenerating (${gen.config} · seed ${gen.seed.toString(16)})…`;
    const ws: WorldSeed = await WorldManager.loadDefault();
    if (token !== regenToken) return;        // superseded by a newer regen
    if (gen.scale) ws.style = { ...(ws.style ?? {}), scalePreset: gen.scale };
    wsName = ws.name;
    const layout = planWorldLayout(ws);
    ws.size = layout.size;
    ws.pois = layout.pois;
    ws.connections = layout.connections;
    // generateWithNoise returns a world ALREADY populated with building + flora +
    // barrier entities (placeSettlement + biome brushes). Keep it — the entity pass
    // renders those buildings & trees, instead of discarding it for an empty World.
    const { map: m, world: w } = await generateWithNoise(ws.size.width, ws.size.height, gen.seed, ws);
    if (token !== regenToken) return;
    map = m;
    world = w;
    visualMap = Autotiler.computeVisualMap(map);
    focus = { level: 'world' };
    selectedPoi = null;
    focusFootprint = null;
    if (refit) fitTiles(cam, 0, 0, map.width, map.height, cssW, cssH, 0.92);
    browser.refreshControls();
    syncInspector();
    title.textContent = `World connectome — ${wsName} · ${backendLabel}`;
  }

  // ── drill navigation ────────────────────────────────────────────────────────
  function footprintOf(templateId: string): { w: number; h: number } | null {
    try { return synthesizeBlueprint(templateId)?.footprint ?? null; } catch { return null; }
  }
  function drillToSettlement(poi: POI, plan: SettlementPlan): void {
    focus = { level: 'settlement', poiId: poi.id, poi, plan };
    selectedPoi = null;
    focusFootprint = null;
    const b = planBounds(plan);
    fitTiles(cam, b.x - 2, b.y - 2, b.x + b.w + 2, b.y + b.h + 2, cssW, cssH);
    syncInspector();
  }
  function drillToBuilding(b: BuildingInstance, plan: SettlementPlan | null): void {
    focus = { level: 'building', building: b, plan };
    focusFootprint = footprintOf(b.templateId);
    const fw = focusFootprint?.w ?? 2, fh = focusFootprint?.h ?? 2;
    fitTiles(cam, b.tileX - 3, b.tileY - 3, b.tileX + fw + 3, b.tileY + fh + 3, cssW, cssH, 0.78);
    syncInspector();
  }
  function popTo(level: CrumbLevel): void {
    const f = focus;
    if (level === 'world') {
      focus = { level: 'world' };
      selectedPoi = null; focusFootprint = null;
      fitTiles(cam, 0, 0, map.width, map.height, cssW, cssH, 0.92);
    } else if (level === 'settlement' && f.level === 'building' && f.plan) {
      const poi = (map.worldSeed?.pois ?? []).find((p) => p.id === f.plan!.poiId) ?? null;
      drillToSettlement(poi ?? ({ id: f.plan.poiId } as POI), f.plan);
    }
    syncInspector();
  }

  function handleClick(sx: number, sy: number): void {
    if (!map) return;
    const f = focus;
    if (f.level === 'world') {
      const poi = pickPoi(map, cam, sx, sy);
      if (!poi) { selectedPoi = null; syncInspector(); return; }
      const plan = planForPoi(map, poi.id);
      if (plan) drillToSettlement(poi, plan);
      else { selectedPoi = poi; syncInspector(); }
    } else if (f.level === 'settlement') {
      const hit = pickBuilding(buildingsOf(map, f.poiId), map, cam, sx, sy);
      if (hit) drillToBuilding(hit, f.plan);
      else {
        const poi = pickPoi(map, cam, sx, sy);
        if (poi) { const pl = planForPoi(map, poi.id); if (pl) drillToSettlement(poi, pl); }
      }
    } else if (f.level === 'building') {
      // hop between buildings of the same settlement
      const plan = f.plan;
      if (plan) {
        const hit = pickBuilding(buildingsOf(map, plan.poiId), map, cam, sx, sy);
        if (hit && hit.id !== f.building.id) drillToBuilding(hit, plan);
      }
    }
  }

  // ── inspector model ───────────────────────────────────────────────────────
  function syncInspector(): void {
    browser.setInspector(buildInspector());
  }
  function buildInspector(): InspectorModel {
    const f = focus;
    if (f.level === 'settlement') {
      const { poi, plan } = f;
      const builds = buildingsOf(map, f.poiId);
      const b = planBounds(plan);
      return {
        breadcrumb: [{ label: wsName, level: 'world' }, { label: poi?.name ?? poi?.type ?? 'settlement', level: 'settlement' }],
        title: poi?.name ?? poi?.type ?? 'Settlement',
        subtitle: poi?.type,
        rows: [
          ['centre', `${plan.center.x}, ${plan.center.y}`],
          ['extent', `${b.w}×${b.h} tiles`],
          ['lots', String(plan.lots.length)],
          ['wards', plan.wards.length ? plan.wards.map((w) => w.type).join(', ') : '—'],
          ['street edges', String(plan.edges.length)],
          ['civics', plan.civics.length ? plan.civics.map((c) => c.type).join(', ') : '—'],
          ['buildings', String(builds.length)],
          ['importance', poi?.importance ?? '—'],
        ],
        hint: builds.length ? 'click a building to drill in →' : 'no buildings placed in this settlement',
      };
    }
    if (f.level === 'building') {
      const { building, plan } = f;
      const poi = plan ? (map.worldSeed?.pois ?? []).find((p) => p.id === plan.poiId) ?? null : null;
      const crumb: InspectorModel['breadcrumb'] = [{ label: wsName, level: 'world' }];
      if (plan) crumb.push({ label: poi?.name ?? poi?.type ?? 'settlement', level: 'settlement' });
      crumb.push({ label: building.templateId, level: 'building' });
      return {
        breadcrumb: crumb,
        title: building.templateId,
        subtitle: poi?.name ? `in ${poi.name}` : undefined,
        rows: [
          ['id', building.id],
          ['tile', `${building.tileX}, ${building.tileY}`],
          ['footprint', focusFootprint ? `${focusFootprint.w}×${focusFootprint.h}` : '—'],
          ['state', building.state],
        ],
        editTemplateId: building.templateId,
      };
    }
    // world (optionally with a non-settlement POI selected)
    const pois = map?.worldSeed?.pois ?? [];
    const settlements = pois.filter((p) => planForPoi(map, p.id));
    const rows: [string, string][] = [
      ['config', gen.config],
      ['seed', '0x' + (gen.seed >>> 0).toString(16).toUpperCase()],
      ['scale', gen.scale ?? 'natural (default)'],
      ['size', map ? `${map.width}×${map.height}` : '—'],
      ['POIs', String(pois.length)],
      ['settlements', String(settlements.length)],
      ['buildings', String(map?.buildings?.length ?? 0)],
      ['road edges', String(map?.roadGraph?.edges.length ?? 0)],
    ];
    if (selectedPoi) {
      rows.push(['—', '—'], ['selected', selectedPoi.name ?? selectedPoi.type], ['poi type', selectedPoi.type], ['importance', selectedPoi.importance ?? '—']);
    }
    return {
      breadcrumb: [{ label: wsName, level: 'world' }],
      title: wsName,
      subtitle: 'world overview',
      rows,
      hint: 'click a settlement to drill in →',
    };
  }

  // ── left panel ──────────────────────────────────────────────────────────────
  const browser = buildWorldBrowser(panel, {
    configs: () => ['default'],
    getConfig: () => gen.config,
    onConfig: (name) => { gen.config = name; void regenerate(); },
    getSeed: () => gen.seed,
    onSeed: (seed) => { gen.seed = seed >>> 0; void regenerate(); },
    getScale: () => gen.scale,
    onScale: (s) => { gen.scale = s; void regenerate(); },
    onCrumb: (level) => popTo(level),
    onEdit: (templateId) => {
      if (opts.onEdit) { opts.onEdit(templateId); return; }   // in-shell handoff
      const u = new URL(location.href);
      u.searchParams.set('studio', templateId);
      location.href = u.toString();   // standalone: full navigation to the editor
    },
  });

  // ── layers panel ──────────────────────────────────────────────────────────────
  // Toggles for the layers this view actually renders: the terrain pass (terrain +
  // road/river tiles) and the connectome overlay. Entity layers (buildings/flora/
  // npcs) light up once the world view materialises entities — a follow-up.
  const SCENE_LAYERS: { layer: RenderLayer; label: string }[] = [
    { layer: 'terrain', label: 'Terrain' },
    { layer: 'roads', label: 'Roads' },
    { layer: 'rivers', label: 'Rivers' },
    { layer: 'buildings', label: 'Buildings' },
    { layer: 'vegetation', label: 'Trees & flora' },
  ];
  function toggleRow(label: string, on: boolean, onChange: (v: boolean) => void): HTMLElement {
    const cb = h('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
    cb.checked = on;
    cb.style.cssText = 'accent-color:var(--accent);cursor:pointer';
    cb.onchange = () => onChange(cb.checked);
    return h('label', { style: 'display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer;font:400 11px var(--font-mono);color:var(--ink-0)' }, cb, h('span', { text: label }));
  }
  const layersSec = h('div', { style: 'border-top:1px solid var(--line);margin:10px 9px 4px;padding:9px 0 4px' });
  layersSec.appendChild(h('div', { class: 'sg-eyebrow', style: 'margin-bottom:5px', text: 'Layers' }));
  for (const { layer, label } of SCENE_LAYERS) {
    layersSec.appendChild(toggleRow(label, true, (v) => { dev[layerFlag(layer)] = v; }));
  }
  layersSec.appendChild(toggleRow('Connectome', true, (v) => { showConnectome = v; }));
  layersSec.appendChild(toggleRow('Detail patch regions', false, (v) => { showDetailPatches = v; }));
  panel.appendChild(layersSec);

  // ── display: terrain render style ───────────────────────────────────────────
  // The terrain shader's display-mode enum (textured / contour-vector / hypsometric
  // / biome / slope / normals), threaded via dev.terrainMode → the terrain uniform.
  const displaySec = h('div', { style: 'border-top:1px solid var(--line);margin:6px 9px 4px;padding:9px 0 4px' });
  displaySec.appendChild(h('div', { class: 'sg-eyebrow', style: 'margin-bottom:5px', text: 'Terrain style' }));
  const styleSel = document.createElement('select');
  styleSel.style.cssText = 'width:100%;background:var(--bg-1);color:var(--ink-0);border:1px solid var(--line);' +
    'border-radius:5px;padding:4px 6px;font:400 11px var(--font-mono);cursor:pointer';
  for (const m of TERRAIN_MODES) {
    const o = document.createElement('option');
    o.value = m.id; o.textContent = m.label;
    styleSel.appendChild(o);
  }
  styleSel.value = 'textured';
  styleSel.onchange = () => { dev.terrainMode = terrainModeValue(styleSel.value as TerrainModeId); };
  displaySec.appendChild(styleSel);

  // Mesh resolution — the actual GPU terrain grid density. 1:1 = one quad per tile
  // (the game default); 2×/4× subdivide each tile into a finer lattice (bilinear
  // off the per-cell height buffer). Most legible in the Wireframe style.
  displaySec.appendChild(h('div', { class: 'sg-eyebrow', style: 'margin:9px 0 5px', text: 'Mesh resolution' }));
  const resSel = document.createElement('select');
  resSel.style.cssText = styleSel.style.cssText;
  for (const [v, label] of [['1', '1:1 — one quad / tile'], ['2', '2× subdivide'], ['4', '4× subdivide']] as const) {
    const o = document.createElement('option'); o.value = v; o.textContent = label; resSel.appendChild(o);
  }
  resSel.value = '1';
  resSel.onchange = () => { dev.terrainSuper = parseInt(resSel.value, 10) || 1; };
  displaySec.appendChild(resSel);
  const hint = h('div', { style: 'margin-top:6px;font:400 10px var(--font-mono);color:var(--ink-2)', text: 'Pick “Wireframe (mesh)” to see the grid.' });
  displaySec.appendChild(hint);
  panel.appendChild(displaySec);

  // ── pan + zoom + click ──────────────────────────────────────────────────────
  let downX = 0, downY = 0, moved = false;
  canvas.addEventListener('mousedown', (e) => {
    cam.dragging = true; cam.lastX = e.clientX; cam.lastY = e.clientY;
    downX = e.clientX; downY = e.clientY; moved = false;
    canvas.style.cursor = 'grabbing';
  }, { signal });
  window.addEventListener('mouseup', (e) => {
    if (cam.dragging && !moved) {
      const r = viewPane.getBoundingClientRect();
      handleClick(e.clientX - r.left, e.clientY - r.top);
    }
    cam.dragging = false; canvas.style.cursor = 'grab';
  }, { signal });
  window.addEventListener('mousemove', (e) => {
    if (!cam.dragging) return;
    if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 3) moved = true;
    cam.x -= (e.clientX - cam.lastX) / cam.zoom;
    cam.y -= (e.clientY - cam.lastY) / cam.zoom;
    cam.lastX = e.clientX; cam.lastY = e.clientY;
  }, { signal });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = viewPane.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const wx = mx / cam.zoom + cam.x, wy = my / cam.zoom + cam.y;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    cam.zoom = Math.max(0.02, Math.min(8, cam.zoom * factor));
    cam.x = wx - mx / cam.zoom; cam.y = wy - my / cam.zoom;
  }, { passive: false, signal });

  // ── focus highlight overlay ──────────────────────────────────────────────────
  function strokeTilePath(pts: ReadonlyArray<{ x: number; y: number }>, color: string, width: number): void {
    if (pts.length < 2) return;
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const p = projectConnectome(map, pts[i].x, pts[i].y, cam);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }
  function tileDot(tx: number, ty: number, r: number, fill: string, stroke?: string): void {
    const p = projectConnectome(map, tx, ty, cam);
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
  // Outline the adaptive detail-patch blocks (16×16-tile regions the GPU refines
  // around coasts / rivers / roads / steep slopes) as iso quads, so it's obvious
  // where the sub-tile mesh is being spent.
  function drawDetailPatches(): void {
    const patches = detailPatches();
    if (!patches.length) return;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(120,220,160,0.10)';
    ctx.strokeStyle = 'rgba(130,238,176,0.65)';
    for (const p of patches) {
      const a = projectConnectome(map, p.ox, p.oy, cam);
      const b = projectConnectome(map, p.ox + p.w, p.oy, cam);
      const c = projectConnectome(map, p.ox + p.w, p.oy + p.h, cam);
      const d = projectConnectome(map, p.ox, p.oy + p.h, cam);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  function drawFocus(): void {
    const f = focus;
    if (f.level === 'world') {
      if (selectedPoi?.position) tileDot(selectedPoi.position.x, selectedPoi.position.y, 9, 'rgba(255,194,75,0.25)', COLORS.accent);
      return;
    }
    // spotlight veil over the rest of the scene
    ctx.save();
    ctx.fillStyle = 'rgba(8,10,16,0.55)';
    ctx.fillRect(0, 0, cssW, cssH);

    const plan = f.plan;
    if (plan) {
      // lot outlines (faint) then street edges (bright)
      for (const lot of plan.lots) {
        ctx.globalAlpha = 0.4;
        for (let i = 0; i < lot.tiles.length; i++) {
          const t = lot.tiles[i];
          strokeTilePath([t, { x: t.x + 1, y: t.y }, { x: t.x + 1, y: t.y + 1 }, { x: t.x, y: t.y + 1 }, t], 'rgba(150,180,140,0.5)', 1);
        }
      }
      ctx.globalAlpha = 1;
      for (const e of plan.edges) strokeTilePath(e.tiles, e.kind === 'through' ? 'rgba(235,200,120,0.95)' : 'rgba(210,200,180,0.7)', e.kind === 'through' ? 2.5 : 1.5);
      // ward seeds
      for (const w of plan.wards) tileDot(w.seed.x, w.seed.y, 4, 'rgba(120,200,240,0.85)');
      // buildings
      const builds = buildingsOf(map, plan.poiId);
      const focusedId = f.level === 'building' ? f.building.id : null;
      for (const b of builds) {
        const on = b.id === focusedId;
        tileDot(b.tileX, b.tileY, on ? 6 : 3.5, on ? COLORS.accent : 'rgba(255,214,102,0.8)', on ? 'rgba(40,30,10,0.9)' : undefined);
      }
    }
    // focused building footprint box
    if (f.level === 'building' && focusFootprint) {
      const { building: b } = f, { w, h } = focusFootprint;
      strokeTilePath(
        [{ x: b.tileX, y: b.tileY }, { x: b.tileX + w, y: b.tileY }, { x: b.tileX + w, y: b.tileY + h }, { x: b.tileX, y: b.tileY + h }, { x: b.tileX, y: b.tileY }],
        COLORS.accent, 2,
      );
    }
    ctx.restore();
  }

  // ── GPU renderer + frame loop ─────────────────────────────────────────────────
  const { render, backend } = await createGpuRenderMap({ canvas: sceneCanvas });
  if (disposed) return;
  const backendLabel = backend;

  function renderContext(): RenderContext {
    return {
      map, camera: cam, canvasWidth: cssW, canvasHeight: cssH,
      npcs: [], npcSheets: new Map(), treeSheets: new Map(),
      world, lighting, visualMap: visualMap ?? undefined,
      devMode: dev as DevModeState,   // terrain/roads/rivers/buildings/vegetation toggles
      // Parametric art resolvers so the entity pass can draw buildings & trees.
      resolveParametricBuildingArt: (e: Entity) => {
        const s = buildingSource.peek(e); if (s) return s; buildingSource.warm(e); return null;
      },
      resolveParametricPlantArt: (kind: string) => {
        const s = plantSource.peek(kind); if (s) return s; plantSource.warm(kind); return null;
      },
      studioNoChrome: true,   // bare GPU terrain; the connectome overlay is drawn separately
    } as unknown as RenderContext;
  }
  function frame(): void {
    if (disposed) return;
    if (map) {
      const rc = renderContext();
      render(ctx, rc);                       // GPU terrain (entity pass empty)
      if (showConnectome) drawWorldConnectome(ctx, rc);  // full connectome backbone
      if (showDetailPatches) drawDetailPatches();         // adaptive high-res regions
      drawFocus();                           // spotlight + drill highlight
    }
    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);

  // initial world
  await regenerate(true);

  // debug surface
  (window as unknown as { __worldStudio?: unknown }).__worldStudio = {
    regen: (seed?: number, scale?: ScalePreset | null) => { if (seed != null) gen.seed = seed >>> 0; if (scale !== undefined) gen.scale = scale; return regenerate(); },
    focus: () => focus,
    map: () => map,
  };
  })();

  return { dispose };
}
