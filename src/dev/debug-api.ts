/**
 * Debug API — a small, stable surface for driving the live game from the
 * browser console, Playwright scripts, and the Playwright MCP. Exposed as
 * `window.__debug`. Prefer these verbs over reaching into `__game`'s private
 * internals: this surface is intentional and survives refactors.
 *
 * Capture lesson (see memory feedback-playwright-in-dev-loop): use `grab()`
 * (canvas → dataURL), NOT Playwright `page.screenshot()` which stalls headed.
 */
import type { Camera, Entity } from '@/core/types';
import type { GameState } from '@/core/state';
import type { QueryOpts } from '@/world/world';
import { focusCameraOnTile } from '@/render/focus-camera';
import { fitCameraToMap } from '@/render/fit-camera';
import { readRenderMode } from '@/render/select-renderer';

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
}

export interface DebugApiDeps {
  state: GameState;
  canvas: HTMLCanvasElement;
  viewport: () => { width: number; height: number };
}

export function createDebugApi(deps: DebugApiDeps): DebugApi {
  const { state, canvas, viewport } = deps;
  const camera = (): Camera => state.camera;

  return {
    inventory(): DebugInventory {
      const w = state.world;
      const buildings = w ? w.query({ tag: 'building' }) : [];
      const byKind: Record<string, number> = {};
      for (const b of buildings) byKind[b.kind] = (byKind[b.kind] ?? 0) + 1;
      return {
        world: state.worldSeed?.name,
        map: state.map ? { w: state.map.width, h: state.map.height } : null,
        buildings: buildings.length,
        byKind,
        npcs: w ? w.query({ kind: 'npc' }).length : 0,
        vegetation: w ? w.query({ tag: 'vegetation' }).length : 0,
      };
    },

    query(opts: QueryOpts = {}): Entity[] {
      return state.world ? state.world.query(opts) : [];
    },

    focusKind(kind: string, zoom = 4): boolean {
      const hit = state.world?.query({ kind })[0];
      if (!hit) return false;
      this.focusXY(hit.x, hit.y, zoom);
      return true;
    },

    focusXY(x: number, y: number, zoom = 4): void {
      const vp = viewport();
      // Set zoom first: focusCameraOnTile centers using the current zoom.
      camera().zoom = zoom;
      focusCameraOnTile(camera(), x, y, vp.width, vp.height, readRenderMode());
    },

    fitMap(): void {
      if (!state.map) return;
      const vp = viewport();
      fitCameraToMap(camera(), state.map.width, state.map.height, vp.width, vp.height, readRenderMode());
    },

    grab(): string {
      return canvas.toDataURL('image/png');
    },
  };
}
