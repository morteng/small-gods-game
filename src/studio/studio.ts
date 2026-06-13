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
import { createIsoRenderMap } from '@/render/iso/iso-renderer';
import { worldToScreen } from '@/render/iso/iso-projection';
import { floorIsoZoom, quantizeIsoZoom, ISO_ZOOM_MIN, ISO_ZOOM_MAX } from '@/render/iso/iso-camera';
import { createCamera, zoomAt } from '@/render/camera';
import { attachControls } from '@/ui/controls';
import { PixiEntityLayer } from '@/render/pixi/pixi-entity-layer';
import { DEFAULT_LIGHTING, normalizeVec3, type LightingState, type ShadowMode, type Vec3 } from '@/render/lighting-state';
import { structureResultToPack } from '@/render/parametric-building-source';
import { composeStructure, type StructureResult } from '@/assetgen/compose';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { BUILDING_BLUEPRINTS, synthesizeBlueprint, isPlantPreset } from '@/blueprint/presets';
import type { ResolvedBlueprint, ResolvedPart, ResolvedFeature } from '@/blueprint/types';
import { blueprintEntity } from '@/blueprint/entity';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import type { SpritePack } from '@/render/iso/sprite-canvas';
import { greyToSpriteCanvas, greyToDataUri, rgbaToCanvas, type SpriteCanvas } from '@/render/iso/sprite-canvas';
import { initManifoldWasm } from '@/assetgen/geometry/manifold-wasm-browser';
// img2img generation pipeline (the real paid path, surfaced step-by-step).
import { buildingImagePrompt } from '@/assetgen/building-image-prompt';
import { compositeOverChroma, chromaKeyMagenta } from '@/render/chroma-key';
import { generateBuildingImage, BUILDING_IMAGE_MODEL } from '@/llm/openrouter-image-client';
import { loadProviderConfig, openrouterImageBaseUrl } from '@/llm/provider-factory';
import { decodePngToRaster, rasterToSpriteCanvas } from '@/render/sprite-codec';
import {
  type Raster, cropRaster, borderKeyedFraction, registerAlbedo, quantizePalette,
} from '@/render/sprite-postprocess';

const MAP_W = 24, MAP_H = 24;
const CENTER = { x: 12, y: 12 };
const MIN_DOCK = 90, MAX_DOCK_FRAC = 0.6, DEFAULT_DOCK = 150;
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

/** A single inspectable buffer in the stage strip / view pane. */
interface Stage { label: string; canvas: SpriteCanvas | null; sub?: string }

interface StudioState {
  kind: string;
  lighting: LightingState;
  az: number;   // sun azimuth, degrees
  el: number;   // sun elevation, degrees
  overlays: boolean;
  fit: boolean; // auto zoom-to-fit the subject (yields to any manual pan/zoom)
  dockH: number;
  // null → live 3D render; else show this buffer in the view pane.
  view: { canvas: SpriteCanvas; label: string } | null;
}

function sunDir(az: number, el: number): Vec3 {
  const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
  return normalizeVec3([-Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)]);
}

