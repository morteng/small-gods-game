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
import type { Blueprint, BlueprintPatch } from '../types';
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

/**
 * Build the patch the connectome implies for `base`. Slice 1: the smoke vent only.
 * Returns `{}` when the building has no hearth/egress (most non-dwellings).
 */
export function connectomeToBlueprint(con: Connectome, base: Blueprint): BlueprintPatch {
  const egress = con.fixtures.find((f) => f.satisfies?.includes('smoke-egress'));
  if (!egress) return {};
  const pid = bodyPartId(base);
  if (!pid) return {};

  // placement 'wall' ⇒ a wall fireplace/chimney; anything else ⇒ a ridge smoke vent.
  const placement = (egress.attrs?.placement as string | undefined) ?? 'ridge';
  const kind = placement === 'wall' ? 'chimney' : 'smokehole';
  const t = hearthT(con, egress.zoneId);

  return {
    parts: {
      [pid]: {
        type: 'body',
        features: {
          // stable id replaces any residual hand-authored vent of the same id
          smoke: { type: 'vent', params: { kind, t } },
        },
      },
    },
  };
}
