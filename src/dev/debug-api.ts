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
import type { Camera, Entity } from '@/core/types';
import type { GameState } from '@/core/state';
import type { QueryOpts } from '@/world/world';
import { focusCameraOnTile } from '@/render/focus-camera';
import { fitCameraToMap } from '@/render/fit-camera';
import type { GameQuery } from '@/game/game-query';

export interface DebugInventory {
  world: string | undefined;
  map: { w: number; h: number } | null;
  buildings: number;
  byKind: Record<string, number>;
  npcs: number;
  vegetation: number;
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
}

export interface DebugApiDeps {
  /** The canonical read facade — all read verbs delegate here (S0). */
  query: GameQuery;
  /** For the camera-mutating verbs (focus/fit), which GameQuery deliberately omits. */
  state: GameState;
  viewport: () => { width: number; height: number };
  /** Open a storylet card by id (Game.playStorylet). */
  playStory: (storyletId: string) => boolean;
}

export function createDebugApi(deps: DebugApiDeps): DebugApi {
  const { query, state, viewport, playStory } = deps;
  const camera = (): Camera => state.camera;

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
      focusCameraOnTile(camera(), x, y, vp.width, vp.height);
    },

    fitMap(): void {
      if (!state.map) return;
      const vp = viewport();
      fitCameraToMap(camera(), state.map.width, state.map.height, vp.width, vp.height);
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
  };
}