export function mountStudio(container: HTMLElement): void {
  ensureBuildingTypesRegistered();
  initManifoldWasm();

  container.style.position = 'relative';
  container.style.background = '#1a1a24';

  // ── paned scaffold: [tree | vSplit | (view / hSplit / dock)] ──────────────
  const root = document.createElement('div');
  root.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:row;overflow:hidden';
  // Left: the node-tree inspector (the geometry "first thing"). Resizable.
  const tree = document.createElement('div');
  tree.style.cssText = `flex:0 0 auto;width:${DEFAULT_TREE_W}px;background:rgba(16,16,26,0.98);border-right:1px solid #3a3a52;overflow:auto`;
  const vSplitter = document.createElement('div');
  vSplitter.style.cssText = 'flex:0 0 6px;background:#3a3a52;cursor:col-resize';
  const mainCol = document.createElement('div');
  mainCol.style.cssText = 'flex:1 1 auto;min-width:0;display:flex;flex-direction:column;overflow:hidden';
  const viewPane = document.createElement('div');
  viewPane.style.cssText = 'position:relative;flex:1 1 auto;min-height:0;overflow:hidden';
  const splitter = document.createElement('div');
  splitter.style.cssText = 'flex:0 0 6px;background:#3a3a52;cursor:row-resize';
  const dock = document.createElement('div');
  dock.style.cssText = 'flex:0 0 auto;height:150px;background:rgba(16,16,26,0.96);border-top:1px solid #3a3a52;overflow:hidden';
  mainCol.append(viewPane, splitter, dock);
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
  const rbKey = (rb: ResolvedBlueprint): string => JSON.stringify(rb);
  function warmSubject(): void {
    if (!liveRb) return;
    const rb = liveRb, k = rbKey(rb);
    if (subjPacks.has(k) || subjInflight.has(k)) return;
    subjInflight.add(k);
    composeStructure(toGeometry(rb), liveSun())
      .then((r) => { subjStages.set(k, r); subjPacks.set(k, structureResultToPack(r)); })
      .catch((err) => { console.warn('[studio] compose failed', err); subjPacks.set(k, null); })
      .finally(() => { subjInflight.delete(k); });
  }
  const peekSubject = (): SpritePack | null => (liveRb ? (subjPacks.get(rbKey(liveRb)) ?? null) : null);
  const stagesSubject = (): StructureResult | null => (liveRb ? (subjStages.get(rbKey(liveRb)) ?? null) : null);
  const invalidate = (): void => { subjPacks.clear(); subjStages.clear(); subjInflight.clear(); };
  const entityLayer = new PixiEntityLayer();
  const renderMap = createIsoRenderMap();

  const params = new URLSearchParams(location.search);
  const initial = (params.get('studio') && params.get('studio') !== '1') ? params.get('studio')! : 'oak_tree';

  const state: StudioState = {
    kind: BUILDING_BLUEPRINTS[initial] ? initial : 'oak_tree',
    lighting: { ...DEFAULT_LIGHTING, shadowMode: 'geometry' },
    az: 41, el: 40,
    overlays: true,
    fit: true,
    dockH: DEFAULT_DOCK,
    view: null,
  };

  let subject: Entity = makeEntity(state.kind);
  liveRb = synthesizeBlueprint(state.kind) ?? null;
  // Per-subject extra stages produced by the OpenRouter render flow.
  let genStages: Stage[] = [];
  // Assigned once the node-tree panel is built; called on subject/param change.
  let rebuildTree: () => void = () => {};
  function setSubject(kind: string): void {
    state.kind = kind;
    world.removeEntity('subject');
    liveRb = synthesizeBlueprint(kind) ?? null;
    invalidate();
    genStages = [];
    state.view = null;
    subject = makeEntity(kind);
    world.addEntity(subject);
    rebuildTree();
  }
  // A node-tree edit mutated liveRb in place: bust geometry caches, drop stale
  // generation stages + any pinned stage view, and redraw the tree.
  function onBlueprintEdited(): void {
    invalidate();
    genStages = [];
    state.view = null;
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
    zoomAt(cam, dir > 0 ? 1.1 : 0.9, w / 2, h / 2, quantizeIsoZoom);
  }
  attachControls(canvas, cam, {
    getZoomQuantize: () => quantizeIsoZoom,
    onUserCameraInput: () => { state.fit = false; },
    onRedraw: () => {},
  });

  function renderContext(): RenderContext {
    const { w, h } = viewport();
    state.lighting.sunDir = sunDir(state.az, state.el);
    if (state.fit) fitCamera();
    return {
      map, camera: cam, canvasWidth: w, canvasHeight: h,
      npcs: [], npcSheets: new Map(), treeSheets: new Map(),
      world, lighting: state.lighting, entityLayer,
      resolveParametricBuildingArt: () => { const s = peekSubject(); if (s) return s; warmSubject(); return null; },
      resolveParametricPlantArt: () => { const s = peekSubject(); if (s) return s; warmSubject(); return null; },
    } as unknown as RenderContext;
  }

  // ── view pane: live render OR a stage buffer ─────────────────────────────
  function paintChecker(w: number, h: number): void {
    for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) {
      ctx.fillStyle = ((x + y) / 16) % 2 ? '#23232f' : '#1a1a24';
      ctx.fillRect(x, y, 16, 16);
    }
  }
  function drawStageInPane(c: SpriteCanvas): void {
    const { w, h } = viewport();
    ctx.clearRect(0, 0, w, h);
    paintChecker(w, h);
    const pad = 24;
    const s = Math.max(1, Math.floor(Math.min((w - pad * 2) / c.width, (h - pad * 2) / c.height)));
    const dw = c.width * s, dh = c.height * s;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(c as CanvasImageSource, Math.round((w - dw) / 2), Math.round((h - dh) / 2), dw, dh);
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
  function drawHud(): void {
    const d = sunDir(state.az, state.el);
    ctx.save();
    ctx.font = '12px monospace';
    ctx.fillStyle = '#cfe';
    ctx.fillText(`${state.kind}   sun az ${state.az}° el ${state.el}°   shadow ${state.lighting.shadowMode}   light ${state.lighting.enabled ? 'on' : 'off'}`, 12, 20);
    const gx = 60, gy = 70, R = 34;
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath(); ctx.arc(gx, gy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#ffd35a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + d[0] * R, gy - d[1] * R); ctx.stroke();
    ctx.fillStyle = '#ffd35a'; ctx.beginPath(); ctx.arc(gx + d[0] * R, gy - d[1] * R, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ── pipeline stages (compose buffers + any generation stages) ────────────
  const dockUi = buildDock(dock);
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
  function syncStages(): void {
    const r = stagesSubject();
    if (r === shownStruct && genStages.length === shownGenLen) return;
    shownStruct = r; shownGenLen = genStages.length;
    if (!r) { dockUi.message('generating…'); return; }
    const tiles = [...composeStages(r), ...genStages];
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
      liveBtn.show(state.view.label);
    } else {
      const rc = renderContext();
      renderMap(ctx, rc);
      drawOverlays(rc.camera);
      drawHud();
      liveBtn.hide();
    }
    syncStages();
    panel.refresh();
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

  // Re-synthesise the live blueprint with a fresh seed (re-rolls every seeded
  // param — vent placement, jitter, …) and re-warm geometry.
  function randomizeSubject(): void {
    const seed = Math.floor(Math.random() * 0x7fffffff);
    liveRb = synthesizeBlueprint(state.kind, [], seed) ?? liveRb;
    onBlueprintEdited();
  }

  // ── node-tree inspector (the live blueprint, browseable + editable) ──────
  const treeUi = buildTree(tree, { getRb: () => liveRb, onEdit: onBlueprintEdited, randomize: randomizeSubject });
  rebuildTree = treeUi.render;
  rebuildTree();

  const panel = buildPanel(viewPane, state, {
    setSubject, invalidate, zoomLabel,
    getZoom: () => cam.zoom,
    zoomIn: () => stepZoom(1),
    zoomOut: () => stepZoom(-1),
    openRender: () => openRenderFlow(),
  });
  frame();

  // ── OpenRouter render flow (review metadata → send → step-by-step) ───────
  async function openRenderFlow(): Promise<void> {
    const rb = liveRb;
    if (!rb) { alert(`No blueprint for "${state.kind}" — cannot generate.`); return; }
    const model = BUILDING_IMAGE_MODEL;
    const prompt = buildingImagePrompt(rb, model);
    const struct = await composeStructure(toGeometry(rb), liveSun());
    const initDataUri = greyToDataUri(compositeOverChroma(struct.grey), struct.size);
    if (!initDataUri) { alert('No canvas for init image.'); return; }
    const bb = {
      x: Math.round(struct.bbox.x), y: Math.round(struct.bbox.y),
      w: Math.max(1, Math.round(struct.bbox.w)), h: Math.max(1, Math.round(struct.bbox.h)),
    };
    const mask: Raster = cropRaster({ data: struct.grey, w: struct.size, h: struct.size }, bb);
    const cfg = loadProviderConfig();
    const body = {
      model, modalities: ['image', 'text'],
      messages: [{ role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `‹init PNG ${struct.size}², ${Math.round(initDataUri.length / 1024)} KB data-uri›` } },
      ] }],
    };
    openMetadataPanel(viewPane, {
      kind: state.kind, model, prompt, initDataUri, size: struct.size, bbox: bb,
      anchors: struct.anchors, body,
      keyStatus: cfg.openrouterApiKey ? 'configured key' : (openrouterImageBaseUrl() ? 'dev proxy key (env)' : 'NO KEY — will fail'),
      onSend: async (status, finishOk) => {
        try {
          status('sending to OpenRouter…');
          const res = await generateBuildingImage(
            { apiKey: cfg.openrouterApiKey ?? '', baseUrl: openrouterImageBaseUrl(), siteName: cfg.openrouterSiteName },
            { initImageDataUri: initDataUri, prompt, model },
          );
          status(`returned (${(res.costUsd ?? 0).toFixed(4)} USD) — post-processing…`);
          const raw = await decodePngToRaster(res.blob);
          if (!raw) throw new Error('could not decode returned image');
          const rawC = rasterToSpriteCanvas(cloneRaster(raw));
          chromaKeyMagenta(raw.data);
          const keyedC = rasterToSpriteCanvas(cloneRaster(raw));
          const border = borderKeyedFraction(raw);
          const reg = registerAlbedo(raw, mask);
          const regC = reg ? rasterToSpriteCanvas(reg.sprite) : null;
          const finalC = reg ? rasterToSpriteCanvas(quantizePalette(reg.sprite, 64)) : null;
          // Append generation stages; the strip + view pane pick them up next frame.
          genStages = [
            { label: '7 · img2img raw', canvas: rawC, sub: `${(res.costUsd ?? 0).toFixed(4)} USD` },
            { label: '8 · chroma-keyed', canvas: keyedC, sub: `border ${border.toFixed(2)}` },
            { label: '9 · registered', canvas: regC, sub: reg ? `IoU ${reg.iou.toFixed(2)}` : 'FAILED' },
            { label: '10 · quantized final', canvas: finalC, sub: '64 colours' },
          ];
          if (finalC) state.view = { canvas: finalC, label: '10 · quantized final' };
          else if (rawC) state.view = { canvas: rawC, label: '7 · img2img raw' };
          const verdict = !reg ? 'registration failed'
            : reg.iou < 0.7 ? `IoU ${reg.iou.toFixed(2)} < 0.70 (would be rejected in-game)`
            : border < 0.6 ? `border ${border.toFixed(2)} < 0.60 (would be rejected in-game)`
            : `OK — IoU ${reg.iou.toFixed(2)}, border ${border.toFixed(2)}`;
          finishOk(`done · ${(res.costUsd ?? 0).toFixed(4)} USD · ${verdict}`);
        } catch (err) {
          status(`error: ${(err as Error).message}`);
        }
      },
    });
  }

  (window as unknown as { __studio?: unknown }).__studio = {
    state, setSubject, invalidate,
    setSun: (az: number, el: number) => { state.az = az; state.el = el; invalidate(); },
    stages: () => shownStruct,
    grab: () => canvas.toDataURL('image/png'),
    stop: () => cancelAnimationFrame(raf),
  };
  // eslint-disable-next-line no-console
  console.log('[studio] mounted —', state.kind);
}

