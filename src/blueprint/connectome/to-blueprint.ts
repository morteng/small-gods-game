/**
 * Resolve a building connectome DOWN into the existing geometric Blueprint — the
 * "layer above, resolve down" step. Slice-1 scope is the headline payoff: the
 * derived smoke-egress fixture becomes a `vent` feature positioned over the hearth
 * zone, so **the hearth literally determines the vent**. Doors/windows stay
 * preset-authored for now (the room graph is latent — carried for the interior
 * slice); this only emits the vent so the chimney-strip is surgical.
 *
 * Content-free: it reads the blueprint feature vocabulary ('vent'/'chimney'/
 * 'smokehole' — engine-side blueprint params, NOT catalogue content) and pulls the
 * egress placement from the connectome it was handed; no catalogue ids are
 * hard-coded (guard-checked).
 */
import type { Blueprint, BlueprintPatch, WallFace } from '../types';
import type { Connectome } from './types';

/** Find the id of the part the vent should sit on (the primary body, else the first part). */
function bodyPartId(base: Blueprint): string | undefined {
  const entries = Object.entries(base.parts);
  const body = entries.find(([, p]) => p.type === 'body');
  return (body ?? entries[0])?.[0];
}

/** Position (0..1 along the run) of the hearth zone's centre, by cumulative bays. */
function hearthT(con: Connectome, hearthZoneId: string): number {
  const total = con.zones.reduce((s, z) => s + (z.bays ?? 1), 0) || 1;
  let before = 0;
  for (const z of con.zones) {
    const bays = z.bays ?? 1;
    if (z.id === hearthZoneId) return (before + bays / 2) / total;
    before += bays;
  }
  return 0.5;
}

/** Which gable end (t≈0.12 or 0.88 along the ridge) the entrance sits at — a west tower crowns
 *  the ENTRANCE gable. Locates the single OUTSIDE portal's zone, finds its centre along the run,
 *  and returns the nearer gable end so the tower stands over the door, not mid-nave. */
function entranceGableT(con: Connectome): number {
  const ext = con.portals.find((p) => p.from === 'OUTSIDE');
  if (!ext) return 0.12;
  const total = con.zones.reduce((s, z) => s + (z.bays ?? 1), 0) || 1;
  let before = 0, centre = 0.5;
  for (const z of con.zones) {
    const bays = z.bays ?? 1;
    if (z.id === ext.to) { centre = (before + bays / 2) / total; break; }
    before += bays;
  }
  return centre < 0.5 ? 0.12 : 0.88;
}

/**
 * Build the patch the connectome implies for `base`. Slice 1: the smoke vent only.
 * Returns `{}` when the building has no hearth/egress (most non-dwellings).
 */
export function connectomeToBlueprint(con: Connectome, base: Blueprint): BlueprintPatch {
  const pid = bodyPartId(base);
  if (!pid) return {};

  const features: Record<string, { type: string; face?: WallFace; params: Record<string, number | string> }> = {};

  // The hearth's smoke vent: placement 'wall' ⇒ a wall fireplace/chimney; else a ridge vent.
  const egress = con.fixtures.find((f) => f.satisfies?.includes('smoke-egress'));
  if (egress) {
    const placement = (egress.attrs?.placement as string | undefined) ?? 'ridge';
    const kind = placement === 'wall' ? 'chimney' : 'smokehole';
    // stable id replaces any residual hand-authored vent of the same id
    features.smoke = { type: 'vent', params: { kind, t: hearthT(con, egress.zoneId) } };
  }

  // E3 axis-mundi: a building with WORSHIP zones crowns its ridge with a stone STEEPLE near
  // the entrance front — the procession's vertical marker, a ridge `spire` feature. A BARN
  // shares the church-axial nave (worship room) but is entered through OPPOSED cart doors (≥2
  // exterior portals, a threshing through-passage); a true sacred cella has a single entrance,
  // so the portal count cleanly tells a temple/church/shrine from a barn.
  const worship = con.zones.some((z) => z.fn === 'worship');
  const singleEntrance = con.portals.filter((p) => p.from === 'OUTSIDE').length < 2;
  // A masonry worship span carries its roof thrust on visible BUTTRESSES — two-stage
  // stepped piers between the lancets + braced corners (body trim, `parts/trim.ts`).
  // Param patch only; barns (opposed cart doors) stay clean-walled.
  const buttress = worship && singleEntrance;
  if (worship && singleEntrance) {
    // A WEST TOWER: the steeple crowns the ENTRANCE GABLE (not mid-roof), centred on the
    // building's width so it reads as a symmetric tower over the door — not a spike stuck on
    // one roof slope. `width` makes it a square tower shaft rather than a thin flèche. Pass the
    // entrance FACE so the geometry stands the tower on that gable (the door's end), whichever
    // way the ridge runs; `t` is a fallback for connectomes with no faced entrance portal.
    const entrance = con.portals.find((p) => p.from === 'OUTSIDE');
    features.spire = {
      type: 'vent',
      ...(entrance?.face ? { face: entrance.face } : {}),
      params: { kind: 'spire', t: entranceGableT(con), width: 1.5 },
    };
  }

  if (!Object.keys(features).length && !buttress) return {};
  return {
    parts: {
      [pid]: {
        type: 'body', features,
        ...(buttress ? { params: { buttress: true } } : {}),
      },
    },
  };
}
