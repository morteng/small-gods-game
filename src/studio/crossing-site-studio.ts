// src/studio/crossing-site-studio.ts
//
// 🏞 CROSSING SITE studio (?studio=crossingsite) — the road-wear economy's SCENE harness.
// The Crossings workspace shows the sprite ladder on a painted strip; this one shows the
// REAL thing: a GPU-rendered terrain patch with a stream, a road authored ACROSS it through
// the actual road walker, and the crossing structure standing on the water — all re-
// expressing live as the dials move (the studio never reloads to refresh).
//
// Route: AUTHORED GRAPH over a bare patch (not POI worldgen-and-hope). `generateWithNoise`
// makes terrain+hydrology only (pois:[]); `pickCrossingSite` scans the water raster for a
// narrow perpendicular crossing; two synthetic bank POIs + one connection drive the SAME
// `buildRoadGraph` walker+carve worldgen runs (class via its own classForConnection);
// `detectCrossings` finds the road×water claim on the render-water mask; the crossing then
// renders either as the tier-recipe preset the economy dials earn through the REAL
// `tierForUse` (previewing exactly what the S3 CrossingTierStore will do), or as the
// worldgen-fitted `buildBridgeObject` span (verbatim opts). A crossing ALWAYS exists by
// construction — the edge is authored to straddle the channel — and dial moves re-run only
// the road/crossing expression over the same terrain, never full worldgen.

import type { RenderContext, GameMap, Entity, WorldSeed, TerrainField, POI } from '@/core/types';
import { World } from '@/world/world';
import { generateWithNoise, terrainConfigFor } from '@/map/map-generator';
import { generateTerrainFields } from '@/terrain/terrain-generator';
import { erodeElevation } from '@/terrain/erosion';
import { Autotiler } from '@/map/autotiler';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { initManifoldWasm } from '@/assetgen/geometry/manifold-wasm-browser';
import { createGpuRenderMap } from '@/render/gpu/gpu-renderer';
import { ParametricBuildingSource } from '@/render/parametric-building-source';
import { ParametricPlantSource } from '@/render/parametric-plant-source';
import { ParametricBarrierSource } from '@/render/parametric-barrier-source';
import { DEFAULT_LIGHTING } from '@/render/lighting-state';
import { createCamera, zoomAt } from '@/render/camera';
import { attachControls } from '@/ui/controls';
import { fitTilesToView, quantizeStudioZoom, STUDIO_ZOOM_MAX } from './studio-camera';
import { buildZoomGroup } from './toolbar';
import { evaluateConnectome, type Diagnostic } from '@/world/connectome-diagnostics';
import { buildRoadGraph, type RoadClass } from '@/world/road-graph';
import { detectCrossings } from '@/world/connectome/detect-crossings';
import type { CrossingSpec } from '@/world/connectome/crossing-builder';
import { buildBridgeObject } from '@/world/connectome/crossing-structures';
import {
  getComposedHeightfield, reconcileCenterlineBows, reconcileRoadTileVisibility, edgeRoadProfile,
} from '@/world/road-deformation';
import { getRenderWaterMask } from '@/world/render-water';
import { ELEVATION_SEA_LEVEL } from '@/world/heightfield';
import { curveRenderElev } from '@/render/gpu/terrain-field';
import { worldStyleOf } from '@/core/world-style';
import { bumpTilesRev } from '@/core/tile-rev';
import { clearObstructedVegetation } from '@/world/vegetation-clear';
import { bridgeBlueprintByName } from '@/blueprint/presets/bridges';
import { resolveBlueprint } from '@/blueprint/resolve';
import { blueprintEntity } from '@/blueprint/entity';
import type { Orientation } from '@/blueprint/orientation';
import {
  tierForUse, type CrossingTier,
  CROSSING_TIER_RECIPES, CROSSING_TIER_LABELS, CLASS_CROSSING_TIER,
  ROAD_CLASS_LADDER, RICH_CROSSING_MIN, CROSSING_LAG,
  CROSSING_EARN_USE, CROSSING_TIER_MAX_SPAN_T, minViableTier, tierSpans,
} from '@/world/road-use';
import { pickCrossingSite, poisForCrossing, shownCrossingTier, type CrossingSitePick } from './crossing-site-scene';
import { injectStudioTheme, COLORS, h } from './theme';

export interface StudioHandle { dispose(): void; }

// Larger than the Site studio's 96: the scene should read as a LANDSCAPE — a solid landmass
// with the stream incised into it — not a minimal test patch the river slices apart.
const PATCH = 128;

/** Default seed — verified to yield a vale channel with a clean perpendicular crossing. */
const DEFAULT_SEED = 0x5170;

