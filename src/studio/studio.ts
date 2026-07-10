// src/studio/studio.ts
// Render Studio — an uncluttered, single-object scene that reuses the EXACT
// game render path (iso terrain + the PixiJS lit entity layer + cast shadows)
// AND the EXACT game camera controls (drag-pan, wheel-zoom on the pixel-perfect
// iso ladder via `attachControls`), so lighting / shadows / sprite anchoring can
// be verified in isolation. Boot with `?studio` (optionally `?studio=english-oak`).
//
// Layout: a resizable VIEW PANE (top) over a docked PIPELINE-STAGES strip
// (bottom). The sources retain every compose buffer per asset (keepStages), so
// the strip fills automatically — no capture step. Click a stage to inspect it
// in the view pane. A "Render via OpenRouter" flow shows the full outgoing
// request (prompt, model, init image, body) for review BEFORE it is sent, then
// runs the real img2img → chroma-key → register → quantize chain and appends
// each step as a further stage.
import type { Entity, GameMap, Tile, RenderContext, NpcInstance } from '@/core/types';
import { World } from '@/world/world';
import { createGpuRenderMap } from '@/render/gpu/gpu-renderer';
import type { RenderFn } from '@/render/select-renderer';
import { worldToScreen } from '@/render/iso/iso-projection';
import { HUMAN_HEIGHT_M, METRES_PER_TILE } from '@/render/scale-contract';
import { buildCharacterSpec } from '@/render/lpc';
import { getOrGenerateSheet } from '@/render/lpc/spritesheet-cache';
import { floorIsoZoom, quantizeToRungs, ISO_ZOOM_RUNGS, ISO_ZOOM_MIN, ISO_ZOOM_MAX } from '@/render/iso/iso-camera';
import { createCamera, zoomAt } from '@/render/camera';
import { attachControls } from '@/ui/controls';
import { DEFAULT_LIGHTING } from '@/render/lighting-state';
import { structureResultToPack } from '@/render/parametric-building-source';
import { GeneratedBuildingArtSource } from '@/render/generated-building-art-source';
import { composeStructure, type StructureResult } from '@/assetgen/compose';
import { ensureBuildingTypesRegistered } from '@/blueprint/register-buildings';
import { BUILDING_BLUEPRINTS, synthesizeBlueprint, resolveAsset, isPlantPreset, isBridgePreset } from '@/blueprint/presets';
import { assetCatalogue } from '@/blueprint/catalogue';
import type { ResolvedBlueprint, Descriptors, Era } from '@/blueprint/types';
import { blueprintEntity } from '@/blueprint/entity';
import { toGeometry } from '@/blueprint/compile/to-geometry';
import { getPartType } from '@/blueprint/registry';
import type { ParamSchema } from '@/blueprint/param-schema';
import type { SpritePack } from '@/render/iso/sprite-canvas';
import { greyToSpriteCanvas, greyToDataUri, rgbaToCanvas, type SpriteCanvas } from '@/render/iso/sprite-canvas';
import { initManifoldWasm } from '@/assetgen/geometry/manifold-wasm-browser';
// img2img generation pipeline (the real paid path, surfaced step-by-step).
import { buildingImagePrompt, ttiReferencePrompt } from '@/assetgen/building-image-prompt';
import { compositeOverChroma, chromaKeyMagenta } from '@/render/chroma-key';
import { generateBuildingImage, BuildingImageError, BUILDING_IMAGE_MODEL, defaultModalitiesFor } from '@/llm/openrouter-image-client';
import { loadProviderConfig, openrouterImageBaseUrl } from '@/llm/provider-factory';
import { decodePngToRaster, rasterToSpriteCanvas } from '@/render/sprite-codec';
import {
  type Raster, cropRaster, borderKeyedFraction, registerAlbedo, quantizePalette,
} from '@/render/sprite-postprocess';
import { setActiveStudioController, type StudioController } from './studio-bridge';
import { buildAccordion } from './accordion';
import { buildObjectBrowser } from './object-browser';
import { mountWorldStudio } from './world-studio';
import { mountGalleryStudio } from './gallery-studio';
import { mountZooStudio } from './zoo-studio';
import { mountSiteStudio } from './site-studio';
import { buildAbSection } from './ab-section';
import { buildTree } from './blueprint-tree';
import { buildToolbar } from './toolbar';
import { buildBottomPanel } from './bottom-panel';
import { buildDock } from './stage-dock';
import { createRefLib } from './reflib';
import { buildReferencePanel } from './reference-panel';
import { buildAmbientDials } from './ambient-dials';
import { buildTimeScrubber } from './time-scrubber';
import { compassBearings, celestialPlot } from './sky-hud';
import { openMetadataPanel, makeLiveButton } from './render-request-panel';
import { injectStudioTheme, COLORS, h } from './theme';
import { celestial, solarLight, sunDirFromAngles, AZ_OFFSET, studioNightFactor } from '@/render/solar';
import { type StudioState, type Stage, type AbResult, AB_MODELS, AB_MIN_BORDER, AB_MIN_IOU } from './types';

const MAP_W = 24, MAP_H = 24;
const CENTER = { x: 12, y: 12 };
// The studio is an inspection tool, so it zooms one rung PAST the game's 1:1 cap
// (to 2× native) to scrutinise detail. Fit still snaps to ≤1:1 (pixel-perfect).
const STUDIO_ZOOM_MAX = 2;
// 'proper' scale anchor: the native sprite height (px) the fixed true-metric scale
// is sized to fill the view at. Chosen to contain the tallest subjects (a spired
// church/keep ≈ 900–1000 px) so every object shares ONE scale and none overflows —
// smaller subjects then read honestly small. ~32 px/m, so this is ≈ 32 m of view.
const PROPER_REF_PX = 1024;
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
    flatHeight: true,   // clean inspection plane — no procedural peaks/snow
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
  if (rb) {
    const e = blueprintEntity('subject', rb, CENTER.x, CENTER.y);
    // The studio is a single-subject inspector: render a barrier subject through the building
    // sprite path (its live blueprint composes via resolveParametricBuildingArt), NOT the world's
    // per-run barrierSlabs path which keys off properties.barrier (absent on a blueprint preset).
    if (e.tags?.includes('barrier')) e.tags = e.tags.filter((t) => t !== 'barrier');
    return e;
  }
  return { id: 'subject', kind, x: CENTER.x, y: CENTER.y, properties: {} } as Entity;
}

