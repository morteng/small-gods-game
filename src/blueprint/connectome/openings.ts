/**
 * Resolve a building connectome DOWN into door + window features — the generative
 * counterpart to the smoke-vent bridge in to-blueprint.ts. The room graph already
 * encodes the openings:
 *
 *   • exterior portals (`from === 'OUTSIDE'`) ARE the doors — each carries a face
 *     and a `main` flag, and a through-passage shows up as two opposed portals;
 *   • zones tagged `needs-light` ARE the rooms that want windows.
 *
 * So instead of hand-listing `t`/face/sill for every pane, a preset opts in with a
 * part tag (`gen-openings`) and drops its feature list; this derives the openings
 * from the graph + the part's own geometry (wall length, storey height) + the era.
 *
 * Content-free in the catalogue sense: it reads the blueprint feature vocabulary
 * ('door'/'window', glazing styles) and generic graph properties (portal.face,
 * zone.tags/fn, source.topology) — never a catalogue room/material/building id.
 */
import type { Blueprint, BlueprintPatch, Era, Feature, WallFace } from '../types';
import { STOREY } from '@/assetgen/geometry/building';
import { mToTiles, METRES_PER_TILE } from '@/render/scale-contract';
import { eraWindowStyle } from '../eras';
import type { Connectome } from './types';

/** The part tag a preset sets to opt a body into graph-derived openings. */
export const GEN_OPENINGS_TAG = 'gen-openings';

const OPP: Record<WallFace, WallFace> = { north: 'south', south: 'north', east: 'west', west: 'east' };

/**
 * The fenestration policy — every tunable that shapes derived openings, in ONE place.
 * This is the extension point: add a building family or a new rule by editing this
 * object, not by sprinkling magic numbers through the derivation. Window STYLE/GLAZING
 * is deliberately NOT here — that lives in ERA_PROFILES (eras.ts), the single source of
 * truth shared with the era-restyle patch; this object only governs placement + sizing.
 */
const FENESTRATION = {
  spacing: 1.6,            // ~one window per N tiles of wall run
  maxPerFace: 3,
  winHeightFrac: 0.42,     // window height as a fraction of storey height …
  winHeightMin: 0.45,
  winHeightMax: 1.4,       // … clamped to this metric band (tiles)
  sillFrac: 0.32,          // sill height as a fraction of storey height …
  sillMin: 0.3,
  sillMax: 1.0,            // … clamped to this band (tiles)
  crossPassageDoorT: 0.33, // a through-passage door sits ⅓ along its run
  singleDoorT: 0.5,
  /** Window-slot preference order along a run; with a door present the windows flank it. */
  slotsWithDoor: [0.2, 0.8, 0.33, 0.67, 0.12, 0.88],
  slotsNoDoor: [0.5, 0.25, 0.75, 0.12, 0.88],
  slotDoorClearance: 0.16, // keep a window at least this far (in t) from any door
} as const;

/** Faces perpendicular to the entrance axis — the building's flanks. */
function perpFaces(front: WallFace): [WallFace, WallFace] {
  return front === 'south' || front === 'north' ? ['east', 'west'] : ['south', 'north'];
}

/** Even window slots along a wall run, ordered by placement preference. With a door on
 *  the face the windows flank it; without one a lone window centres. Used when no frame is
 *  annotated (no bay rhythm to follow) — see {@link bayWindowSlots} for the structural path. */