export function mountCrossingSiteStudio(container: HTMLElement): StudioHandle {
  let disposed = false;
  let rafId = 0;
  let ro: ResizeObserver | null = null;
  let detachControls: (() => void) | null = null;
  const dispose = (): void => {
    disposed = true;
    cancelAnimationFrame(rafId);
    detachControls?.();
    ro?.disconnect();
    delete (window as unknown as { __crossingSite?: unknown }).__crossingSite;
  };

  void (async () => {
    ensureBuildingTypesRegistered();
    initManifoldWasm();

    container.style.position = 'relative';
    container.style.background = COLORS.bg0;
    injectStudioTheme(container);

    // ── scaffold: [controls | (bar over view)] ───────────────────────────────
    const root = h('div', { style: 'position:absolute;inset:0;display:flex;flex-direction:row;overflow:hidden' });
    const panel = h('div', { class: 'sg-panel', style: 'flex:0 0 auto;width:272px;border-right:1px solid var(--line);overflow:auto;padding:12px' });
    const rightCol = h('div', { style: 'flex:1 1 auto;min-width:0;display:flex;flex-direction:column;overflow:hidden' });
    const topBar = h('div', { class: 'sg-bar', style: 'flex:0 0 auto;display:flex;align-items:center;gap:9px;padding:7px 10px' });
    const viewPane = h('div', { style: 'position:relative;flex:1 1 auto;min-height:0;overflow:hidden' });
    rightCol.append(topBar, viewPane);
    root.append(panel, rightCol);
    container.appendChild(root);

    const sceneCanvas = h('canvas', { style: 'position:absolute;inset:0;width:100%;height:100%;display:block;z-index:0' }) as HTMLCanvasElement;
    const canvas = h('canvas', { style: 'position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab;z-index:1' }) as HTMLCanvasElement;
    viewPane.append(sceneCanvas, canvas);
    const ctx = canvas.getContext('2d')!;

    // ── state: the dials ─────────────────────────────────────────────────────
    const gen = {
      seed: DEFAULT_SEED,
      terrain: 'vale' as 'vale' | 'plain' | 'knoll' | 'wild',
      relief: 32,          // mountainRelief style override (m) — thick land, banks above water
      riverDensity: 0.5,   // stream scale — inverse-tunes the flow threshold (W ∝ √Q)
    };
    const econ = {
      use: 0.4, wealth: 0.3, cls: 'road' as RoadClass,
      varietySeed: 0,      // low-rung roundwood variation (0 = canonical build)
      fitted: false,       // true = the worldgen-fitted buildBridgeObject span instead
    };

    // ── scene state ──────────────────────────────────────────────────────────
    let map: GameMap = null as unknown as GameMap;
    let world = new World({ tiles: [], width: 0, height: 0, villages: [], seed: 0, success: false, worldSeed: null, stats: { iterations: 0, backtracks: 0 }, buildings: [] } as unknown as GameMap);
    let visualMap: ReturnType<typeof Autotiler.computeVisualMap> | null = null;
    let fields: TerrainField | null = null;
    let pristine: { type: string; walkable: boolean }[][] = [];
    let pick: CrossingSitePick | null = null;
    let specs: CrossingSpec[] = [];
    let spec: CrossingSpec | null = null;
    let regenToken = 0;
    let exprSeq = 0;       // per-expression roadGraph.rev base → unique deformation/SDF cache keys
    let bridgeSeq = 0;     // unique preview-entity ids across swaps
    let bridgeIds: string[] = [];
    const lighting = { ...DEFAULT_LIGHTING };
    const cam = createCamera();
    const dev: Record<string, unknown> = {};

    // keepStages ⇒ the INLINE compose path (offthread=false). The bridge is a `building`
    // to the draw list, and its arch/manifold geometry composes on the MAIN thread here
    // (mount ran initManifoldWasm) — the worker pool's manifold isn't initialised, so the
    // default off-thread path silently hangs on the bridge (flora needs no manifold, so it
    // rendered while the crossing never appeared). Every other studio keeps this inline path.
    const buildingSource = new ParametricBuildingSource({ keepStages: true });
    const plantSource = new ParametricPlantSource();
    const barrierSource = new ParametricBarrierSource();

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let cssW = 0, cssH = 0;
    function resize(): void {
      const r = viewPane.getBoundingClientRect();
      cssW = Math.max(1, Math.floor(r.width));
      cssH = Math.max(1, Math.floor(r.height));
      canvas.width = sceneCanvas.width = Math.floor(cssW * dpr);
      canvas.height = sceneCanvas.height = Math.floor(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    ro = new ResizeObserver(resize); ro.observe(viewPane);

    detachControls = attachControls(canvas, cam, {
      getZoomQuantize: () => quantizeStudioZoom,
      getMaxZoom: () => STUDIO_ZOOM_MAX,
      onRedraw: () => {},
    });

    // ── top bar: status tag + the SHARED zoom group (same widget as the object
    // studio's toolbar; buttons drive zoomAt through the same rung quantizer the
    // wheel uses — one zoom code path). "Frame crossing" is this scene's Fit.
    const sceneTag = h('span', { class: 'sg-tag', style: 'font-size:12px', text: '🏞 crossing site' });
    const zoomStep = (dir: 1 | -1): void =>
      zoomAt(cam, dir > 0 ? 2 : 0.5, cssW / 2, cssH / 2, quantizeStudioZoom, STUDIO_ZOOM_MAX);
    const zoomBar = buildZoomGroup({
      zoomLabel: (z) => (z >= 1 ? `${Math.round(z)}×` : `1/${Math.round(1 / z)}×`),
      getZoom: () => cam.zoom,
      zoomIn: () => zoomStep(1),
      zoomOut: () => zoomStep(-1),
      onFit: () => frameCrossing(),
      fitLabel: 'Frame crossing',
      fitTitle: 'Fit the view on the detected crossing',
    });
    topBar.append(sceneTag, h('span', { style: 'flex:1 1 auto' }), zoomBar.el);

    // ── controls ─────────────────────────────────────────────────────────────
    panel.appendChild(h('div', { style: 'font:700 13px var(--font-mono);color:#e8eef6;margin-bottom:10px', text: '🏞 Crossing Site' }));
    panel.appendChild(h('div', { class: 'sg-muted', style: 'font:400 11px var(--font-mono);line-height:1.5;margin-bottom:12px',
      text: 'A real rendered crossing: terrain + stream, a road authored across it through the real walker, and the structure the economy dials earn via tierForUse().' }));

    const label = (t: string): HTMLElement => h('div', { class: 'sg-muted', style: 'font:600 10px var(--font-mono);letter-spacing:.06em;text-transform:uppercase;margin:10px 0 4px', text: t });
    const FIELD = 'width:100%;background:var(--bg-1);color:var(--ink-0);border:1px solid var(--line);border-radius:6px;padding:6px 8px;font:500 12px var(--font-mono)';

    function slider(
      name: string, min: number, max: number, step: number,
      get: () => number, set: (v: number) => void, onCommit: () => void,
      fmt: (v: number) => string = (v) => v.toFixed(2), live = false,
    ): void {
      panel.appendChild(label(name));
      const row = h('div', { style: 'display:flex;align-items:center;gap:8px' });
      const val = h('span', { class: 'sg-accent', style: 'min-width:44px', text: fmt(get()) });
      const s = h('input', { class: 'sg-range', style: 'flex:1', attrs: { type: 'range', min: String(min), max: String(max), step: String(step), value: String(get()) } }) as HTMLInputElement;
      s.oninput = () => { set(+s.value); val.textContent = fmt(get()); if (live) onCommit(); };
      if (!live) s.onchange = () => onCommit();   // regen-class dials commit on release
      row.append(s, val);
      panel.appendChild(row);
    }

    // — terrain (regen) dials —
    panel.appendChild(label('Seed'));
    const seedRow = h('div', { style: 'display:flex;gap:6px' });
    const seedInput = h('input', { style: FIELD }) as HTMLInputElement;
    seedInput.type = 'number'; seedInput.value = String(gen.seed);
    seedInput.onchange = () => { gen.seed = (parseInt(seedInput.value, 10) || 0) >>> 0; void regenerate(); };
    const reroll = h('button', { class: 'sg-btn', style: 'flex:0 0 auto;white-space:nowrap', text: '🎲' });
    reroll.onclick = () => { gen.seed = (gen.seed * 1103515245 + 12345) >>> 0; seedInput.value = String(gen.seed); void regenerate(); };
    seedRow.append(seedInput, reroll); panel.appendChild(seedRow);

    panel.appendChild(label('Terrain shape'));
    const terSel = h('select', { style: FIELD }) as HTMLSelectElement;
    for (const t of [
      { id: 'vale', label: 'River vale (one river + terraces)' },
      { id: 'plain', label: 'Flat plain' },
      { id: 'knoll', label: 'Knoll (a natural hill)' },
      { id: 'wild', label: 'Wild (raw noise patch)' },
    ]) terSel.appendChild(h('option', { attrs: { value: t.id }, text: t.label }));
    terSel.value = gen.terrain;
    terSel.onchange = () => { gen.terrain = terSel.value as typeof gen.terrain; void regenerate(); };
    panel.appendChild(terSel);

    slider('Relief (mountainRelief, m)', 8, 48, 1, () => gen.relief, (v) => { gen.relief = v; }, () => void regenerate(), (v) => `${v} m`);
    slider('Stream scale (riverDensity)', 0.2, 1.5, 0.05, () => gen.riverDensity, (v) => { gen.riverDensity = v; }, () => void regenerate());

    const regenBtn = h('button', { class: 'sg-btn', style: 'width:100%;margin-top:12px', text: '↻ Regenerate patch' });
    regenBtn.onclick = () => void regenerate();
    panel.appendChild(regenBtn);

    // — crossing-economy (re-expression) dials —
    panel.appendChild(h('div', { style: 'border-top:1px solid var(--line);margin:14px 0 2px' }));
    slider('Use (edge use.ema01)', 0, 1, 0.01, () => econ.use, (v) => { econ.use = v; }, () => expressCrossing(), undefined, true);
    slider('Wealth (endpoint purse)', 0, 1, 0.01, () => econ.wealth, (v) => { econ.wealth = v; }, () => expressCrossing(), undefined, true);

    panel.appendChild(label('Road class (the cap)'));
    const clsSel = h('select', { style: FIELD }) as HTMLSelectElement;
    for (const c of ROAD_CLASS_LADDER) clsSel.appendChild(h('option', { text: `${c} (tier cap ${CLASS_CROSSING_TIER[c]})`, attrs: { value: c } }));
    clsSel.value = econ.cls;
    clsSel.onchange = () => { econ.cls = clsSel.value as RoadClass; expressRoad(); };  // class re-walks the road (grade envelope + carriage width are class-real)
    panel.appendChild(clsSel);

    panel.appendChild(label('Variety ("the spice")'));
    const varBtn = h('button', { class: 'sg-btn', style: 'width:100%', text: 'Reroll variation seed' });
    varBtn.onclick = () => { econ.varietySeed += 1; expressCrossing(); };
    panel.appendChild(varBtn);

    const fitRow = h('label', { style: 'display:flex;align-items:center;gap:7px;margin-top:10px;cursor:pointer;font:500 11px var(--font-mono);color:var(--ink-0)' });
    const fitChk = h('input', {}) as HTMLInputElement; fitChk.type = 'checkbox'; fitChk.checked = econ.fitted;
    fitChk.onchange = () => { econ.fitted = fitChk.checked; expressCrossing(); };
    fitRow.append(fitChk, h('span', { text: 'Worldgen-fitted span (buildBridgeObject)' }));
    panel.appendChild(fitRow);

    panel.appendChild(label('Computed'));
    const readout = h('div', { style: 'font:400 11px var(--font-mono);white-space:pre-wrap;line-height:1.7' });
    panel.appendChild(readout);

    panel.appendChild(label('Diagnostics'));
    const diagBox = h('div', { style: 'font:400 11px var(--font-mono);line-height:1.55;white-space:pre-wrap' });
    panel.appendChild(diagBox);

    // ── expression ───────────────────────────────────────────────────────────
    const invalidateDrawCache = (): void =>
      (window as unknown as { __invalidateDrawCache?: () => void }).__invalidateDrawCache?.();

    // Art-settle reveal: async sprite packs (flora, the bridge) stream in AFTER the
    // static draw list first builds, and in the studio context their rev stream doesn't
    // reliably reach the cache's debounce — so after every (re)expression, re-cut the
    // static list on a decaying schedule to pick up whatever has settled. Bounded cost
    // (a handful of rebuilds), and a dial move reschedules it anyway.
    let revealTimers: number[] = [];
    function scheduleArtReveal(): void {
      for (const t of revealTimers) clearTimeout(t);
      revealTimers = [2000, 5000, 10000, 20000, 40000, 80000].map((ms) =>
        window.setTimeout(() => { if (!disposed) invalidateDrawCache(); }, ms));
    }

    function currentTier(): CrossingTier { return tierForUse(econ.use, econ.cls, econ.wealth); }

    /** A spec's two bank anchors — `bankCells` (the ribbon-seated opening) when the detector
     *  seated one, else the raw walker banks (`detectCrossings` always sets those). */
    function bankAnchors(s: CrossingSpec): [{ x: number; y: number }, { x: number; y: number }] {
      if (s.bankCells) return [{ x: s.bankCells[0][0], y: s.bankCells[0][1] }, { x: s.bankCells[1][0], y: s.bankCells[1][1] }];
      if (s.banks) return [s.banks[0], s.banks[1]];
      return [{ x: 0, y: 0 }, { x: 0, y: 0 }];
    }

    /** Swap the crossing structure only (use/wealth/variety/fitted dial moves). */
    function expressCrossing(): void {
      if (!map) return;
      for (const id of bridgeIds) world.removeEntity(id);
      bridgeIds = [];
      if (spec) {
        const style = worldStyleOf(map.worldSeed ?? undefined);
        const composed = getComposedHeightfield(map);
        const elev = (x: number, y: number): number =>
          curveRenderElev(composed[Math.round(y) * map.width + Math.round(x)] ?? ELEVATION_SEA_LEVEL,
            ELEVATION_SEA_LEVEL, style.terrainHeightGamma);
        const prosperity = econ.wealth >= RICH_CROSSING_MIN ? 'rich' : 'modest';
        if (econ.fitted) {
          // The REAL worldgen span pass — verbatim `buildBridgeObject` opts (map-generator's
          // "Raising bridge spans" phase), so what stands here is what a world would ship.
          const nodeById = new Map(map.roadGraph!.nodes.map((n) => [n.id, n]));
          const poiById = new Map((map.worldSeed?.pois ?? []).map((p) => [p.id, p] as [string, POI]));
          const e = buildBridgeObject({ ...spec, prosperity }, {
            deckElevAt: elev,
            reliefM: style.mountainRelief,
            zPxPerM: style.terrainVerticalExaggeration,
            roadSurfaceFor: (edgeId) => {
              const edge = map.roadGraph!.edges.find((x) => x.id === edgeId);
              return edge ? edgeRoadProfile(map, edge, nodeById, poiById)?.state.surfaceMaterial : undefined;
            },
          });
          if (e) { world.addEntity(e); bridgeIds.push(e.id); buildingSource.warm(e); }
        } else {
          // The tier-recipe preview — the S3 CrossingTierStore's swap, done live: the earned
          // rung's canonical `bridge-<recipe>` preset (or the min-viable structure when the
          // earned one can't span this water), quarter-turned onto the crossing axis.
          const st = shownCrossingTier(currentTier(), spec.spanTiles);
          const bp = bridgeBlueprintByName(`bridge-${CROSSING_TIER_RECIPES[st.shown]}`, econ.varietySeed || undefined);
          if (bp) {
            const rb = resolveBlueprint([bp], econ.varietySeed);
            const [b0, b1] = bankAnchors(spec);
            const ax: [number, number] = spec.axis ?? [b1.x - b0.x, b1.y - b0.y];
            const q: Orientation = Math.abs(ax[0]) >= Math.abs(ax[1]) ? 0 : 1;
            const placed = q ? { ...rb, orientation: q } : rb;
            const fpW = q ? rb.footprint.h : rb.footprint.w;
            const fpH = q ? rb.footprint.w : rb.footprint.h;
            const mid = { x: (b0.x + b1.x) / 2, y: (b0.y + b1.y) / 2 };
            const e = blueprintEntity(`crossing-site-preview-${++bridgeSeq}`, placed,
              Math.round(mid.x - fpW / 2), Math.round(mid.y - fpH / 2), { poiId: spec.id });
            // Seat the preset at bank grade: its own short supports stand into the channel.
            (e.properties as Record<string, unknown>).liftElev = Math.max(elev(b0.x, b0.y), elev(b1.x, b1.y));
            world.addEntity(e);
            bridgeIds.push(e.id);
            buildingSource.warm(e);   // kick the compose NOW — don't wait for the draw list to
          }                           // iterate it (the static cache is cut before it settles)
        }
      }
      syncReadout();
      invalidateDrawCache();
      scheduleArtReveal();
    }

    /** Re-express the road + crossing over the SAME terrain (class dial / after regen). */
    function expressRoad(): void {
      if (!map || !fields) return;
      // Restore the pre-road tiles so a re-express never stacks carves.
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const t = map.tiles[y][x], p = pristine[y][x];
          if (t.type !== p.type || t.walkable !== p.walkable) { t.type = p.type; t.walkable = p.walkable; }
        }
      }
      for (const id of bridgeIds) world.removeEntity(id);
      bridgeIds = [];
      specs = []; spec = null;
      if (pick) {
        const { pois, connections } = poisForCrossing(econ.cls, pick.a, pick.b);
        const style = worldStyleOf(map.worldSeed ?? undefined);
        // The REAL walker+carve — grade envelope, water bridging, tile stamp, all class-true.
        const graph = buildRoadGraph(connections, pois, map.tiles, fields, { reliefM: style.mountainRelief });
        graph.rev = (exprSeq += 100);   // unique per expression → deformation/feature-SDF caches re-key
        map.roadGraph = graph;
        reconcileCenterlineBows(map);          // pin bowed splines back onto the walked row
        reconcileRoadTileVisibility(map);      // orphaned carve cells paint honestly
        // The same reconcile worldgen runs AFTER its road carve: trees standing on the
        // fresh road/bridge tiles are cleared, so the crossing isn't swallowed by the
        // riverside canopy. (Flora cleared by a previous expression stays gone until
        // the next regen — the patch regenerates it with the terrain.)
        clearObstructedVegetation(world, map);
        const wet = getRenderWaterMask(map);
        specs = detectCrossings(graph, map.width, {
          isWater: wet, bridgeAt: wet,
          defaults: { era: 'late-medieval', prosperity: 'modest' },
        });
        // The crossing nearest the authored site (a wild seed can yield extra incidental ones).
        const d2 = (s: CrossingSpec): number => {
          const [b0, b1] = bankAnchors(s);
          const mx = (b0.x + b1.x) / 2, my = (b0.y + b1.y) / 2;
          return (mx - pick!.site.x) ** 2 + (my - pick!.site.y) ** 2;
        };
        spec = specs.length ? specs.reduce((a, b) => (d2(b) < d2(a) ? b : a)) : null;
        // Open the crossing SURROUNDS: riverside canopy a tile off the road still
        // overhangs the deck in iso view, hiding the studio's whole subject. A used
        // crossing approach is trampled/cut clear in reality, so fell flora within a
        // small disc of the crossing midpoint.
        if (spec) {
          const [b0, b1] = bankAnchors(spec);
          const mx = (b0.x + b1.x) / 2, my = (b0.y + b1.y) / 2;
          const md = mx + my;    // the crossing's iso depth (screen-y ∝ x+y)
          for (const e of world.query({ kind: 'vegetation' })) {
            const dx = e.x - mx, dy = e.y - my;
            const near = dx * dx + dy * dy <= 6 * 6;   // a disc immediately around the deck
            // Canopy sprites draw UP from their foot, so a tree standing in FRONT (greater
            // iso depth) still overhangs the deck from several tiles back. Clear that forward
            // lobe: trees within a screen-column of the crossing (screen-x ∝ x−y) and 0–9
            // tiles nearer the camera. Without it the studio's whole subject hides under a crown.
            const front = e.x + e.y - md;
            const overhang = front >= 0 && front <= 9 && Math.abs(dx - dy) <= 6;
            if (near || overhang) world.removeEntity(e.id);
          }
        }
      } else {
        map.roadGraph = undefined;
      }
      bumpTilesRev(map);                       // carve/restore mutated tiles in place
      visualMap = Autotiler.computeVisualMap(map);
      expressCrossing();
      refreshDiagnostics();
    }

    // ── full regen (terrain dials) ───────────────────────────────────────────
    async function regenerate(refit = false): Promise<void> {
      const token = ++regenToken;
      // Honest feedback BEFORE the long await: a cold first gen (manifold wasm + a 128²
      // patch + erosion + brushes) is ~50s of black canvas, and silence reads as broken.
      // Set the status the moment we start — the browser paints it before the await blocks.
      sceneTag.textContent = '🏞 generating terrain…';
      readout.textContent = 'generating terrain + hydrology…\n(a cold first patch takes a moment)';
      diagBox.textContent = '';
      // Same site-scale framing as the Site studio: a land patch (island:false), warm
      // shallow-lapse climate, style knobs under `overrides` (bare style is dropped).
      const ws: WorldSeed = {
        name: 'crossing-site-patch', size: { width: PATCH, height: PATCH }, biome: 'temperate',
        pois: [], connections: [], constraints: [],
        island: false,
        climate: { tempNorth: 0.6, tempSouth: 0.74, elevationLapse: 0.18 },
        style: { overrides: { mountainRelief: gen.relief, coastDrama: 0.3, riverDensity: gen.riverDensity } },
        terrainShape: gen.terrain === 'wild' ? undefined : { kind: gen.terrain, strength: 0.9 },
      } as unknown as WorldSeed;
      const res = await generateWithNoise(PATCH, PATCH, gen.seed, ws);
      if (disposed || token !== regenToken) return;
      map = res.map; world = res.world;
      // Rebuild the SAME TerrainField the generator walked (terrainConfigFor is the shared
      // seam), so the authored road grades against the exact elevation the terrain has.
      const config = terrainConfigFor(gen.seed, PATCH, PATCH, ws);
      fields = generateTerrainFields(config);
      fields.elevation = erodeElevation(fields.elevation, PATCH, PATCH, { seed: gen.seed });
      pristine = map.tiles.map((row) => row.map((t) => ({ type: t.type, walkable: t.walkable })));
      pick = pickCrossingSite(map);
      expressRoad();
      if (refit) fitTilesToView(cam, 0, 0, map.width, map.height, cssW, cssH);
    }

    /** Fit the view on the detected crossing (falls back to the site pick / whole patch). */
    function frameCrossing(): void {
      if (!map) return;
      const c = spec
        ? (() => { const [b0, b1] = bankAnchors(spec); return { x: (b0.x + b1.x) / 2, y: (b0.y + b1.y) / 2 }; })()
        : pick?.site;
      if (!c) { fitTilesToView(cam, 0, 0, map.width, map.height, cssW, cssH); return; }
      const R = 14;   // half-window (tiles) — the crossing + both approaches in frame
      fitTilesToView(cam,
        Math.max(0, c.x - R), Math.max(0, c.y - R),
        Math.min(map.width, c.x + R), Math.min(map.height, c.y + R), cssW, cssH);
    }

    // ── readouts ─────────────────────────────────────────────────────────────
    function syncReadout(): void {
      sceneTag.textContent = !map
        ? '🏞 generating…'
        : `🏞 seed ${gen.seed} · ${gen.terrain} · ${spec ? `crossing ${spec.spanTiles}t` : 'no crossing'}`;
      if (!map) { readout.textContent = 'generating…'; return; }
      if (!pick) {
        readout.textContent = '✕ no crossable stream on this patch\n— reroll the seed or raise the stream scale';
        return;
      }
      if (!spec) {
        readout.textContent = '✕ road found a dry route on this seed\n— reroll (authored endpoints straddle the channel, so this is rare)';
        return;
      }
      const tier = currentTier();
      const st = shownCrossingTier(tier, spec.spanTiles);
      const rich = econ.wealth >= RICH_CROSSING_MIN;
      let earned = 0;
      for (let t = 1; t < CROSSING_EARN_USE.length; t++) if (econ.use >= CROSSING_EARN_USE[t]) earned = t;
      const mv = minViableTier(spec.spanTiles);
      const edgeCls = map.roadGraph?.edges.find((e) => e.feature === 'road')?.class ?? econ.cls;
      readout.textContent =
        `channel       ${spec.spanTiles}t (${spec.spanTiles * 2} m) · axis ${pick.axis}\n` +
        `crossings     ${specs.length} on the edge (class ${edgeCls})\n` +
        `── economy ──\n` +
        `earned rung   ${earned}\n` +
        `class cap     ${CLASS_CROSSING_TIER[econ.cls]} (${econ.cls})\n` +
        `lag           ${rich ? `0 (rich ≥ ${RICH_CROSSING_MIN})` : String(CROSSING_LAG)}\n` +
        `tier          ${tier} — ${CROSSING_TIER_LABELS[tier]}\n` +
        `── span verdict ──\n` +
        `min viable    ${mv === null ? 'NONE — a ferry, not a bridge' : `tier ${mv} (${CROSSING_TIER_LABELS[mv]})`}\n` +
        `earned spans  ${tierSpans(tier, spec.spanTiles) ? `yes (≤ ${CROSSING_TIER_MAX_SPAN_T[tier]}t)` : `NO (max ${CROSSING_TIER_MAX_SPAN_T[tier]}t)`}\n` +
        (econ.fitted
          ? `showing       worldgen-fitted span (buildBridgeObject)`
          : st.ferry
            ? `showing       tier ${st.shown} for display — nothing spans ${spec.spanTiles}t`
            : st.downgraded
              ? `showing       tier ${st.shown} (${CROSSING_TIER_LABELS[st.shown]}) — min viable for this water`
              : `showing       tier ${st.shown} (${CROSSING_TIER_LABELS[st.shown]}) · seed ${econ.varietySeed}`);
    }

    function refreshDiagnostics(): void {
      let ds: Diagnostic[] = [];
      try { ds = evaluateConnectome({ world, map }).diagnostics; } catch { /* linter is best-effort */ }
      if (!ds.length) { diagBox.innerHTML = '<span style="color:#7bd88f">✓ no issues</span>'; return; }
      const sev: Record<string, string> = { error: '#ff6b6b', warn: '#ffd166', info: '#8ab4f8' };
      diagBox.replaceChildren();
      for (const d of ds.slice(0, 10)) {
        diagBox.appendChild(h('div', { style: `color:${sev[d.severity] ?? '#aaa'}`, text: `• ${d.rule}: ${d.message}` }));
      }
      if (ds.length > 10) diagBox.appendChild(h('div', { class: 'sg-muted', text: `… +${ds.length - 10} more` }));
    }

    // ── GPU renderer + frame loop ────────────────────────────────────────────
    const { render } = await createGpuRenderMap({ canvas: sceneCanvas });
    if (disposed) return;

    function renderContext(): RenderContext {
      return {
        map, camera: cam, canvasWidth: cssW, canvasHeight: cssH,
        npcs: [], npcSheets: new Map(),
        world, lighting, visualMap: visualMap ?? undefined,
        devMode: dev as unknown,
        // Folds into the static draw-cache art-rev debounce so flora/bridge sprites
        // texture in as their async packs settle (without it the first draw-list
        // snapshot freezes dot/flatblock placeholders forever — game parity).
        buildingArtRev: buildingSource.version() + plantSource.version() + barrierSource.version(),
        resolveParametricBuildingArt: (e: Entity) => { const s = buildingSource.peek(e); if (s) return s; buildingSource.warm(e); return null; },
        resolveParametricPlantArt: (kind: string) => { const s = plantSource.peek(kind); if (s) return s; plantSource.warm(kind); return null; },
        resolveParametricBarrierArt: (e: Entity) => { const s = barrierSource.peek(e); if (s) return s; barrierSource.warm(e); return null; },
        studioNoChrome: true,
      } as unknown as RenderContext;
    }
    function frame(): void {
      if (disposed) return;
      if (map) render(ctx, renderContext());
      zoomBar.refresh();
      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);

    await regenerate(true);

    // Scripting hook (studio-only, mirrors __siteStudio/__crossings).
    (window as unknown as { __crossingSite?: unknown }).__crossingSite = {
      /** Economy/terrain dial poke; re-expresses in place (cls re-walks the road). */
      set(opts: Partial<{ use: number; wealth: number; cls: RoadClass; varietySeed: number; fitted: boolean }>): CrossingTier {
        let roadDirty = false;
        if (opts.use !== undefined) econ.use = opts.use;
        if (opts.wealth !== undefined) econ.wealth = opts.wealth;
        if (opts.varietySeed !== undefined) econ.varietySeed = opts.varietySeed;
        if (opts.fitted !== undefined) { econ.fitted = opts.fitted; fitChk.checked = opts.fitted; }
        if (opts.cls !== undefined && opts.cls !== econ.cls) { econ.cls = opts.cls; clsSel.value = opts.cls; roadDirty = true; }
        if (roadDirty) expressRoad(); else expressCrossing();
        return currentTier();
      },
      /** Terrain dial poke — regenerates the patch. */
      setTerrain(opts: Partial<{ seed: number; terrain: typeof gen.terrain; relief: number; riverDensity: number }>): Promise<void> {
        if (opts.seed !== undefined) { gen.seed = opts.seed >>> 0; seedInput.value = String(gen.seed); }
        if (opts.terrain !== undefined) { gen.terrain = opts.terrain; terSel.value = opts.terrain; }
        if (opts.relief !== undefined) gen.relief = opts.relief;
        if (opts.riverDensity !== undefined) gen.riverDensity = opts.riverDensity;
        return regenerate();
      },
      regen: (seed?: number) => {
        if (seed != null) { gen.seed = seed >>> 0; seedInput.value = String(gen.seed); }
        return regenerate();
      },
      map: () => map,
      frame: () => frameCrossing(),
      state: () => ({ ...gen, ...econ, pick, crossings: specs.length, spanTiles: spec?.spanTiles ?? null }),
      /** Read-only inspector: the crossing structure entities + whether their sprite has
       *  composed yet (mirrors __siteStudio). Handy from the bus/console while tuning. */
      bridges: () => bridgeIds.map((id) => {
        const e = world.query({}).find((x) => x.id === id);
        if (!e) return { id, missing: true };
        return {
          id: e.id, kind: e.kind, x: e.x, y: e.y,
          liftElev: (e.properties as { liftElev?: number }).liftElev,
          composed: buildingSource.peek(e) ? true : false,
        };
      }),
      grab: () => {
        // A WebGPU canvas detaches its swap chain after present — render one fresh frame
        // and read it back in the SAME task (the debug-api capture lesson).
        if (map) render(ctx, renderContext());
        const out = document.createElement('canvas');
        out.width = sceneCanvas.width; out.height = sceneCanvas.height;
        const g = out.getContext('2d')!;
        g.drawImage(sceneCanvas, 0, 0); g.drawImage(canvas, 0, 0);
        return out.toDataURL('image/png');
      },
    };
  })();

  return { dispose };
}
