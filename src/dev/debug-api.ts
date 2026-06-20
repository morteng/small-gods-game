/**
 * Debug API — a small, stable surface for driving the live game from the
 * browser console, Playwright scripts, and the Playwright MCP. Exposed as
 * `window.__debug`. Prefer these verbs over reaching into `__game`'s private
 * internals: this surface is intentional and survives refactors.
 *
 * Post-S0 it is a THIN SHIM over `GameQuery` (the canonical read facade) for its
 * read verbs (inventory/query/grab) plus the camera-mutating convenience verbs
 * (focusKind/focusXY/fitMap) that don't belong on a read-only facade. The public
 * shape is unchanged — existing console/Playwright callers keep working.
 *
 * Capture lesson (see memory feedback-playwright-in-dev-loop): use `grab()`
 * (canvas → dataURL), NOT Playwright `page.screenshot()` which stalls headed.
 */
import type { Camera, Entity, DevModeState, NpcProperties } from '@/core/types';
import type { NpcAnimation } from '@/core/npc-animation';
import type { GameState } from '@/core/state';
import type { QueryOpts } from '@/world/world';
import { focusCameraOnTile } from '@/render/focus-camera';
import { frameTargets, applyFrame } from '@/render/camera-framing';
import { fitCameraToMap } from '@/render/fit-camera';
import { RENDER_LAYERS, layerFlag, type RenderLayer } from '@/render/layer-visibility';
import type { GameQuery } from '@/game/game-query';

export interface DebugInventory {
  world: string | undefined;
  map: { w: number; h: number } | null;
  buildings: number;
  byKind: Record<string, number>;
  npcs: number;
  vegetation: number;
}

/** Selector for {@link DebugApi.frameEntities} — any combination narrows the set. */
export interface FrameEntitiesOpts {
  kind?: string;
  tag?: string;
  /** Match entities whose `properties.poiId` starts with this (e.g. 'crossing@'). */
  poiPrefix?: string;
  ids?: string[];
  /** Context padding in tiles + viewport fill fraction (see camera-framing). */
  padTiles?: number;
  margin?: number;
}

export interface FrameReport {
  total: number;
  onScreen: number;
  coverage: number;
  zoom: number;
}

export interface DebugApi {
  /** Summary of what worldgen produced: building counts by kind, npc/veg totals. */
  inventory(): DebugInventory;
  /** Raw entity query passthrough (see World.query). */
  query(opts?: QueryOpts): Entity[];
  /** Center + zoom the camera on the first entity of `kind`. False if none exist. */
  focusKind(kind: string, zoom?: number): boolean;
  /** Center + zoom the camera on a tile. */
  focusXY(x: number, y: number, zoom?: number): void;
  /** Fit the whole map in the viewport. */
  fitMap(): void;
  /** Frame a SET of entities in the viewport (cameraman primitive) and report how many
   *  actually land on screen — so a capture of named connectome nodes is reliable, not a
   *  guessed focus point. Select by `kind`, `tag`, `poiPrefix` (e.g. 'crossing@'), or
   *  explicit `ids`. Returns `{total, onScreen, coverage, zoom}`. */
  frameEntities(opts: FrameEntitiesOpts): FrameReport;
  /** The rendered frame as a PNG data URL (robust capture; survives headed). */
  grab(): string;
  /** Open a registered storylet as an interactive card. False if the id is unknown. */
  playStory(storyletId: string): boolean;
  /** Belief-granted powers (skill-panel payload) for the player. */
  powers(): ReturnType<GameQuery['beliefPowers']>;
  /** The divine inbox (salience-ranked) for the player. */
  inbox(): ReturnType<GameQuery['divineInbox']>;
  /** Fate-surfacing stub (B-E): promote an inbox item id (boosts salience + flags
   *  it). Pass nothing to clear all surfacing. Returns the surfaced-id count. */
  surfaceInbox(id?: string): number;
  /** Adaptive-score control (P-A). `music()` → state; `music(true|false)` toggles;
   *  `music(0.5)` sets master volume. Returns the director's debug snapshot. */
  music(arg?: boolean | number | 'voice' | 'camera' | 'cinematic'): object;
  /** Show/hide a render layer (dev). `layer()` → all visibilities; `layer('vegetation')`
   *  toggles trees; `layer('roads', false)` hides. Layers: terrain, roads, rivers,
   *  npcs, buildings, vegetation, props, terrainFeatures, decorations, remains. */
  layer(name?: RenderLayer, visible?: boolean): boolean | Record<string, boolean>;
  /** Convenience: show/hide vegetation (trees). No arg toggles. Returns visible. */
  trees(visible?: boolean): boolean;
  /** Dev: pin the first `count` NPCs to an LPC animation to eyeball poses
   *  (e.g. `playAnim('slash')`, `playAnim('hurt')`, `playAnim('spellcast')`).
   *  Call with no args (or null) to release the override. Returns # pinned.
   *  Animations: walk, spellcast, thrust, slash, shoot, hurt. */
  playAnim(anim?: NpcAnimation | null, count?: number): number;
  /** Regenerate a fresh world: clears the autosave slot and reloads (boot then seeds
   *  anew). The ONLY way to see new worldgen — a stale autosave masks it. */
  newWorld(): void;
}