function windowSlots(count: number, hasDoor: boolean, doorTs: number[]): number[] {
  const order = hasDoor ? FENESTRATION.slotsWithDoor : FENESTRATION.slotsNoDoor;
  const out: number[] = [];
  for (const t of order) {
    if (out.length >= count) break;
    if (doorTs.some((dt) => Math.abs(dt - t) < FENESTRATION.slotDoorClearance)) continue;
    out.push(t);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Window slots SNAPPED to the structural bay rhythm (Layer 3b): a real timber-frame or
 * masonry wall is divided into bays by its posts/piers, and windows sit CENTRED in the
 * panels between them — not at arbitrary fractions of the run. The frame's `bayModule`
 * (metres per bay) divides the wall run into `bays` panels; we light one panel each,
 * skipping any bay the door occupies, and pick `count` of them by the same preference the
 * fixed slots used — a lone light centres, lights flanking a door push to the outer bays.
 * So a wide box-frame range reads as evenly-rhythmed framed lights, a stout mass wall as a
 * couple of deep-set openings, each aligned to where the wall can actually carry one.
 */
function bayWindowSlots(
  count: number, runTiles: number, bayModuleM: number, hasDoor: boolean, doorTs: number[],
): number[] {
  const runM = runTiles * METRES_PER_TILE;
  const bays = Math.max(1, Math.round(runM / bayModuleM));
  const centres = Array.from({ length: bays }, (_, k) => (k + 0.5) / bays);
  const free = centres.filter(
    (c) => !doorTs.some((dt) => Math.abs(dt - c) < FENESTRATION.slotDoorClearance),
  );
  const pool = free.length ? free : centres;
  // Door present ⇒ prefer the OUTER bays (flank the entrance); else prefer the CENTRE bay.
  const ordered = [...pool].sort((a, b) =>
    hasDoor ? Math.abs(b - 0.5) - Math.abs(a - 0.5) : Math.abs(a - 0.5) - Math.abs(b - 0.5),
  );
  return ordered.slice(0, count).sort((a, b) => a - b);
}

const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Build the door + window patch the connectome implies for the body part tagged
 * `gen-openings`. `era` is the EFFECTIVE era (the requested variant era, not the
 * preset's authored one) — it selects window style/glazing via ERA_PROFILES so a
 * `resolveAsset({era})` variant gets period-correct generated windows. Returns `{}`
 * for any blueprint that hasn't opted in.
 */
export function connectomeOpenings(con: Connectome, base: Blueprint, era: Era | undefined): BlueprintPatch {
  const entry = Object.entries(base.parts).find(
    ([, p]) => p.type === 'body' && p.tags?.includes(GEN_OPENINGS_TAG),
  );
  if (!entry) return {};
  const [pid, part] = entry;
  const size = part.size ?? base.footprint;
  const storeyM = (part.params?.storeyM as number) ?? -1;
  const storeyTiles = storeyM > 0 ? mToTiles(storeyM) : STOREY;

  const features: Record<string, Feature> = {};

  // ── Doors: one per exterior portal, on its declared face ──────────────────
  const ext = con.portals.filter((p) => p.from === 'OUTSIDE');
  const crossPassage = ext.length >= 2;
  const doorTsByFace: Partial<Record<WallFace, number[]>> = {};
  const addDoorT = (f: WallFace, t: number) => (doorTsByFace[f] = [...(doorTsByFace[f] ?? []), t]);

  if (ext.length === 0) {
    features.door = { type: 'door', face: 'south', params: { main: true, t: 0.5 } };
    addDoorT('south', 0.5);
  } else {
    ext.forEach((p, i) => {
      const face = p.face ?? 'south';
      const t = crossPassage ? FENESTRATION.crossPassageDoorT : FENESTRATION.singleDoorT;
      features[i === 0 ? 'door' : `door_${i}`] = { type: 'door', face, params: { main: !!p.main, t } };
      addDoorT(face, t);
    });
  }

  // ── Windows: rooms that want light, distributed along the lit faces ───────
  const litZones = con.zones.filter((z) => z.tags?.includes('needs-light'));
  if (litZones.length > 0 && era !== 'primordial') {
    // Window style + glazing come from the era profile (eras.ts) — the SAME source the
    // era-restyle patch uses, so authored and generated windows agree period-for-period.
    const { style, glazed } = eraWindowStyle(era);
    const winH = clampN(FENESTRATION.winHeightFrac * storeyTiles, FENESTRATION.winHeightMin, FENESTRATION.winHeightMax);
    const sill = clampN(FENESTRATION.sillFrac * storeyTiles, FENESTRATION.sillMin, FENESTRATION.sillMax);

    // STRUCTURE gates fabric (Layer 3): the frame's walls set the opening rhythm. A mass
    // wall takes few, widely-spaced lights; a box frame's panels glaze generously. The
    // structure subsystem already resolved this into `con.structure.fenestration`; fall
    // back to the neutral default when no frame is annotated.
    const spacing = con.structure?.fenestration?.spacing ?? FENESTRATION.spacing;
    const maxPerFace = con.structure?.fenestration?.maxPerFace ?? FENESTRATION.maxPerFace;

    const mainPortal = ext.find((p) => p.main) ?? ext[0];
    const front: WallFace = mainPortal?.face ?? 'south';
    const sacred =
      con.source?.topology === 'church-axial' || con.zones.some((z) => z.fn === 'worship');
    // Sacred masonry gets tall, narrow, POINTED lancet lights whatever the era — the
    // ecclesiastical window, not the modest domestic box (K2 + church expression).
    const winStyle = sacred ? 'lancet' : style;
    // A lancet is far taller and narrower than a house window: it reaches most of the storey
    // and comes to a Gothic point, so the nave reads as a church, not a barn.
    const sacredWinH = clampN(storeyTiles * 0.86, 1.2, 3.6);
    const sacredHalfW = 0.14;
    const [flankA, flankB] = perpFaces(front);
    // A sacred building keeps its entrance front clear (the pediment/portico) and lights
    // the flanks symmetrically; a dwelling lights its front + the near flank.
    const faces: WallFace[] = sacred ? [flankA, flankB] : [front, flankA];

    for (const face of faces) {
      const run = face === 'south' || face === 'north' ? size.w : size.h;
      const count = clampN(Math.round(run / spacing), 1, maxPerFace);
      const doorTs = doorTsByFace[face] ?? [];
      // Bay-aware placement when the frame is annotated (the live expressBuilding path);
      // the fixed-slot fallback covers connectomes with no structure (edge/test paths).
      const bayModuleM = con.structure?.bayModule;
      const slots = bayModuleM
        ? bayWindowSlots(count, run, bayModuleM, doorTs.length > 0, doorTs)
        : windowSlots(count, doorTs.length > 0, doorTs);
      slots.forEach((t, k) => {
        features[`win_${face[0]}${k}`] = {
          type: 'window',
          face,
          params: {
            style: winStyle, glazed, t, sill,
            height: sacred ? sacredWinH : winH,
            ...(sacred ? { width: sacredHalfW } : {}),
            perStorey: true,
          },
        };
      });
    }
  }

  return { parts: { [pid]: { type: 'body', features } } };
}

export { OPP };