function cloneRaster(r: Raster): Raster {
  return { data: new Uint8ClampedArray(r.data), w: r.w, h: r.h };
}

// ── view-pane "live" badge ───────────────────────────────────────────────────
function makeLiveButton(viewPane: HTMLElement, onLive: () => void): { show: (l: string) => void; hide: () => void } {
  const bar = document.createElement('div');
  bar.style.cssText = 'position:absolute;top:10px;left:10px;display:none;align-items:center;gap:8px;z-index:11;font:12px monospace;color:#cfe';
  const label = document.createElement('span');
  label.style.cssText = 'background:rgba(20,20,32,0.9);border:1px solid #3a3a52;border-radius:4px;padding:3px 8px';
  const btn = document.createElement('button');
  btn.textContent = '▶ Live';
  btn.style.cssText = 'background:#21213a;color:#ffd35a;border:1px solid #3a3a52;border-radius:4px;padding:3px 10px;cursor:pointer;font:12px monospace';
  btn.onclick = onLive;
  bar.append(label, btn);
  viewPane.appendChild(bar);
  return {
    show: (l) => { label.textContent = `viewing: ${l}`; bar.style.display = 'flex'; },
    hide: () => { bar.style.display = 'none'; },
  };
}

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

function buildPanel(host: HTMLElement, state: StudioState, deps: PanelDeps): PanelHandle {
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

// ── docked pipeline-stage strip ──────────────────────────────────────────────
function buildDock(dock: HTMLElement): {
  render: (header: string, tiles: Stage[], onClick: (s: Stage) => void) => void;
  message: (m: string) => void;
} {
  dock.style.display = 'flex';
  dock.style.flexDirection = 'column';
  const head = document.createElement('div');
  head.textContent = '🔬 Pipeline stages';
  head.style.cssText = 'color:#ffd35a;font:11px monospace;padding:6px 10px 4px';
  const strip = document.createElement('div');
  strip.style.cssText = 'flex:1 1 auto;display:flex;gap:8px;overflow-x:auto;align-items:center;padding:0 10px 8px';
  dock.append(head, strip);

  const checker = (c: CanvasRenderingContext2D, w: number, h: number) => {
    for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) {
      c.fillStyle = ((x + y) / 8) % 2 ? '#2a2a3a' : '#1c1c28';
      c.fillRect(x, y, 8, 8);
    }
  };
  // Smaller thumbnails (cap by both axes, the dock height drives the visual size).
  const tileFor = (src: SpriteCanvas, max: number): HTMLCanvasElement => {
    const s = Math.max(0.05, Math.min(max / src.width, max / src.height));
    const tw = Math.max(1, Math.round(src.width * s)), th = Math.max(1, Math.round(src.height * s));
    const cv = document.createElement('canvas'); cv.width = tw; cv.height = th;
    const cx = cv.getContext('2d')!;
    checker(cx, tw, th);
    cx.imageSmoothingEnabled = false;
    cx.drawImage(src as CanvasImageSource, 0, 0, tw, th);
    return cv;
  };

  function message(m: string): void { head.textContent = `🔬 Pipeline stages — ${m}`; strip.innerHTML = ''; }

  function render(header: string, tiles: Stage[], onClick: (s: Stage) => void): void {
    head.textContent = `🔬 Pipeline stages — ${header}  ·  click a stage to inspect`;
    strip.innerHTML = '';
    for (const t of tiles) {
      const cell = document.createElement('div');
      cell.style.cssText = 'flex:0 0 auto;text-align:center;cursor:pointer';
      const cap = document.createElement('div');
      cap.textContent = t.sub ? `${t.label}  ·  ${t.sub}` : t.label;
      cap.style.cssText = 'margin-top:3px;opacity:0.8;white-space:nowrap;font:10px monospace;color:#cfe';
      if (t.canvas) {
        const thumb = tileFor(t.canvas, 64);
        thumb.style.cssText = 'border:1px solid #3a3a52;image-rendering:pixelated;background:#11111a;vertical-align:middle';
        cell.append(thumb, cap);
        cell.onclick = () => onClick(t);
      } else {
        const ph = document.createElement('div');
        ph.style.cssText = 'width:64px;height:48px;border:1px dashed #3a3a52;display:flex;align-items:center;justify-content:center;opacity:0.5;color:#cfe';
        ph.textContent = '—';
        cell.append(ph, cap);
      }
      strip.appendChild(cell);
    }
  }

  return { render, message };
}

