/**
 * Rig registry — the motion studio (`src/studio/motion-studio.ts`) picks a
 * paper-doll rig by id instead of hardcoding the LPC humanoid template. Each
 * `RigEntry` bundles everything the studio needs to bake and inspect a rig:
 * per-chip bone-overlay colors, the L/R joint-pin mirror pairing, an async
 * layer loader, and one `RigFacingEntry` per authored viewing angle.
 *
 * FACINGS ARE A LIST, NOT A SPECIAL CASE. The humanoid has three authored
 * views (south/north/west; east is west mirrored at bake time — `facing.ts`)
 * and the code-drawn quadrupeds have one. A one-entry list says that plainly,
 * where a `facings?:` bolted onto a `template` would have left every consumer
 * asking "and if it's absent?".
 *
 * Node-safe on import: this module must be importable from `npx tsx` test
 * files with no DOM. The humanoid entry's `loadLayers()` does `fetch`/PNG
 * decode work, but that only runs when the function is CALLED — merely
 * importing `RIGS`/`rigById` touches no browser API.
 *
 * A future code-drawn rig (no vendored sheets to fetch) would simply resolve
 * `loadLayers()` synchronously-fast with no network/decode step at all.
 */
import type { Direction } from '../../core/types';
import { LPC_DIR_OFFSET } from '../../core/npc-animation';
import type { AnimTemplate, Clip, PoseLayer } from './rig';
import { HUMANOID_FACINGS } from './facing';
import { loadHumanoidCharacter } from './humanoid-loader';
import type { ImportedClipMeta } from './clip-meta';
import { IMPORTED_CLIPS, IMPORTED_CLIP_META } from './clips';
import { DEFAULT_HUMANOID_LAYERS, HUMANOID_CLIPS } from './lpc-humanoid';
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

/** Authored viewing angles. East is never authored — bake west and mirror. */
export type RigFacingId = Extract<Direction, 'down' | 'up' | 'left'>;

export interface RigFacingEntry {
  id: RigFacingId;
  /** Short ASCII label for the studio button. */
  label: string;
  template: AnimTemplate;
  /** Clips this facing's template can actually play — see `clipsFor`. */
  clips: readonly Clip[];
  /**
   * Row of the vendored LPC sheet whose cells belong to this facing. Anything
   * compositing vendored pixels (the gait lane, the reference lane) must slice
   * THIS row — the templates describe a cell, not a sheet. Absent for rigs with
   * no vendored sheet at all (the code-drawn quadrupeds draw one cell).
   */
  sheetRow?: number;
  /**
   * Whether the authored clips' pixel stamps survive on this facing. South's
   * stamps are face pixel-clones (there is no face on a back view) and palms
   * harvested from the spellcast sheet's SOUTH row, so they are wrong donors
   * anywhere else. The shipped runtime bake makes the same call for the same
   * reason — `src/render/lpc/rig-rows.ts`'s `FACINGS`.
   */
  stamps: boolean;
}

export interface RigEntry {
  /** Stable id, ASCII. */
  id: string;
  /** Short ASCII label for the studio button. */
  label: string;
  /** One '#rrggbb' per chip, template order — the bone-overlay colors. */
  chipColors: readonly string[];
  /** Joint-pin mirror pairing; null when the chip has no mirror partner. */
  mirrorName(n: string): string | null;
  /** Async because vendored rigs fetch sheets; code-drawn rigs resolve immediately. */
  loadLayers(): Promise<PoseLayer[]>;
  /** Authored viewing angles, at least one. */
  facings: readonly RigFacingEntry[];
}

/** Every chip name a clip addresses — tracks, couplings, plants and stamp anchors. */
export function clipChipNames(clip: Clip): Set<string> {
  const names = new Set<string>(Object.keys(clip.tracks));
  for (const c of clip.couple ?? []) {
    names.add(c.from);
    names.add(c.to);
  }
  for (const p of clip.plant ?? []) names.add(p.chip);
  for (const key of clip.stamps ?? []) {
    for (const ref of key.refs) if (ref.anchor !== undefined) names.add(ref.anchor);
  }
  return names;
}