export interface DebugApiDeps {
  /** The canonical read facade — all read verbs delegate here (S0). */
  query: GameQuery;
  /** For the camera-mutating verbs (focus/fit), which GameQuery deliberately omits. */
  state: GameState;
  viewport: () => { width: number; height: number };
  /** Open a storylet card by id (Game.playStorylet). */
  playStory: (storyletId: string) => boolean;
  /** Adaptive-score control (Game.presentation): toggle / set volume / inspect. */
  music: (arg?: boolean | number | 'voice' | 'camera' | 'cinematic') => object;
  /** Live dev-mode state (render-layer flags live here). */
  devMode: () => DevModeState;
  /** Mark the next frame dirty after a dev mutation. */
  requestRender: () => void;
  /** Clear the autosave + reload for a fresh world (Game.newWorld). */
  newWorld: () => void;
}

export function createDebugApi(deps: DebugApiDeps): DebugApi {
  const { query, state, viewport, playStory, music } = deps;
  const camera = (): Camera => state.camera;
  const setLayer = (name: RenderLayer, visible?: boolean): boolean => {
    const dm = deps.devMode();
    const flag = layerFlag(name);
    const next = visible === undefined ? dm[flag] === false : visible;
    dm[flag] = next;
    deps.requestRender();
    return next;
  };

  return {
    inventory(): DebugInventory {
      // Building-only byKind, matching the historical shape (worldSummary.byKind
      // counts ALL kinds — kept distinct for back-compat).
      const buildings = query.entities({ tag: 'building' });
      const byKind: Record<string, number> = {};
      for (const b of buildings) byKind[b.kind] = (byKind[b.kind] ?? 0) + 1;
      const summary = query.worldSummary();
      return {
        world: summary.name,
        map: summary.map,
        buildings: buildings.length,
        byKind,
        npcs: summary.npcs,
        vegetation: summary.vegetation,
      };
    },

    query(opts: QueryOpts = {}): Entity[] {
      return query.entities(opts);
    },

    focusKind(kind: string, zoom = 4): boolean {
      const hit = query.entities({ kind })[0];
      if (!hit) return false;
      this.focusXY(hit.x, hit.y, zoom);
      return true;
    },

    focusXY(x: number, y: number, zoom = 4): void {
      const vp = viewport();
      // Set zoom first: focusCameraOnTile centers using the current zoom.
      camera().zoom = zoom;
      focusCameraOnTile(camera(), x, y, vp.width, vp.height, state.map);
    },

    fitMap(): void {
      if (!state.map) return;
      const vp = viewport();
      fitCameraToMap(camera(), state.map.width, state.map.height, vp.width, vp.height);
    },

    frameEntities(opts: FrameEntitiesOpts): FrameReport {
      let ents = query.entities(opts.kind ? { kind: opts.kind } : opts.tag ? { tag: opts.tag } : {});
      if (opts.poiPrefix) ents = ents.filter((e) => String((e.properties as { poiId?: string })?.poiId ?? '').startsWith(opts.poiPrefix!));
      if (opts.ids) { const set = new Set(opts.ids); ents = ents.filter((e) => set.has(e.id)); }
      const vp = viewport();
      const r = frameTargets(ents.map((e) => ({ x: e.x, y: e.y })), vp.width, vp.height, {
        map: state.map, padTiles: opts.padTiles, margin: opts.margin,
      });
      if (!r) return { total: 0, onScreen: 0, coverage: 0, zoom: camera().zoom };
      applyFrame(camera(), r);
      deps.requestRender();
      return { total: r.total, onScreen: r.onScreen, coverage: r.coverage, zoom: r.zoom };
    },

    grab(): string {
      return query.screenshot();
    },

    playStory(storyletId: string): boolean {
      return playStory(storyletId);
    },

    powers() {
      return query.beliefPowers();
    },

    inbox() {
      return query.divineInbox();
    },

    surfaceInbox(id?: string): number {
      if (!state.surfacedInbox) state.surfacedInbox = new Set<string>();
      if (id === undefined) state.surfacedInbox.clear();
      else state.surfacedInbox.add(id);
      return state.surfacedInbox.size;
    },

    music(arg?: boolean | number | 'voice' | 'camera' | 'cinematic'): object {
      return music(arg);
    },

    layer(name?: RenderLayer, visible?: boolean): boolean | Record<string, boolean> {
      if (!name) {
        const dm = deps.devMode();
        const out: Record<string, boolean> = {};
        for (const l of RENDER_LAYERS) out[l] = dm[layerFlag(l)] !== false;
        return out;
      }
      return setLayer(name, visible);
    },

    trees(visible?: boolean): boolean {
      return setLayer('vegetation', visible);
    },

    playAnim(anim?: NpcAnimation | null, count = 24): number {
      const npcs = query.entities({ kind: 'npc' });
      if (!anim) {
        for (const e of npcs) (e.properties as unknown as NpcProperties).animForce = undefined;
        deps.requestRender();
        return 0;
      }
      const n = Math.min(count, npcs.length);
      for (let i = 0; i < n; i++) {
        (npcs[i].properties as unknown as NpcProperties).animForce = anim;
      }
      deps.requestRender();
      return n;
    },

    newWorld(): void {
      deps.newWorld();
    },
  };
}
