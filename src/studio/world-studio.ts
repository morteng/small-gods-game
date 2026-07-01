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
import { type ScalePreset } from '@/core/world-style';
import { World } from '@/world/world';
import { WorldManager } from '@/map/world-manager';
import { generateWithNoise } from '@/map/map-generator';
import { planWorldLayout } from '@/world/poi-layout';
import { Autotiler } from '@/map/autotiler';
import { synthesizeBlueprint } from '@/blueprint/presets';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { initManifoldWasm } from '@/assetgen/geometry/manifold-wasm-browser';
import { createGpuRenderMap } from '@/render/gpu/gpu-renderer';
import { drawWorldConnectome, drawWaterNetwork, projectConnectome, screenToTileLifted } from '@/render/connectome-overlay';
import { drawMountAnchorOverlay } from '@/render/mount-anchor-overlay';
import { getWaterNetwork, getWaterConnectome } from '@/world/water-network-store';
import { serializeCompact } from '@/world/connectome/world-node';
import { applyNodeMoves, mergeWaterFeatures, addLakeBody, type LakeStamp } from '@/terrain/water-network-edits';
import type { WaterNetwork } from '@/terrain/river-network';
import { tileReadout } from './world-hover';
import { buildRenderWaterTypeMemo } from '@/render/gpu/render-water-mask';
import {
  getRiverChannelGeometry, buildRiverChannelGeometry, type RiverChannelGeometry,
} from '@/render/gpu/river-channel-geometry';
import { paintedWaterAt as paintedWaterAtFn } from '@/render/gpu/water-field';
import { buildConnectomeWaterOverride } from '@/render/gpu/connectome-water';
import type { ConnectomeWaterOverride } from '@/core/types';
import { computePressure, type PressureReport } from '@/world/connectome/pressure';
import { evaluateConnectome, type Diagnostic } from '@/world/connectome-diagnostics';
import { waterPressureItems, suggestWaterResolutions } from '@/world/connectome/water-nodes';
import { buildRiverDeformationsFromNetwork } from '@/world/river-deformation';
import { buildLakeConformDeformations, LAKE_BASIN_SOURCE, LAKE_OUTLET_SOURCE } from '@/world/lake-conform';
import { getWorldDeformationStore } from '@/world/road-deformation';
import { summarizeNetwork, affectedWaterCells } from '@/terrain/river-network';
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
import { buildWorldBrowser, type InspectorModel, type CrumbLevel, type InspectorField, type InspectorAction } from './world-browser';
import { type Focus, planForPoi, buildingsOf, planBounds, pickPoi, pickBuilding } from './world-picking';
import { emptyEdits, hasEdits, countEdits, applyEditsToSeed, makeAddedPoi, type PoiEdits } from './world-node-edits';
import { ERAS, type Era } from '@/core/era';

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
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;cursor:default;z-index:1';
  viewPane.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;

  // ── per-pixel hover readout (DIR-C) — a floating inspector that follows the
  // cursor and reports everything the world knows about the tile/feature under it.
  const hoverPanel = document.createElement('div');
  hoverPanel.style.cssText =
    'position:absolute;z-index:20;display:none;pointer-events:none;min-width:120px;max-width:260px;' +
    'background:rgba(12,16,22,.94);border:1px solid var(--line);border-radius:7px;padding:7px 9px;' +
    'font:400 11px var(--font-mono);color:var(--ink-0);box-shadow:0 6px 20px rgba(0,0,0,.45);backdrop-filter:blur(4px)';
  viewPane.appendChild(hoverPanel);

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
  let showMountAnchors = false;  // building mount sockets (sign/lamp/perch dots, by role)
  let showWaterNet = false;   // the water connectome (river-network graph) overlay
  // Water EDIT mode: drag nodes to move features in real time; pressure shows crowding.
  let waterEdit = false;
  let showPressure = true;            // ring impinging features (advisory) while editing
  let conformTerrain = false;         // DIR-A: lakes adjust the ground to hold water + drain
  const nodeMoves = new Map<string, { x: number; y: number }>();  // the live edit overlay
  const mergeOps: Array<[string, string]> = [];   // join ops (keepId, dropId), replayed in order
  let draggingNode: string | null = null;
  // A selected water feature (node/lake id) — outlines its directly + indirectly
  // (downstream) affected tiles. Cleared when another object is selected.
  let selectedWater: string | null = null;

  // ── NODE EDIT (settlement POIs) ──────────────────────────────────────────────
  // A pristine, final-coordinate snapshot of the generated world's seed (POIs already
  // shifted by planWorldLayout). Node edits apply against THIS and regenerate in place
  // via generateWithNoise — which reads worldSeed.pois directly and never re-runs the
  // layout, so no re-centring jump. Refreshed on every fresh (seed/scale) regen.
  let baseSeed: WorldSeed | null = null;
  const poiEdits: PoiEdits = emptyEdits();
  let nodeEdit = false;                 // drag-settlements mode (mirrors water edit)
  let addNodeBrush = false;             // click land to drop a new settlement
  let draggingPoi: string | null = null;
  let livePoiPos: { id: string; x: number; y: number } | null = null;   // live drag overlay
  let addedCounter = 0;

  // ── hover inspection + selection (DIR-C) — the feature under the cursor ────────
  type HoverHighlight =
    | { kind: 'tile'; tx: number; ty: number }
    | { kind: 'node'; tx: number; ty: number }
    | { kind: 'rect'; x: number; y: number; w: number; h: number };
  // What a hit RESOLVES to — so a click can select the same thing the hover found.
  type SelTarget =
    | { kind: 'water'; id: string }
    | { kind: 'poi'; poi: POI }
    | { kind: 'building'; building: BuildingInstance; plan: SettlementPlan | null }
    | { kind: 'tile' };
  interface Hit { title: string; rows: [string, string][]; hi: HoverHighlight; sel: SelTarget; }
  let hover: Hit | null = null;
  let selected: Hit | null = null;   // the pinned selection (any node / building / tile)

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
  // DIR-A: place a NEW lake by clicking the map — a stamped still-water body the
  // connectome adopts and the terrain conform carves a basin + outlet for.
  let placeLakeBrush = false;
  let lakeRadius = 4;      // tiles
  const addedLakes: LakeStamp[] = [];   // author-placed lakes (overlay on the base net)
  let waterEditVersion = 0;             // bumps each connectome edit → busts render water caches
  let overrideMemo: { version: number; override: ConnectomeWaterOverride } | null = null;
  // Analytic river-channel geometry for the EDITED network, memoised by edit version so
  // idle frames hand the renderer a stable reference (the GPU upload guard skips); a
  // drag bumps the version → re-projects the smooth river silhouette in real time.
  let channelMemo: { version: number; geo: RiverChannelGeometry } | null = null;
  // Which scalar field the overlay draws (W-B humidity, W-C cloud/temperature).
  let overlay: 'none' | 'humidity' | 'cloud' | 'temp' = 'humidity';
  let lastStepT = (typeof performance !== 'undefined' ? performance.now() : 0);

  // Adaptive detail-patch regions (coast/river/road/slope), memoised per world —
  // the same importance map the GPU detail pass instances. Drawn as a 2D overlay
  // so they're legible at any zoom, unlike the GPU patches (zoom ≥ 2 only).
  let patchMemo: { map: GameMap; version: number; patches: DetailPatch[] } | null = null;
  function detailPatches(): DetailPatch[] {
    if (!map) return [];
    if (patchMemo && patchMemo.map === map && patchMemo.version === waterEditVersion) return patchMemo.patches;
    // Same render classification the GPU detail pass keys off — incl. author-placed lakes.
    const mask = computeDetailMask(map, { waterType: connectomeWaterOverride()?.waterType });
    const patches = coalescePatches(mask, map.width, map.height, DETAIL_PATCH_TILES);
    patchMemo = { map, version: waterEditVersion, patches };
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
    // Snapshot the final-coordinate seed as the NODE-EDIT base, and clear any staged
    // edits — a fresh (seed/scale) world starts from a clean slate. Edits then apply
    // against this base via regenerateFromEdits() with no re-layout jump.
    baseSeed = structuredClone(ws);
    poiEdits.moved.clear(); poiEdits.params.clear(); poiEdits.removed.clear(); poiEdits.added.length = 0;
    livePoiPos = null; draggingPoi = null;
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
    refreshDiagnostics();   // re-lint the freshly-generated world (#30)
    title.textContent = `World connectome — ${wsName} · ${backendLabel}`;
  }

  // Regenerate IN PLACE from the node-edit overlay: fold moved/retuned/added/removed
  // POIs into the base seed and re-run generateWithNoise at the SAME size + seed (no
  // planWorldLayout → stable coordinates, no camera refit). Used by drag-drop, param
  // chips, add/remove — anything that mutates `poiEdits`.
  async function regenerateFromEdits(): Promise<void> {
    if (!baseSeed) { void regenerate(); return; }
    const token = ++regenToken;
    const n = countEdits(poiEdits);
    title.textContent = `World connectome — ${wsName} · editing (${n} node ${n === 1 ? 'edit' : 'edits'})…`;
    const editedWs = applyEditsToSeed(baseSeed, poiEdits);
    const { map: m, world: w } = await generateWithNoise(baseSeed.size!.width, baseSeed.size!.height, gen.seed, editedWs);
    if (token !== regenToken) return;
    map = m; world = w;
    waterDyn = new WaterDynamics(map);
    floodWatch = buildFloodWatch(
      (map.worldSeed?.pois ?? []).filter((p) => p.position)
        .map((p) => ({ id: p.id, name: p.name ?? p.id, x: p.position!.x, y: p.position!.y, radius: 3 })),
      map.width, map.height,
    );
    floodEventLog.length = 0;
    visualMap = Autotiler.computeVisualMap(map);
    // Keep the current focus/selection where it still resolves; refresh the inspector.
    if (focus.level === 'settlement' && !planForPoi(map, focus.poiId)) { focus = { level: 'world' }; selectedPoi = null; }
    browser.refreshControls();
    syncInspector();
    refreshDiagnostics();
    title.textContent = `World connectome — ${wsName} · ${backendLabel}${hasEdits(poiEdits) ? ` · ${n} node ${n === 1 ? 'edit' : 'edits'}` : ''}`;
  }

  // ── drill navigation ────────────────────────────────────────────────────────
  function footprintOf(templateId: string): { w: number; h: number } | null {
    try { return synthesizeBlueprint(templateId)?.footprint ?? null; } catch { return null; }
  }
  // Clicking a connectome object SELECTS it in place — no camera move, no veil.
  // The affected tiles are outlined instead (see drawFocus). The camera only moves
  // on explicit navigation (regenerate / breadcrumb pop / the fitAll handle).
  function drillToSettlement(poi: POI, plan: SettlementPlan): void {
    focus = { level: 'settlement', poiId: poi.id, poi, plan };
    selectedPoi = null;
    focusFootprint = null;
    selectedWater = null;
    syncInspector();
  }
  function drillToBuilding(b: BuildingInstance, plan: SettlementPlan | null): void {
    focus = { level: 'building', building: b, plan };
    focusFootprint = footprintOf(b.templateId);
    selectedWater = null;
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
      const { tx, ty } = screenToTileLifted(map, sx, sy, cam);
      waterDyn.rain(tx, ty, weather);
      return;
    }
    // Flood brush: lay a sheet of standing water on the ground at the cursor (W-E).
    if (floodBrush && waterDyn) {
      const { tx, ty } = screenToTileLifted(map, sx, sy, cam);
      waterDyn.floodArea(tx, ty, floodRadius, floodDepthM);
      return;
    }
    // Place-lake brush (DIR-A): stamp a NEW lake body at the cursor; with "conform
    // terrain" on, the basin + outlet carve in immediately.
    if (placeLakeBrush) {
      const { tx, ty } = screenToTileLifted(map, sx, sy, cam);
      stampLake(Math.round(tx), Math.round(ty), lakeRadius);
      return;
    }
    // Add-settlement brush: drop a NEW village node on the clicked land tile → regen.
    if (addNodeBrush) {
      const { tx, ty } = screenToTileLifted(map, sx, sy, cam);
      const poi = makeAddedPoi(`added_${++addedCounter}`, 'village', Math.round(tx), Math.round(ty), 'medium', `New Village ${addedCounter}`);
      poiEdits.added.push(poi);
      void regenerateFromEdits();
      return;
    }
    // Otherwise: select whatever connectome object / building / tile is under the
    // cursor — uniform across all of them (resolveHit topmost-wins). Toggling the
    // same water node off clears it; clicking bare terrain clears the selection.
    if (waterEdit) return;   // edit mode owns the click (drag-to-move handled elsewhere)
    selectHit(resolveHit(sx, sy));
  }

  // ── node-edit helpers (params / actions / add / frame) ──────────────────────
  const POI_SIZES = ['small', 'medium', 'large', 'huge'] as const;
  function setParam(id: string, patch: { size?: POI['size']; era?: Era }): void {
    poiEdits.params.set(id, { ...(poiEdits.params.get(id) ?? {}), ...patch });
    void regenerateFromEdits();
  }
  /** Editable size + era chips for a settlement node. */
  function poiFields(cur: POI): InspectorField[] {
    const edit = poiEdits.params.get(cur.id);
    const size = String(edit?.size ?? cur.size ?? 'medium');
    const era = String(edit?.era ?? cur.era ?? '');
    return [
      { key: 'size', value: size, options: POI_SIZES.map((v) => ({ label: v, value: v })),
        onChange: (v) => setParam(cur.id, { size: v as POI['size'] }) },
      { key: 'era', value: era,
        options: [{ label: 'world', value: '' }, ...ERAS.map((v) => ({ label: v, value: v }))],
        onChange: (v) => setParam(cur.id, { era: v ? (v as Era) : undefined }) },
    ];
  }
  /** Frame the camera on a node — its settlement footprint if built, else a box round it. */
  function frameNode(poi: POI): void {
    const plan = planForPoi(map, poi.id);
    if (plan) { const b = planBounds(plan); fitTiles(cam, b.x - 4, b.y - 4, b.x + b.w + 4, b.y + b.h + 4, cssW, cssH, 0.8); }
    else if (poi.position) { const { x, y } = poi.position; fitTiles(cam, x - 16, y - 16, x + 16, y + 16, cssW, cssH, 0.8); }
  }
  function removeNode(id: string): void {
    poiEdits.removed.add(id);
    poiEdits.added = poiEdits.added.filter((p) => p.id !== id);   // dropping a just-added node
    if (focus.level === 'settlement' && focus.poiId === id) { focus = { level: 'world' }; }
    if (selectedPoi?.id === id) selectedPoi = null;
    void regenerateFromEdits();
  }
  function poiActions(poi: POI): InspectorAction[] {
    return [
      { label: '🎯 Frame', onClick: () => frameNode(poi) },
      { label: '🗑 Remove', tone: 'danger', onClick: () => removeNode(poi.id) },
    ];
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
        fields: poi ? poiFields(poi) : undefined,
        actions: poi ? poiActions(poi) : undefined,
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
    const actions: InspectorAction[] = [];
    if (selectedPoi) actions.push(...poiActions(selectedPoi));
    if (hasEdits(poiEdits)) {
      const n = countEdits(poiEdits);
      actions.push({ label: `↺ Reset ${n} node ${n === 1 ? 'edit' : 'edits'}`, onClick: resetNodeEdits });
    }
    return {
      breadcrumb: [{ label: wsName, level: 'world' }],
      title: wsName,
      subtitle: 'world overview',
      rows,
      fields: selectedPoi ? poiFields(selectedPoi) : undefined,
      actions: actions.length ? actions : undefined,
      hint: nodeEdit ? 'drag a settlement to move it' : addNodeBrush ? 'click land to add a settlement' : 'click a settlement to drill in →',
    };
  }
  function resetNodeEdits(): void {
    poiEdits.moved.clear(); poiEdits.params.clear(); poiEdits.removed.clear(); poiEdits.added.length = 0;
    livePoiPos = null; draggingPoi = null;
    void regenerateFromEdits();
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
  layersSec.appendChild(toggleRow('Mount anchors (sign/lamp/perch)', false, (v) => { showMountAnchors = v; }));
  // Water EDIT: drag river/lake nodes to move features live; pressure rings show crowding.
  layersSec.appendChild(toggleRow('✥ Edit water — drag nodes', false, (v) => {
    waterEdit = v;
    canvas.style.cursor = v ? 'crosshair' : 'default';
  }));
  layersSec.appendChild(toggleRow('   ↳ show pressure (crowding)', true, (v) => { showPressure = v; }));
  layersSec.appendChild(toggleRow('⛰ Conform terrain to water (basins + outlets)', false, (v) => { conformTerrain = v; recarveFromEdits(); }));
  // NODE EDIT: drag settlements to move them; a second toggle arms an add-settlement brush.
  const addNodeToggle = toggleRow('   ↳ ＋ add settlement (click land)', false, (v) => {
    addNodeBrush = v; canvas.style.cursor = v ? 'copy' : (nodeEdit ? 'crosshair' : 'default');
  });
  layersSec.appendChild(toggleRow('✥ Edit nodes — drag settlements', false, (v) => {
    nodeEdit = v;
    if (!v) { addNodeBrush = false; (addNodeToggle.querySelector('input') as HTMLInputElement).checked = false; }
    canvas.style.cursor = v ? 'crosshair' : 'default';
    syncInspector();
  }));
  layersSec.appendChild(addNodeToggle);
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
    if (v) { rainBrush = false; rainCb.checked = false; placeLakeBrush = false; placeLakeCb.checked = false; }
    canvas.style.cursor = v ? 'crosshair' : 'default';
  });
  const floodCb = floodToggle.querySelector('input') as HTMLInputElement;
  weatherSec.appendChild(floodToggle);
  weatherSec.appendChild(sliderRow('Flood depth', 0.5, 10, 0.5, () => floodDepthM, (v) => { floodDepthM = v; }, (v) => `${v.toFixed(1)} m`));
  weatherSec.appendChild(sliderRow('Flood size', 2, 30, 1, () => floodRadius, (v) => { floodRadius = v; }, (v) => `${v | 0} t`));
  // ── W-B: manual rain brush ──
  const rainToggle = toggleRow('💧 Rain brush — click the map', false, (v) => {
    rainBrush = v;
    if (v) { floodBrush = false; floodCb.checked = false; placeLakeBrush = false; placeLakeCb.checked = false; }
    canvas.style.cursor = v ? 'crosshair' : 'default';
  });
  const rainCb = rainToggle.querySelector('input') as HTMLInputElement;
  weatherSec.appendChild(rainToggle);
  weatherSec.appendChild(sliderRow('Brush rain', 100, 4000, 50, () => weather.rainMm, (v) => { weather.rainMm = v; }, (v) => `${v | 0} mm`));
  weatherSec.appendChild(sliderRow('Brush size', 1, 20, 1, () => weather.brushRadius, (v) => { weather.brushRadius = v; }, (v) => `${v | 0} t`));
  weatherSec.appendChild(sliderRow('Runoff', 0, 1, 0.05, () => weather.runoffFrac, (v) => { weather.runoffFrac = v; }, (v) => `${(v * 100) | 0}%`));
  // ── DIR-A: place-lake brush — stamp a new still-water body the terrain conforms to ──
  const placeLakeToggle = toggleRow('🪣 Place lake — click the map', false, (v) => {
    placeLakeBrush = v;
    if (v) { rainBrush = false; rainCb.checked = false; floodBrush = false; floodCb.checked = false; }
    canvas.style.cursor = v ? 'crosshair' : 'default';
  });
  const placeLakeCb = placeLakeToggle.querySelector('input') as HTMLInputElement;
  weatherSec.appendChild(placeLakeToggle);
  weatherSec.appendChild(sliderRow('Lake size', 2, 14, 1, () => lakeRadius, (v) => { lakeRadius = v; }, (v) => `${v | 0} t`));
  const weatherReadout = h('div', { style: 'margin-top:4px;font:400 10px var(--font-mono);color:var(--ink-2)', text: '—' });
  weatherSec.appendChild(weatherReadout);
  menuBar.appendChild(dropdown('☁ Weather ▾', weatherSec));

  // ── Diagnostics (#30): surface the connectome LINTER (evaluateConnectome) right in the
  // studio — dev visualization belongs in the studios, not the shipped game. Lists every
  // rule violation graded by severity; click one to jump the camera to its locus. Refreshes
  // on each regenerate. (Fate consumes the SAME report via the bus/MCP `lint_world` — #29.)
  const diagBody = h('div', { style: 'display:flex;flex-direction:column;gap:5px;font:11px var(--font-mono);min-width:300px' });
  const SEV: Record<string, string> = { error: '#ff6b6b', warn: '#ffc34d', info: '#7fb2ff' };
  function focusDiagnostic(d: Diagnostic): void {
    let tx: number | undefined, ty: number | undefined;
    if (d.locus.tiles?.length) { tx = d.locus.tiles[0].x; ty = d.locus.tiles[0].y; }
    else if (d.locus.pois?.length) {
      const p = (map?.worldSeed?.pois ?? []).find((q) => q.id === d.locus.pois![0]);
      if (p?.position) { tx = p.position.x; ty = p.position.y; }
    } else if (d.locus.edges?.length) {
      const e = map?.roadGraph?.edges.find((x) => x.id === d.locus.edges![0]);
      if (e?.polyline.length) { const m = e.polyline[Math.floor(e.polyline.length / 2)]; tx = m.x; ty = m.y; }
    }
    if (tx !== undefined && ty !== undefined) fitTiles(cam, tx - 6, ty - 6, tx + 6, ty + 6, cssW, cssH, 0.9);
  }
  function refreshDiagnostics(): void {
    diagBody.textContent = '';
    if (!world || !map || !map.width) { diagBody.appendChild(h('div', { text: 'No world.', style: 'color:var(--ink-2)' })); return; }
    let report;
    try { report = evaluateConnectome({ world, map }); }
    catch (e) { diagBody.appendChild(h('div', { text: 'lint failed: ' + (e as Error).message, style: `color:${SEV.error}` })); return; }
    const head = h('div', { style: 'display:flex;gap:11px;margin-bottom:3px;font-weight:600' });
    head.appendChild(h('span', { text: `${report.total} issues`, style: 'color:var(--ink-0)' }));
    head.appendChild(h('span', { text: `${report.counts.error ?? 0} ✕`, style: `color:${SEV.error}` }));
    head.appendChild(h('span', { text: `${report.counts.warn ?? 0} △`, style: `color:${SEV.warn}` }));
    head.appendChild(h('span', { text: `${report.counts.info ?? 0} ⓘ`, style: `color:${SEV.info}` }));
    diagBody.appendChild(head);
    if (report.total === 0) { diagBody.appendChild(h('div', { text: '✓ clean — no diagnostics', style: 'color:#74d99f' })); return; }
    const order: Record<string, number> = { error: 0, warn: 1, info: 2 };
    for (const d of [...report.diagnostics].sort((a, b) => order[a.severity] - order[b.severity])) {
      const row = h('div', { style: `display:flex;gap:6px;align-items:baseline;padding:3px 5px;border-left:2px solid ${SEV[d.severity]};background:var(--bg-1);border-radius:4px;cursor:pointer` });
      row.appendChild(h('span', { text: d.rule, style: `color:${SEV[d.severity]};font-weight:600;white-space:nowrap` }));
      row.appendChild(h('span', { text: d.message, style: 'color:var(--ink-1)' }));
      row.onclick = () => focusDiagnostic(d);
      diagBody.appendChild(row);
    }
  }
  menuBar.appendChild(dropdown('🔎 Lint ▾', diagBody));

  // ── water connectome editing (drag nodes to move features in real time) ───────
  // The base network re-derives from the seed; `nodeMoves` is a pure overlay applied
  // on top, so the edited graph (and its re-routed reaches) is recomputed each frame.
  function editedWaterNet(): WaterNetwork | undefined {
    if (!map) return undefined;
    // Replay edits from the seed-derived base: stamped lakes, then moves, then merges
    // (which change ids). Order is deterministic so the edited graph is reproducible.
    let net = getWaterNetwork(map);
    for (const stamp of addedLakes) net = addLakeBody(net, stamp);
    net = applyNodeMoves(net, nodeMoves);
    for (const [keep, drop] of mergeOps) net = mergeWaterFeatures(net, keep, drop);
    return net;
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
    if (!map) return;
    const edited = editedWaterNet();
    if (!edited) return;
    const store = getWorldDeformationStore(map);
    store.removeSource('river:incision');
    store.add(...buildRiverDeformationsFromNetwork(map, edited));
    // DIR-A: lakes own their terrain — level a water-holding basin + carve an outlet so
    // the connectome "works out". Off by default (generated worlds stay byte-identical);
    // an author opts in, and the lakes (moved or not) re-conform the ground.
    store.removeSource(LAKE_BASIN_SOURCE);
    store.removeSource(LAKE_OUTLET_SOURCE);
    if (conformTerrain) store.add(...buildLakeConformDeformations(map, edited));
    // The store's version bump re-keys getComposedHeightfield → new buffer → terrain re-uploads.
    // Bump the water-edit version so the render water mask + surface (placed lakes) rebuild.
    waterEditVersion++;
  }
  /** The connectome-projected water override for the EDITED network — author-placed
   *  lakes the hydrology raster never knew, rendered as real still water (mask + surface
   *  to the spill lip). Undefined when nothing is placed (→ the raster path). Memoised by
   *  the edit version so the per-frame render context reuses it between edits. */
  function connectomeWaterOverride(): ConnectomeWaterOverride | undefined {
    if (!map || addedLakes.length === 0) return undefined;
    if (overrideMemo && overrideMemo.version === waterEditVersion) return overrideMemo.override;
    const net = editedWaterNet();
    if (!net) return undefined;
    // The ONE connectome→render-water projection (classification + still-water surface).
    const override = buildConnectomeWaterOverride(map, net, waterEditVersion);
    overrideMemo = { version: waterEditVersion, override };
    return override;
  }
  /** Analytic river-channel geometry for the EDITED network — the connectome projected
   *  as the segment + bucket buffers the water shader reads to draw rivers as a smooth
   *  signed-distance silhouette. Memoised by the edit version, so a node drag re-projects
   *  the channel instantly while held frames reuse the same reference. Falls back to the
   *  base (memoised per-seed) geometry when nothing is edited. */
  function riverChannelGeo(): RiverChannelGeometry | undefined {
    if (!map) return undefined;
    const edited = addedLakes.length > 0 || nodeMoves.size > 0 || mergeOps.length > 0;
    if (!edited) return getRiverChannelGeometry(map) ?? undefined;
    if (channelMemo && channelMemo.version === waterEditVersion) return channelMemo.geo;
    const net = editedWaterNet();
    if (!net) return undefined;
    const geo = buildRiverChannelGeometry(map, net);
    channelMemo = { version: waterEditVersion, geo };
    return geo;
  }
  /** Stamp a new author-placed lake and re-derive the connectome + terrain from it. */
  function stampLake(cx: number, cy: number, radius: number): LakeStamp | null {
    if (!map) return null;
    const stamp: LakeStamp = { id: `wl:placed:${addedLakes.length}:${cy * map.width + cx}`, cx, cy, radius };
    addedLakes.push(stamp);
    recarveFromEdits();
    return stamp;
  }

  // ── hover inspection (DIR-C) ──────────────────────────────────────────────────
  /** A water node/lake's title + extra rows for the readout. */
  function describeWaterFeature(net: WaterNetwork, id: string): { title: string; rows: [string, string][] } | null {
    const lake = net.lakes.find((l) => l.id === id);
    if (lake) {
      return { title: `${lake.klass} · still water`, rows: [
        ['area', `${lake.area} cells`], ['outlets', String(lake.outletIds.length)], ['inlets', String(lake.inletIds.length)],
      ] };
    }
    const n = net.byId.get(id);
    if (!n) return null;
    const inc = net.reaches.filter((r) => r.from === id || r.to === id);
    return { title: n.kind.replace(/_/g, ' '), rows: [['reaches', String(inc.length)]] };
  }
  const floodField = (): Float32Array | undefined => waterDyn?.floodOffsetM();
  /** Resolve what's under the cursor into a Hit (readout + highlight + select
   *  target). Topmost-wins: water node → POI → building → bare tile. Shared by the
   *  hover readout and click-to-select so they always agree on the target. */
  function resolveHit(sx: number, sy: number): Hit | null {
    if (!map) return null;
    const cont = screenToTileLifted(map, sx, sy, cam);
    const cx = Math.floor(cont.tx), cy = Math.floor(cont.ty);
    // 1) a water node / lake (when the connectome is on)
    if (showWaterNet || waterEdit) {
      const net = editedWaterNet();
      const id = net ? pickWaterNode(net, sx, sy, 14) : null;
      if (net && id) {
        const d = describeWaterFeature(net, id);
        const node = net.byId.get(id);
        const lake = node ? null : net.lakes.find((l) => l.id === id);
        const hx = node ? node.x : Math.round(lake?.x ?? cx);
        const hy = node ? node.y : Math.round(lake?.y ?? cy);
        return { title: d?.title ?? 'water', hi: { kind: 'node', tx: hx, ty: hy }, sel: { kind: 'water', id },
          rows: [...(d?.rows ?? []), ...tileReadout(map, hx, hy, { floodM: floodField(), renderWaterType: buildRenderWaterTypeMemo(map), paintedWaterAt: (tx, ty) => paintedWaterAtFn(map, tx, ty) })] };
      }
    }
    // 2) a POI (place / settlement)
    const poi = pickPoi(map, cam, sx, sy);
    if (poi) {
      const px = poi.position?.x ?? cx, py = poi.position?.y ?? cy;
      const rows: [string, string][] = [['kind', poi.type]];
      if (poi.importance) rows.push(['importance', String(poi.importance)]);
      rows.push(...tileReadout(map, px, py, { floodM: floodField(), renderWaterType: buildRenderWaterTypeMemo(map), paintedWaterAt: (tx, ty) => paintedWaterAtFn(map, tx, ty) }));
      const hi: HoverHighlight = poi.region
        ? { kind: 'rect', x: poi.region.x_min, y: poi.region.y_min, w: poi.region.x_max - poi.region.x_min + 1, h: poi.region.y_max - poi.region.y_min + 1 }
        : { kind: 'tile', tx: px, ty: py };
      return { title: poi.name ?? poi.type, rows, hi, sel: { kind: 'poi', poi } };
    }
    // 3) a building (when its settlement is in focus)
    const f = focus;
    const poiId = f.level === 'settlement' ? f.poiId : (f.level === 'building' && f.plan ? f.plan.poiId : null);
    if (poiId) {
      const b = pickBuilding(buildingsOf(map, poiId), map, cam, sx, sy);
      if (b) {
        const fp = footprintOf(b.templateId);
        const plan = f.level === 'settlement' ? f.plan : (f.level === 'building' ? f.plan : null);
        return { title: b.templateId, hi: { kind: 'rect', x: b.tileX, y: b.tileY, w: fp?.w ?? 1, h: fp?.h ?? 1 },
          sel: { kind: 'building', building: b, plan },
          rows: [['tile', `${b.tileX}, ${b.tileY}`], ['footprint', fp ? `${fp.w}×${fp.h}` : '—'], ['state', b.state]] };
      }
    }
    // 4) bare terrain
    return { title: 'terrain', hi: { kind: 'tile', tx: cx, ty: cy }, sel: { kind: 'tile' }, rows: tileReadout(map, cx, cy, { floodM: floodField(), renderWaterType: buildRenderWaterTypeMemo(map), paintedWaterAt: (tx, ty) => paintedWaterAtFn(map, tx, ty) }) };
  }
  const resolveHover = (sx: number, sy: number): void => { hover = resolveHit(sx, sy); };
  /** Select whatever a click resolved — uniform across water nodes / POIs /
   *  buildings / tiles. Drives the inspector drill AND the pinned highlight. */
  function selectHit(hit: Hit | null): void {
    selected = hit;
    const sel = hit?.sel;
    if (!sel || sel.kind === 'tile') { selectedWater = null; return; }
    if (sel.kind === 'water') { selectedWater = selectedWater === sel.id ? null : sel.id; return; }
    selectedWater = null;
    if (sel.kind === 'poi') {
      const plan = planForPoi(map, sel.poi.id);
      if (plan) drillToSettlement(sel.poi, plan); else { selectedPoi = sel.poi; syncInspector(); }
    } else if (sel.kind === 'building') {
      drillToBuilding(sel.building, sel.plan);
    }
  }
  const esc = (s: string): string => s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
  /** Paint the floating readout near the cursor (clamped into the view). */
  function renderHoverPanel(sx: number, sy: number): void {
    if (!hover) { hoverPanel.style.display = 'none'; return; }
    const rows = hover.rows.map(([k, v]) =>
      `<div style="display:flex;gap:12px;justify-content:space-between"><span style="color:var(--ink-2)">${esc(k)}</span><span style="color:var(--ink-0)">${esc(v)}</span></div>`).join('');
    hoverPanel.innerHTML = `<div style="font-weight:600;color:var(--accent);margin-bottom:4px">${esc(hover.title)}</div>${rows}`;
    hoverPanel.style.display = 'block';
    const pw = hoverPanel.offsetWidth || 160, ph = hoverPanel.offsetHeight || 80;
    let px = sx + 16, py = sy + 16;
    if (px + pw > cssW) px = sx - 16 - pw;
    if (py + ph > cssH) py = sy - 16 - ph;
    hoverPanel.style.left = `${Math.max(4, px)}px`;
    hoverPanel.style.top = `${Math.max(44, py)}px`;
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
    // Node-edit mode: grab a settlement POI to drag it (not while the add-brush is armed).
    if (nodeEdit && !addNodeBrush && map) {
      const r = viewPane.getBoundingClientRect();
      const poi = pickPoi(map, cam, e.clientX - r.left, e.clientY - r.top);
      if (poi?.position) { draggingPoi = poi.id; livePoiPos = { id: poi.id, x: poi.position.x, y: poi.position.y }; canvas.style.cursor = 'grabbing'; return; }
    }
    cam.dragging = true; cam.lastX = e.clientX; cam.lastY = e.clientY;
    downX = e.clientX; downY = e.clientY; moved = false;
    canvas.style.cursor = 'grabbing';
  }, { signal });
  window.addEventListener('mouseup', () => {
    if (draggingPoi) {                        // finished a settlement drag → commit + regen
      if (livePoiPos) poiEdits.moved.set(draggingPoi, { x: livePoiPos.x, y: livePoiPos.y });
      draggingPoi = null; livePoiPos = null;
      canvas.style.cursor = nodeEdit ? 'crosshair' : 'default';
      void regenerateFromEdits();
      return;
    }
  }, { signal });
  window.addEventListener('mouseup', (e) => {
    if (draggingNode) {                       // finished a node drag
      // Drop ONTO a merge-compatible feature → join them (the lake feeds the channel, etc.)
      // instead of leaving a pinch point. Otherwise just settle the move.
      const r = viewPane.getBoundingClientRect();
      const net = editedWaterNet();
      const onto = net ? pickWaterNode(net, e.clientX - r.left, e.clientY - r.top, 14) : null;
      if (net && onto && onto !== draggingNode) {
        const pair = suggestWaterResolutions(net, [{ a: draggingNode, b: onto, overlap: 1 }])[0];
        if (pair.resolution === 'merge') mergeOps.push([onto, draggingNode]); // keep target, drop dragged
      }
      draggingNode = null;
      canvas.style.cursor = waterEdit ? 'crosshair' : 'default';
      recarveFromEdits();
      return;
    }
    if (cam.dragging && !moved) {
      const r = viewPane.getBoundingClientRect();
      handleClick(e.clientX - r.left, e.clientY - r.top);
    }
    cam.dragging = false; canvas.style.cursor = waterEdit ? 'crosshair' : 'default';
  }, { signal });
  window.addEventListener('mousemove', (e) => {
    const r = viewPane.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (draggingNode && map) {                 // live-move the grabbed node
      const { tx, ty } = screenToTileLifted(map, sx, sy, cam);
      nodeMoves.set(draggingNode, { x: tx - 0.5, y: ty - 0.5 });  // node coords (centre = x+0.5)
      return;
    }
    if (draggingPoi && map) {                   // live-move the grabbed settlement (ghost marker)
      const { tx, ty } = screenToTileLifted(map, sx, sy, cam);
      livePoiPos = { id: draggingPoi, x: Math.round(tx), y: Math.round(ty) };
      hoverPanel.style.display = 'none'; hover = null;
      return;
    }
    if (cam.dragging) {
      if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 3) moved = true;
      cam.x -= (e.clientX - cam.lastX) / cam.zoom;
      cam.y -= (e.clientY - cam.lastY) / cam.zoom;
      cam.lastX = e.clientX; cam.lastY = e.clientY;
      hoverPanel.style.display = 'none';   // suppress the readout while panning
      hover = null;
      return;
    }
    // pointer at rest over the view → per-pixel hover inspection
    if (sx < 0 || sy < 0 || sx > cssW || sy > cssH) { hover = null; hoverPanel.style.display = 'none'; return; }
    resolveHover(sx, sy);
    renderHoverPanel(sx, sy);
  }, { signal });
  canvas.addEventListener('mouseleave', () => { hover = null; hoverPanel.style.display = 'none'; }, { signal });
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

  // Mount-anchor overlay — the 2026-06-13 anchor-tags verification surface (shared with the
  // in-game dev overlay). Dots each building's mount sockets by role at metric height.
  const drawMountAnchors = (): void => drawMountAnchorOverlay(ctx, world, map, cam);

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
    // Dragging a settlement: a ghost marker follows the cursor until drop commits the move.
    if (livePoiPos) {
      tileDot(livePoiPos.x, livePoiPos.y, 11, 'rgba(255,194,75,0.4)', COLORS.accent);
      strokeTilePath([{ x: livePoiPos.x - 3, y: livePoiPos.y - 3 }, { x: livePoiPos.x + 4, y: livePoiPos.y - 3 }, { x: livePoiPos.x + 4, y: livePoiPos.y + 4 }, { x: livePoiPos.x - 3, y: livePoiPos.y + 4 }, { x: livePoiPos.x - 3, y: livePoiPos.y - 3 }], COLORS.accent, 1.5);
    }
    const f = focus;
    if (f.level === 'world') {
      if (selectedPoi?.position) tileDot(selectedPoi.position.x, selectedPoi.position.y, 9, 'rgba(255,194,75,0.25)', COLORS.accent);
      return;
    }
    // Selection outlines the affected tiles in place — no veil, no camera move.
    ctx.save();

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

  // Fill a set of row-major cells as lifted iso diamonds (cell-centre coords, so
  // they sit on the same lattice as the water connectome + terrain). Used for the
  // direct/indirect affected-tile wash of a water selection.
  function fillCells(cells: ArrayLike<number>, color: string): void {
    if (!cells.length) return;
    const HW = ISO_TILE_W / 2 * cam.zoom, HH = ISO_TILE_H / 2 * cam.zoom;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let k = 0; k < cells.length; k++) {
      const idx = cells[k], tx = idx % map.width, ty = (idx / map.width) | 0;
      const p = projectConnectome(map, tx + 0.5, ty + 0.5, cam);
      ctx.moveTo(p.x, p.y - HH); ctx.lineTo(p.x + HW, p.y); ctx.lineTo(p.x, p.y + HH); ctx.lineTo(p.x - HW, p.y); ctx.closePath();
    }
    ctx.fill();
  }

  // Selected water feature → wash its directly-occupied cells + the cells it feeds
  // downstream (indirect), then ring the selected node. The "select, don't zoom"
  // model: the affected tiles light up in place.
  function drawWaterSelection(): void {
    if (!selectedWater) return;
    const net = editedWaterNet();
    if (!net) return;
    const { direct, indirect } = affectedWaterCells(net, selectedWater);
    ctx.save();
    fillCells(indirect, 'rgba(96,170,230,0.20)');   // downstream — what it feeds
    fillCells(direct, 'rgba(120,210,255,0.42)');    // the water itself
    const node = net.byId.get(selectedWater);
    const lake = node ? null : net.lakes.find((l) => l.id === selectedWater);
    const cxc = node ? node.x : lake?.x ?? 0, cyc = node ? node.y : lake?.y ?? 0;
    const p = projectConnectome(map, cxc + 0.5, cyc + 0.5, cam);
    ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    ctx.strokeStyle = COLORS.accent; ctx.lineWidth = 2.5; ctx.shadowColor = COLORS.accent; ctx.shadowBlur = 10; ctx.stroke();
    ctx.restore();
  }

  // Outline one highlight shape (tile diamond / node ring / footprint box) in a
  // colour. Shared by the live hover (white) and the pinned selection (accent).
  function strokeHighlight(hi: HoverHighlight, color: string, lineWidth: number, glow: number): void {
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.shadowColor = color; ctx.shadowBlur = glow;
    const HW = ISO_TILE_W / 2 * cam.zoom, HH = ISO_TILE_H / 2 * cam.zoom;
    if (hi.kind === 'tile' || hi.kind === 'node') {
      const p = projectConnectome(map, hi.tx + 0.5, hi.ty + 0.5, cam);   // cell centre
      if (hi.kind === 'node') { ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI * 2); ctx.stroke(); }
      else { ctx.beginPath(); ctx.moveTo(p.x, p.y - HH); ctx.lineTo(p.x + HW, p.y); ctx.lineTo(p.x, p.y + HH); ctx.lineTo(p.x - HW, p.y); ctx.closePath(); ctx.stroke(); }
    } else {
      strokeTilePath(
        [{ x: hi.x, y: hi.y }, { x: hi.x + hi.w, y: hi.y }, { x: hi.x + hi.w, y: hi.y + hi.h }, { x: hi.x, y: hi.y + hi.h }, { x: hi.x, y: hi.y }],
        color, lineWidth,
      );
    }
    ctx.restore();
  }
  // The pinned selection outline (accent). Water selections are drawn by
  // drawWaterSelection (downstream wash + ring), so skip them here.
  function drawSelectionHit(): void {
    if (!selected || selected.sel.kind === 'water') return;
    strokeHighlight(selected.hi, COLORS.accent, 2.5, 10);
  }
  // The live hover highlight — a crisp white outline under the cursor (DIR-C).
  function drawHover(): void {
    if (hover) strokeHighlight(hover.hi, '#ffffff', 1.75, 8);
  }

  // ── GPU renderer + frame loop ─────────────────────────────────────────────────
  const { render, backend } = await createGpuRenderMap({ canvas: sceneCanvas });
  if (disposed) return;
  const backendLabel = backend;

  function renderContext(): RenderContext {
    return {
      map, camera: cam, canvasWidth: cssW, canvasHeight: cssH,
      npcs: [], npcSheets: new Map(),
      world, lighting, visualMap: visualMap ?? undefined,
      devMode: dev as DevModeState,   // terrain/roads/rivers/buildings/vegetation toggles
      lakeOffsetM: waterDyn?.lakeOffsetM(),   // localized lake level (climate W-B)
      floodOffsetM: waterDyn?.floodOffsetM(), // per-cell standing water (W-E flood)
      connectomeWater: connectomeWaterOverride(), // DIR-A author-placed lakes as real water
      riverChannel: riverChannelGeo(),            // analytic river silhouette from the live net

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
      if (showMountAnchors) drawMountAnchors();           // building mount sockets (by role)
      drawOverlay();                          // humidity / cloud / temperature field
      drawFocus();                           // selected settlement/building outlines
      drawWaterSelection();                   // selected river/lake + downstream wash
      drawSelectionHit();                     // pinned selection outline (any object)
      drawHover();                            // per-pixel hover highlight
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
    // Building mount-anchor overlay (sign/lamp/perch sockets, by role) — toggle for the dev loop.
    mountAnchors: (on?: boolean) => { if (on !== undefined) showMountAnchors = on; return showMountAnchors; },
    // Composite the WebGPU scene + the 2D overlay into one PNG data-URL (studio dev-loop grab;
    // the on-screen canvases are stacked, so a screenshot must merge both layers).
    grab: () => {
      const out = document.createElement('canvas');
      out.width = sceneCanvas.width; out.height = canvas.height;
      const g = out.getContext('2d')!;
      g.drawImage(sceneCanvas, 0, 0);
      g.drawImage(canvas, 0, 0);
      return out.toDataURL('image/png');
    },
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
    waterEdit: (on?: boolean) => { if (on !== undefined) { waterEdit = on; canvas.style.cursor = on ? 'crosshair' : 'default'; } return waterEdit; },
    moveWaterNode: (id: string, x: number, y: number) => { nodeMoves.set(id, { x, y }); recarveFromEdits(); return editedWaterNet(); },
    mergeWaterFeatures: (keepId: string, dropId: string) => { mergeOps.push([keepId, dropId]); recarveFromEdits(); return editedWaterNet(); },
    clearWaterEdits: () => { nodeMoves.clear(); mergeOps.length = 0; addedLakes.length = 0; recarveFromEdits(); },
    // DIR-A: stamp a NEW lake at a tile (the connectome adopts it; conform carves its basin).
    placeLake: (tx: number, ty: number, radius = lakeRadius) => {
      const stamp = stampLake(Math.round(tx), Math.round(ty), radius);
      const net = editedWaterNet();
      return stamp && net ? { id: stamp.id, lakes: net.lakes.length } : null;
    },
    clearPlacedLakes: () => { addedLakes.length = 0; recarveFromEdits(); return addedLakes.length; },
    // DIR-A: lakes conform the terrain (water-holding basin + carved outlet). Toggle +
    // read back how many deformations the current (edited) lakes emit.
    conformTerrain: (on?: boolean) => {
      if (on !== undefined) { conformTerrain = on; recarveFromEdits(); }
      const net = editedWaterNet();
      return {
        on: conformTerrain,
        lakes: net?.lakes.length ?? 0,
        deformations: map && net ? buildLakeConformDeformations(map, net).length : 0,
      };
    },
    // Advisory crowding report on the (edited) network, each pinch annotated with a SUGGESTED
    // resolution (merge vs separate) — the feedback an agent reads after editing the connectome.
    waterPressure: () => {
      const net = editedWaterNet();
      const rep = waterPressure(net);
      if (!rep || !net) return null;
      return {
        maxPressure: rep.maxPressure,
        pinches: suggestWaterResolutions(net, rep.pairs).slice(0, 12),
        crowded: [...rep.perItem.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
      };
    },
    // Selection (DIR-C): pick a water feature by id and read back the affected cells.
    selectWater: (id: string | null) => { selectedWater = id; return id ? (map ? affectedWaterCells(editedWaterNet()!, id) : null) : null; },
    selectedWater: () => selectedWater,
    // Alignment probe: for a CSS-pixel cursor, the picked tile + where the hover
    // diamond's centre projects (so the residual cursor↔diamond offset is measurable).
    probe: (sx: number, sy: number) => {
      if (!map) return null;
      const c = screenToTileLifted(map, sx, sy, cam);
      const cx = Math.floor(c.tx), cy = Math.floor(c.ty);
      const p = projectConnectome(map, cx + 0.5, cy + 0.5, cam);
      return { cursor: { x: sx, y: sy }, tile: [cx, cy], diamond: p, lifted: c, dx: p.x - sx, dy: p.y - sy };
    },
    // View helpers (for headed iteration): frame the whole map, toggle the backbone,
    // set terrain style, read/poke the camera.
    fitAll: () => { if (map) fitTiles(cam, 0, 0, map.width, map.height, cssW, cssH, 0.94); },
    lookAt: (tx: number, ty: number, span = 6) => { if (map) fitTiles(cam, tx - span, ty - span, tx + span, ty + span, cssW, cssH, 0.9); return { x: cam.x, y: cam.y, zoom: cam.zoom }; },
    cam: () => ({ x: cam.x, y: cam.y, zoom: cam.zoom }),
    // Forward projection (tile → CSS-pixel screen), for round-trip alignment checks.
    projectTile: (tx: number, ty: number) => (map ? projectConnectome(map, tx, ty, cam) : null),
    // Full hit resolution at a CSS-pixel cursor (the same path hover + click use) —
    // title + select kind + readout rows. The e2e targeting suite drives this.
    hitAt: (sx: number, sy: number) => {
      const h = resolveHit(sx, sy);
      if (!h) return null;
      return { title: h.title, kind: h.sel.kind, rows: h.rows };
    },
    connectome: (on?: boolean) => { if (on !== undefined) showConnectome = on; return showConnectome; },
    terrainMode: (id: TerrainModeId) => { dev.terrainMode = terrainModeValue(id); },
  };
  })();

  return { dispose };
}
