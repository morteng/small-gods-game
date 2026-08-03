/**
 * Fetch + slice a humanoid wardrobe stack into paper-doll pose layers.
 *
 * A LEAF on purpose: this used to live in `rig-catalog.ts`, which also pulls in
 * the code-drawn quadruped (`quadruped.ts` + `quadruped-art.ts`, ~1.1k lines of
 * sheep pixels). The live game bakes rig rows onto NPC sheets and needs the
 * loader but not a sheep, so the loader moved out and its importers were
 * REPOINTED (a re-export from `rig-catalog` would not have cut the edge — the
 * `src/sim/divine-costs.ts` pattern).
 *
 * Node-safe on IMPORT (no DOM at module scope); `loadHumanoidCharacter` itself
 * does `fetch` + PNG decode, so only callers pay for a browser.
 */
import { assetUrl } from '@/core/asset-url';
import { decodePngToRaster } from '@/render/sprite-codec';
import type { Raster } from '../sprite-postprocess';
import type { PoseLayer } from './rig';
import type { DonorSheets } from './stamp';
import { stampAnims } from './stamp';
import {
  donorSheetCandidates,
  HUMANOID_CLIPS,
  HUMANOID_SOURCE,
  LPC_HUMANOID_SOUTH,
} from './lpc-humanoid';

// NOTE: the dev server's SPA fallback answers missing files with 200 +
// index.html, so "does this variant exist" must survive decode, not just
// resp.ok — hence fallback on any failure, not only HTTP errors.
async function fetchRaster(path: string): Promise<Raster | null> {
  const resp = await fetch(assetUrl(path));
  if (!resp.ok) return null;
  const type = resp.headers.get('content-type') ?? '';
  if (!type.includes('image/png')) return null;
  return decodePngToRaster(await resp.blob());
}

/** One layer to resolve + fetch for a humanoid bake — path plus optional fallback/chip assignment. */
export interface HumanoidCharLayerSpec {
  path: string;
  fallback?: string;
  assign?: string;
}

export interface HumanoidCharacterLoad<T extends HumanoidCharLayerSpec = HumanoidCharLayerSpec> {
  layers: PoseLayer[];
  /** Raw full vendored sheets, aligned with `layers` — the gait lane composites frames from these. */
  sheets: Raster[];
  /** The requested specs that actually RESOLVED, aligned with the two above.
   *  Shorter than the input when a layer isn't vendored — see the loader's doc. */
  resolved: T[];
}

/**
 * Copy one `cell`-sized cell out of a full LPC sheet (row/col in cells). The
 * templates describe a CELL, not a sheet, so every facing slices its own row
 * (south = row 2, north = row 0 — see `facing.ts`'s donor caveat).
 */
export function sliceSourceCell(sheet: Raster, row: number, col: number, cell: number): Raster {
  const data = new Uint8ClampedArray(cell * cell * 4);
  for (let y = 0; y < cell; y++) {
    const src = (row * cell + y) * sheet.w + col * cell;
    data.set(sheet.data.subarray(src * 4, (src + cell) * 4), y * cell * 4);
  }
  return { data, w: cell, h: cell };
}

/**
 * Fetch + decode a humanoid wardrobe stack (default or role-picked), harvest
 * each layer's donor sheets for the authored clips' stamps, and slice every
 * sheet down to the authored source cell (`HUMANOID_SOURCE`). Shared by the
 * rig registry's default `loadLayers()`, the motion studio's "Character" panel
 * (role/seed wardrobe swap) and the runtime rig-row bake — all of which also
 * want the raw sheets (the gait lane composites frames from them; the rig bake
 * slices the north cell out of them).
 *
 * A layer that resolves to nothing is DROPPED, not fatal — the LPC compositor
 * already skips selections a body type doesn't support (`meta.required`), which
 * is exactly why the child's `face_neutral` is not vendored. Throwing there
 * would cost a whole role its rig rows over a soft overlay the composed sheet
 * never had either. `resolved` reports what survived; an empty stack still
 * throws, because that is a broken wardrobe rather than a missing garment.
 */
export async function loadHumanoidCharacter<T extends HumanoidCharLayerSpec>(
  specs: readonly T[],
): Promise<HumanoidCharacterLoad<T>> {
  const anims = stampAnims(HUMANOID_CLIPS.map((c) => c.stamps));
  const loaded = await Promise.all(
    specs.map(async (spec) => {
      let path = spec.path;
      let sheet = await fetchRaster(path);
      if (!sheet && spec.fallback) {
        path = spec.fallback;
        sheet = await fetchRaster(path);
      }
      if (!sheet) return null;
      // Donor anim sheets for clip stamps (open palms…), derived from the
      // path that actually loaded. A layer without the donor anim simply
      // keeps its rest pixels (e.g. the child wardrobe has no spellcast).
      const donors: Record<string, Raster> = {};
      for (const anim of anims) {
        for (const cand of donorSheetCandidates(path, anim)) {
          const d = await fetchRaster(cand);
          if (d) {
            donors[anim] = d;
            break;
          }
        }
      }
      return { spec, sheet, donors };
    }),
  );
  const kept = loaded.filter((l) => l !== null);
  if (kept.length === 0) throw new Error(`${specs.map((s) => s.path).join(', ')}: nothing vendored`);
  const cell = LPC_HUMANOID_SOUTH.cell;
  return {
    layers: kept.map(({ spec, sheet, donors }) => ({
      raster: sliceSourceCell(sheet, HUMANOID_SOURCE.row, HUMANOID_SOURCE.col, cell),
      assign: spec.assign,
      donors: donors as DonorSheets,
    })),
    sheets: kept.map((l) => l.sheet),
    resolved: kept.map((l) => l.spec),
  };
}