// ── node-tree inspector (browseable + editable live blueprint) ───────────────
interface TreeDeps {
  getRb: () => ResolvedBlueprint | null;
  onEdit: () => void;       // a value was mutated in place on the live blueprint
  randomize: () => void;    // re-roll all seeded params
}
function buildTree(host: HTMLElement, deps: TreeDeps): { render: () => void } {
  const css = {
    head: 'position:sticky;top:0;z-index:1;background:rgba(16,16,26,0.98);padding:8px 10px 6px;border-bottom:1px solid #2a2a3a',
    title: 'color:#ffd35a;font:bold 12px monospace',
    summary: 'margin-top:4px;font:10px monospace;color:#9fd;white-space:normal;word-break:break-word',
    body: 'padding:6px 8px 16px;font:11px monospace;color:#cfe',
    node: 'margin:2px 0;border-left:1px solid #2a2a3a;padding-left:8px',
    nodeHead: 'cursor:pointer;user-select:none;padding:2px 0;color:#cde',
    kv: 'display:flex;align-items:center;gap:6px;margin:2px 0',
    key: 'opacity:0.7;flex:0 0 auto',
    inputN: 'width:64px;background:#11111a;color:#9fe;border:1px solid #3a3a52;padding:1px 3px;font:11px monospace',
    inputT: 'flex:1 1 auto;min-width:0;background:#11111a;color:#9fe;border:1px solid #3a3a52;padding:1px 3px;font:11px monospace',
    btn: 'background:#21213a;color:#ffd35a;border:1px solid #3a3a52;border-radius:4px;padding:2px 8px;cursor:pointer;font:11px monospace',
    sect: 'color:#ffd35a;opacity:0.85;margin:8px 0 2px;font-weight:bold',
  };

  // One editable control for obj[key]; recurses for nested objects, JSON for arrays.
  function valueEditor(obj: Record<string, unknown>, key: string): HTMLElement {
    const v = obj[key];
    if (typeof v === 'boolean') {
      const c = document.createElement('input'); c.type = 'checkbox'; c.checked = v;
      c.onchange = () => { obj[key] = c.checked; deps.onEdit(); };
      return c;
    }
    if (typeof v === 'number') {
      const i = document.createElement('input'); i.type = 'number'; i.value = String(v);
      i.step = Number.isInteger(v) ? '1' : '0.05'; i.style.cssText = css.inputN;
      i.onchange = () => { const n = Number(i.value); if (Number.isFinite(n)) { obj[key] = n; deps.onEdit(); } };
      return i;
    }
    if (typeof v === 'string') {
      const i = document.createElement('input'); i.type = 'text'; i.value = v; i.style.cssText = css.inputT;
      i.onchange = () => { obj[key] = i.value; deps.onEdit(); };
      return i;
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return paramBlock(v as Record<string, unknown>);
    }
    // arrays + anything else: editable JSON, reverts on parse failure.
    const i = document.createElement('input'); i.type = 'text'; i.value = JSON.stringify(v); i.style.cssText = css.inputT;
    i.onchange = () => { try { obj[key] = JSON.parse(i.value); deps.onEdit(); } catch { i.value = JSON.stringify(obj[key]); } };
    return i;
  }

  function kvRow(obj: Record<string, unknown>, key: string): HTMLElement {
    const row = document.createElement('div'); row.style.cssText = css.kv;
    const k = document.createElement('span'); k.textContent = key; k.style.cssText = css.key;
    row.append(k, valueEditor(obj, key));
    return row;
  }

  function paramBlock(params: Record<string, unknown>): HTMLElement {
    const box = document.createElement('div'); box.style.cssText = css.node;
    const keys = Object.keys(params);
    if (!keys.length) { const e = document.createElement('div'); e.textContent = '(none)'; e.style.opacity = '0.4'; return e; }
    for (const key of keys) box.appendChild(kvRow(params, key));
    return box;
  }

  function collapsible(label: string, openByDefault: boolean): { el: HTMLElement; body: HTMLElement } {
    const el = document.createElement('div'); el.style.cssText = css.node;
    const head = document.createElement('div'); head.style.cssText = css.nodeHead;
    const body = document.createElement('div'); body.style.display = openByDefault ? 'block' : 'none';
    const caret = () => (body.style.display === 'none' ? '▸' : '▾');
    const setLabel = () => { head.textContent = `${caret()} ${label}`; };
    head.onclick = () => { body.style.display = body.style.display === 'none' ? 'block' : 'none'; setLabel(); };
    setLabel();
    el.append(head, body);
    return { el, body };
  }

  function featureNode(f: ResolvedFeature): HTMLElement {
    const face = f.face ? ` · ${f.face}` : '';
    const kind = typeof f.params.kind === 'string' ? ` (${f.params.kind})` : '';
    const { el, body } = collapsible(`◦ ${f.type}${kind}${face}`, false);
    body.appendChild(paramBlock(f.params));
    return el;
  }

  function partNode(p: ResolvedPart): HTMLElement {
    const mat = p.material ? ` · ${p.material}` : '';
    const { el, body } = collapsible(`▪ ${p.id} [${p.type}]${mat}`, false);
    const meta = document.createElement('div'); meta.style.cssText = 'font:10px monospace;opacity:0.6;margin:2px 0';
    meta.textContent = `at (${p.at.x},${p.at.y})  size ${p.size.w}×${p.size.h}`;
    body.appendChild(meta);
    const ps = document.createElement('div'); ps.style.cssText = css.sect; ps.textContent = 'params'; body.appendChild(ps);
    body.appendChild(paramBlock(p.params));
    if (p.features.length) {
      const fs = document.createElement('div'); fs.style.cssText = css.sect; fs.textContent = `features (${p.features.length})`; body.appendChild(fs);
      for (const f of p.features) body.appendChild(featureNode(f));
    }
    return el;
  }

  function render(): void {
    host.innerHTML = '';
    const rb = deps.getRb();
    const head = document.createElement('div'); head.style.cssText = css.head;
    const titleRow = document.createElement('div'); titleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px';
    const title = document.createElement('div'); title.style.cssText = css.title; title.textContent = '🌳 Geometry · Blueprint';
    const rnd = document.createElement('button'); rnd.textContent = '🎲 Randomize'; rnd.style.cssText = css.btn; rnd.onclick = deps.randomize;
    titleRow.append(title, rnd);
    head.appendChild(titleRow);

    if (!rb) { head.appendChild(Object.assign(document.createElement('div'), { textContent: 'no blueprint for this kind', style: css.summary })); host.appendChild(head); return; }

    // Feature-type tally — the geometry truth (e.g. how many chimneys/vents the
    // model ACTUALLY has, vs whatever the img2img prompt claims).
    const counts: Record<string, number> = {};
    for (const p of rb.parts) for (const f of p.features) counts[f.type] = (counts[f.type] ?? 0) + 1;
    const vents = rb.parts.flatMap(p => p.features).filter(f => f.type === 'vent');
    const ventKinds = vents.map(v => (typeof v.params.kind === 'string' ? v.params.kind : 'vent'));
    const tally = Object.entries(counts).map(([t, n]) => `${t}×${n}`).join(' · ') || 'no features';
    const summary = document.createElement('div'); summary.style.cssText = css.summary;
    summary.textContent = `${rb.class}${rb.preset ? ` · ${rb.preset}` : ''}${rb.era ? ` · ${rb.era}` : ''} · ${rb.parts.length} part(s) · ${tally}${ventKinds.length ? `  [${ventKinds.join(', ')}]` : ''}`;
    head.appendChild(summary);
    host.appendChild(head);

    const body = document.createElement('div'); body.style.cssText = css.body;

    // ── meta: footprint + materials + palette (all editable) ──
    const metaBlock = collapsible('⚙ meta (footprint · materials · palette)', true);
    const fp = document.createElement('div'); fp.style.cssText = css.sect; fp.textContent = 'footprint'; metaBlock.body.appendChild(fp);
    metaBlock.body.appendChild(kvRow(rb.footprint as unknown as Record<string, unknown>, 'w'));
    metaBlock.body.appendChild(kvRow(rb.footprint as unknown as Record<string, unknown>, 'h'));
    const mts = document.createElement('div'); mts.style.cssText = css.sect; mts.textContent = 'materials'; metaBlock.body.appendChild(mts);
    metaBlock.body.appendChild(paramBlock(rb.materials as Record<string, unknown>));
    if (rb.palette && Object.keys(rb.palette).length) {
      const pl = document.createElement('div'); pl.style.cssText = css.sect; pl.textContent = 'palette'; metaBlock.body.appendChild(pl);
      metaBlock.body.appendChild(paramBlock(rb.palette as unknown as Record<string, unknown>));
    }
    body.appendChild(metaBlock.el);

    // ── parts ──
    const partsHdr = document.createElement('div'); partsHdr.style.cssText = css.sect; partsHdr.textContent = `parts (${rb.parts.length})`; body.appendChild(partsHdr);
    for (const p of rb.parts) body.appendChild(partNode(p));

    host.appendChild(body);
  }

  return { render };
}

