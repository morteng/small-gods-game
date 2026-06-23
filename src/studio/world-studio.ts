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
import { drawWorldConnectome, drawWaterNetwork, projectConnectome, screenToTileApprox } from '@/render/connectome-overlay';
import { getWaterNetwork, getWaterConnectome } from '@/world/water-network-store';
import { serializeCompact } from '@/world/connectome/world-node';
import { applyNodeMoves } from '@/terrain/water-network-edits';
import type { WaterNetwork } from '@/terrain/river-network';
import { computePressure, type PressureReport } from '@/world/connectome/pressure';
import { waterPressureItems } from '@/world/connectome/water-nodes';
import { buildRiverDeformationsFromNetwork } from '@/world/river-deformation';
import { getWorldDeformationStore } from '@/world/road-deformation';
import { summarizeNetwork } from '@/terrain/river-network';
import { WaterDynamics, DEFAULT_WEATHER, type WeatherParams } from '@/render/gpu/water-dynamics';
import { buildFloodWatch, type FloodWatch } from '@/world/flood-watch';
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

  // Top MENU BAR — spans the view, holds the title + the dropdown controls (Layers /
  // Terrain / Weather), so the left panel is free for the world browser + inspector.
  const menuBar = document.createElement('div');
  menuBar.style.cssText =
    'position:absolute;top:0;left:0;right:0;height:40px;z-index:10;display:flex;align-items:center;' +
    'gap:8px;padding:0 10px;background:linear-gradient(180deg,rgba(10,14,20,.92),rgba(10,14,20,.78));' +
    'border-bottom:1px solid var(--line);backdrop-filter:blur(6px)';
  viewPane.appendChild(menuBar);

  const title = document.createElement('div');
  title.style.cssText = 'font:600 12px var(--font-mono);color:#e8eef6;white-space:nowrap;' +
    'overflow:hidden;text-overflow:ellipsis;max-width:40%';
  title.textContent = 'World connectome — loading…';
  menuBar.appendChild(title);
  menuBar.appendChild(h('div', { style: 'flex:1 1 auto' }));   // spacer → controls right-align

  // Single-open dropdown menus anchored in the bar. Each is a button + a popover that
  // drops below it; opening one closes the others, and an outside click closes all.
  const MENUBTN_CSS = 'display:flex;align-items:center;gap:5px;background:var(--bg-1);color:var(--ink-0);' +
    'border:1px solid var(--line);border-radius:6px;padding:5px 10px;font:500 11px var(--font-mono);cursor:pointer;white-space:nowrap';
  const dropdowns: { pop: HTMLElement; btn: HTMLButtonElement }[] = [];
  function closeDropdowns(except?: HTMLElement): void {
    for (const d of dropdowns) if (d.pop !== except) { d.pop.style.display = 'none'; d.btn.style.borderColor = 'var(--line)'; }
  }
  function dropdown(label: string, content: HTMLElement): HTMLElement {
    const wrap = h('div', { style: 'position:relative' });
    const btn = h('button', { text: label }) as HTMLButtonElement;
    btn.style.cssText = MENUBTN_CSS;
    const pop = h('div', {
      style: 'position:absolute;top:calc(100% + 6px);right:0;min-width:248px;max-height:74vh;overflow:auto;' +
        'background:rgba(16,20,28,.98);border:1px solid var(--line);border-radius:9px;padding:9px 11px;' +
        'z-index:30;display:none;box-shadow:0 10px 30px rgba(0,0,0,.5)',
    });
    pop.appendChild(content);
    pop.addEventListener('click', (e) => e.stopPropagation());
    btn.onclick = (e) => {
      e.stopPropagation();
      const open = pop.style.display !== 'none';
      closeDropdowns();
      pop.style.display = open ? 'none' : 'block';
      btn.style.borderColor = open ? 'var(--line)' : 'var(--accent)';
    };
    wrap.append(btn, pop);
    dropdowns.push({ pop, btn });
    return wrap;
  }
  window.addEventListener('click', () => closeDropdowns(), { signal });

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
  let showWaterNet = false;   // the water connectome (river-network graph) overlay
  // Water EDIT mode: drag nodes to move features in real time; pressure shows crowding.
  let waterEdit = false;
  let showPressure = true;            // ring impinging features (advisory) while editing
  const nodeMoves = new Map<string, { x: number; y: number }>();  // the live edit overlay
  let draggingNode: string | null = null;

  // Climate W-B — localized real-time water + humidity (rain on one spot raises the
  // basin it drains into + the air there). Rebuilt per world in regenerate().
  let waterDyn: WaterDynamics | null = null;
  const weather: WeatherParams = { ...DEFAULT_WEATHER };
  let floodWatch: FloodWatch | null = null;
  const floodEventLog: string[] = [];   // recent place-flood edges, newest last
  let rainBrush = false;
  let floodBrush = false;
  let floodRadius = 8;     // tiles
  let floodDepthM = 2.0;   // metres of standing water laid per click
  // Which scalar field the overlay draws (W-B humidity, W-C cloud/temperature).
  let overlay: 'none' | 'humidity' | 'cloud' | 'temp' = 'humidity';
  let lastStepT = (typeof performance !== 'undefined' ? performance.now() : 0);

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
    waterDyn = new WaterDynamics(map);   // fresh climate state for the new world
    // W-F: watch the placed POIs for flooding (the "important places" Fate cares about).
    floodWatch = buildFloodWatch(
      (map.worldSeed?.pois ?? [])
        .filter((p) => p.position)
        .map((p) => ({ id: p.id, name: p.name ?? p.id, x: p.position!.x, y: p.position!.y, radius: 3 })),
      map.width, map.height,
    );
    floodEventLog.length = 0;
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
    // Rain brush intercepts the click: deposit a cloudburst at the cursor tile.
    if (rainBrush && waterDyn) {
      const { tx, ty } = screenToTileApprox(map, sx, sy, cam);
      waterDyn.rain(tx, ty, weather);
      return;
    }
    // Flood brush: lay a sheet of standing water on the ground at the cursor (W-E).
    if (floodBrush && waterDyn) {
      const { tx, ty } = screenToTileApprox(map, sx, sy, cam);
      waterDyn.floodArea(tx, ty, floodRadius, floodDepthM);
      return;
    }
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
  // Sea & lakes ride a dedicated flag (not the RenderLayer enum) so the bathymetry
  // / lake beds can be revealed without touching the river ribbons.
  const waterRow = toggleRow('Sea & lakes', true, (v) => { dev.showWater = v; });
  function toggleRow(label: string, on: boolean, onChange: (v: boolean) => void): HTMLElement {
    const cb = h('input', { attrs: { type: 'checkbox' } }) as HTMLInputElement;
    cb.checked = on;
    cb.style.cssText = 'accent-color:var(--accent);cursor:pointer';
    cb.onchange = () => onChange(cb.checked);
    return h('label', { style: 'display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer;font:400 11px var(--font-mono);color:var(--ink-0)' }, cb, h('span', { text: label }));
  }
  const layersSec = h('div', { style: 'min-width:200px' });
  for (const { layer, label } of SCENE_LAYERS) {
    layersSec.appendChild(toggleRow(label, true, (v) => { dev[layerFlag(layer)] = v; }));
    if (layer === 'rivers') layersSec.appendChild(waterRow);   // group water with rivers
  }
  layersSec.appendChild(toggleRow('Connectome', true, (v) => { showConnectome = v; }));
  layersSec.appendChild(toggleRow('Water connectome', false, (v) => { showWaterNet = v; }));
  layersSec.appendChild(toggleRow('Detail patch regions', false, (v) => { showDetailPatches = v; }));
  // Water EDIT: drag river/lake nodes to move features live; pressure rings show crowding.
  layersSec.appendChild(toggleRow('✥ Edit water — drag nodes', false, (v) => {
    waterEdit = v;
    canvas.style.cursor = v ? 'crosshair' : 'grab';
  }));
  layersSec.appendChild(toggleRow('   ↳ show pressure (crowding)', true, (v) => { showPressure = v; }));
  menuBar.appendChild(dropdown('◴ Layers ▾', layersSec));

  // ── display: terrain render style ───────────────────────────────────────────
  // The terrain shader's display-mode enum (textured / contour-vector / hypsometric
  // / biome / slope / normals), threaded via dev.terrainMode → the terrain uniform.
  const displaySec = h('div', { style: 'min-width:210px' });
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
  menuBar.appendChild(dropdown('⛰ Terrain ▾', displaySec));

  // ── weather: emergent climate params (climate W-B) ───────────────────────────
  // Localized real-time water: rain a basin's catchment → it fills + the air wets,
  // then evaporates back. Every knob is live on `weather`; the basin offset is read
  // by reference into the water field, so changes show next frame.
  function sliderRow(
    label: string, min: number, max: number, step: number, get: () => number,
    set: (v: number) => void, fmt: (v: number) => string,
  ): HTMLElement {
    const val = h('span', { style: 'margin-left:auto;color:var(--ink-1);font:400 10px var(--font-mono)', text: fmt(get()) });
    const head = h('div', { style: 'display:flex;align-items:center;gap:6px;font:400 11px var(--font-mono);color:var(--ink-0)' }, h('span', { text: label }), val);
    const sl = h('input', { attrs: { type: 'range', min: String(min), max: String(max), step: String(step) } }) as HTMLInputElement;
    sl.value = String(get());
    sl.style.cssText = 'width:100%;accent-color:var(--accent);cursor:pointer;margin:2px 0 4px';
    sl.oninput = () => { const v = parseFloat(sl.value); set(v); val.textContent = fmt(v); };
    return h('div', { style: 'padding:2px 0' }, head, sl);
  }
  function btn(label: string, onClick: () => void): HTMLElement {
    const b = h('button', { text: label }) as HTMLButtonElement;
    b.style.cssText = 'flex:1;background:var(--bg-1);color:var(--ink-0);border:1px solid var(--line);' +
      'border-radius:5px;padding:5px 6px;font:400 10px var(--font-mono);cursor:pointer';
    b.onclick = onClick;
    return b;
  }
  // A row of mutually-exclusive pills (the overlay selector).
  function pillRow(label: string, opts: { id: typeof overlay; label: string }[], get: () => typeof overlay, set: (v: typeof overlay) => void): HTMLElement {
    const pills: HTMLButtonElement[] = [];
    const sync = () => pills.forEach((b) => {
      const on = b.dataset.id === get();
      b.style.background = on ? 'var(--accent)' : 'var(--bg-1)';
      b.style.color = on ? '#1a1206' : 'var(--ink-1)';
    });
    const row = h('div', { style: 'display:flex;align-items:center;gap:5px;padding:3px 0' },
      h('span', { style: 'font:400 11px var(--font-mono);color:var(--ink-0);min-width:54px', text: label }));
    for (const o of opts) {
      const b = h('button', { text: o.label, attrs: { 'data-id': o.id } }) as HTMLButtonElement;
      b.dataset.id = o.id;
      b.style.cssText = 'flex:1;border:1px solid var(--line);border-radius:5px;padding:4px 5px;font:400 10px var(--font-mono);cursor:pointer';
      b.onclick = () => { set(o.id); sync(); };
      pills.push(b); row.appendChild(b);
    }
    sync();
    return row;
  }

  const weatherSec = h('div', { style: 'min-width:248px' });
  // ── W-C: emergent weather ──
  weatherSec.appendChild(toggleRow('⛅ Live weather (wind · clouds · storms)', false, (v) => { weather.autoWeather = v; }));
  weatherSec.appendChild(sliderRow('Wind dir', 0, 360, 5, () => weather.windDirDeg, (v) => { weather.windDirDeg = v; }, (v) => `${v | 0}°`));
  weatherSec.appendChild(sliderRow('Wind speed', 0, 20, 0.5, () => weather.windSpeed, (v) => { weather.windSpeed = v; }, (v) => `${v.toFixed(1)} t/s`));
  weatherSec.appendChild(sliderRow('Evaporation', 0, 0.2, 0.005, () => weather.evapRate, (v) => { weather.evapRate = v; }, (v) => v.toFixed(3)));
  weatherSec.appendChild(sliderRow('Orographic rain', 0, 2, 0.05, () => weather.orographicGain, (v) => { weather.orographicGain = v; }, (v) => v.toFixed(2)));
  weatherSec.appendChild(sliderRow('Diurnal swing', 0, 0.25, 0.01, () => weather.diurnalAmp, (v) => { weather.diurnalAmp = v; }, (v) => v.toFixed(2)));
  weatherSec.appendChild(pillRow('Overlay', [
    { id: 'humidity', label: 'Humid' }, { id: 'cloud', label: 'Cloud' }, { id: 'temp', label: 'Temp' }, { id: 'none', label: 'Off' },
  ], () => overlay, (v) => { overlay = v; }));
  const wbtns = h('div', { style: 'display:flex;gap:5px;margin:5px 0 3px' },
    btn('☁ Seed clouds', () => { waterDyn?.seedClouds(0.7); }),
    btn('⤒ Raise lake', () => { waterDyn?.shiftLargest(2.0); }),
    btn('☀ Drought', () => { waterDyn?.shiftLargest(-2.0); }),
    btn('Reset', () => { waterDyn?.reset(); floodWatch?.reset(); floodEventLog.length = 0; }),
  );
  weatherSec.appendChild(wbtns);
  // ── W-E: flood brush — lay standing water on the ground (a god flooding a plain) ──
  const floodToggle = toggleRow('🌊 Flood brush — click the map', false, (v) => {
    floodBrush = v;
    if (v) { rainBrush = false; rainCb.checked = false; }
    canvas.style.cursor = v ? 'crosshair' : 'grab';
  });
  const floodCb = floodToggle.querySelector('input') as HTMLInputElement;
  weatherSec.appendChild(floodToggle);
  weatherSec.appendChild(sliderRow('Flood depth', 0.5, 10, 0.5, () => floodDepthM, (v) => { floodDepthM = v; }, (v) => `${v.toFixed(1)} m`));
  weatherSec.appendChild(sliderRow('Flood size', 2, 30, 1, () => floodRadius, (v) => { floodRadius = v; }, (v) => `${v | 0} t`));
  // ── W-B: manual rain brush ──
  const rainToggle = toggleRow('💧 Rain brush — click the map', false, (v) => {
    rainBrush = v;
    if (v) { floodBrush = false; floodCb.checked = false; }
    canvas.style.cursor = v ? 'crosshair' : 'grab';
  });
  const rainCb = rainToggle.querySelector('input') as HTMLInputElement;
  weatherSec.appendChild(rainToggle);
  weatherSec.appendChild(sliderRow('Brush rain', 100, 4000, 50, () => weather.rainMm, (v) => { weather.rainMm = v; }, (v) => `${v | 0} mm`));
  weatherSec.appendChild(sliderRow('Brush size', 1, 20, 1, () => weather.brushRadius, (v) => { weather.brushRadius = v; }, (v) => `${v | 0} t`));
  weatherSec.appendChild(sliderRow('Runoff', 0, 1, 0.05, () => weather.runoffFrac, (v) => { weather.runoffFrac = v; }, (v) => `${(v * 100) | 0}%`));
  const weatherReadout = h('div', { style: 'margin-top:4px;font:400 10px var(--font-mono);color:var(--ink-2)', text: '—' });
  weatherSec.appendChild(weatherReadout);
  menuBar.appendChild(dropdown('☁ Weather ▾', weatherSec));

  // ── water connectome editing (drag nodes to move features in real time) ───────
  // The base network re-derives from the seed; `nodeMoves` is a pure overlay applied
  // on top, so the edited graph (and its re-routed reaches) is recomputed each frame.
  function editedWaterNet(): WaterNetwork | undefined {
    if (!map) return undefined;
    return applyNodeMoves(getWaterNetwork(map), nodeMoves);
  }
  function waterPressure(net: WaterNetwork | undefined): PressureReport | undefined {
    return net ? computePressure(waterPressureItems(net)) : undefined;
  }
  /** Nearest water node/lake id to a CSS-pixel cursor, within `tol` px (else null). */
  function pickWaterNode(net: WaterNetwork, sx: number, sy: number, tol = 12): string | null {
    if (!map) return null;
    let best: string | null = null, bestD = tol * tol;
    const test = (id: string, tx: number, ty: number): void => {
      const p = projectConnectome(map!, tx, ty, cam);
      const d = (p.x - sx) ** 2 + (p.y - sy) ** 2;
      if (d < bestD) { bestD = d; best = id; }
    };
    for (const n of net.nodes) test(n.id, n.x + 0.5, n.y + 0.5);
    for (const l of net.lakes) test(l.id, l.x + 0.5, l.y + 0.5);
    return best;
  }
  /** Re-carve terrain from the edited network (drop time): swap the river:incision
   *  deformations for ones derived from the moved graph, then refresh the GPU terrain. */
  function recarveFromEdits(): void {
    if (!map || nodeMoves.size === 0) return;
    const edited = applyNodeMoves(getWaterNetwork(map), nodeMoves);
    const store = getWorldDeformationStore(map);
    store.removeSource('river:incision');
    store.add(...buildRiverDeformationsFromNetwork(map, edited));
    // The store's version bump re-keys getComposedHeightfield → new buffer → terrain re-uploads.
  }

  // ── pan + zoom + click ──────────────────────────────────────────────────────
  let downX = 0, downY = 0, moved = false;
  canvas.addEventListener('mousedown', (e) => {
    // In edit mode, grab the nearest water node instead of panning.
    if (waterEdit && map) {
      const r = viewPane.getBoundingClientRect();
      const hit = pickWaterNode(editedWaterNet()!, e.clientX - r.left, e.clientY - r.top);
      if (hit) { draggingNode = hit; canvas.style.cursor = 'grabbing'; return; }
    }
    cam.dragging = true; cam.lastX = e.clientX; cam.lastY = e.clientY;
    downX = e.clientX; downY = e.clientY; moved = false;
    canvas.style.cursor = 'grabbing';
  }, { signal });
  window.addEventListener('mouseup', (e) => {
    if (draggingNode) {                       // finished a node drag → re-carve terrain
      draggingNode = null;
      canvas.style.cursor = waterEdit ? 'crosshair' : 'grab';
      recarveFromEdits();
      return;
    }
    if (cam.dragging && !moved) {
      const r = viewPane.getBoundingClientRect();
      handleClick(e.clientX - r.left, e.clientY - r.top);
    }
    cam.dragging = false; canvas.style.cursor = waterEdit ? 'crosshair' : 'grab';
  }, { signal });
  window.addEventListener('mousemove', (e) => {
    if (draggingNode && map) {                 // live-move the grabbed node
      const r = viewPane.getBoundingClientRect();
      const { tx, ty } = screenToTileApprox(map, e.clientX - r.left, e.clientY - r.top, cam);
      nodeMoves.set(draggingNode, { x: tx - 0.5, y: ty - 0.5 });  // node coords (centre = x+0.5)
      return;
    }
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

  // Air-humidity heat overlay — cyan iso-diamonds over cells the rain wetted, alpha
  // by moisture. Hot path (humidity can spread to thousands of cells), so it projects
  // INLINE (no per-cell `projectConnectome`, which allocates a style object ×4/cell),
  // ignores terrain lift (a flat overlay), culls offscreen, and batches every cell
  // into ONE of 4 alpha buckets → 4 fills total, not one fillStyle change per cell.
  const HUMIDITY_FLOOR = 0.04;
  const HUM_BUCKETS = 4;
  const HUM_BUDGET = 8000;     // max diamonds drawn — the field stride-samples past this
  // RGB per overlay bucket b (0..HUM_BUCKETS-1) — humidity/cloud are mono ramps,
  // temperature is a cold-blue → hot-red diverging ramp.
  function overlayColor(mode: 'humidity' | 'cloud' | 'temp', b: number, n: number): string {
    const a = Math.min(0.5, 0.12 + b * (0.42 / n));
    if (mode === 'cloud')  return `rgba(235,238,245,${a})`;   // overcast white
    if (mode === 'temp') { const t = b / (n - 1); return `rgba(${(40 + t * 200) | 0},${(90 + (0.5 - Math.abs(t - 0.5)) * 200) | 0},${(235 - t * 200) | 0},${a})`; }
    return `rgba(90,200,235,${a})`;                            // humidity cyan
  }

  // Draw a per-cell scalar field (0..1) as alpha-bucketed iso diamonds. Counts then
  // strides to ≤ HUM_BUDGET diamonds (a smooth field downsamples cleanly) so cost is
  // bounded however far the field has spread; projects INLINE (no per-cell allocs —
  // the W-B perf lesson). `temp` is always full-grid so it skips the floor.
  function drawScalarField(field: Float32Array, mode: 'humidity' | 'cloud' | 'temp'): void {
    const W = map.width, H = map.height;
    const floor = mode === 'temp' ? -1 : HUMIDITY_FLOOR;
    let count = 0;
    for (let i = 0; i < field.length; i++) if (field[i] > floor) count++;
    if (count === 0) return;
    const stride = Math.max(1, Math.ceil(Math.sqrt(count / HUM_BUDGET)));
    const HW = ISO_TILE_W / 2, HH = ISO_TILE_H / 2, z = cam.zoom;
    const dx = HW * z * stride, dy = HH * z * stride;
    const paths = Array.from({ length: HUM_BUCKETS }, () => new Path2D());
    for (let y = 0; y < H; y += stride) {
      const row = y * W;
      for (let x = 0; x < W; x += stride) {
        const v = field[row + x];
        if (v <= floor) continue;
        const cx = ((x - y) * HW - cam.x) * z;
        const cy = ((x + y) * HH - cam.y) * z;
        if (cx < -dx || cx > cssW + dx || cy < -dy || cy > cssH + dy) continue;   // cull
        const p = paths[Math.min(HUM_BUCKETS - 1, (v * HUM_BUCKETS) | 0)];
        p.moveTo(cx, cy - dy); p.lineTo(cx + dx, cy); p.lineTo(cx, cy + dy); p.lineTo(cx - dx, cy); p.closePath();
      }
    }
    ctx.save();
    for (let b = 0; b < HUM_BUCKETS; b++) { ctx.fillStyle = overlayColor(mode, b, HUM_BUCKETS); ctx.fill(paths[b]); }
    ctx.restore();
  }

  function drawOverlay(): void {
    const wd = waterDyn;
    if (!wd || overlay === 'none') return;
    if (overlay === 'humidity') drawScalarField(wd.humidity, 'humidity');
    else if (overlay === 'cloud') drawScalarField(wd.cloud, 'cloud');
    else if (overlay === 'temp')  drawScalarField(wd.temp, 'temp');
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
      lakeOffsetM: waterDyn?.lakeOffsetM(),   // localized lake level (climate W-B)
      floodOffsetM: waterDyn?.floodOffsetM(), // per-cell standing water (W-E flood)
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
    // Step the climate fields on the wall clock (pure render-time, never the sim
    // clock) — capped so a backgrounded tab doesn't dump a huge dt into evaporation.
    const now = (typeof performance !== 'undefined' ? performance.now() : lastStepT + 16);
    const dt = Math.min(0.1, Math.max(0, (now - lastStepT) / 1000));
    lastStepT = now;
    if (waterDyn) {
      waterDyn.step(dt, weather);
      // W-F: detect places that just flooded / dried and log the edges (the events
      // that will surface onto the command bus → Fate in W-H).
      if (floodWatch) {
        for (const ev of floodWatch.poll(waterDyn.floodOffsetM())) {
          const msg = ev.type === 'flooded'
            ? `🌊 ${ev.name} is flooding (${ev.depthM.toFixed(1)} m)`
            : `🏜 ${ev.name} has dried out`;
          floodEventLog.push(msg);
          if (floodEventLog.length > 6) floodEventLog.shift();
          // eslint-disable-next-line no-console
          console.log('[flood]', msg);
        }
      }
      const lvl = waterDyn.maxLevelM();
      const base = waterDyn.bodyCount === 0
        ? 'no lakes — runoff drains to sea'
        : `lakes ${waterDyn.bodyCount} · peak level ${lvl >= 0 ? '+' : ''}${lvl.toFixed(2)} m · humidity ${(waterDyn.maxHumidity() * 100) | 0}%`;
      const flood = waterDyn.maxFloodM();
      const floodStr = flood > 0 ? ` · flood ${flood.toFixed(1)} m` : '';
      const lastEv = floodEventLog.length > 0 ? ` — ${floodEventLog[floodEventLog.length - 1]}` : '';
      weatherReadout.textContent = (weather.autoWeather
        ? `${base} · cloud ${(waterDyn.maxCloud() * 100) | 0}% · day ${(waterDyn.timeOfDay() * 100) | 0}%`
        : base) + floodStr + lastEv;
    }
    if (map) {
      const rc = renderContext();
      render(ctx, rc);                       // GPU terrain (entity pass empty)
      if (showConnectome) drawWorldConnectome(ctx, rc);  // full connectome backbone
      if (showWaterNet || waterEdit) {                    // water connectome (river graph)
        const edited = editedWaterNet();
        drawWaterNetwork(ctx, rc, {
          net: edited,
          pressure: waterEdit && showPressure ? waterPressure(edited) : undefined,
        });
      }
      if (showDetailPatches) drawDetailPatches();         // adaptive high-res regions
      drawOverlay();                          // humidity / cloud / temperature field
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
    // Climate W-B handles: rain a basin's catchment + read the field state.
    rain: (tx: number, ty: number) => waterDyn?.rain(tx, ty, weather),
    // W-E: flood a plain — lay standing water of `depthM` over a disc of `radius` tiles.
    flood: (tx: number, ty: number, radius = 8, depthM = 2) => waterDyn?.floodArea(tx, ty, radius, depthM),
    // W-F: place-level flood edges (which important places are under water).
    floodEvents: () => floodEventLog.slice(),
    floodedPlaces: () => floodWatch?.floodedPlaceIds() ?? [],
    weather: () => weather,
    dyn: () => waterDyn && ({
      bodies: waterDyn.bodyCount, levelM: waterDyn.maxLevelM(), floodM: waterDyn.maxFloodM(),
      humidity: waterDyn.maxHumidity(), cloud: waterDyn.maxCloud(), timeOfDay: waterDyn.timeOfDay(),
    }),
    // W-C handles: drive the emergent atmosphere + pick the overlay.
    storm: (on = true) => { weather.autoWeather = on; },
    seedClouds: (a?: number) => waterDyn?.seedClouds(a),
    setOverlay: (m: 'none' | 'humidity' | 'cloud' | 'temp') => { overlay = m; },
    // Water connectome: toggle the overlay + read the graph / its spectrum tally.
    waterNet: (on?: boolean) => { if (on !== undefined) showWaterNet = on; return showWaterNet; },
    waterNetwork: () => (map ? getWaterNetwork(map) : null),
    waterSummary: () => (map ? summarizeNetwork(getWaterNetwork(map)) : null),
    // The water sub-connectome lifted into WorldNode form (what Fate / agents read).
    waterConnectome: () => (map ? serializeCompact(getWaterConnectome(map)) : null),
    // Water EDITING surface (drag-to-move + advisory pressure) — also the agent seam.
    waterEdit: (on?: boolean) => { if (on !== undefined) { waterEdit = on; canvas.style.cursor = on ? 'crosshair' : 'grab'; } return waterEdit; },
    moveWaterNode: (id: string, x: number, y: number) => { nodeMoves.set(id, { x, y }); recarveFromEdits(); return editedWaterNet(); },
    clearWaterEdits: () => { nodeMoves.clear(); recarveFromEdits(); },
    // Advisory crowding report on the (edited) network: pairs ranked worst-first + per-node totals.
    waterPressure: () => {
      const rep = waterPressure(editedWaterNet());
      if (!rep) return null;
      return { maxPressure: rep.maxPressure, pairs: rep.pairs.slice(0, 12), crowded: [...rep.perItem.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12) };
    },
    // View helpers (for headed iteration): frame the whole map, toggle the backbone,
    // set terrain style, read/poke the camera.
    fitAll: () => { if (map) fitTiles(cam, 0, 0, map.width, map.height, cssW, cssH, 0.94); },
    cam: () => ({ x: cam.x, y: cam.y, zoom: cam.zoom }),
    connectome: (on?: boolean) => { if (on !== undefined) showConnectome = on; return showConnectome; },
    terrainMode: (id: TerrainModeId) => { dev.terrainMode = terrainModeValue(id); },
  };
  })();

  return { dispose };
}
