// The generateWorld orchestration: engine wasm + renderer + art library +
// flora prewarm + worldgen (with loading-bar progress mapping), then the
// art-settle hold — the overlay outlives worldgen-ready until the building art
// has settled, so the world fades in fully textured (never grey massing). The
// gate itself (signals + quiet window) lives in art-settle-gate.ts.
import type { GameMap, WorldSeed } from '@/core/types';
import type { GameState } from '@/core/state';
import type { AssetManager } from '@/render/asset-manager';
import type { ArtImageCache } from '@/render/decoration-image-cache';
import type { LoadingSurface } from '@/render/ui/shell/shell';
import type { SaveFile } from '@/core/save-file';
import type { ParametricBuildingSource } from '@/render/parametric-building-source';
import type { ParametricBarrierSource } from '@/render/parametric-barrier-source';
import type { ParametricPlantSource } from '@/render/parametric-plant-source';
import type { GeneratedBuildingArtSource } from '@/render/generated-building-art-source';
import type { Viewport } from './viewport';
import { readSave, readJournal, type SaveSlot } from '@/services/save-store';
import { waitForArtSettled } from '@/game/art-settle-gate';
import { composeQueuePending } from '@/render/compose-scheduler';
import { pendingSheets } from '@/render/lpc/spritesheet-cache';
import { selectRenderer, type SelectedRenderers } from '@/render/select-renderer';
import { ART_RECIPE_VERSION } from '@/core/content-version';
import { loadBaseLibrary } from '@/services/base-library-loader';
import { AssetLibrary } from '@/services/asset-library';
import { ArtResolver } from '@/render/art-resolver';
import { initManifoldWasm } from '@/assetgen/geometry/manifold-wasm-browser';
import { bootMark } from '@/dev/profile';
import { createBootProgressMapper } from '@/ui/boot-progress';
import { bootstrapWorld } from '@/game/bootstrap-world';

export interface BootSequenceDeps {
  canvas: HTMLCanvasElement;
  state: GameState;
  /** The progress surface. Satisfied BOTH by the WebGPU shell (UI v3) and by the
   *  legacy DOM loading overlay, which is exactly why the type is the structural
   *  `LoadingSurface` — swapping one for the other is a type change here, not a
   *  rewrite of this orchestration. */
  loading: LoadingSurface;
  assets: AssetManager;
  sheets: Map<string, HTMLCanvasElement>;
  decorationImages: ArtImageCache;
  getViewport: () => Viewport;
  parametricPlantSource: ParametricPlantSource;
  parametricBuildingSource: ParametricBuildingSource;
  parametricBarrierSource: ParametricBarrierSource;
  generatedBuildingArtSource: GeneratedBuildingArtSource;
  /** The scene renderer lands back on the Game as soon as it's up (the frame
   *  path + captureFrame read `render`; `renderMeta` is P1-C's world-less
   *  title-screen entry — captured now, wired into the frame loop by a later
   *  phase, spec 3.1's meta-mode `onRender` branch). */
  setRenderMap: (renderers: SelectedRenderers) => void;
  /** UI v3: true when `Game.bootShell()` already brought the GPU scene up (so the
   *  renderer step is skipped — see the comment at its call site). */
  renderersReady?: boolean;
  /** UI v3: forwarded to `bootstrapWorld` — the explicit, URL-free route for
   *  "start a brand-new world (at this seed)", which is how a `new_game` command
   *  from the title screen or a connected agent expresses itself. */
  forceFresh?: boolean;
  genSeedOverride?: number;
  /** UI v3 P3b: which slot to resume FROM when not `forceFresh`. Default
   *  'autosave' — every pre-P3b caller keeps reading the same slot it always
   *  did. Threaded down to `bootstrapWorld`'s injectable `readSave`/
   *  `readJournal` so `load_slot { slot }` resumes the slot it was asked for
   *  instead of always taking the autosave path. */
  slot?: SaveSlot;
  /** The loaded art library + resolvers land back on the Game (renderDeps reads them). */
  setArt: (art: { assetLibrary: AssetLibrary; artResolver: ArtResolver; buildingArtResolver: ArtResolver }) => void;
  /** Game-side world-ready wiring (HUD, dev inspector, autosave) — runs inside
   *  bootstrap's onReady, before the art hold starts. */
  onWorldReady: () => void;
  /** Forwarded from `bootstrapWorld`: fired only when a save was RESUMED, so the
   *  caller can continue the event journal from that save's cursor. */
  onResumed?: (save: SaveFile) => void;
}

