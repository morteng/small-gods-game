// src/studio/studio.ts
// Render Studio — an uncluttered, single-object scene that reuses the EXACT
// game render path (iso terrain + the PixiJS lit entity layer + cast shadows)
// AND the EXACT game camera controls (drag-pan, wheel-zoom on the pixel-perfect
// iso ladder via `attachControls`), so lighting / shadows / sprite anchoring can
// be verified in isolation. Boot with `?studio` (optionally `?studio=oak_tree`).
//
// Layout: a resizable VIEW PANE (top) over a docked PIPELINE-STAGES strip
// (bottom). The sources retain every compose buffer per asset (keepStages), so
// the strip fills automatically — no capture step. Click a stage to inspect it
// in the view pane. A "Render via OpenRouter" flow shows the full outgoing
// request (prompt, model, init image, body) for review BEFORE it is sent, then
// runs the real img2img → chroma-key → register → quantize chain and appends
// each step as a further stage.
import type { Entity, GameMap, Tile, RenderContext } from '@/core/types';
import { World } from '@/world/world';
import { createGpuRenderMap } from '@/render/gpu/gpu-renderer';
import type { RenderFn } from '@/render/select-renderer';
import { worldToScreen } from '@/render/iso/iso-projection';
import { floorIsoZoom, quantizeToRungs, ISO_ZOOM_RUNGS, ISO_ZOOM_MIN, ISO_ZOOM_MAX } from '@/render/iso/iso-camera';
import { createCamera, zoomAt } from '@/render/camera';
import { attachControls } from '@/ui/controls';
import { DEFAULT_LIGHTING, normalizeVec3, type Vec3 } from '@/render/lighting-state';
import { structureResultToPack } from '@/render/parametric-building-source';
import { composeStructure, type StructureResult } from '@/assetgen/compose';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { BUILDING_BLUEPRINTS, synthesizeBlueprint, resolveAsset, isPlantPreset } from '@/blueprint/presets';
import type { ResolvedBlueprint, Descriptors, Era } from '@/blueprint/types';
import { blueprintEntity } from '@/blueprint/entity';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { getPartType } from '@/blueprint/registry';
import type { ParamSchema } from '@/blueprint/param-schema';
import type { SpritePack } from '@/render/iso/sprite-canvas';
import { greyToSpriteCanvas, greyToDataUri, rgbaToCanvas, type SpriteCanvas } from '@/render/iso/sprite-canvas';
import { initManifoldWasm } from '@/assetgen/geometry/manifold-wasm-browser';
// img2img generation pipeline (the real paid path, surfaced step-by-step).
import { buildingImagePrompt } from '@/assetgen/building-image-prompt';
import { compositeOverChroma, chromaKeyMagenta } from '@/render/chroma-key';
import { generateBuildingImage, BuildingImageError, BUILDING_IMAGE_MODEL, defaultModalitiesFor } from '@/llm/openrouter-image-client';
import { loadProviderConfig, openrouterImageBaseUrl } from '@/llm/provider-factory';
import { decodePngToRaster, rasterToSpriteCanvas } from '@/render/sprite-codec';
import { canonicalJson, generatedArtKey } from '@/render/generated-art-cache';
import { assetUrl } from '@/core/asset-url';
import {
  type Raster, cropRaster, borderKeyedFraction, registerAlbedo, quantizePalette,
} from '@/render/sprite-postprocess';
import { buildAccordion } from './accordion';
import { buildObjectBrowser } from './object-browser';
import { buildAbSection } from './ab-section';
import { buildTree } from './blueprint-tree';
import { buildToolbar } from './toolbar';
import { buildBottomPanel } from './bottom-panel';
import { buildDock } from './stage-dock';
import { openMetadataPanel, makeLiveButton } from './render-request-panel';
import { injectStudioTheme, COLORS, h } from './theme';
import { celestial, solarLight } from './solar';
import { type StudioState, type Stage, type AbResult, AB_MODELS, AB_MIN_BORDER, AB_MIN_IOU } from './types';

const MAP_W = 24, MAP_H = 24;
const CENTER = { x: 12, y: 12 };
// The studio is an inspection tool, so it zooms one rung PAST the game's 1:1 cap
// (to 2× native) to scrutinise detail. Fit still snaps to ≤1:1 (pixel-perfect).
const STUDIO_ZOOM_MAX = 2;
const STUDIO_ZOOM_RUNGS = [...ISO_ZOOM_RUNGS, STUDIO_ZOOM_MAX];
const quantizeStudioZoom = (z: number, dir: -1 | 0 | 1 = 0): number =>
  quantizeToRungs(STUDIO_ZOOM_RUNGS, z, dir);
const MIN_DOCK = 90, MAX_DOCK_FRAC = 0.6, DEFAULT_DOCK = 170;
const MIN_TREE_W = 200, MAX_TREE_W = 560, DEFAULT_TREE_W = 320;

function flatMap(): GameMap {
  const tiles: Tile[][] = Array.from({ length: MAP_H }, (_, y) =>
    Array.from({ length: MAP_W }, (_, x) =>
      ({ x, y, type: 'grass', walkable: true, state: 'realized' }) as unknown as Tile));
  return {
    tiles, width: MAP_W, height: MAP_H, villages: [], seed: 1, success: true,
    worldSeed: null as unknown as GameMap['worldSeed'],
    stats: { iterations: 0, backtracks: 0 }, buildings: [],
  } as GameMap;
}

/** Build the single studio entity for `kind` at the map centre. Plant kinds are
 *  lean veg entities (no blueprint); buildings/props are blueprint entities. */
function makeEntity(kind: string): Entity {
  if (isPlantPreset(kind)) {
    return { id: 'subject', kind, x: CENTER.x, y: CENTER.y,
      tags: ['vegetation'], properties: { category: 'vegetation' } } as Entity;
  }
  const rb = synthesizeBlueprint(kind);
  if (rb) return blueprintEntity('subject', rb, CENTER.x, CENTER.y);
  return { id: 'subject', kind, x: CENTER.x, y: CENTER.y, properties: {} } as Entity;
}

function sunDir(az: number, el: number): Vec3 {
  const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
  return normalizeVec3([-Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)]);
}

/** One paid render's metrics + harvested images (PNG data-URIs). Returned by the
 *  programmatic harvest interface (window.__studio.render) so a dev loop can run a
 *  render and pull the raw / registered / finished sprite + the gate metrics. */
