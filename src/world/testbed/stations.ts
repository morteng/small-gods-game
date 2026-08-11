// src/world/testbed/stations.ts
//
// STATION DATA for the testbed screenshot tour (WP-T4, `scripts/testbed-tour.ts`).
//
// (import below: the specimen row list is owned by `specimens.ts`, not copied here.)
//
// ── READ THIS BEFORE TRUSTING A GREEN TOUR ─────────────────────────────────────
// The tour's output is for HUMAN REVIEW. There is no pixel-diff baseline here,
// deliberately: no diff infra exists in this repo, every render contains animated
// water/vegetation/NPCs so two "correct" captures are never byte-identical, and a
// carelessly chosen tolerance is a convenient-metric trap — three bridge-siting
// rounds shipped green against a proxy metric before the real defect was found
// (see `docs/audit/TESTBED-WORLD-PLAN.md` §3.6). A GREEN TOUR IS NEVER EVIDENCE
// THAT A SITING FIX WORKS. The testbed world itself carries the same warning
// (`testbed-world.ts` header) — it is authored and pinned to one gen seed, so it
// cannot show emergent siting defects by construction. Siting fixes are accepted
// only against the adversarial instruments (`probe-bridge-decks.ts`, multi-seed
// `lint:world`), never against this tour.
//
// ── Targets are POI ids or specimen-row names, NEVER tile coordinates ─────────
// `testbedSeed()` authors POIs in an AUTHORING frame that `planWorldLayout`
// translates (and `snapDrySettlementsOffWater` may move) into a different FINAL
// frame — the WCV 123/124 lesson. The tour resolves every target's position from
// the LIVE, laid-out world at capture time (`map.worldSeed.pois` for a POI target;
// the live centroid of tagged specimen entities for a row target), never from a
// coordinate baked in here.
//
// ── Where the `specimenRow` list comes from ───────────────────────────────────
// The plan (§4, WP-T4 brief) said to "import the row names from specimens.ts'
// SPECIMEN_ROW". That was wrong as written: `SPECIMEN_ROW` is the PROPERTY KEY
// string `'specimenRow'` a specimen entity carries, not an enumerable list of row
// VALUES — and at the time no row-name registry was exported at all.
// Deriving the list at RUNTIME is the wrong answer too: it would mean either (a)
// generating the whole testbed world at import time just to read a data module —
// wrong layering, and expensive (~15-25s) for something imported by a test or the
// tour — or (b) querying the live browser world in the tour script and improvising
// a station per row it happens to find, which breaks the acceptance contract that
// `TESTBED_STATIONS.length` is the tour's own definition of "how many stations".
// So the row list is IMPORTED from `specimens.ts`, which is the only module that
// knows what its rows are. It was briefly hand-copied here; that was a rot vector in
// an epic whose whole premise is derive-don't-enumerate, so `specimens.ts` now exports
// `SPECIMEN_ROW_NAMES` and types every one of its `row:` literals against it — adding a
// row without listing it there fails typecheck, and the tour picks it up for free.
import { SPECIMEN_ROW_NAMES } from '@/world/testbed/specimens';

export const KNOWN_SPECIMEN_ROWS = SPECIMEN_ROW_NAMES;

/** A tour station: what to frame, and how. */
export interface TestbedStation {
  /** Stable id — becomes the capture filename (`testbed-<id>.png`). */
  id: string;
  /** WHAT TO FRAME, resolved from the LIVE world at capture time — never a tile
   *  coordinate (see the module header):
   *    `{ poi }`          a POI id, from `worldSeed.pois`.
   *    `{ specimenRow }`  the centroid of that row's live, tagged specimens.
   *    `{ entityKind }`   the live entity of that KIND belonging to `ofPoi`. A
   *                       blueprint entity's `kind` IS its preset name
   *                       (`blueprint/entity.ts:blueprintEntity`) and a civic
   *                       building carries its owning settlement in
   *                       `properties.poiId`, so this frames the actual building
   *                       rather than the settlement that contains it — the whole
   *                       point of a station like `mill_at_water`, and the one
   *                       thing the first cut of this tour got wrong.
   *
   *                       OWNERSHIP, NOT PROXIMITY, and that distinction cost a
   *                       round: an earlier `nearPoi` version resolved "nearest
   *                       watermill to netherquay" to GREYWARD's mill (5.0 tiles
   *                       away) over Netherquay's own (7.1) — a plausible-looking
   *                       capture of the wrong building, which is precisely the
   *                       failure this target type was added to fix. */
  target: { poi: string } | { specimenRow: string } | { entityKind: string; ofPoi: string };
  /** Camera zoom (iso projection; `ISO_ZOOM_MAX` is 1 — the hard-rule default for
   *  a "centred on the tile" close shot). Omit to use the tour's own default
   *  (1). A handful of stations need to zoom OUT to show their subject at all
   *  (a whole walled city, or a long specimen row) — each such override is
   *  commented at its station below with why. */
  zoom?: number;
  /** Solar hour override (0-23). Omit to use the tour's default boot hour (10).
   *  Only the night-variant station needs one today. */
  hour?: number;
}