export async function runBootSequence(deps: BootSequenceDeps, worldSeed?: WorldSeed): Promise<GameMap> {
  const { state, loading } = deps;
  loading.show();
  bootMark('start');
  loading.setProgress(0.08, 'Summoning the engine…');
  initManifoldWasm();
  bootMark('engine');
  // UI v3: the GPU scene may ALREADY be up — `Game.bootShell()` brings the device
  // and the renderer online before any world exists, so the title screen can be
  // on screen within a second or two. Re-running `selectRenderer` would build a
  // second GpuScene (and all its pipelines) for nothing, so skip it when the
  // caller says it already has one. A cold boot (studio, embed, tests) still
  // takes this step exactly as before.
  if (!deps.renderersReady) {
    loading.setProgress(0.22, 'Preparing the canvas…');
    deps.setRenderMap(await selectRenderer(deps.canvas));
  }
  bootMark('renderer');
  loading.setProgress(0.38, 'Loading the art library…');
  const baseLibrary = await loadBaseLibrary();
  const assetLibrary = new AssetLibrary(baseLibrary);
  const artResolver = new ArtResolver(assetLibrary, 'pixel-art');
  const buildingArtResolver = new ArtResolver(assetLibrary, 'pixel-art', 'building', ART_RECIPE_VERSION);
  deps.setArt({ assetLibrary, artResolver, buildingArtResolver });
  bootMark('art-library');
  loading.setProgress(0.5, 'Growing the forest…');
  // species sprites ready before frame 1 — no placeholder flash; ticks the bar per species
  await deps.parametricPlantSource.prewarmAll((done, total) => {
    loading.setProgress(0.5 + 0.1 * (done / total), `Growing the forest… ${done}/${total}`);
  });
  bootMark('flora-prewarm');
  loading.setProgress(0.6, 'Generating the world…');
  // Worldgen phase announcements land on the bar's 0.6..0.97 band (asymptotic —
  // phase count varies per world); stat lines stay console-only.
  const worldgenProgress = createBootProgressMapper(0.6, 0.97);
  // P3b: bind the reader deps to the requested slot (default 'autosave' —
  // byte-identical to the pre-P3b behaviour when the caller doesn't ask for a
  // specific one) so `bootstrapWorld`'s resume branch reads THAT slot's blob
  // and journal instead of always the autosave's.
  const slot = deps.slot ?? 'autosave';
  return bootstrapWorld({
    state, assets: deps.assets, sheets: deps.sheets,
    decorationImages: deps.decorationImages, getViewport: deps.getViewport,
    worldSeed,
    readSave: () => readSave(slot),
    readJournal: (upTo: number) => readJournal(slot, upTo),
    ...(deps.forceFresh !== undefined ? { forceFresh: deps.forceFresh } : {}),
    ...(deps.genSeedOverride !== undefined ? { genSeedOverride: deps.genSeedOverride } : {}),
    ...(deps.onResumed ? { onResumed: deps.onResumed } : {}),
    onProgress: (msg) => {
      const update = worldgenProgress.next(msg);
      if (update) loading.setProgress(update.fraction, update.label);
    },
    onReady: () => {
      bootMark('worldgen');
      deps.onWorldReady();
      // M1: a restored world carries its chronicle (snapshot-backed ring) —
      // read the recent annals aloud while the art settles. Fresh worlds have
      // none and the block stays hidden.
      const annals = state.chronicle?.entries() ?? [];
      if (annals.length) loading.setChronicle(annals.slice(-5).map(e => e.text));
      // The fade waits for the building art to settle (composes drained + art
      // rev quiet) so the player never sees grey massing pop into textured
      // buildings — fire-and-forget: the frame loop starts beneath the overlay
      // and drives the demand-loads the gate is watching.
      void holdLoadingUntilArtSettled(deps, buildingArtResolver);
    },
  });
}

/** Hold the loading overlay past worldgen-ready until the building art has
 *  settled, so the world fades in fully textured (never grey massing). No
 *  time cap: readiness is signal-driven and the pending counts structurally
 *  drain (warm failures cache null; IDB reads are timeboxed by idb-guard). */
async function holdLoadingUntilArtSettled(deps: BootSequenceDeps, buildingArtResolver: ArtResolver): Promise<void> {
  const { loading } = deps;
  loading.setProgress(0.98, 'Raising the buildings…');
  // Prewarm EVERY building/barrier, not just the spawn viewport's: the frame
  // path only warms visible entities, so without this the gate's signals go
  // quiet while off-screen towns are still bare massing and the first pan
  // shows grey boxes. Sources dedupe by blueprint identity — this costs one
  // IDB read / library fetch per UNIQUE building, not per entity. Warming
  // here (not via the frame loop) also keeps the loads flowing in a hidden tab.
  const world = deps.state.world;
  if (world) {
    for (const e of world.query({ tag: 'building' })) {
      deps.parametricBuildingSource.warm(e);
      deps.generatedBuildingArtSource.warm(e);
      buildingArtResolver.warm(e);
    }
    for (const e of world.query({ kind: 'barrier' })) deps.parametricBarrierSource.warm(e);
  }
  await waitForArtSettled({
    // Compose-queue depth alone misses warm-cache boots (every pack is an IDB
    // read, the queue never fills) — sum the sources' in-flight warms too.
    pendingComposes: () =>
      composeQueuePending()
      + deps.parametricBuildingSource.pending()
      + deps.parametricBarrierSource.pending()
      + deps.generatedBuildingArtSource.pending()
      // NPC LPC sheets too ("all sprites ready before the fade — that goes for
      // NPCs"): kickOffSheets requested every NPC's sheet during bootstrap, so
      // holding on inflight here means nobody pops in over a live frame loop.
      + pendingSheets(),
    // Mirror the draw-cache's buildingArtRev exactly (render-context.ts) — the
    // generated (painted) source repaints buildings too.
    artRev: () =>
      deps.parametricBuildingSource.version()
      + deps.parametricBarrierSource.version()
      + deps.generatedBuildingArtSource.version(),
    onProgress: (pending) => {
      if (pending > 0) loading.setProgress(0.98, `Raising the buildings… ${pending} left`);
    },
  });
  console.info('[boot] art gate: settled');
  bootMark('art-settled');
  loading.setProgress(1, 'Entering the world…');
  loading.hide();
}