export interface RenderResult {
  kind: string; model: string; ok: boolean;
  costUsd: number; border: number; iou: number; verdict: string;
  rawDataUri: string | null;        // FLUX output, chroma background
  registeredDataUri: string | null; // registered onto the geometry silhouette
  finalDataUri: string | null;      // palette-quantized, game-ready albedo
}

export function mountStudio(container: HTMLElement): void {
  // World-overview mode (?studio=world): the real default world on the GPU
  // renderer with the whole-world connectome overlay, separate from the
  // single-object editor below.
  if (new URLSearchParams(location.search).get('studio') === 'world') {
    void import('@/studio/world-studio').then(({ mountWorldStudio }) => mountWorldStudio(container));
    return;
  }

  ensureBuildingTypesRegistered();
  initManifoldWasm();

  container.style.position = 'relative';
  container.style.background = COLORS.bg0;
  injectStudioTheme(container);

  // ── paned scaffold: [tree | vSplit | (toolbar / view / hSplit / dock)] ────
  const root = h('div', { style: 'position:absolute;inset:0;display:flex;flex-direction:row;overflow:hidden' });
  // Left: the object browser + geometry inspector. Resizable.
  const tree = h('div', { class: 'sg-panel', style: `flex:0 0 auto;width:${DEFAULT_TREE_W}px;border-right:1px solid var(--line);overflow:auto` });
  const vSplitter = h('div', { class: 'sg-splitter sg-splitter-col', style: 'flex:0 0 6px' });
  const mainCol = h('div', { style: 'flex:1 1 auto;min-width:0;display:flex;flex-direction:column;overflow:hidden' });
  const toolbarHost = h('div', { style: 'flex:0 0 auto' });
  const viewPane = h('div', { style: 'position:relative;flex:1 1 auto;min-height:0;overflow:hidden' });
  const splitter = h('div', { class: 'sg-splitter sg-splitter-row', style: 'flex:0 0 6px' });
  const dock = h('div', { class: 'sg-panel', style: 'flex:0 0 auto;height:170px;border-top:1px solid var(--line);overflow:hidden' });
  mainCol.append(toolbarHost, viewPane, splitter, dock);
  root.append(tree, vSplitter, mainCol);
  container.appendChild(root);

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100%;display:block';
  viewPane.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;

  const map = flatMap();
  const world = new World(map);
  // Bake the geometry cast shadow with the studio's LIVE sun so the sun sliders
  // actually move it (the game uses the canonical sun). Caches clear on a sun
  // change so the next warm() recomputes. keepStages retains every compose buffer
  // per asset for the stage strip (no manual capture).
  const liveSun = (): [number, number, number] => sunDir(state.az, state.el);

  // ── unified subject source ────────────────────────────────────────────────
  // The studio holds ONE live ResolvedBlueprint (`liveRb`); the node-tree editor
  // mutates it in place. Geometry for EVERY kind (building/prop/plant) flows from
  // this single blueprint: compose → SpritePack, cached & keyed by the blueprint's
  // JSON so an edit busts the cache and re-warms. The full StructureResult is always
  // retained for the pipeline strip. Both render-path resolvers read this one source.
  let liveRb: ResolvedBlueprint | null = null;
  const subjPacks = new Map<string, SpritePack | null>();
  const subjStages = new Map<string, StructureResult>();
  const subjInflight = new Set<string>();
  // The skirt is a geometry option, so it belongs in the cache key (toggling it must
  // re-compose). Keyed alongside the blueprint JSON.
  const rbKey = (rb: ResolvedBlueprint): string => JSON.stringify(rb) + (state.skirt ? `|skirt:${state.skirt.margin}:${state.skirt.fade}` : '');
  function warmSubject(): void {
    if (!liveRb) return;
    const rb = liveRb, k = rbKey(rb);
    if (subjPacks.has(k) || subjInflight.has(k)) return;
    subjInflight.add(k);
    composeStructure(
      toGeometry(rb, state.skirt ? { skirt: { margin: state.skirt.margin } } : undefined),
      liveSun(),
      state.skirt ? { skirtFade: state.skirt.fade } : undefined,
    )
      .then((r) => { subjStages.set(k, r); subjPacks.set(k, structureResultToPack(r)); })
      .catch((err) => { console.warn('[studio] compose failed', err); subjPacks.set(k, null); })
      .finally(() => { subjInflight.delete(k); });
  }
  const peekSubject = (): SpritePack | null => (liveRb ? (subjPacks.get(rbKey(liveRb)) ?? null) : null);
  const stagesSubject = (): StructureResult | null => (liveRb ? (subjStages.get(rbKey(liveRb)) ?? null) : null);

  // The FINISHED img2img sprite from the seeded library (if one exists for this
  // exact blueprint), loaded with NO API call so the pipeline strip can show the
  // real painted art alongside the geometry channels. `undefined` = not looked up
  // yet, `null` = looked up, none in the library.
  const subjFinished = new Map<string, SpriteCanvas | null>();
  let baseManifest: Promise<Record<string, { file: string }> | null> | null = null;
  function warmFinished(): void {
    if (!liveRb) return;
    const rb = liveRb, k = rbKey(rb);
    if (subjFinished.has(k)) return;
    subjFinished.set(k, null);   // mark in-flight; replaced on success
    (async () => {
      baseManifest ??= (async () => {
        try {
          const resp = await fetch(assetUrl('asset-library/building-sprites/manifest.json'));
          if (!resp.ok) return null;
          const json = await resp.json() as { entries?: Record<string, { file: string }> };
          return json.entries ?? null;
        } catch { return null; }
      })();
      const entries = await baseManifest;
      const artKey = generatedArtKey(canonicalJson(rb), BUILDING_IMAGE_MODEL, rb.footprint);
      const entry = entries?.[artKey];
      if (!entry) return;
      const resp = await fetch(assetUrl(`asset-library/building-sprites/${entry.file}`));
      if (!resp.ok) return;
      const raster = await decodePngToRaster(await resp.blob());
      if (raster) subjFinished.set(k, rasterToSpriteCanvas(raster));
    })().catch(() => {});
  }
  const finishedSubject = (): SpriteCanvas | null => (liveRb ? (subjFinished.get(rbKey(liveRb)) ?? null) : null);

  // The pack the LIVE 3D view renders. Geometry massing by default; when a finished
  // img2img sprite exists for this blueprint (session render or seeded library) and the
  // 'Textured' display option is on, swap its painted albedo onto the massing pack's
  // co-registered normal/material/shadow maps — so the game-ready textured object is
  // lit on grass with the real geometry normals. The painted sprite is registered onto
  // the same bbox crop as the massing albedo, so the maps stay aligned.
  function litSubjectPack(): SpritePack | null {
    const massing = peekSubject();
    if (!massing) { warmSubject(); return null; }
    warmFinished();
    if (!state.textured) return massing;
    const fin = finishedSubject();
    if (fin && fin.width === massing.albedo.width && fin.height === massing.albedo.height) {
      return { ...massing, albedo: fin };
    }
    return massing;
  }
  const invalidate = (): void => { subjPacks.clear(); subjStages.clear(); subjInflight.clear(); subjFinished.clear(); };
  // WebGPU scene renderer (async bring-up). Until it resolves, the frame loop
  // paints only the background; the GPU canvas composites once ready.
  let renderMap: RenderFn | null = null;
  void createGpuRenderMap().then((r) => { renderMap = r.render; });

  const params = new URLSearchParams(location.search);
  const initial = (params.get('studio') && params.get('studio') !== '1') ? params.get('studio')! : 'oak_tree';

  const state: StudioState = {
    kind: BUILDING_BLUEPRINTS[initial] ? initial : 'oak_tree',
    lighting: { ...DEFAULT_LIGHTING, shadowMode: 'geometry' },
    az: 41, el: 40,
    sunMode: 'solar',
    hour: 15, yearFrac: 0.3, lat: 45, moonPhase: 1,
    overlays: true,
    textured: true,
    fit: true,
    skirt: null,
    dockH: DEFAULT_DOCK,
    view: null,
  };
  // In solar mode, derive az/el (sun by day, moon by night) from time/season/moon.
  // `commit` re-bakes the geometry cast shadow (skip it for cheap live drags).
  function recomputeSun(commit = true): void {
    if (state.sunMode !== 'solar') return;
    const c = celestial(state.hour, state.yearFrac, state.lat, state.moonPhase);
    state.az = Math.round(c.az); state.el = Math.round(c.el);
    if (commit) invalidate();   // direction moved → re-bake the geometry cast shadow
  }
  recomputeSun();

  let subject: Entity = makeEntity(state.kind);
  liveRb = synthesizeBlueprint(state.kind) ?? null;
  // Per-subject extra stages produced by the OpenRouter render flow.
  let genStages: Stage[] = [];
  // The metrics + harvested images from the most recent paid render (for the
  // programmatic harvest interface, window.__studio.render/last).
  let lastRender: RenderResult | null = null;
  // Assigned once the node-tree panel is built; called on subject/param change.
  let rebuildTree: () => void = () => {};
  // Assigned once the object browser is built; re-highlights the current kind.
  let browserRefresh: () => void = () => {};
  // The variant currently applied to the subject (era + descriptors); reset when
  // the subject changes. Non-empty ⇒ rebuild liveRb via resolveAsset.
  let liveEra: Era | undefined;
  let liveDescriptors: Descriptors = {};
  let liveStage: string | undefined;       // lifecycle stage (sapling/ruin/…)
  function setSubject(kind: string): void {
    state.kind = kind;
    world.removeEntity('subject');
    liveEra = undefined;
    liveDescriptors = {};
    liveStage = undefined;
    liveRb = synthesizeBlueprint(kind) ?? null;
    invalidate();
    genStages = [];
    state.view = null;
    subject = makeEntity(kind);
    world.addEntity(subject);
    rebuildTree();
    browserRefresh();
  }
  // Rebuild the subject from the current era + descriptor variant — resolveAsset
  // layers the era patch (period materials/features) + descriptor patch and records
  // both on the blueprint. A bare variant falls back to synthesizeBlueprint.
  function rebuildVariant(): void {
    const hasVariant = !!liveEra || !!liveStage || Object.keys(liveDescriptors).length > 0;
    liveRb = (hasVariant
      ? resolveAsset({ type: state.kind, era: liveEra, descriptors: liveDescriptors, stage: liveStage })
      : synthesizeBlueprint(state.kind)) ?? liveRb;
    onBlueprintReplaced();
    browserRefresh();
  }
  const applyVariant = (d: Descriptors): void => { liveDescriptors = d; rebuildVariant(); };
  const applyEra = (era: Era | undefined): void => { liveEra = era; rebuildVariant(); };
  const applyStage = (stage: string | undefined): void => { liveStage = stage; rebuildVariant(); };
  // A live VALUE edit on the tree mutated liveRb in place: bust geometry caches + drop
  // stale generation stages / pinned stage view, then RE-WARM. Crucially it does NOT
  // rebuild the tree DOM — doing so on every edit collapses every node and drops focus
  // mid-edit (the input already shows the new value). The summary tally goes briefly
  // stale until the next structural rebuild; that's the right trade for a usable editor.
  function onValueEdited(): void {
    invalidate();
    genStages = [];
    state.view = null;
  }
  // The blueprint was REPLACED wholesale (new kind / variant / randomize): re-warm AND
  // rebuild the tree DOM so it reflects the new structure.
  function onBlueprintReplaced(): void {
    onValueEdited();
    rebuildTree();
  }
  world.addEntity(subject);

  function subjectPack(): { albedo: { width: number; height: number } } | null {
    return peekSubject() as unknown as { albedo: { width: number; height: number } } | null;
  }
  const zoomLabel = (z: number): string =>
    z >= 1 ? (z === 1 ? '1:1' : `${Math.round(z)}×`) : `1/${Math.round(1 / z)}`;

  // ── camera (shares the game's Camera + attachControls) ───────────────────
  function viewport(): { w: number; h: number; dpr: number } {
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    const r = viewPane.getBoundingClientRect();
    return { w: Math.max(1, r.width), h: Math.max(1, r.height), dpr };
  }
  function resize(): void {
    const { w, h, dpr } = viewport();
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  new ResizeObserver(resize).observe(viewPane);
  resize();

  const cam = createCamera();
  function fitCamera(): void {
    const { w, h } = viewport();
    const foot = worldToScreen(CENTER.x, CENTER.y, 0, 0, 0);
    const pack = subjectPack();
    const pw = pack?.albedo?.width ?? 0, ph = pack?.albedo?.height ?? 0;
    // Snap DOWN to a natural ladder rung (integer / 1-over-integer), ~16% margin
    // on the constraining axis, so the whole subject fits at a 1:1 pixel scale.
    const z = pw && ph ? Math.min((h * 0.84) / ph, (w * 0.84) / pw) : cam.zoom || 1;
    cam.zoom = floorIsoZoom(Math.max(ISO_ZOOM_MIN, Math.min(ISO_ZOOM_MAX, z)));
    // Centre the subject's full vertical extent (foot-anchored billboard spans
    // [foot.sy − ph, foot.sy] → mid is foot.sy − ph/2), so short buildings and
    // tall trees both frame with no empty sky. Foot-low fallback pre-warm.
    cam.x = foot.sx - w / (2 * cam.zoom);
    cam.y = ph ? foot.sy - ph / 2 - h / (2 * cam.zoom) : foot.sy - (h * 0.55) / cam.zoom;
  }
  function stepZoom(dir: -1 | 1): void {
    const { w, h } = viewport();
    state.fit = false;
    zoomAt(cam, dir > 0 ? 1.1 : 0.9, w / 2, h / 2, quantizeStudioZoom, STUDIO_ZOOM_MAX);
  }
  attachControls(canvas, cam, {
    getZoomQuantize: () => quantizeStudioZoom,
    getMaxZoom: () => STUDIO_ZOOM_MAX,
    onUserCameraInput: () => { state.fit = false; },
    onRedraw: () => {},
  });

  function renderContext(): RenderContext {
    const { w, h } = viewport();
    state.lighting.sunDir = sunDir(state.az, state.el);
    // Light colour tracks the sky: in solar mode the full day/night ramp
    // (golden-hour → noon → moonlit night); in manual mode just the elevation
    // ramp (no moon — manual is for inspecting a fixed sun angle).
    if (state.sunMode === 'solar') {
      const c = celestial(state.hour, state.yearFrac, state.lat, state.moonPhase);
      state.lighting.ambient = c.ambient;
      state.lighting.sunColor = c.sunColor;
    } else {
      const l = solarLight(state.el);
      state.lighting.ambient = l.ambient;
      state.lighting.sunColor = l.sunColor;
    }
    if (state.fit) fitCamera();
    return {
      map, camera: cam, canvasWidth: w, canvasHeight: h,
      npcs: [], npcSheets: new Map(), treeSheets: new Map(),
      world, lighting: state.lighting,
      resolveParametricBuildingArt: litSubjectPack,
      resolveParametricPlantArt: litSubjectPack,
    } as unknown as RenderContext;
  }

  // ── view pane: live render OR a stage buffer ─────────────────────────────
  function paintChecker(w: number, h: number): void {
    for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) {
      ctx.fillStyle = ((x + y) / 16) % 2 ? COLORS.checkerA : COLORS.checkerB;
      ctx.fillRect(x, y, 16, 16);
    }
  }
  // Stage-view pan/zoom (independent of the 3D camera). `zoom===0` means "fit";
  // a wheel/drag promotes it to an explicit scale. Reset whenever the shown
  // buffer changes (selecting a different stage re-fits).
  const stageNav = { canvas: null as SpriteCanvas | null, zoom: 0, panX: 0, panY: 0 };
  function stageFitScale(c: SpriteCanvas): number {
    const { w, h } = viewport(); const pad = 24;
    return Math.max(0.05, Math.min((w - pad * 2) / c.width, (h - pad * 2) / c.height));
  }
  function drawStageInPane(c: SpriteCanvas): void {
    const { w, h } = viewport();
    if (c !== stageNav.canvas) { stageNav.canvas = c; stageNav.zoom = 0; stageNav.panX = 0; stageNav.panY = 0; }
    ctx.clearRect(0, 0, w, h);
    paintChecker(w, h);
    // Below ~1px/texel, integer snapping collapses detail; keep an integer scale
    // when fitting/zoomed-in for crisp pixels, but allow fractional when fit < 1.
    const fit = stageFitScale(c);
    const raw = stageNav.zoom > 0 ? stageNav.zoom : fit;
    const s = raw >= 1 ? Math.round(raw) : raw;
    const dw = c.width * s, dh = c.height * s;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(c as CanvasImageSource, Math.round((w - dw) / 2) + stageNav.panX, Math.round((h - dh) / 2) + stageNav.panY, dw, dh);
  }

  // ── debug overlays + HUD ─────────────────────────────────────────────────
  function drawOverlays(camv: { x: number; y: number; zoom: number }): void {
    if (!state.overlays) return;
    const z = camv.zoom;
    ctx.save();
    ctx.scale(z, z);
    ctx.translate(Math.round(-camv.x * z) / z, Math.round(-camv.y * z) / z);
    ctx.lineWidth = 1 / z;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const tx = CENTER.x + dx, ty = CENTER.y + dy;
        const n = worldToScreen(tx, ty, 0, 0, 0);
        const e = worldToScreen(tx + 1, ty, 0, 0, 0);
        const s = worldToScreen(tx + 1, ty + 1, 0, 0, 0);
        const wp = worldToScreen(tx, ty + 1, 0, 0, 0);
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.beginPath();
        ctx.moveTo(n.sx, n.sy); ctx.lineTo(e.sx, e.sy); ctx.lineTo(s.sx, s.sy); ctx.lineTo(wp.sx, wp.sy); ctx.closePath();
        ctx.stroke();
      }
    }
    const c = worldToScreen(CENTER.x, CENTER.y, 0, 0, 0);
    ctx.strokeStyle = 'rgba(255,80,80,0.9)';
    ctx.beginPath();
    ctx.moveTo(c.sx - 8, c.sy); ctx.lineTo(c.sx + 8, c.sy);
    ctx.moveTo(c.sx, c.sy - 8); ctx.lineTo(c.sx, c.sy + 8);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,80,80,0.9)';
    ctx.beginPath(); ctx.arc(c.sx, c.sy, 2.2 / z + 1, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  // A compact sun-direction gizmo, tucked top-left (the toolbar carries the text
  // status now). Drawn only in the live 3D view.
  function drawHud(): void {
    if (!state.overlays) return;
    const d = sunDir(state.az, state.el);
    const gx = 44, gy = 44, R = 26;
    ctx.save();
    ctx.fillStyle = 'rgba(12,13,17,0.55)';
    ctx.beginPath(); ctx.arc(gx, gy, R + 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(gx, gy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = COLORS.accent; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + d[0] * R, gy - d[1] * R); ctx.stroke();
    ctx.fillStyle = COLORS.accent; ctx.beginPath(); ctx.arc(gx + d[0] * R, gy - d[1] * R, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ── stage-view interaction overlay (wheel-zoom + drag-pan a stage buffer) ──
  // A transparent layer that only captures pointer events while a stage is shown,
  // so the 3D camera's attachControls keeps the canvas to itself in Live mode.
  const stageOverlay = document.createElement('div');
  stageOverlay.style.cssText = 'position:absolute;inset:0;z-index:9;display:none;cursor:grab';
  viewPane.appendChild(stageOverlay);
  stageOverlay.addEventListener('wheel', (e) => {
    if (!state.view) return;
    e.preventDefault();
    const c = state.view.canvas;
    const base = stageNav.zoom > 0 ? stageNav.zoom : stageFitScale(c);
    const next = Math.max(0.1, Math.min(64, base * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    // Zoom about the cursor: keep the texel under the pointer fixed.
    const r = viewPane.getBoundingClientRect();
    const px = e.clientX - r.left - r.width / 2 - stageNav.panX;
    const py = e.clientY - r.top - r.height / 2 - stageNav.panY;
    const k = next / base - 1;
    stageNav.panX -= px * k; stageNav.panY -= py * k;
    stageNav.zoom = next;
  }, { passive: false });
  stageOverlay.addEventListener('mousedown', (e) => {
    if (!state.view) return;
    e.preventDefault();
    stageOverlay.style.cursor = 'grabbing';
    const sx = e.clientX, sy = e.clientY, p0x = stageNav.panX, p0y = stageNav.panY;
    const move = (ev: MouseEvent) => { stageNav.panX = p0x + (ev.clientX - sx); stageNav.panY = p0y + (ev.clientY - sy); };
    const up = () => { stageOverlay.style.cursor = 'grab'; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  });
  stageOverlay.addEventListener('dblclick', () => { if (state.view) { stageNav.zoom = 0; stageNav.panX = 0; stageNav.panY = 0; } });

  // ── bottom dock: Pipeline (compose/gen stages) + A/B Compare tabs ────────
  const bottom = buildBottomPanel(dock);
  const dockUi = buildDock(bottom.pipelineBody);
  buildAbSection(bottom.abBody, {
    models: AB_MODELS,
    defaultA: BUILDING_IMAGE_MODEL, defaultB: 'google/gemini-2.5-flash-image',
    keyStatus: () => {
      const cfg = loadProviderConfig();
      return cfg.openrouterApiKey ? 'configured key' : (openrouterImageBaseUrl() ? 'dev proxy key (env)' : 'NO KEY — will fail');
    },
    getKind: () => state.kind,
    run: runAbPair,
    onView: (c, label) => { state.view = { canvas: c, label }; },
  });
  const liveBtn = makeLiveButton(viewPane, () => { state.view = null; });
  function composeStages(r: StructureResult): Stage[] {
    return [
      { label: '1 · albedo (material-colour init)', canvas: rgbaToCanvas(r.grey, r.size, r.size) },
      { label: '2 · normal', canvas: rgbaToCanvas(r.normal, r.size, r.size) },
      { label: '3 · material (R=id G=AO)', canvas: rgbaToCanvas(r.material, r.size, r.size) },
      { label: '4 · emissive', canvas: rgbaToCanvas(r.emissive, r.size, r.size) },
      { label: '5 · ground shadow', canvas: r.shadow ? rgbaToCanvas(r.shadow.data, r.shadow.w, r.shadow.h) : null },
      { label: '6 · final crop', canvas: greyToSpriteCanvas(r.grey, r.size, r.bbox) },
    ];
  }
  let shownStruct: StructureResult | null = null;
  let shownGenLen = -1;
  let shownFinished: SpriteCanvas | null = null;
  function syncStages(): void {
    warmFinished();
    const r = stagesSubject();
    const finished = finishedSubject();
    if (r === shownStruct && genStages.length === shownGenLen && finished === shownFinished) return;
    shownStruct = r; shownGenLen = genStages.length; shownFinished = finished;
    if (!r) { dockUi.message('generating…'); return; }
    // The seeded library's finished sprite (free, no API) when one exists for this
    // blueprint — shown as the '★' stage so finished art is visible without paying.
    const libStage: Stage[] = finished
      ? [{ label: '★ seeded sprite (finished)', canvas: finished, sub: 'from library' }]
      : [];
    const tiles = [...composeStages(r), ...libStage, ...genStages];
    dockUi.render(
      `${state.kind}  ·  canvas ${r.size}²  ·  crop ${Math.round(r.bbox.w)}×${Math.round(r.bbox.h)}`,
      tiles,
      (st) => { if (st.canvas) { state.view = { canvas: st.canvas, label: st.label }; } },
    );
  }

  let raf = 0;
  function frame(): void {
    if (state.view) {
      drawStageInPane(state.view.canvas);
      const c = state.view.canvas;
      const s = stageNav.zoom > 0 ? stageNav.zoom : stageFitScale(c);
      liveBtn.show(`${state.view.label}  ·  ${s >= 1 ? `${Math.round(s)}×` : `${(s * 100) | 0}%`} (scroll=zoom, drag=pan, dbl=reset)`);
      stageOverlay.style.display = 'block';
    } else {
      stageOverlay.style.display = 'none';
      const rc = renderContext();
      if (renderMap) renderMap(ctx, rc);
      drawOverlays(rc.camera);
      drawHud();
      liveBtn.hide();
    }
    syncStages();
    toolbar.refresh();
    raf = requestAnimationFrame(frame);
  }

  // ── splitter drag (resize dock vs view pane) ─────────────────────────────
  splitter.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startY = e.clientY, startH = state.dockH;
    const move = (ev: MouseEvent) => {
      const maxH = container.getBoundingClientRect().height * MAX_DOCK_FRAC;
      state.dockH = Math.max(MIN_DOCK, Math.min(maxH, startH + (startY - ev.clientY)));
      dock.style.height = `${state.dockH}px`;
      resize();
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  });

  // ── vertical splitter drag (resize node-tree vs main column) ─────────────
  vSplitter.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startX = e.clientX, startW = tree.getBoundingClientRect().width;
    const move = (ev: MouseEvent) => {
      const w = Math.max(MIN_TREE_W, Math.min(MAX_TREE_W, startW + (ev.clientX - startX)));
      tree.style.width = `${w}px`;
      resize();
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  });

  // Randomize the subject for visual exploration. Re-rolling the synthesis seed alone
  // is a no-op for presets with no stochastic params (most buildings), so we ALSO
  // randomize each part's schema-defined params (roof/plan/levels/jetty/…) within range
  // — a real, visible variation. Studio-only dev tooling, so Math.random is fine.
  function randomizeSubject(): void {
    if (!liveRb) return;
    for (const part of liveRb.parts) {
      let schema: ParamSchema;
      try { schema = getPartType(part.type).paramSchema; } catch { continue; }
      for (const [key, spec] of Object.entries(schema)) {
        if (spec.kind === 'enum') {
          part.params[key] = spec.values[Math.floor(Math.random() * spec.values.length)];
        } else if (spec.kind === 'number') {
          // Skip sentinel-default knobs (e.g. storeyM = -1 "use the standard storey").
          if (spec.default === -1) continue;
          const lo = spec.min ?? 0, hi = spec.max ?? 1;
          const v = lo + Math.random() * (hi - lo);
          part.params[key] = Number.isInteger(spec.default) ? Math.round(v) : Math.round(v * 100) / 100;
        } else if (spec.kind === 'bool') {
          part.params[key] = Math.random() < 0.5;
        }
      }
    }
    onBlueprintReplaced();
  }

  // ── left-pane accordion: Object Browser · A/B Compare · Geometry ─────────
  // Three collapsible, vertically-resizable sections. Each body is built once;
  // folding just hides it. The node-tree is the bottom section.
  const accordion = buildAccordion(tree, [
    {
      id: 'browser', title: 'Object Browser', open: true, height: 280,
      build: (body) => {
        const b = buildObjectBrowser(body, {
          getCurrent: () => state.kind,
          onSelect: (kind) => setSubject(kind),
          getDescriptors: () => liveDescriptors,
          onVariant: (d) => applyVariant(d),
          getEra: () => liveEra,
          onEra: (era) => applyEra(era),
          getStage: () => liveStage,
          onStage: (s) => applyStage(s),
        });
        browserRefresh = b.refresh;
      },
    },
    {
      id: 'geometry', title: 'Geometry · Blueprint', open: true, height: 360,
      actions: (host) => {
        host.append(h('button', {
          class: 'sg-btn', style: 'padding:3px 8px', title: 'Re-roll seeded params  (G)',
          html: '🎲 <span style="opacity:.7">Randomize</span>', on: { click: randomizeSubject },
        }));
      },
      build: (body) => {
        const treeUi = buildTree(body, { getRb: () => liveRb, onEdit: onValueEdited });
        rebuildTree = treeUi.render;
        rebuildTree();
      },
    },
  ]);
  void accordion;

  const toolbar = buildToolbar(toolbarHost, state, {
    invalidate, zoomLabel,
    onSolarChange: recomputeSun,
    getZoom: () => cam.zoom,
    zoomIn: () => stepZoom(1),
    zoomOut: () => stepZoom(-1),
    openRender: () => openRenderFlow(),
    getPrompt: () => (liveRb ? buildingImagePrompt(liveRb, BUILDING_IMAGE_MODEL) : ''),
    randomize: randomizeSubject,
    subjectInfo: () => {
      const fp = liveRb?.footprint;
      const axes = [liveEra, liveDescriptors.wealth, liveDescriptors.quality, liveDescriptors.condition, liveStage].filter(Boolean);
      const variant = axes.length ? ` · <span style="color:var(--info)">${axes.join(' · ')}</span>` : '';
      return `<b>${state.kind}</b>${fp ? ` · ${fp.w}×${fp.h}` : ''}${variant}`;
    },
    keyStatus: () => {
      const cfg = loadProviderConfig();
      return cfg.openrouterApiKey ? 'configured key' : (openrouterImageBaseUrl() ? 'dev proxy key' : 'NO KEY');
    },
  });
  frame();

  // ── debug surface (window.__studio) ──────────────────────────────────────
  // A scripting handle so the geometry/prompt can be inspected and captured
  // headlessly (Playwright, dev console) without poking private state. Every
  // method that depends on async geometry resolves only once the sprite pack is
  // warm + a frame has been drawn, so `await __studio.render('cottage')` yields a
  // PNG of the finished geometry — no manual setTimeout/canvas hunting.
  const nextFrame = (): Promise<void> => new Promise(r => requestAnimationFrame(() => r()));
  async function settleGeometry(timeoutMs = 8000): Promise<boolean> {
    warmSubject();
    const start = performance.now();
    while (!peekSubject() && performance.now() - start < timeoutMs) await nextFrame();
    await nextFrame(); await nextFrame();   // let the pack draw into the pane
    return !!peekSubject();
  }
  const studioDebug = {
    /** All available subject presets (buildings + plants). */
    kinds: (): string[] => Object.keys(BUILDING_BLUEPRINTS).sort(),
    /** The current subject kind. */
    get kind(): string { return state.kind; },
    /** Switch subject; resolves once its geometry is warm + drawn. */
    async setKind(kind: string): Promise<boolean> {
      if (!BUILDING_BLUEPRINTS[kind]) throw new Error(`unknown kind "${kind}"`);
      setSubject(kind);
      return settleGeometry();
    },
    /** Force geometry to (re)warm; resolves when a sprite pack exists. */
    warm: (): Promise<boolean> => settleGeometry(),
    /** PNG data-URI of whatever the view pane currently shows. */
    grab: (): string => canvas.toDataURL('image/png'),
    /** setKind + grab in one await — the headless render loop's workhorse. */
    async render(kind?: string): Promise<string> {
      if (kind && kind !== state.kind) await studioDebug.setKind(kind);
      else await settleGeometry();
      return canvas.toDataURL('image/png');
    },
    /** The live ResolvedBlueprint (deep clone — safe to log, won't mutate state). */
    rb: (): unknown => liveRb ? JSON.parse(JSON.stringify(liveRb)) : null,
    /** The exact img2img prompt that would be sent for the current subject. */
    prompt: (): string => (liveRb ? buildingImagePrompt(liveRb, BUILDING_IMAGE_MODEL) : ''),
    /** Re-roll all seeded params, then resolve once redrawn. */
    async randomize(): Promise<boolean> { randomizeSubject(); return settleGeometry(); },
    /** Pin a named pipeline stage (e.g. 'grey', 'albedo') into the view pane. */
    stages: (): string[] => genStages.map(s => s.label),

    // ── render-harvest interface (for the dev loop / optimal-render iteration) ──
    /** Show the finished textured sprite in the lit view (vs the grey massing). */
    setTextured(on: boolean): void { state.textured = on; },
    /** Toggle scene lighting (sun + AO) in the lit view. */
    setLighting(on: boolean): void { state.lighting.enabled = on; },
    /** Run ONE paid img2img render of the current (or named) subject; returns its
     *  gate metrics + harvested sprites (raw / registered / final PNG data-URIs).
     *  COSTS MONEY. A passing render also becomes the lit view's textured albedo. */
    async renderPaid(kind?: string): Promise<RenderResult> {
      if (kind && kind !== state.kind) await studioDebug.setKind(kind);
      const rb = liveRb;
      if (!rb) throw new Error(`no blueprint for "${state.kind}"`);
      const init = await buildInit(rb);
      if (!init) throw new Error('no canvas for init image');
      return executeRender(rb, BUILDING_IMAGE_MODEL, init.initDataUri, init.mask);
    },
    /** The most recent paid render's metrics + harvested images, or null. */
    last: (): RenderResult | null => lastRender,
    /** The init image (magenta-backed geometry silhouette) FLUX is asked to match —
     *  the geometry reference, for diffing alignment against last().registeredDataUri. */
    async initImage(): Promise<string | null> {
      if (!liveRb) return null;
      const init = await buildInit(liveRb);
      return init ? init.initDataUri : null;
    },
  };

  // ── OpenRouter render flow (review metadata → send → step-by-step) ───────
  // PNG data-URI of any SpriteCanvas (OffscreenCanvas has no toDataURL → copy to DOM).
  function spriteToDataUri(c: SpriteCanvas | null): string | null {
    if (!c) return null;
    if (typeof HTMLCanvasElement !== 'undefined' && c instanceof HTMLCanvasElement) return c.toDataURL('image/png');
    const tmp = document.createElement('canvas'); tmp.width = c.width; tmp.height = c.height;
    const tctx = tmp.getContext('2d'); if (!tctx) return null;
    tctx.drawImage(c as unknown as CanvasImageSource, 0, 0);
    return tmp.toDataURL('image/png');
  }

  // Compose THIS subject's init image + registration mask — identical geometry to the
  // massing pack (warmSubject), so the registered sprite aligns with the normal/material
  // maps the lit view uses. Returns null when no canvas is available (jsdom).
  async function buildInit(rb: ResolvedBlueprint): Promise<
    { initDataUri: string; mask: Raster; struct: StructureResult; bb: { x: number; y: number; w: number; h: number } } | null
  > {
    const struct = await composeStructure(
      toGeometry(rb, state.skirt ? { skirt: { margin: state.skirt.margin } } : undefined),
      liveSun(),
      state.skirt ? { skirtFade: state.skirt.fade } : undefined,
    );
    const initDataUri = greyToDataUri(compositeOverChroma(struct.grey), struct.size);
    if (!initDataUri) return null;
    const bb = {
      x: Math.round(struct.bbox.x), y: Math.round(struct.bbox.y),
      w: Math.max(1, Math.round(struct.bbox.w)), h: Math.max(1, Math.round(struct.bbox.h)),
    };
    const mask: Raster = cropRaster({ data: struct.grey, w: struct.size, h: struct.size }, bb);
    return { initDataUri, mask, struct, bb };
  }

  // Run ONE paid img2img render + the full runtime post-process (chroma-key → border
  // gate → silhouette registration → palette quantize), update the pipeline strip, and
  // — when it passes the gates — register the finished sprite as this blueprint's
  // textured albedo (so the lit view shows it on grass). Pure of any UI; the metadata
  // panel and the programmatic harvest interface both call it. `status` is optional.
  async function executeRender(
    rb: ResolvedBlueprint, model: string, initDataUri: string, mask: Raster,
    status?: (s: string) => void,
  ): Promise<RenderResult> {
    const prompt = buildingImagePrompt(rb, model);
    const cfg = loadProviderConfig();
    status?.('sending to OpenRouter…');
    const res = await generateBuildingImage(
      { apiKey: cfg.openrouterApiKey ?? '', baseUrl: openrouterImageBaseUrl(), siteName: cfg.openrouterSiteName },
      { initImageDataUri: initDataUri, prompt, model },
    );
    status?.(`returned (${(res.costUsd ?? 0).toFixed(4)} USD) — post-processing…`);
    const raw = await decodePngToRaster(res.blob);
    if (!raw) throw new Error('could not decode returned image');
    const rawC = rasterToSpriteCanvas(cloneRaster(raw));
    chromaKeyMagenta(raw.data);
    const keyedC = rasterToSpriteCanvas(cloneRaster(raw));
    const border = borderKeyedFraction(raw);
    const reg = registerAlbedo(raw, mask);
    const regC = reg ? rasterToSpriteCanvas(reg.sprite) : null;
    const finalC = reg ? rasterToSpriteCanvas(quantizePalette(reg.sprite, 64)) : null;
    const iou = reg ? reg.iou : 0;
    const ok = !!reg && iou >= 0.7 && border >= 0.6;
    genStages = [
      { label: '7 · img2img raw', canvas: rawC, sub: `${(res.costUsd ?? 0).toFixed(4)} USD` },
      { label: '8 · chroma-keyed', canvas: keyedC, sub: `border ${border.toFixed(2)}` },
      { label: '9 · registered', canvas: regC, sub: reg ? `IoU ${iou.toFixed(2)}` : 'FAILED' },
      { label: '10 · quantized final', canvas: finalC, sub: '64 colours' },
    ];
    if (finalC && ok) subjFinished.set(rbKey(rb), finalC);
    state.view = null;   // drop to live 3D so the textured result is lit on grass
    const verdict = !reg ? 'registration failed'
      : iou < 0.7 ? `IoU ${iou.toFixed(2)} < 0.70 (would be rejected in-game)`
      : border < 0.6 ? `border ${border.toFixed(2)} < 0.60 (would be rejected in-game)`
      : `OK — IoU ${iou.toFixed(2)}, border ${border.toFixed(2)}`;
    const result: RenderResult = {
      kind: state.kind, model, ok, costUsd: res.costUsd ?? 0, border, iou, verdict,
      rawDataUri: spriteToDataUri(rawC),
      registeredDataUri: spriteToDataUri(regC),
      finalDataUri: spriteToDataUri(finalC),
    };
    lastRender = result;
    return result;
  }

  async function openRenderFlow(): Promise<void> {
    const rb = liveRb;
    if (!rb) { alert(`No blueprint for "${state.kind}" — cannot generate.`); return; }
    const model = BUILDING_IMAGE_MODEL;
    const init = await buildInit(rb);
    if (!init) { alert('No canvas for init image.'); return; }
    const cfg = loadProviderConfig();
    const prompt = buildingImagePrompt(rb, model);
    const body = {
      model, modalities: defaultModalitiesFor(model),
      messages: [{ role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `‹init PNG ${init.struct.size}², ${Math.round(init.initDataUri.length / 1024)} KB data-uri›` } },
      ] }],
    };
    openMetadataPanel(viewPane, {
      kind: state.kind, model, prompt, initDataUri: init.initDataUri, size: init.struct.size, bbox: init.bb,
      anchors: init.struct.anchors, body,
      keyStatus: cfg.openrouterApiKey ? 'configured key' : (openrouterImageBaseUrl() ? 'dev proxy key (env)' : 'NO KEY — will fail'),
      onSend: async (status, finishOk) => {
        try {
          const r = await executeRender(rb, model, init.initDataUri, init.mask, status);
          finishOk(`done · ${r.costUsd.toFixed(4)} USD · ${r.verdict}`);
        } catch (err) {
          if (err instanceof BuildingImageError) status(`⛔ ${err.hint} → ${err.helpUrl}\n(${err.message})`);
          else status(`error: ${(err as Error).message}`);
        }
      },
    });
  }

  // ── A/B model eval (same subject + init image, two models, gate metrics) ──
  // Generate the CURRENT subject through `model`, run the exact runtime gates
  // (chroma-key → border-keyed fraction → silhouette IoU), and return the raw +
  // finished sprites with cost/verdict. The init image is model-independent
  // (geometry only); only the prompt + modalities adapt per model.
  async function runAbModel(
    model: string, initDataUri: string, mask: Raster, cfg: ReturnType<typeof loadProviderConfig>,
  ): Promise<AbResult> {
    const rb = liveRb!;
    const prompt = buildingImagePrompt(rb, model);
    const base: AbResult = { model, ok: false, costUsd: 0, ms: 0, border: 0, iou: 0, raw: null, final: null, verdict: '' };
    const t0 = performance.now();
    try {
      const res = await generateBuildingImage(
        { apiKey: cfg.openrouterApiKey ?? '', baseUrl: openrouterImageBaseUrl(), siteName: cfg.openrouterSiteName },
        { initImageDataUri: initDataUri, prompt, model },
      );
      base.ms = performance.now() - t0;
      base.costUsd = res.costUsd ?? 0;
      const raw = await decodePngToRaster(res.blob);
      if (!raw) { base.error = 'decode failed'; base.verdict = 'decode failed'; return base; }
      base.raw = rasterToSpriteCanvas(cloneRaster(raw));
      chromaKeyMagenta(raw.data);
      base.border = borderKeyedFraction(raw);
      const reg = registerAlbedo(raw, mask);
      base.iou = reg ? reg.iou : 0;
      base.final = reg ? rasterToSpriteCanvas(quantizePalette(reg.sprite, 64)) : null;
      base.ok = !!reg && base.border >= AB_MIN_BORDER && base.iou >= AB_MIN_IOU;
      base.verdict = !reg ? 'registration failed'
        : base.iou < AB_MIN_IOU ? `IoU ${base.iou.toFixed(2)} < ${AB_MIN_IOU} (rejected in-game)`
        : base.border < AB_MIN_BORDER ? `border ${base.border.toFixed(2)} < ${AB_MIN_BORDER} (rejected in-game)`
        : `PASS — IoU ${base.iou.toFixed(2)}, border ${base.border.toFixed(2)}`;
    } catch (err) {
      base.ms = performance.now() - t0;
      base.error = err instanceof BuildingImageError ? `${err.hint} → ${err.helpUrl}` : (err as Error).message;
      base.verdict = err instanceof BuildingImageError ? `⛔ ${err.kind}` : 'error';
    }
    return base;
  }

  // Compose the CURRENT subject's init image once, then run both models against it
  // (geometry is model-independent; only prompt + modalities differ per model).
  async function runAbPair(modelA: string, modelB: string): Promise<[AbResult, AbResult]> {
    const rb = liveRb;
    if (!rb) throw new Error(`No blueprint for "${state.kind}"`);
    const struct = await composeStructure(toGeometry(rb), liveSun());
    const initDataUri = greyToDataUri(compositeOverChroma(struct.grey), struct.size);
    if (!initDataUri) throw new Error('No canvas for init image');
    const bb = {
      x: Math.round(struct.bbox.x), y: Math.round(struct.bbox.y),
      w: Math.max(1, Math.round(struct.bbox.w)), h: Math.max(1, Math.round(struct.bbox.h)),
    };
    const mask: Raster = cropRaster({ data: struct.grey, w: struct.size, h: struct.size }, bb);
    const cfg = loadProviderConfig();
    return Promise.all([runAbModel(modelA, initDataUri, mask, cfg), runAbModel(modelB, initDataUri, mask, cfg)]);
  }

  Object.assign(studioDebug, {
    state, invalidate,
    setSun: (az: number, el: number) => { state.az = az; state.el = el; invalidate(); },
    structResult: () => shownStruct,
    /** Headless A/B: generate the current subject with two models and return the
     *  gate metrics (cost/ms/border/IoU/verdict) — sprites omitted (not serialisable). */
    async ab(modelA = BUILDING_IMAGE_MODEL, modelB = 'google/gemini-2.5-flash-image'): Promise<unknown> {
      const [a, b] = await runAbPair(modelA, modelB);
      const strip = (r: AbResult) => ({ model: r.model, ok: r.ok, costUsd: r.costUsd, ms: r.ms, border: r.border, iou: r.iou, verdict: r.verdict, error: r.error });
      return { a: strip(a), b: strip(b) };
    },
    stop: () => cancelAnimationFrame(raf),
  });
  (window as unknown as { __studio?: unknown }).__studio = studioDebug;
  // eslint-disable-next-line no-console
  console.log('[studio] mounted —', state.kind);
}

function cloneRaster(r: Raster): Raster {
  return { data: new Uint8ClampedArray(r.data), w: r.w, h: r.h };
}
