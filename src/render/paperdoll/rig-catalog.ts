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
import type { AnimTemplate, Clip, PoseLayer } from './rig';
import { loadHumanoidCharacter } from './humanoid-loader';
import {
  DEFAULT_HUMANOID_LAYERS,
  HUMANOID_CLIPS,
  LPC_HUMANOID_SOUTH,
} from './lpc-humanoid';
import {
  drawQuadrupedCell,
  GOAT_PARAMS,
  GOAT_WEST,
  QUADRUPED_CHIP_COLORS,
  quadrupedMirrorName,
  SHEEP_CLIPS,
  SHEEP_PARAMS,
  SHEEP_WEST,
  type QuadrupedParams,
} from './quadruped';

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

const humanoidRig: RigEntry = {
  id: 'humanoid',
  label: 'Human',
  template: LPC_HUMANOID_SOUTH,
  clips: HUMANOID_CLIPS,
  chipColors: HUMANOID_CHIP_COLORS,
  mirrorName: humanoidMirrorName,
  loadLayers: async () => (await loadHumanoidCharacter(DEFAULT_HUMANOID_LAYERS)).layers,
};

// ── quadrupeds ───────────────────────────────────────────────────────────────

/**
 * A code-drawn species needs no fetch at all: `drawQuadrupedCell` is pure
 * raster math, and one cell is the whole wardrobe (there are no LPC-style
 * layers to stack). It runs INSIDE `loadLayers` rather than at module scope so
 * importing this registry stays free — the studio pays for the pixels only
 * when the rig is actually picked.
 */
const quadrupedRig = (
  id: string,
  label: string,
  template: AnimTemplate,
  params: QuadrupedParams,
): RigEntry => ({
  id,
  label,
  template,
  clips: SHEEP_CLIPS,
  chipColors: QUADRUPED_CHIP_COLORS,
  mirrorName: quadrupedMirrorName,
  loadLayers: () => Promise.resolve([{ raster: drawQuadrupedCell(params) }]),
});

// ── registry ─────────────────────────────────────────────────────────────────

/**
 * Every registered rig, humanoid first. Sheep and goat share ONE clip set —
 * clips key on the chip vocabulary rather than on a species, which is the
 * whole point of the quadruped template being parametric.
 */
export const RIGS: readonly RigEntry[] = [
  humanoidRig,
  quadrupedRig('sheep', 'Sheep', SHEEP_WEST, SHEEP_PARAMS),
  quadrupedRig('goat', 'Goat', GOAT_WEST, GOAT_PARAMS),
];

export function rigById(id: string): RigEntry | undefined {
  return RIGS.find((r) => r.id === id);
}