/**
 * The clips a template can actually play — those naming ONLY chips it owns.
 *
 * Filtered, never assumed: `sampleClip` looks tracks up by chip name and simply
 * skips what it cannot find, so offering a clip to a template missing half its
 * vocabulary produces a rig standing perfectly still with no error anywhere.
 *
 * The north template deliberately shares SOUTH's chip names (`armL_up`,
 * `legR_fore`, …), so every south-authored clip passes this filter and will
 * PLAY on north. Whether it READS right from behind is a different question,
 * and answering it is exactly what the bench exists for. The west template is a
 * different vocabulary entirely (`armNear_up`, `legFar_fore`, …), which is why
 * nothing hand-authored survives the filter there and its list is imported
 * clips alone.
 */
export function clipsFor(template: AnimTemplate, clips: readonly Clip[]): Clip[] {
  const owned = new Set(template.chips.map((c) => c.name));
  return clips.filter((clip) => [...clipChipNames(clip)].every((n) => owned.has(n)));
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

// L/R chip pairs mirror about the sprite's vertical axis. The profile
// vocabulary has no such pairing (near/far are depth, not sides), so west
// chips fall through to null — which is the honest answer, not a gap.
const humanoidMirrorName = (n: string): string | null =>
  n.includes('L_') ? n.replace('L_', 'R_') : n.includes('R_') ? n.replace('R_', 'L_') : null;

/**
 * One humanoid facing: the shared facing registry's template, the LPC sheet row
 * straight out of `LPC_DIR_OFFSET` (never a second copy of the row order — a
 * duplicated convention drifts, and a reference lane reading the wrong row
 * would look like a bad bake), and the union of the hand-authored clips this
 * template can play with the imported clips captured for it.
 */
const humanoidFacing = (id: RigFacingId, label: string, stamps: boolean): RigFacingEntry => {
  const template = HUMANOID_FACINGS[id].template;
  const imported = Object.values(IMPORTED_CLIPS).map((set) => set[id]);
  return {
    id,
    label,
    template,
    clips: [...clipsFor(template, HUMANOID_CLIPS), ...clipsFor(template, imported)],
    sheetRow: LPC_DIR_OFFSET[id],
    stamps,
  };
};

const humanoidRig: RigEntry = {
  id: 'humanoid',
  label: 'Human',
  chipColors: HUMANOID_CHIP_COLORS,
  mirrorName: humanoidMirrorName,
  loadLayers: async () => (await loadHumanoidCharacter(DEFAULT_HUMANOID_LAYERS)).layers,
  facings: [
    humanoidFacing('down', 'South', true),
    humanoidFacing('up', 'North', false),
    humanoidFacing('left', 'West', false),
  ],
};

// ── quadrupeds ───────────────────────────────────────────────────────────────

/**
 * A code-drawn species needs no fetch at all: `drawQuadrupedCell` is pure
 * raster math, and one cell is the whole wardrobe (there are no LPC-style
 * layers to stack). It runs INSIDE `loadLayers` rather than at module scope so
 * importing this registry stays free — the studio pays for the pixels only
 * when the rig is actually picked.
 *
 * One facing, and that is the whole truth about these rigs: the quadruped
 * template is a profile, drawn rather than sliced, with no sheet row to name
 * and no donor pixels for a stamp to harvest.
 */
const quadrupedRig = (
  id: string,
  label: string,
  template: AnimTemplate,
  params: QuadrupedParams,
): RigEntry => ({
  id,
  label,
  chipColors: QUADRUPED_CHIP_COLORS,
  mirrorName: quadrupedMirrorName,
  loadLayers: () => Promise.resolve([{ raster: drawQuadrupedCell(params) }]),
  facings: [{ id: 'left', label: 'West', template, clips: clipsFor(template, SHEEP_CLIPS), stamps: false }],
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

/**
 * Capture metadata for a clip — but only when the clip really IS that import.
 *
 * Clip NAMES collide across rigs on purpose: the sheep authors its own `walk`
 * by hand, and so would any future species. Keying `IMPORTED_CLIP_META` by name
 * alone reports a hand-drawn sheep as a 1.225-second CMU capture of a neutral
 * male, complete with a stride and a ground-speed mismatch it does not have.
 * Identity against the facing's own entry is the only lookup that cannot lie.
 */
export function importedMetaFor(facing: RigFacingEntry, clip: Clip): ImportedClipMeta | undefined {
  const set = IMPORTED_CLIPS[clip.name];
  return set !== undefined && set[facing.id] === clip ? IMPORTED_CLIP_META[clip.name] : undefined;
}