// ── outgoing-request review panel (shown BEFORE the paid call) ───────────────
interface MetadataOpts {
  kind: string; model: string; prompt: string; initDataUri: string;
  size: number; bbox: { x: number; y: number; w: number; h: number };
  anchors: unknown; body: unknown; keyStatus: string;
  onSend: (status: (m: string) => void, finishOk: (m: string) => void) => Promise<void> | void;
}
function openMetadataPanel(host: HTMLElement, o: MetadataOpts): void {
  host.querySelector('#studio-meta')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'studio-meta';
  wrap.style.cssText = [
    'position:absolute', 'top:12px', 'left:12px', 'width:420px', 'max-height:calc(100% - 24px)',
    'overflow:auto', 'padding:12px 14px', 'background:rgba(14,14,22,0.97)', 'border:1px solid #4a4a6a',
    'border-radius:8px', 'font:12px monospace', 'color:#cfe', 'z-index:20',
  ].join(';');

  const h = (t: string) => { const d = document.createElement('div'); d.textContent = t; d.style.cssText = 'color:#ffd35a;margin:8px 0 3px;font-weight:bold'; return d; };
  const pre = (t: string) => { const p = document.createElement('pre'); p.textContent = t; p.style.cssText = 'white-space:pre-wrap;word-break:break-word;background:#11111a;border:1px solid #2a2a3a;border-radius:4px;padding:6px;margin:0;max-height:180px;overflow:auto'; return p; };
  const line = (t: string) => { const d = document.createElement('div'); d.textContent = t; d.style.margin = '2px 0'; return d; };

  const title = document.createElement('div');
  title.textContent = '🎨 Outgoing OpenRouter request — review before sending';
  title.style.cssText = 'font-weight:bold;color:#ffd35a;margin-bottom:6px';

  const img = document.createElement('img');
  img.src = o.initDataUri;
  img.style.cssText = 'max-width:160px;image-rendering:pixelated;border:1px solid #3a3a52;background:#11111a';

  const status = document.createElement('div');
  status.style.cssText = 'margin-top:8px;color:#9fd;min-height:16px';
  const setStatus = (m: string) => { status.textContent = m; };

  const sendBtn = document.createElement('button');
  sendBtn.textContent = '⬆ Send (paid)';
  sendBtn.style.cssText = 'background:#2a4a2a;color:#cfe;border:1px solid #4a6a4a;border-radius:4px;padding:5px 12px;cursor:pointer;font:12px monospace;margin-right:8px';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.style.cssText = 'background:#21213a;color:#cfe;border:1px solid #3a3a52;border-radius:4px;padding:5px 12px;cursor:pointer;font:12px monospace';
  closeBtn.onclick = () => wrap.remove();
  sendBtn.onclick = async () => {
    sendBtn.disabled = true; sendBtn.style.opacity = '0.5';
    await o.onSend(setStatus, (m) => { setStatus(m); });
  };
  const btns = document.createElement('div'); btns.style.marginTop = '8px'; btns.append(sendBtn, closeBtn);

  wrap.append(
    title,
    line(`subject:  ${o.kind}`),
    line(`model:    ${o.model}`),
    line(`init:     ${o.size}² PNG · crop ${o.bbox.w}×${o.bbox.h} · key: ${o.keyStatus}`),
    h('prompt'), pre(o.prompt),
    h('init image (magenta-backed)'), img,
    h('request body'), pre(JSON.stringify(o.body, null, 2)),
    h('anchors'), pre(JSON.stringify(o.anchors)),
    btns, status,
  );
  host.appendChild(wrap);
}