const sunDir = sunDirFromAngles; // shared az/el → screen-space dir (render/solar.ts)

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

export interface StudioHandle { dispose(): void; }
export interface ObjectStudioOpts {
  /** Initial subject kind (building/plant). Falls back to 'english-oak'. */
  initialKind?: string;
}

/** The single-object editor. Returns a dispose handle so the unified shell
 *  ({@link mountStudio}) can tear it down when switching to World mode. */
export function mountObjectStudio(container: HTMLElement, opts: ObjectStudioOpts = {}): StudioHandle {
  let disposed = false;
  let studioRO: ResizeObserver | null = null;
  let onOrbitKey: ((e: KeyboardEvent) => void) | null = null;

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

  // Two stacked canvases (same as the game): a WebGPU SCENE canvas (renders the lit
  // model straight to its swap chain), and a transparent 2D OVERLAY canvas on top
  // for the grid/HUD/stage-buffer view. The GPU frame builder no longer blits onto a
  // 2D ctx, so the scene must own a real on-screen canvas to be visible.
  const sceneCanvas = document.createElement('canvas');
  sceneCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;z-index:0';
  viewPane.appendChild(sceneCanvas);
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;z-index:1';
  viewPane.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;

  const map = flatMap();

  // Scale reference: a real LPC NPC (1.7 m) standing one tile WEST of the subject's
  // anchor (outside the +x/+y footprint, on the flat ground) so true size reads
  // against an actual game character — a church towers over them, a cottage barely.
  // The sheet warms once (async); the rAF loop shows the NPC the frame it lands.
  const refNpc: NpcInstance = {
    id: 'scale-ref', name: 'Scale', role: 'farmer', seed: 7,
    tileX: CENTER.x + 4, tileY: CENTER.y + 1, direction: 'down', frame: 0, frameTimer: 0, animation: 'walk',
  };
  const refSheets = new Map<string, HTMLCanvasElement>();
  void getOrGenerateSheet(buildCharacterSpec(refNpc.role, refNpc.seed))
    .then((sheet) => { if (sheet) refSheets.set(refNpc.id, sheet); })
    .catch(() => {});
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
  const rbKey = (rb: ResolvedBlueprint): string => JSON.stringify(rb)
    + (state.skirt ? `|skirt:${state.skirt.margin}:${state.skirt.fade}` : '')
    + (state.yaw ? `|yaw:${state.yaw.toFixed(4)}` : '');
  function warmSubject(): void {
    if (!liveRb) return;
    const rb = liveRb, k = rbKey(rb);
    if (subjPacks.has(k) || subjInflight.has(k)) return;
    subjInflight.add(k);
    // `pickIds` (BOTH the geometry stamp + the compose buffer) is studio-only: the live view's
    // click-to-select / hover chip read the resulting per-pixel pick buffer. Costs ~2 bytes/px
    // here; the runtime/game compose paths never pass it (their sprite-cache keys stay stable).
    composeStructure(
      toGeometry(rb, { pickIds: true, ...(state.skirt ? { skirt: { margin: state.skirt.margin } } : {}) }),
      liveSun(),
      { pickIds: true, ...(state.skirt ? { skirtFade: state.skirt.fade } : null), ...(state.yaw ? { yaw: state.yaw } : null) },
    )
      .then((r) => { subjStages.set(k, r); subjPacks.set(k, structureResultToPack(r)); })
      .catch((err) => { console.warn('[studio] compose failed', err); subjPacks.set(k, null); })
      .finally(() => { subjInflight.delete(k); });
  }
  const peekSubject = (): SpritePack | null => (liveRb ? (subjPacks.get(rbKey(liveRb)) ?? null) : null);
  const stagesSubject = (): StructureResult | null => (liveRb ? (subjStages.get(rbKey(liveRb)) ?? null) : null);

  // Shipped/cached img2img sprites render through the SAME runtime source the game
  // uses — GeneratedBuildingArtSource (IDB → vendored building-sprites library, with
  // the black/material-map fix + preset fallback) — wired as resolveGeneratedBuildingArt
  // below, NOT a studio reimplementation of the manifest load. Read-only here
  // (enabled:false): paid generation stays in the reviewed executeRender flow (a thin
  // layer over the shared generate + postprocess primitives), whose result lands in
  // `subjFinished` and wins the lit view via litSubjectPack's albedo-swap.
  const genBuilding = new GeneratedBuildingArtSource({
    enabled: () => false,           // the studio never PAYS through this source
    canSpend: () => false,
    model: () => BUILDING_IMAGE_MODEL,
    generate: async () => { throw new Error('studio genBuilding is read-only'); },
  });
  // A finished sprite produced by THIS session's paid render (executeRender), keyed by
  // blueprint — swapped onto the massing pack's co-registered maps for the lit view.
  // Library/IDB art comes from genBuilding above, not here.
  const subjFinished = new Map<string, SpriteCanvas | null>();
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
    if (!state.textured) return massing;
    const fin = finishedSubject();   // this session's paid render; library/IDB art → genBuilding
    if (fin && fin.width === massing.albedo.width && fin.height === massing.albedo.height) {
      return { ...massing, albedo: fin };
    }
    return massing;
  }

  // Why the textured sprite the LIVE view is serving may be STALE — i.e. painted
  // against geometry other than what's on screen — or null when it's trustworthy.
  // Two independent signals:
  //  - provenance: the game source resolved it via the vendored library's
  //    PRESET-NAME fallback (no hash/version check — the art was seeded for the
  //    bare preset and may predate any geometry edit since). Exact IDB/manifest
  //    hits can never be stale: their key bakes ART_RECIPE_VERSION + a blueprint
  //    hash, so a match ⇒ same geometry.
  //  - dims: the same cheap bbox guard litSubjectPack applies to session renders,
  //    extended to library/IDB packs — a painted crop whose dimensions disagree
  //    with the current massing crop was registered onto a different silhouette.
  // Session renders are exempt (composed against the live blueprint just now).
  // Cheap enough for the frame loop: two memoized map lookups + a dims compare.
  function texturedSpriteWarning(): string | null {
    if (!state.textured || finishedSubject()) return null;
    const pack = genBuilding.peek(subject);
    if (!pack) return null;   // grey massing / still warming — nothing painted to doubt
    if (genBuilding.peekMeta(subject)?.resolved === 'preset-fallback') {
      return '⚠ painted sprite predates geometry edits (preset match — not verified)';
    }
    const massing = peekSubject();
    if (massing && (pack.albedo.width !== massing.albedo.width
      || pack.albedo.height !== massing.albedo.height)) {
      return '⚠ painted sprite size disagrees with current geometry';
    }
    return null;
  }
  const invalidate = (): void => { subjPacks.clear(); subjStages.clear(); subjInflight.clear(); subjFinished.clear(); };

  // The scene's STATIC draw layer (which the subject building/plant lives in) is
  // cached and only rebuilds when `RenderContext.buildingArtRev` changes. The studio
  // reuses ONE map (same dims/seed) across every subject, so without this the cache
  // key never moves and a subject switch keeps drawing the PREVIOUS building. Derive a
  // rev from a cheap signature of everything that changes what the static layer draws —
  // kind, blueprint (rbKey folds skirt+yaw), the textured toggle, and whether the async
  // massing pack / finished sprite has settled (so the subject appears progressively as
  // compose lands, mirroring the game's progressive building texturing).
  let subjectRev = 0;
  let lastSubjSig = '';
  function subjectArtRev(): number {
    const k = liveRb ? rbKey(liveRb) : '';
    const sig = `${state.kind}|${k}|${+state.textured}|${peekSubject() ? 'p' : '-'}`
      + `|${state.textured && finishedSubject() ? 'f' : '-'}`;
    if (sig !== lastSubjSig) { lastSubjSig = sig; subjectRev++; }
    return subjectRev;
  }
  // WebGPU scene renderer (async bring-up). Until it resolves, the frame loop
  // paints only the background; the GPU canvas composites once ready.
  let renderMap: RenderFn | null = null;
  void createGpuRenderMap({ canvas: sceneCanvas })
    .then((r) => { renderMap = r.render; })
    .catch((err) => { console.error('[studio] GPU render init failed:', err); });

  const initial = (opts.initialKind && opts.initialKind !== '1') ? opts.initialKind : 'english-oak';

  const state: StudioState = {
    kind: (BUILDING_BLUEPRINTS[initial] || isBridgePreset(initial) || isPlantPreset(initial)) ? initial : 'english-oak',
    lighting: { ...DEFAULT_LIGHTING, shadowMode: 'geometry' },
    az: 41, el: 40,
    sunMode: 'solar',
    hour: 15, yearFrac: 0.3, lat: 45, moonPhase: 1,
    overlays: true,
    textured: true,
    fit: true,
    scaleMode: 'proper',
    yaw: 0,
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
  // Assigned alongside rebuildTree: expands/scrolls/flashes a blueprint tree node by
  // PICK key (`<partId>` or `<partId>/<featureId>`) — the sprite click-to-select sink.
  let treeSelect: (pickKey: string) => void = () => {};
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
    sceneCanvas.width = canvas.width;
    sceneCanvas.height = canvas.height;   // GPU swap chain follows this size
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  studioRO = new ResizeObserver(resize); studioRO.observe(viewPane);
  resize();

  const cam = createCamera();
  function fitCamera(): void {
    const { w, h } = viewport();
    const foot = worldToScreen(CENTER.x, CENTER.y, 0, 0, 0);
    const pack = subjectPack();
    const pw = pack?.albedo?.width ?? 0, ph = pack?.albedo?.height ?? 0;
    // 'proper': a FIXED true-metric scale shared by every subject (sized to fit the
    // tallest building, PROPER_REF_PX), so a church reads bigger than a cottage and a
    // prop reads tiny — honest relative size. 'game': fit each subject to ~84% of the
    // view (the convenient framing). Snap DOWN to a natural ladder rung either way.
    const z = state.scaleMode === 'proper'
      ? Math.min(h * 0.92, w * 0.92) / PROPER_REF_PX
      : (pw && ph ? Math.min((h * 0.84) / ph, (w * 0.84) / pw) : cam.zoom || 1);
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

  // ── turntable orbit (right-drag, or Q/E keys) ────────────────────────────────
  // Snapped to 15° so each angle's geometry bake is cached & reused (peekSubject
  // keys on yaw); orbiting through a revolution composes 24 angles once, then
  // scrubs instantly. No invalidate — that would drop the other angles' bakes.
  const YAW_STEP = Math.PI / 12;            // 15°
  const TAU = Math.PI * 2;
  const RAD_PER_PX = YAW_STEP / 11;         // ~11 px drag per 15° step
  function setYaw(rad: number): void {
    const snapped = Math.round(rad / YAW_STEP) * YAW_STEP;
    state.yaw = ((snapped % TAU) + TAU) % TAU;
  }
  // right-button drag orbits without disturbing attachControls' left-drag pan.
  let orbiting = false, orbitStartX = 0, orbitStartYaw = 0, orbitMoved = false;
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 2) return;
    orbiting = true; orbitMoved = false; orbitStartX = e.clientX; orbitStartYaw = state.yaw;
    canvas.style.cursor = 'ew-resize';
  });
  window.addEventListener('mousemove', (e) => {
    if (disposed || !orbiting) return;
    if (Math.abs(e.clientX - orbitStartX) > 2) orbitMoved = true;
    setYaw(orbitStartYaw + (e.clientX - orbitStartX) * RAD_PER_PX);
  });
  window.addEventListener('mouseup', (e) => {
    if (disposed) return;
    if (e.button === 2 && orbiting) { orbiting = false; canvas.style.cursor = ''; }
  });
  // swallow the context menu only when it ends an orbit drag (so a plain
  // right-click elsewhere still works normally).
  canvas.addEventListener('contextmenu', (e) => { if (orbitMoved) { e.preventDefault(); orbitMoved = false; } });
  onOrbitKey = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'q' || e.key === 'Q') setYaw(state.yaw - YAW_STEP);
    else if (e.key === 'e' || e.key === 'E') setYaw(state.yaw + YAW_STEP);
    else if (e.key === 'r' || e.key === 'R') state.yaw = 0;
  };
  window.addEventListener('keydown', onOrbitKey);

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
    // `uNight` (shader emissive gate — lit window panes) was never set here, so
    // painted sprites' windows never glowed in the studio even at midnight on
    // the Sky slider. Solar mode reads the SAME runtime authority the live game
    // uses (solar hour → tick → `nightFactorForTick`); manual az/el mode has no
    // tick, so it derives an equivalent ramp from elevation (see `studioNightFactor`).
    state.lighting.nightFactor = studioNightFactor(state.sunMode, state.hour, state.el);
    if (state.fit) fitCamera();
    // Keep the scale-reference NPC just off the subject's SOUTH-EAST corner so it always
    // y-sorts IN FRONT of the building's billboard — a fixed offset falls inside a deep
    // footprint (e.g. the 3×6 church) and the tall sprite then draws over the NPC.
    const fp = liveRb?.footprint;
    refNpc.tileX = CENTER.x + (fp ? fp.w : 1);
    refNpc.tileY = CENTER.y + (fp ? fp.h : 1);
    return {
      map, camera: cam, canvasWidth: w, canvasHeight: h,
      // The scale-reference NPC, once its sheet is warm. Rendered by the scene's
      // NPC pass at true metric, y-sorted in front of the subject.
      npcs: refSheets.has(refNpc.id) ? [refNpc] : [],
      npcSheets: refSheets,
      world, lighting: state.lighting,
      resolveParametricBuildingArt: litSubjectPack,
      resolveParametricPlantArt: litSubjectPack,
      // Shipped/cached img2img sprites render through the game's GeneratedBuildingArtSource
      // (identical path + the black/material-map fix + preset fallback the live game uses).
      // A fresh SESSION paid render (finishedSubject) wins instead via the parametric
      // albedo-swap in litSubjectPack, so a just-generated sprite overrides the library.
      resolveGeneratedBuildingArt: (e: Entity) => {
        if (!state.textured || finishedSubject()) return null;
        const s = genBuilding.peek(e);
        if (s) return s;
        genBuilding.warm(e);   // fire-and-forget; free IDB/library read, never blocks
        return null;
      },
      // Bust the scene's static-draw-list cache when the subject changes (subjectArtRev)
      // AND when the game source resolves a sprite (genBuilding.version()).
      buildingArtRev: subjectArtRev() + genBuilding.version(),
      studioNoChrome: true,   // bare scene; the studio draws its own overlays/HUD
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

    // Scale legend (screen space): the units the grid + reference NPC encode + the mode.
    const { h: vh } = viewport();
    ctx.save();
    ctx.font = '600 11px var(--font-mono)';
    ctx.fillStyle = 'rgba(232,238,246,0.88)';
    ctx.textAlign = 'left';
    ctx.fillText(
      `□ grid = ${METRES_PER_TILE} m · 🧍 NPC = ${HUMAN_HEIGHT_M} m · ${state.scaleMode === 'proper' ? 'TRUE scale' : 'fit (game)'}`,
      12, vh - 12,
    );
    ctx.restore();
  }
  // A compact COMPASS ROSE, tucked top-left (the toolbar carries the text status now).
  // Drawn only in the live 3D view. The N/E/S/W labels sit at the SCREEN directions of the
  // world-compass faces folded through BOTH the turntable yaw AND the iso projection (all
  // from sky-hud.compassBearings — no hardcoded angles), so at yaw 0 the S label points at
  // the model's south (front) face and the ring counter-rotates as you orbit. The sky body
  // (sun by day / moon by night) plots at its TRUE azimuth with elevation as distance from
  // centre (rim = horizon, centre = zenith). Cheap — runs every frame.
  function drawHud(): void {
    if (!state.overlays) return;
    const gx = 44, gy = 44, R = 26;
    ctx.save();
    // backdrop + ring
    ctx.fillStyle = 'rgba(12,13,17,0.55)';
    ctx.beginPath(); ctx.arc(gx, gy, R + 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(gx, gy, R, 0, Math.PI * 2); ctx.stroke();

    // cardinal ticks + labels (N highlighted in the accent so orientation reads at a glance)
    ctx.font = '700 10px var(--font-mono)';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const b of compassBearings(state.yaw)) {
      ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(gx + b.sx * (R - 3), gy + b.sy * (R - 3));
      ctx.lineTo(gx + b.sx * R, gy + b.sy * R);
      ctx.stroke();
      ctx.fillStyle = b.label === 'N' ? COLORS.accent : 'rgba(232,238,246,0.85)';
      ctx.fillText(b.label, gx + b.sx * (R - 9), gy + b.sy * (R - 9));
    }

    // sky body: sun (accent) by day, moon (pale) by night. Azimuth on the rose, elevation
    // as distance from centre. Recover the TRUE compass azimuth from the studio's (eyeballed
    // AZ_OFFSET) az so the plot is cardinally honest; manual mode has no moon.
    const body = state.sunMode === 'solar'
      ? celestial(state.hour, state.yearFrac, state.lat, state.moonPhase).body : 'sun';
    const trueAz = (((state.az - AZ_OFFSET) % 360) + 360) % 360;
    const p = celestialPlot(trueAz, state.el, state.yaw);
    const px = gx + p.x * R, py = gy + p.y * R;
    const dim = body === 'moon';
    ctx.strokeStyle = dim ? 'rgba(205,214,230,0.55)' : COLORS.accent; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(px, py); ctx.stroke();
    ctx.fillStyle = dim ? '#cdd6e6' : COLORS.accent;
    ctx.beginPath(); ctx.arc(px, py, dim ? 2.6 : 3, 0, Math.PI * 2); ctx.fill();

    // turntable yaw readout (only when rotated off the canonical view)
    if (state.yaw) {
      const deg = Math.round((state.yaw * 180) / Math.PI);
      ctx.fillStyle = 'rgba(232,238,246,0.9)';
      ctx.font = '600 11px var(--font-mono)';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(`⟳ ${deg}°`, gx, gy + R + 18);
    }
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
  // The Reference tab is much taller than the stage strip (thumbnails + prompt + controls), so on
  // its first reveal auto-grow the dock to fit its content (grow-only — never fights a manual drag).
  const bottom = buildBottomPanel(dock, (which) => {
    if (which !== 'ref') return;
    requestAnimationFrame(() => {
      const maxH = container.getBoundingClientRect().height * MAX_DOCK_FRAC;
      const need = bottom.tabsEl.offsetHeight + bottom.refBody.scrollHeight + 10;
      const target = Math.max(state.dockH, Math.min(maxH, need));
      if (target > state.dockH + 1) { state.dockH = target; dock.style.height = `${target}px`; resize(); }
    });
  });
  const dockUi = buildDock(bottom.pipelineBody);
  // TTI reference-library loader (dev-only /__reflib): each subject that has a text-to-image
  // reference gets it shown in the Reference dock tab — a manual eval tool (our sprite vs ref).
  const refLib = createRefLib();
  // Our best current sprite for the eval: the finished/painted one (session render → game-source
  // library), else the grey massing final-crop. The massing crop is memoised on the struct identity.
  let ourMassingFor: StructureResult | null = null;
  let ourMassingCanvas: SpriteCanvas | null = null;
  const ourSprite = (): SpriteCanvas | null => {
    const fin = finishedSubject() ?? (genBuilding.peek(subject)?.albedo ?? null);
    if (fin) return fin;
    const r = stagesSubject();
    if (!r) return null;
    if (r !== ourMassingFor) { ourMassingFor = r; ourMassingCanvas = greyToSpriteCanvas(r.grey, r.size, r.bbox); }
    return ourMassingCanvas;
  };
  const refBridgeRw = new URLSearchParams(location.search).get('bridge') === 'rw';
  const refPanel = buildReferencePanel(bottom.refBody, {
    references: () => refLib.referencesFor(state.kind),
    ourSprite,
    onInspect: (c, label) => { state.view = { canvas: c, label }; },
    kind: () => state.kind,
    defaultPrompt: () => (liveRb ? ttiReferencePrompt(liveRb) : ''),
    models: AB_MODELS,
    defaultModel: 'black-forest-labs/flux.2-pro',
    allowWrite: () => refBridgeRw,
    base: refLib.base,
    onRegenDone: (slug) => refLib.invalidate(slug),
    onDeleteDone: (slug) => refLib.remove(slug),
  });
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
  // Stale-sprite warning chip (bottom-left over the view, same house style as the
  // ambient-dial bar): shown while the LIVE view serves a painted sprite that is
  // NOT verified against the on-screen geometry (see texturedSpriteWarning).
  // Re-evaluated every frame, so it appears/disappears reactively as the user
  // edits geometry or toggles the Textured display option.
  // Top-centre under the ambient dials — bottom-left collided with the centred time
  // scrubber (long warning text slid beneath its panel and truncated).
  const staleBadge = h('div', {
    style: 'position:absolute;left:50%;transform:translateX(-50%);top:52px;z-index:6;display:none;'
      + 'max-width:min(72%,640px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
      + 'padding:4px 10px;border-radius:8px;font-size:12px;color:#e8b45a;'
      + 'background:rgba(16,18,24,0.72);border:1px solid var(--line);'
      + 'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);box-shadow:0 2px 10px rgba(0,0,0,0.35)',
  });
  viewPane.appendChild(staleBadge);
  function updateStaleBadge(): void {
    // Only meaningful over the live 3D view — stage-buffer inspection hides it.
    const warn = state.view ? null : texturedSpriteWarning();
    if (warn) {
      if (staleBadge.textContent !== warn) staleBadge.textContent = warn;
      staleBadge.style.display = 'block';
    } else {
      staleBadge.style.display = 'none';
    }
  }
  // Ambient dials (centre-top over the view): preview emergent environment effects on the subject
  // — COLD lights a hearth fire → smoke rises from the building's baked chimney-vent anchors.
  const ambient = buildAmbientDials(viewPane);
  // Time-of-day scrubber (bottom-centre over the view): the promoted 90%-case sun control. Drags
  // go through the SAME solar seam the toolbar popover uses (recomputeSun) — cheap live path while
  // dragging, cast-shadow re-bake on release — and a drag flips manual→solar. Two-way sync with the
  // popover is by the per-frame refresh() below (both read the one owned state).
  const scrubber = buildTimeScrubber(viewPane, {
    getHour: () => state.hour,
    getYearFrac: () => state.yearFrac,
    getLat: () => state.lat,
    getMoonPhase: () => state.moonPhase,
    // Same gate as the HUD: overlays on AND the live 3D view (in stage inspection the
    // z-9 stage overlay would sit over the bar and swallow its pointer events anyway).
    visible: () => state.overlays && !state.view,
    onScrubStart: () => { if (state.sunMode === 'manual') state.sunMode = 'solar'; },
    onInput: (hour) => { state.hour = hour; recomputeSun(false); },
    onCommit: (hour) => { state.hour = hour; recomputeSun(true); },
  });
  /** The subject's chimney-vent anchors projected into world-screen space (smoke emission points).
   *  Vent anchors are normalised (0..1) against the sprite's opaque bbox; the foot-anchored sprite
   *  spans [foot.sy−ph, foot.sy] and is centred at foot.sx (width pw), so this maps them 1:1. */
  function ventScreenPoints(): { x: number; y: number }[] {
    const struct = stagesSubject();
    const pack = subjectPack();
    const vents = struct?.anchors?.vents;
    if (!struct || !pack?.albedo || !vents?.length) return [];
    const foot = worldToScreen(CENTER.x, CENTER.y, 0, 0, 0);
    const pw = pack.albedo.width, ph = pack.albedo.height;
    const left = foot.sx - pw / 2, top = foot.sy - ph;
    return vents.map((v) => ({ x: left + v.x * pw, y: top + v.y * ph }));
  }

  // ── click-to-select pick channel (hover chip + click → blueprint tree) ──────
  // warmSubject composes with `pickIds: true`, so every studio StructureResult carries a
  // per-pixel provenance buffer (uncropped, size²). The subject is drawn foot-anchored at
  // CENTER exactly like ventScreenPoints above: the CROPPED pack spans
  // [foot.sx − pw/2, foot.sx + pw/2] × [foot.sy − ph, foot.sy] in world-screen space, and the
  // UNCROPPED pick buffer's origin sits a further (−bbox.x, −bbox.y) up-left of that. Both
  // directions of the mapping below reuse this ONE frame so hover/click/outline stay aligned.
  // Yaw needs no special-casing: compose bakes the turntable into the sprite, so the mapping
  // is always just this 2D draw rect.
  interface PickBox { x0: number; y0: number; x1: number; y1: number }
  /** Per-key pixel bboxes for the hover outline, scanned ONCE per composed struct (keyed on
   *  the StructureResult identity — invalidate() drops the struct, the WeakMap follows). */
  const pickBoxCache = new WeakMap<StructureResult, Map<string, PickBox>>();
  function pickBoxesFor(struct: StructureResult): Map<string, PickBox> | null {
    if (!struct.pick) return null;
    let m = pickBoxCache.get(struct);
    if (m) return m;
    m = new Map<string, PickBox>();
    const { data, table, width, height } = struct.pick;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const id = data[y * width + x];
      if (!id) continue;
      const key = table[id - 1];
      const bb = m.get(key);
      if (!bb) m.set(key, { x0: x, y0: y, x1: x, y1: y });
      else {
        if (x < bb.x0) bb.x0 = x; if (x > bb.x1) bb.x1 = x;
        if (y < bb.y0) bb.y0 = y; if (y > bb.y1) bb.y1 = y;
      }
    }
    pickBoxCache.set(struct, m);
    return m;
  }
  /** The UNCROPPED pick buffer's top-left in world-screen space (and the pack dims), or null
   *  until the composed struct + pack are warm. greyToSpriteCanvas crops at Math.round(bbox),
   *  so the same rounding keeps the two frames pixel-aligned. */
  function pickFrame(): { left: number; top: number; struct: StructureResult } | null {
    const struct = stagesSubject();
    const pack = subjectPack();
    if (!struct?.pick || !pack?.albedo) return null;
    const foot = worldToScreen(CENTER.x, CENTER.y, 0, 0, 0);
    return {
      left: foot.sx - pack.albedo.width / 2 - Math.round(struct.bbox.x),
      top: foot.sy - pack.albedo.height - Math.round(struct.bbox.y),
      struct,
    };
  }
  /** Pick key under a client-space point in the LIVE view, or null. Inverts the overlay
   *  camera transform (screen = (world − cam)·zoom — see drawOverlays) then indexes the
   *  pick buffer; the sub-pixel origin snap (≤1/zoom px) is irrelevant at pick granularity. */
  function pickKeyAt(clientX: number, clientY: number): string | null {
    if (state.view) return null;                 // stage inspection showing, not the live scene
    const f = pickFrame();
    if (!f) return null;
    const r = viewPane.getBoundingClientRect();
    const wx = (clientX - r.left) / cam.zoom + cam.x;
    const wy = (clientY - r.top) / cam.zoom + cam.y;
    const px = Math.floor(wx - f.left), py = Math.floor(wy - f.top);
    const { data, table, width, height } = f.struct.pick!;
    if (px < 0 || py < 0 || px >= width || py >= height) return null;
    const id = data[py * width + px];
    return id ? table[id - 1] : null;
  }
  // Hover chip: a small cursor-tracking DOM label (house pattern: absolute chip over the
  // view pane, like ambient-dials) naming the feature under the cursor, e.g. 'body/win_s'.
  const pickChip = h('div', {
    style: 'position:absolute;z-index:8;display:none;pointer-events:none;'
      + 'font:500 11px/1 var(--font-mono);color:var(--accent);background:rgba(14,15,20,.88);'
      + 'border:1px solid var(--accent-dim);border-radius:4px;padding:3px 7px;white-space:nowrap',
  });
  viewPane.appendChild(pickChip);
  let hoverPickKey: string | null = null;
  function setPickHover(key: string | null, e?: MouseEvent): void {
    hoverPickKey = key;
    if (!key || !e) {
      pickChip.style.display = 'none';
      if (!orbiting) canvas.style.cursor = '';
      return;
    }
    const r = viewPane.getBoundingClientRect();
    pickChip.textContent = key;
    pickChip.style.left = `${Math.round(e.clientX - r.left + 14)}px`;
    pickChip.style.top = `${Math.round(e.clientY - r.top + 12)}px`;
    pickChip.style.display = 'block';
    canvas.style.cursor = 'pointer';
  }
  canvas.addEventListener('mousemove', (e) => {
    if (disposed || orbiting) return;
    // A held left button is attachControls' pan drag — mute the hover so the chip doesn't
    // chase a panning camera (and the cursor stays the pan affordance, not 'pointer').
    if (e.buttons & 1) { setPickHover(null); return; }
    setPickHover(pickKeyAt(e.clientX, e.clientY), e);
  });
  canvas.addEventListener('mouseleave', () => setPickHover(null));
  // CLICK (no drag) selects in the blueprint tree. attachControls owns left-DRAG for the
  // camera pan, so disambiguate by travel: ≤3 px between down and up reads as a click —
  // listeners only, no preventDefault/stopPropagation, so the pan keeps working untouched.
  let pickDown: { x: number; y: number } | null = null;
  canvas.addEventListener('mousedown', (e) => { if (e.button === 0) pickDown = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('mouseup', (e) => {
    if (disposed || e.button !== 0 || !pickDown) return;
    const moved = Math.hypot(e.clientX - pickDown.x, e.clientY - pickDown.y);
    pickDown = null;
    if (moved > 3) return;                        // it was a pan, not a click
    const key = pickKeyAt(e.clientX, e.clientY);
    if (key) treeSelect(key);
  });
  /** Outline the hovered feature's pixel bbox on the 2D overlay (same world-screen camera
   *  transform as drawOverlays, so it tracks the sprite under pan/zoom). Per-frame cost is
   *  one cached Map lookup — the bbox scan ran once per compose in pickBoxesFor. */
  function drawPickHover(camv: { x: number; y: number; zoom: number }): void {
    if (!hoverPickKey || state.view) return;
    const f = pickFrame();
    if (!f) return;
    const bb = pickBoxesFor(f.struct)?.get(hoverPickKey);
    if (!bb) return;
    const z = camv.zoom;
    ctx.save();
    ctx.scale(z, z);
    ctx.translate(Math.round(-camv.x * z) / z, Math.round(-camv.y * z) / z);
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 1.5 / z;
    // ±1 px breathing room so a 1-px-thin feature (a mullion) still shows a visible ring.
    ctx.strokeRect(f.left + bb.x0 - 1, f.top + bb.y0 - 1, bb.x1 - bb.x0 + 3, bb.y1 - bb.y0 + 3);
    ctx.restore();
  }

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
    genBuilding.warm(subject);   // library/IDB art via the game source (free reads)
    const r = stagesSubject();
    // This session's paid render wins; else the shipped library sprite (game source).
    const sessionFin = finishedSubject();
    const finished = sessionFin ?? (genBuilding.peek(subject)?.albedo ?? null);
    if (r === shownStruct && genStages.length === shownGenLen && finished === shownFinished) return;
    shownStruct = r; shownGenLen = genStages.length; shownFinished = finished;
    if (!r) { dockUi.message('generating…'); return; }
    // The finished sprite (free, no API) when one exists for this blueprint — shown as the
    // '★' stage so finished art is visible without paying. A library sprite resolved via
    // the PRESET-NAME fallback carries no hash/version check (unlike an exact key, which
    // bakes ART_RECIPE_VERSION + a blueprint hash), so it may have been painted against
    // old geometry — say so instead of presenting it as trustworthy.
    const presetFallback = !sessionFin
      && genBuilding.peekMeta(subject)?.resolved === 'preset-fallback';
    const libStage: Stage[] = finished
      ? [{ label: '★ seeded sprite (finished)', canvas: finished,
          sub: sessionFin ? 'this session'
            : presetFallback ? 'library · preset match — NOT verified against current geometry'
            : 'from library (game source)' }]
      : [];
    const tiles = [...composeStages(r), ...libStage, ...genStages];
    dockUi.render(
      `${state.kind}  ·  canvas ${r.size}²  ·  crop ${Math.round(r.bbox.w)}×${Math.round(r.bbox.h)}`,
      tiles,
      (st) => { if (st.canvas) { state.view = { canvas: st.canvas, label: st.label }; } },
    );
  }

  let raf = 0;
  let lastFrameMs = 0;
  function frame(): void {
    if (disposed) return;
    const tNow = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const dtMs = lastFrameMs ? tNow - lastFrameMs : 16.7;
    lastFrameMs = tNow;
    if (state.view) {
      // Stage-buffer inspection: hide the GPU scene so the (opaque) stage view owns
      // the pane.
      sceneCanvas.style.visibility = 'hidden';
      drawStageInPane(state.view.canvas);
      const c = state.view.canvas;
      const s = stageNav.zoom > 0 ? stageNav.zoom : stageFitScale(c);
      liveBtn.show(`${state.view.label}  ·  ${s >= 1 ? `${Math.round(s)}×` : `${(s * 100) | 0}%`} (scroll=zoom, drag=pan, dbl=reset)`);
      stageOverlay.style.display = 'block';
    } else {
      sceneCanvas.style.visibility = 'visible';
      stageOverlay.style.display = 'none';
      const rc = renderContext();
      if (renderMap) renderMap(ctx, rc);
      drawOverlays(rc.camera);
      drawPickHover(rc.camera);   // click-to-select hover outline (world-screen space)
      drawHud();
      liveBtn.hide();
      // Ambient effects (smoke etc.) — stepped by wall-clock, drawn in the same world-screen space
      // as the overlays (so the plume tracks the chimney under pan/zoom), on top of the scene.
      if (ambient.active) {
        ambient.step(ventScreenPoints(), dtMs);
        const camv = rc.camera, z = camv.zoom;
        ctx.save();
        ctx.scale(z, z);
        ctx.translate(Math.round(-camv.x * z) / z, Math.round(-camv.y * z) / z);
        ambient.draw(ctx);
        ctx.restore();
      }
    }
    syncStages();
    updateStaleBadge();  // reactive: follows geometry edits + the Textured toggle
    refPanel.update();   // Reference dock tab: our sprite vs the TTI target (memoised internally)
    toolbar.refresh();
    scrubber.refresh();  // moves the handle when the popover changes time; hides with overlays
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
        treeSelect = treeUi.select;   // sprite pick-click → tree expand/scroll/flash
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
    setYaw: (deg: number) => setYaw((deg * Math.PI) / 180),
    getYaw: () => (state.yaw * 180) / Math.PI,
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
    /** All available subject presets (buildings + hand plants + flora-DB species + bridges). */
    kinds: (): string[] => assetCatalogue().map((e) => e.type).sort(),
    /** The current subject kind. */
    get kind(): string { return state.kind; },
    /** Switch subject; resolves once its geometry is warm + drawn. */
    async setKind(kind: string): Promise<boolean> {
      if (!BUILDING_BLUEPRINTS[kind] && !isBridgePreset(kind) && !isPlantPreset(kind)) throw new Error(`unknown kind "${kind}"`);
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
    /** Run ONE paid text-to-image REFERENCE regen of the current (or named) subject,
     *  written into the studio's reference library (reference-library/tti/<slug>/) via
     *  the /__reflib dev sink — the same endpoint the Reference panel's Regen button
     *  uses. Derives the TTI prompt from the resolved blueprint unless `prompt` is
     *  given; defaults the model to FLUX.2 Pro. COSTS MONEY (~$0.03). */
    async regenReference(kind?: string, slug?: string, model?: string, prompt?: string): Promise<unknown> {
      if (kind && kind !== state.kind) await studioDebug.setKind(kind);
      const rb = liveRb;
      if (!rb) throw new Error(`no blueprint for "${state.kind}"`);
      const ttiPrompt = prompt ?? ttiReferencePrompt(rb);
      const useSlug = slug ?? state.kind;
      const useModel = model ?? 'black-forest-labs/flux.2-pro';
      const res = await fetch(`${refLib.base}/${encodeURIComponent(useSlug)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: ttiPrompt, model: useModel, confirm: true }),
      });
      if (!res.ok) throw new Error(`regen failed (${res.status}): ${await res.text()}`);
      const json = await res.json();
      refLib.invalidate(useSlug);   // reload the new reference image into the panel
      return json;
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
      { ...(state.skirt ? { skirtFade: state.skirt.fade } : null), ...(state.yaw ? { yaw: state.yaw } : null) },
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
    /** Orbit the turntable to an absolute yaw in DEGREES (snapped to 15°); resolves
     *  once that angle's geometry is composed + drawn. */
    async setYaw(deg: number): Promise<boolean> { setYaw((deg * Math.PI) / 180); return settleGeometry(); },
    /** Current turntable yaw in degrees. */
    yaw: (): number => Math.round((state.yaw * 180) / Math.PI),
    /** Snap to one of the 4 placement orientations (0..3 = S/W/N/E door facing); a turn
     *  of o×90° — the same geometry rotation the placer bakes into a building's blueprint. */
    async setOrientation(o: number): Promise<boolean> { setYaw((((o % 4) + 4) % 4) * (Math.PI / 2)); return settleGeometry(); },
    /** Current placement orientation (0..3) the turntable is snapped to. */
    orientation: (): number => ((Math.round(state.yaw / (Math.PI / 2)) % 4) + 4) % 4,
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
  // Publish this control surface so the studio↔bus bridge (?studio…&bridge) can drive
  // it out-of-process (CLI / MCP: studio_select / studio_render / screenshot).
  setActiveStudioController(studioDebug as unknown as StudioController);
  // eslint-disable-next-line no-console
  console.log('[studio] mounted —', state.kind);

  return {
    dispose(): void {
      disposed = true;
      cancelAnimationFrame(raf);
      studioRO?.disconnect();
      if (onOrbitKey) window.removeEventListener('keydown', onOrbitKey);
      setActiveStudioController(null);
    },
  };
}

// ── unified studio shell ─────────────────────────────────────────────────────
// One entry point hosting EVERY workspace in the same chrome: a slim workspace bar
// over a content host. Switching disposes the current workspace and mounts the
// next (no page reload). Each workspace is a thin adapter over its mount fn and
// gets a shared `ctx` whose `open(id, arg)` lets one workspace hand off to another
// (the World Browser's "Edit in studio" → the Object editor; a Gallery cell → the
// Object editor). The registry is data-driven, so new workspaces (Zoo, …) are one
// entry. Initial workspace comes from ?studio:
//   =world → World · =gallery/arboretum/buildings → Gallery (filtered) ·
//   =<kind> → that object · bare → Object (oak).

/** A registered studio surface. `mount` returns the standard dispose handle; `arg`
 *  carries an initial subject (Object) or class filter (Gallery). */
interface Workspace {
  id: string;
  label: string;   // button label (leading emoji + name)
  mount(host: HTMLElement, ctx: WorkspaceCtx, arg?: string): StudioHandle;
}
interface WorkspaceCtx {
  /** Switch to another workspace, optionally seeding it (e.g. open a kind in Object). */
  open(id: string, arg?: string): void;
}

const WORKSPACES: Workspace[] = [
  { id: 'object', label: '🏛 Object', mount: (host, _ctx, arg) => mountObjectStudio(host, { initialKind: arg }) },
  { id: 'gallery', label: '🖼 Gallery', mount: (host, ctx, arg) => mountGalleryStudio(host, { filter: arg, onEdit: (k) => ctx.open('object', k) }) },
  { id: 'zoo', label: '🦌 Zoo', mount: (host) => mountZooStudio(host) },
  { id: 'world', label: '🌍 World', mount: (host, ctx) => mountWorldStudio(host, { onEdit: (k) => ctx.open('object', k) }) },
  { id: 'site', label: '🏰 Site', mount: (host) => mountSiteStudio(host) },
];

/** Map a ?studio= param to an initial (workspace id, arg). Unknown → Object/<param>. */
function initialWorkspace(param: string | null): { id: string; arg?: string } {
  switch (param) {
    case 'world': return { id: 'world' };
    case 'site': return { id: 'site' };
    case 'zoo': return { id: 'zoo' };
    case 'gallery': case '1': case null: return param === 'gallery' ? { id: 'gallery' } : { id: 'object' };
    case 'arboretum': return { id: 'gallery', arg: 'plant' };
    case 'buildings': return { id: 'gallery', arg: 'building' };
    default: return { id: 'object', arg: param ?? undefined };
  }
}

export function mountStudio(container: HTMLElement): void {
  injectStudioTheme(container);
  container.style.position = 'relative';
  container.style.background = COLORS.bg0;

  const shell = h('div', { style: 'position:absolute;inset:0;display:flex;flex-direction:column;overflow:hidden' });
  const bar = h('div', { class: 'sg-panel', style: 'flex:0 0 auto;display:flex;gap:6px;align-items:center;padding:5px 10px;border-bottom:1px solid var(--line)' });
  const host = h('div', { style: 'position:relative;flex:1 1 auto;min-height:0;overflow:hidden' });
  shell.append(bar, host);
  container.appendChild(shell);

  bar.appendChild(h('span', { class: 'sg-muted', style: 'font-weight:700;letter-spacing:.06em;margin-right:6px', text: 'STUDIO' }));

  let activeId = '';
  let current: StudioHandle | null = null;
  const buttons = new Map<string, HTMLElement>();
  const paint = (): void => { for (const [id, btn] of buttons) btn.classList.toggle('is-on', id === activeId); };

  const ctx: WorkspaceCtx = { open };
  function open(id: string, arg?: string): void {
    const ws = WORKSPACES.find((w) => w.id === id);
    if (!ws) return;
    current?.dispose();
    host.replaceChildren();
    activeId = id; paint();
    current = ws.mount(host, ctx, arg);
  }

  for (const ws of WORKSPACES) {
    const btn = h('button', { class: 'sg-btn', html: ws.label.replace(/^(\S+)\s/, '$1 <span style="opacity:.8">') + '</span>' });
    btn.addEventListener('click', () => { if (activeId !== ws.id) open(ws.id); });
    buttons.set(ws.id, btn);
    bar.appendChild(btn);
  }

  const init = initialWorkspace(new URLSearchParams(location.search).get('studio'));
  open(init.id, init.arg);
}

function cloneRaster(r: Raster): Raster {
  return { data: new Uint8ClampedArray(r.data), w: r.w, h: r.h };
}