/** Close, "centred on the tile" framing — the plan's stated default preference. */
const CLOSE_ZOOM = 1;
/** Wide framing for a whole walled settlement — has to fit `kingsford_ring`'s full
 *  circuit (3 gates, 11 towers) in one frame, which CLOSE_ZOOM cannot. */
const CITY_ZOOM = 0.28;
/** Specimen rows are long strips laid by a bottom-left packer (`SEP 1` between
 *  items, `BAND_GAP 1` between bands — see `specimens.ts`'s layout constants);
 *  CLOSE_ZOOM would show at most one or two items astride the row's centroid.
 *  This is the widest zoom that still reads as "close to the ground" rather than
 *  a top-down map view. */
const ROW_ZOOM = 0.45;

// ─── Context stations ───────────────────────────────────────────────────────────
//
// One per context named in the WP-T4 brief: mill-at-water, each of the four road
// classes' crossings, gate-in-wall, terrace/slope band, port/quay, the four coastal
// landmarks, the walled city as a whole, and its night variant.
//
// CROSSING TARGETS: the module contract allows only a POI or a specimen row as a
// target, and none of the four crossings has a dedicated deck-centred POI except
// the highway's (`kingsford_bridge` — authored specifically to anchor that
// crossing's road class, `testbed-world.ts:192-200`). For the other three, the
// best available POI proxy is derived from `testbed-world.ts`'s own measurements:
// its crossing-tier comment block records each crossing's FINAL x (path 98, track
// 106, road 112, highway 118) and each connection's authored (pre-layout) waypoints
// run a straight north-south leg at one AUTHORING x per crossing (46/54/60/66)
// before jogging to its far endpoint. Those two series are the same series with a
// constant +52 offset (66+52=118, 60+52=112, 54+52=106, 46+52=98) — i.e. each
// crossing sits directly on its connection's authored vertical leg, at the SAME
// authoring x as one of that connection's own named endpoints:
//   highway (kingsford_bridge → greyward_castle): kingsford_bridge IS the leg's
//     start point (66,31) — already a dedicated bridge POI, no proxy needed.
//   road (netherquay → longacre_farm): the leg runs at x=60, matching
//     longacre_farm's authored x (60,44) — NOT netherquay's (71,29), which sits off
//     to the side before the road turns onto the leg. longacre_farm is the proxy.
//   track (vale_crossroads → longacre_farm): the leg's start point IS
//     vale_crossroads (54,32) — no better proxy needed.
//   path (fordstones → ford_and_firkin): the leg's start point IS fordstones
//     (46,31) — no better proxy needed.
// A POI-anchored frame is therefore near, not exactly on, each deck for road/track/
// path (kingsford_bridge is exact for highway); zoomed to CLOSE_ZOOM it should
// still catch the crossing given the reach is only 2-5 tiles wide. Re-derive this
// mapping from `testbed-world.ts`'s own measured comments if the seed ever moves a
// POI (which re-rolls every waypoint downstream of it, per that file's own
// warnings) — never hand-tune the zoom to paper over a target that drifted off the
// deck.
const CONTEXT_STATIONS: readonly TestbedStation[] = [
  // THE MILL WHEEL REACHING PAINTED WATER — the epic's headline in-situ context, and the
  // reason `{ entityKind }` exists. Two corrections are baked into this one line, both
  // found by looking at the capture instead of at the acceptance count:
  //
  //  1. It framed a POI (`millbeck`) and photographed a village green. A mill is seated by
  //     `getMillSites` on a hydrology-tagged bank cell, nowhere near the POI centre.
  //  2. Re-aimed at "the watermill nearest millbeck", it resolved to KINGSFORD's — because
  //     MILLBECK HAS NO MILL, despite its own seed description promising one. Measured: the
  //     world stands four watermills (kingsford 99,67 · netherquay 130,65 · greyward 123,69
  //     · longacre 110,73) and none belongs to Millbeck; `planCivics` is flush-or-omit, so a
  //     settlement off a wheel-scale reach simply gets none. And Kingsford's is the ONE mill
  //     `lint:testbed` reports as `mill.wheel-reaches-water` FAILING — its wheel hangs over
  //     dry ground. The station named after the context was framing the counter-example.
  //
  // Netherquay's mill stands 1 tile off drawn water on the trunk river, with the stone-arch
  // crossing in the same frame. Re-derive from the lint's `mill.wheel-reaches-water` rule if
  // the seed ever moves a POI — never by assuming the nearest mill is a good one, and never
  // by proximity at all (see the `ofPoi` note above).
  { id: 'mill_at_water', target: { entityKind: 'watermill', ofPoi: 'netherquay' }, zoom: CLOSE_ZOOM },

  // Each of the four road-class crossings (see the derivation note above).
  { id: 'crossing_highway', target: { poi: 'kingsford_bridge' }, zoom: CLOSE_ZOOM },
  { id: 'crossing_road', target: { poi: 'longacre_farm' }, zoom: CLOSE_ZOOM },
  { id: 'crossing_track', target: { poi: 'vale_crossroads' }, zoom: CLOSE_ZOOM },
  { id: 'crossing_path', target: { poi: 'fordstones' }, zoom: CLOSE_ZOOM },

  // A gate seated in `kingsford_ring` (stone wall, 3 gates, 11 towers).
  { id: 'gate_in_wall', target: { poi: 'kingsford' }, zoom: CLOSE_ZOOM },

  // A building terracing into a slope — Sun's Rest sits explicitly "on the terrace
  // above the town" (`testbed-world.ts:189-191`).
  { id: 'terrace_slope_band', target: { poi: 'sunsrest_temple' }, zoom: CLOSE_ZOOM },

  // The river quay/dock — Netherquay. (Distinct from `crossing_road`, which also
  // sits near Netherquay's connection but is framed on the crossing itself.)
  { id: 'port_quay', target: { poi: 'netherquay' }, zoom: CLOSE_ZOOM },

  // The four coast-anchored landmarks — resolved out to the shoreline this seed
  // actually produces (`coast:` anchoring), one station each since they sit on
  // opposite shores and cannot share a frame.
  { id: 'coastal_dire_brink', target: { poi: 'dire_brink' }, zoom: CLOSE_ZOOM },
  { id: 'coastal_drowned_sentinels', target: { poi: 'drowned_sentinels' }, zoom: CLOSE_ZOOM },
  { id: 'coastal_smugglers_bight', target: { poi: 'smugglers_bight' }, zoom: CLOSE_ZOOM },
  { id: 'coastal_windward_head', target: { poi: 'windward_head' }, zoom: CLOSE_ZOOM },

  // The walled city as a whole, day and night (`hour: 22` for window emissives).
  { id: 'walled_city', target: { poi: 'kingsford' }, zoom: CITY_ZOOM },
  { id: 'walled_city_night', target: { poi: 'kingsford' }, zoom: CITY_ZOOM, hour: 22 },
];

// ─── Specimen-row stations ────────────────────────────────────────────────────
//
// One per row placed by `placeSpecimens` (WP-T2). Framed on the live centroid of
// that row's tagged entities (never the apron rect, which is authored and static —
// the row itself may not fill it; see `specimens.ts`'s SPECIMEN CAPACITY note in
// `testbed-world.ts`, 37 of 119 registry ids currently fail to place for lack of
// dry apron room, so a row station may frame partly-empty ground until that
// densifies. That is a WP-T2 concern, not this tour's to paper over.)
const SPECIMEN_ROW_STATIONS: readonly TestbedStation[] = KNOWN_SPECIMEN_ROWS.map((row) => ({
  id: `specimen_${row}`,
  target: { specimenRow: row },
  zoom: ROW_ZOOM,
}));

/** The full tour. One per named context, plus one per specimen row. */
export const TESTBED_STATIONS: readonly TestbedStation[] = [
  ...CONTEXT_STATIONS,
  ...SPECIMEN_ROW_STATIONS,
];
