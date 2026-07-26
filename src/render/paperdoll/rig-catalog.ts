/**
 * Rig registry — the motion studio (`src/studio/motion-studio.ts`) picks a
 * paper-doll rig by id instead of hardcoding the LPC humanoid template. Each
 * `RigEntry` bundles everything the studio needs to bake and inspect a
 * template: the `AnimTemplate` + `Clip` set, per-chip bone-overlay colors, the
 * L/R joint-pin mirror pairing, and an async layer loader.
 *
 * Node-safe on import: this module must be importable from `npx tsx` test
 * files with no DOM. The humanoid entry's `loadLayers()` does `fetch`/PNG
 * decode work, but that only runs when the function is CALLED — merely
 * importing `RIGS`/`rigById` touches no browser API.
 *
 * A future code-drawn rig (no vendored sheets to fetch) would simply resolve
 * `loadLayers()` synchronously-fast with no network/decode step at all.
 */
import { assetUrl } from '@/core/asset-url';
import { decodePngToRaster } from '@/render/sprite-codec';
import type { Raster } from '../sprite-postprocess';
import type { AnimTemplate, Clip, PoseLayer } from './rig';
import type { DonorSheets } from './stamp';
import { stampAnims } from './stamp';
import {
  DEFAULT_HUMANOID_LAYERS,
  donorSheetCandidates,
  HUMANOID_CLIPS,
  HUMANOID_SOURCE,
  LPC_HUMANOID_SOUTH,
} from './lpc-humanoid';

export interface RigEntry {
  /** Stable id, ASCII. */
  id: string;
  /** Short ASCII label for the studio button. */
  label: string;
  template: AnimTemplate;
  clips: readonly Clip[];
  /** One '#rrggbb' per chip, template order — the bone-overlay colors. */
  chipColors: readonly string[];
  /** Joint-pin mirror pairing; null when the chip has no mirror partner. */
  mirrorName(n: string): string | null;
  /** Async because vendored rigs fetch sheets; code-drawn rigs resolve immediately. */
  loadLayers(): Promise<PoseLayer[]>;
}

// ── humanoid ─────────────────────────────────────────────────────────────────

const HUMANOID_CHIP_COLORS: readonly string[] = [
  '#787878', // trunk
  '#ffdc3c', // head
  '#50b4ff', // armL_up
  '#3c78ff', // armL_fore
  '#ff8250', // armR_up
  '#ff4628', // armR_fore
  '#50dc78', // legL_up
  '#28a050', // legL_fore
  '#c878ff', // legR_up
  '#9640dc', // legR_fore
];

// L/R chip pairs mirror about the sprite's vertical axis.
const humanoidMirrorName = (n: string): string | null =>
  n.includes('L_') ? n.replace('L_', 'R_') : n.includes('R_') ? n.replace('R_', 'L_') : null;

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

export interface HumanoidCharacterLoad {
  layers: PoseLayer[];
  /** Raw full vendored sheets, aligned with `layers` — the gait lane composites frames from these. */
  sheets: Raster[];
}

/**
 * Fetch + decode a humanoid wardrobe stack (default or role-picked), harvest
 * each layer's donor sheets for the authored clips' stamps, and slice every
 * sheet down to the authored source cell (`HUMANOID_SOURCE`). Shared by the
 * registry's default `loadLayers()` and the motion studio's "Character" panel
 * (role/seed wardrobe swap), which also wants the raw sheets for its gait lane.
 */
export async function loadHumanoidCharacter(
  specs: readonly HumanoidCharLayerSpec[],
): Promise<HumanoidCharacterLoad> {
  const anims = stampAnims(HUMANOID_CLIPS.map((c) => c.stamps));
  const loaded = await Promise.all(
    specs.map(async (spec) => {
      let path = spec.path;
      let sheet = await fetchRaster(path);
      if (!sheet && spec.fallback) {
        path = spec.fallback;
        sheet = await fetchRaster(path);
      }
      if (!sheet) throw new Error(`${spec.path}: not found`);
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
      return { sheet, donors };
    }),
  );
  const cell = LPC_HUMANOID_SOUTH.cell;
  const sx = HUMANOID_SOURCE.col * cell;
  const sy = HUMANOID_SOURCE.row * cell;
  const layers: PoseLayer[] = loaded.map(({ sheet, donors }, li) => {
    const data = new Uint8ClampedArray(cell * cell * 4);
    for (let y = 0; y < cell; y++) {
      const src = (sy + y) * sheet.w + sx;
      data.set(sheet.data.subarray(src * 4, (src + cell) * 4), y * cell * 4);
    }
    return { raster: { data, w: cell, h: cell }, assign: specs[li].assign, donors: donors as DonorSheets };
  });
  return { layers, sheets: loaded.map((l) => l.sheet) };
}

const humanoidRig: RigEntry = {
  id: 'humanoid',
  label: 'Human',
  template: LPC_HUMANOID_SOUTH,
  clips: HUMANOID_CLIPS,
  chipColors: HUMANOID_CHIP_COLORS,
  mirrorName: humanoidMirrorName,
  loadLayers: async () => (await loadHumanoidCharacter(DEFAULT_HUMANOID_LAYERS)).layers,
};

// ── registry ─────────────────────────────────────────────────────────────────

/** Every registered rig, humanoid first. A sheep/quadruped entry lands here later. */
export const RIGS: readonly RigEntry[] = [humanoidRig];

export function rigById(id: string): RigEntry | undefined {
  return RIGS.find((r) => r.id === id);
}
