/**
 * Cellar derivation (layered-connectome L3b) — a building that DECLARES a cellar room
 * (its buildingType's `cellar` field names the roomType: a church's crypt, a hall's
 * cellar) sinks that room below grade at `level:-1`, but only where the FRAME can carry
 * masonry — a stone vault needs a mass/box wall; a light cruck/stave frame gets none, so
 * the historical rule (only substantial stone buildings have crypts) falls out of the
 * structure annotation, not hard-coded logic.
 *
 * Pure + deterministic + content-free: the cellar's roomType id comes from the DATA
 * (`bt.fields.cellar`), the access portal reuses an interior portal type already present
 * in the graph, and the parent is found by the generic 'worship' function tag (engine-
 * shared vocabulary, like smoke.ts's 'smoke-egress'). No content ids appear here.
 *
 * Render-only: the cellar zone surfaces in the interior cutaway as a sub-grade floor plate
 * (interiorPlan → buildingFacets). The pipeline derives it LAST (after every massing/opening/
 * vent/cap pass has read the connectome — see express.ts), so a below-grade zone can never
 * perturb the exterior; a building's sprite is byte-identical with or without its cellar.
 */
import type { BuildingTypeFields } from '@/catalogue/types';
import type { Connectome, ExpandCtx, Zone, Portal } from './types';

/** Attach the declared below-grade cellar (level:-1) to a masonry-framed building. */
export function deriveCellar(con: Connectome, ctx: ExpandCtx): Connectome {
  // Already has a sub-grade zone, or a light frame that can't sink a stone vault ⇒ none.
  if (con.zones.some((z) => (z.level ?? 0) < 0) || !con.structure?.flue) return con;
  const type = con.source?.type;
  if (!type) return con;
  const cellarType = ctx.registry.get<BuildingTypeFields>('buildingType', type)?.fields.cellar;
  if (!cellarType) return con;

  // Parent: the deepest worship zone (the sanctum the crypt sits beneath), else the last
  // zone. Sinks one storey below it; the crypt inherits the building era.
  const worship = con.zones.filter((z) => z.fn === 'worship');
  const parent = worship[worship.length - 1] ?? con.zones[con.zones.length - 1];
  if (!parent) return con;

  const crypt: Zone = { id: 'z-cellar', type: cellarType, fn: 'worship', level: -1, scale: 'room', bays: 1 };
  const zones = [...con.zones, crypt];

  // Access stair: reuse an interior portal type the graph already uses (a human door), so
  // no content portal id is named here. Omit the portal if the building has none to borrow.
  const interiorType = con.portals.find((p) => p.from !== 'OUTSIDE')?.type ?? con.portals[0]?.type;
  const portals: Portal[] = interiorType
    ? [...con.portals, { id: 'p-cellar', type: interiorType, from: parent.id, to: crypt.id }]
    : con.portals;

  return { ...con, zones, portals };
}
