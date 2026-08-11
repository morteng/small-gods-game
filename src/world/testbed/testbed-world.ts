// src/world/testbed/testbed-world.ts
//
// THE TESTBED WORLD — a DEV-ONLY, code-authored `WorldSeed` whose job is IN-SITU
// INTEGRATION COVERAGE: one small world that contains every terrain CONTEXT the
// catalogue's features need, so a human (or a screenshot tour) can check that a mill
// wheel reaches painted water, a gate is seated in its wall, a bridge spans a drawn
// channel, and a building terraces into a slope. `?studio=gallery` / `?studio=zoo` are
// contact sheets of isolated subjects; they structurally cannot show any of those
// relationships, and that is where most recent believability bugs lived.
//
// ─── READ THIS BEFORE YOU TRUST A GREEN TESTBED ──────────────────────────────
// A GREEN TESTBED IS NEVER EVIDENCE THAT A SITING FIX WORKS. This world is AUTHORED
// and pinned to ONE gen seed: nothing here snaps, nothing fights the terrain, no
// settlement walks out of a lake. `default/12345` — the one probed world with zero POI
// snaps — stayed clean through the entire WCV 123/124 bridge bug while `default/777`
// was badly broken. A testbed would have shown green all night. Siting fixes are
// accepted against the ADVERSARIAL instruments only:
//   • `scripts/probe-bridge-decks.ts` (the acceptance instrument for bridge siting),
//   • `npm run lint:world` at seeds beyond the defaults,
//   • `scripts/probe-hydrology-parity.ts`, `scripts/probe-world.ts`.
//
// Like `src/world/genome.ts` this is a seed built in CODE rather than hand-written
// JSON — but UNLIKE a genome it carries POIs. Genomes' no-POI contract
// (`genome.ts:10`) is deliberate and stays intact; nothing here touches that module.
//
// SEED-SPECIFICITY IS THE DEAL: the world is DEFINED at {@link TESTBED_GEN_SEED} only.
// Anchoring (coast snap, plateau stamping, hydrology) is a deterministic function of
// (seed code, genSeed), so positions are stable build-to-build until WORLDGEN CODE
// changes — which is exactly when the testbed should re-verify. Consumers must read
// POI ids and resolve their FINAL positions from the generated world; never hardcode
// tile coordinates (authored coords and final coords are different spaces —
// `planWorldLayout` translates everything, see the OFFSET note below).
//
// It is never added to `PLAYABLE_WORLD_NAMES`: the shipped New Game menu stays clean of
// dev surfaces. It is reached only by `?world=testbed` in a dev build (`autostart.ts`),
// resolved through a dynamic import so the whole chunk tree-shakes out of a distribution
// build, and it is ALWAYS ephemeral (never autosaved).

import type { WorldSeed, POI, Connection, NPC } from '@/core/types';
import { validateWorldSeed } from '@/core/schema';

/** Canonical id. Also stamped on the seed so post-generation passes can recognise it. */
export const TESTBED_WORLD_ID = 'testbed';

/** The ONE gen seed this world is defined at (matches the lint/probe default). */
export const TESTBED_GEN_SEED = 12345;

// ─── The authoring frame ──────────────────────────────────────────────────────
//
// `planWorldLayout` (island worlds) GROWS the map and TRANSLATES all content so the
// authored bounding box sits centred inside an ocean margin: the map is sized so the
// content span reaches only `0.66/√2 ≈ 0.467` of each axis. So the numbers below are
// AUTHORING coordinates in a fixed [0,AUTHOR_W] × [0,AUTHOR_H] frame, and the layout
// solver maps them to the real grid. The frame is pinned by POIs that actually touch
// all four extremes (the forest belt at x=0, the cinderwaste at x=AUTHOR_W, the glacier
// at y=0, the mire at y=AUTHOR_H) — keep it that way, or the derived map size (and with
// it every final coordinate) shifts under you.
//
// Measured at TESTBED_GEN_SEED: an 88×58 authored frame derives a 192×128 map
// (24,576 tiles ≈ 14% of `default`'s 488×352, which itself lays out to 488×352 from an
// authored 230×163) and generates headless in ~15–25 s — inside the ~60 s test budget.
const AUTHOR_W = 88;
const AUTHOR_H = 58;

// ─── Terrain shape ────────────────────────────────────────────────────────────
//
// A VALE is a river+terrace+slope machine: high dry flanks, a low trough tilted downhill
// along its axis (so hydrology runs ONE river that grows from a headwater to a mouth),
// and a continuous cross-slope band between them (`terrain-shape.ts:91-104`).
//
// STRENGTH IS 0.55, NOT ~1 — MEASURED, NOT TASTE. `applyTerrainShape` runs AFTER the
// island mask (`terrain-generator.ts:70-76`) and blends `strength` of the authored
// target OVER it. The vale's dry flank target is 0.62 and its trough 0.405, both above
// sea level (0.35), so at strength 0.9 the vale simply OVERWRITES the sunk coastline:
// measured at genseed 12345, strength 0.9 produced ZERO ocean on the north/west/south
// edges (the only sea was the vale's own eastern outlet) and 0 river cells adjacent to
// ocean. The break-even is `0.35/0.5775 ≈ 0.6`. At 0.55 the same seed yields a proper
// island ring (10,446 ocean cells), a trunk river down the trough that reaches it, and
// the terraces are still legible. Raising this back toward 1 costs the coast.
const VALE_STRENGTH = 0.55;

// ─── Rosters ──────────────────────────────────────────────────────────────────
//
// All eight `NpcRole`s appear across these rosters. NOTE (verified at source): only
// `role:'noble'` entries become entities at seed time (`seedAuthoredNobles`,
// `world/seed-world.ts:137-205`); the rest mark a POI as INHABITED and feed the
// statistical cohort tier. The six-soul cradle band covers farmer/elder/child/beggar/
// merchant/soldier as real entities.
const CITY_FOLK: NPC[] = [
  { name: 'Lord Aveline Kingsford', role: 'noble' },
  { name: 'Watch-Captain Orrin', role: 'soldier' },
  { name: 'Mistress Hallow', role: 'merchant' },
  { name: 'Deacon Pell', role: 'priest' },
  { name: 'Old Wick', role: 'beggar' },
];
const MILL_FOLK: NPC[] = [
  { name: 'Goodwife Ferrin', role: 'farmer' },
  { name: 'Elder Tamsin', role: 'elder' },
  { name: 'Little Rue', role: 'child' },
];
const QUAY_FOLK: NPC[] = [
  { name: 'Skipper Halden', role: 'merchant' },
  { name: 'Nettie the Netter', role: 'farmer' },
];
const CASTLE_FOLK: NPC[] = [
  { name: 'Lady Morrow', role: 'noble' },
  { name: 'Sergeant Bask', role: 'soldier' },
  { name: 'Sister Enid', role: 'priest' },
];
const TEMPLE_FOLK: NPC[] = [
  { name: 'Hierarch Vane', role: 'priest' },
  { name: 'Novice Ilsa', role: 'child' },
];
const FARM_FOLK: NPC[] = [
  { name: 'Corb the Ploughman', role: 'farmer' },
  { name: 'Granny Sowe', role: 'elder' },
];
const TAVERN_FOLK: NPC[] = [
  { name: 'Hesper the Host', role: 'merchant' },
  { name: 'Cadge', role: 'beggar' },
];
const WATCH_FOLK: NPC[] = [{ name: 'Warder Fenn', role: 'soldier' }];

/**
 * Build the testbed `WorldSeed`. Pure and allocation-fresh on every call (callers
 * mutate `pois`/`connections` — `planWorldLayout` hands back translated copies but
 * `bootstrapWorld` assigns them straight back onto the seed).
 *
 * COVERAGE CONTRACT: every value in `POI_TYPES` (`src/core/schema.ts:9-35`) appears at
 * least once. Adding a POI type there without adding one here should fail the coverage
 * gate (WP-T3), not slip through.
 */
export function testbedSeed(): WorldSeed {
  const pois: POI[] = [
    // ── The northern upland: the high dry flank of the vale ──────────────────
    // A glacier at the frame's top edge (pins the authoring frame's y=0) crowning the
    // massif — ice band + the coldest biome the world reaches.
    { id: 'hoarcrown', type: 'glacier', name: 'Hoarcrown', position: { x: 36, y: 0 }, size: 'medium', summitM: 150,
      description: 'A blue-white ice cap on the north shoulder of the Warden, never melting.' },
    { id: 'warden_horn', type: 'mountain', name: 'The Warden', position: { x: 31, y: 6 }, size: 'large', summitM: 190,
      description: 'A craggy horn walling the vale off to the north, its spurs catching every cloud.' },
    { id: 'ironbite_mine', type: 'mine', name: 'Ironbite', position: { x: 24, y: 13 }, size: 'small',
      description: 'A worked terrace and a shaft mouth at the Warden\'s southern foot.' },
    { id: 'elder_stones', type: 'ruins', name: 'The Elder Stones', position: { x: 13, y: 10 }, size: 'small', era: 'ancient',
      description: 'A ring of leaning stones on the upper terrace, older than the vale\'s memory.' },
    { id: 'northwatch', type: 'tower', name: 'Northwatch', position: { x: 52, y: 6 }, size: 'small', npcs: WATCH_FOLK,
      description: 'A lone watch tower on the north brow, set to see the whole vale at once.' },

    // ── The eastern waste: a hot, dry climate band with its fire-mountain ────
    // `desert` is a region-fill type, so this box genuinely becomes desert rather than
    // scrubland. It also pins the authoring frame's x = AUTHOR_W.
    { id: 'cinderwaste', type: 'desert', name: 'The Cinderwaste', position: { x: 74, y: 13 }, size: 'large',
      region: { x_min: 62, x_max: AUTHOR_W, y_min: 2, y_max: 26 },
      description: 'A blistering waste of dune and cracked hardpan on the hot eastern shoulder.' },
    { id: 'emberfang', type: 'volcano', name: 'Emberfang', position: { x: 79, y: 19 }, size: 'medium', summitM: 120,
      description: 'A black cinder cone at the waste\'s heart, its crater glowing red after dark.' },
    { id: 'ash_spring', type: 'oasis', name: 'Ash Spring', position: { x: 67, y: 15 }, size: 'small',
      description: 'A ring of palms and sweet water — the only mercy in the Cinderwaste.' },

    // ── The western woods and the lake that feeds the vale ───────────────────
    // `forest` is region-fill; this belt pins the authoring frame's x = 0.
    { id: 'thornwold', type: 'forest', name: 'Thornwold', position: { x: 8, y: 24 },
      region: { x_min: 0, x_max: 18, y_min: 14, y_max: 36 },
      description: 'Old woodland climbing the western terrace, its clearings full of watchful trees.' },
    { id: 'mirror_lake', type: 'lake', name: 'Mirror Lake', position: { x: 21, y: 27 }, size: 'large',
      description: 'A broad still lake perched on the western shelf — the head of the vale\'s river.' },

    // ── The vale floor: the settled river corridor ───────────────────────────
    // Kingsford is the walled city — the gate-in-wall context. `huge` is LOAD-BEARING:
    // buildingCount = rint(5,12) × SETTLEMENT_SIZE_SCALE (2.6 for huge, building-placer.ts:486)
    // so `placed` always clears the stone town-wall rung's `minBuildings: 12`
    // (barrier-types.ts:119). At `large` (×1.8) it measured 9 buildings and fell back to a
    // PALISADE. It is deliberately NOT an endpoint of any crossing: a huge city's zone
    // radius (≈ rint(6,10)·√2.6) swallows the whole valley floor, and roads leaving its
    // gate then detour catastrophically — see the crossing waypoint note below.
    { id: 'kingsford', type: 'city', name: 'Kingsford', position: { x: 48, y: 20 }, size: 'huge', importance: 'critical',
      npcs: CITY_FOLK,
      description: 'The vale\'s one walled town, straddling the high bank above the ford it is named for.' },
    { id: 'millbeck', type: 'village', name: 'Millbeck', position: { x: 32, y: 30 }, size: 'medium', npcs: MILL_FOLK,
      description: 'A village on the river bank whose mill wheel turns in the race below the green.' },
    // The river quay. `importance:'high'` (rank 2) is what makes its crossing a `road`
    // rather than a `track`. CAVEAT, measured: its `dock` lands ~3 tiles from the DRAWN
    // channel, not on it — the port zone's lot pick is what chooses the dock cell, and
    // pulling the POI a tile closer to the bank re-rolled the hydrology and cost the clean
    // deck sheet. Left as the honest state; the dock-on-the-water context is still open.
    { id: 'netherquay', type: 'port', name: 'Netherquay', position: { x: 71, y: 29 }, size: 'medium', importance: 'high',
      npcs: QUAY_FOLK,
      description: 'A river quay at the foot of the vale, where the channel widens enough for a boat.' },
    { id: 'sunsrest_temple', type: 'temple', name: 'Sun\'s Rest', position: { x: 54, y: 16 }, size: 'medium', importance: 'high',
      npcs: TEMPLE_FOLK,
      description: 'A stone temple on the terrace above the town, catching the first light off the Warden.' },
    { id: 'vale_crossroads', type: 'crossroads', name: 'The Vale Crossroads', position: { x: 54, y: 32 }, size: 'small',
      description: 'A signpost and a milestone where the upper lane meets the towpath.' },
    // `importance:'critical'` (rank 3) on a FIELD-INERT, building-less POI is what makes
    // the trunk crossing a `highway` WITHOUT parking a huge walled city on the bank:
    // `classForConnection` reads endpoint rank, and `bridge` has no zone rule, no
    // buildings and no terrain influence (`POI_INFLUENCES` has no entry for it).
    { id: 'kingsford_bridge', type: 'bridge', name: 'Kingsford Bridge', position: { x: 66, y: 31 },
      size: 'medium', importance: 'critical',
      description: 'The great crossing the town grew around.' },
    // Both ends of the FOOTPATH crossing must rank 0, i.e. `size:'small'` with no
    // `importance` (a POI with neither field ranks 1 and yields a track).
    { id: 'fordstones', type: 'ruins', name: 'The Fordstones', position: { x: 46, y: 31 }, size: 'small',
      era: 'ancient',
      description: 'Three lichened uprights on the north bank, marking a ford older than the road.' },

    // ── South of the channel: the low terrace, the mire, the specimen apron ──
    { id: 'greyward_castle', type: 'castle', name: 'Greyward', position: { x: 71, y: 45 }, size: 'medium', importance: 'high',
      npcs: CASTLE_FOLK,
      description: 'A weathered keep on the southern rise, watching the vale road and the mire beyond.' },
    { id: 'longacre_farm', type: 'farm', name: 'Longacre', position: { x: 60, y: 44 }, size: 'medium', npcs: FARM_FOLK,
      description: 'The vale\'s biggest farm, its strips running down to the south bank.' },
    { id: 'ford_and_firkin', type: 'tavern', name: 'The Ford & Firkin', position: { x: 46, y: 41 }, size: 'small',
      npcs: TAVERN_FOLK,
      description: 'A low inn on the south road, one field back from the water.' },
    // Position sits OFF the mire's own standing water: a settlement/landform POI standing
    // in a lake is what `snapDrySettlementsOffWater` moves, and a moved POI is the source
    // of the pre/post-snap TWO-HYDROLOGIES defect. Nothing in this world snaps.
    { id: 'sloughmire', type: 'swamp', name: 'Sloughmire', position: { x: 30, y: 48 }, size: 'medium',
      region: { x_min: 4, x_max: 34, y_min: 44, y_max: AUTHOR_H },
      description: 'A black-water mire of dead trees where the vale\'s overflow gathers and stops.' },
    // THE SPECIMEN APRON — RESERVED FOR WP-T2. `plains` is a region-fill type, so this
    // box is dried into open grassland: flat, treeless, clear of every settlement's
    // zone radius, and deliberately NOT organic townscape (its screenshots must never be
    // read as siting evidence). The id is a PINNED CROSS-SLICE CONTRACT — do not rename.
    { id: 'specimen_apron', type: 'plains', name: 'The Specimen Apron', position: { x: 60, y: 55 },
      region: { x_min: 40, x_max: 82, y_min: 51, y_max: AUTHOR_H },
      description: 'A flat, open sward set aside on the southern terrace — the specimen ground.' },

    // ── Coast-anchored landforms ─────────────────────────────────────────────
    // The authoring frame is INLAND by construction (see the OFFSET note): the layout
    // solver centres it inside the ocean margin, so no authored coordinate can BE on the
    // shore. That is exactly what the `coast:` anchor is for — worldgen resolves each of
    // these out to the real shoreline at gen time (`poi-influence.ts:206-222`), so they
    // track the coast this seed actually produces instead of a coordinate that misses it.
    { id: 'dire_brink', type: 'cliffs', name: 'The Dire Brink', position: { x: 86, y: 40 }, coast: 'east', size: 'large',
      description: 'A tableland shorn off where the eastern shore rears up and plunges to the surf.' },
    { id: 'drowned_sentinels', type: 'sea_stacks', name: 'The Drowned Sentinels', position: { x: 86, y: 47 }, coast: 'east',
      size: 'medium',
      description: 'A file of bare rock pillars standing off the foot of the Brink.' },
    { id: 'smugglers_bight', type: 'cove', name: 'Smuggler\'s Bight', position: { x: 4, y: 40 }, coast: 'west', size: 'medium',
      description: 'A sheltered crescent bitten into the western shore between two low arms of land.' },
    { id: 'windward_head', type: 'headland', name: 'Windward Head', position: { x: 40, y: 56 }, coast: 'south', size: 'large',
      description: 'A low green cape reaching into the southern sea, its rocky toe washed by the swell.' },
  ];

  // ── NO AUTHORED RIVER CONNECTION — AND THAT IS DELIBERATE ──────────────────
  //
  // `Connection.type:'river'` is real (`surfaceOf` → surface 'water' → tile type 'river',
  // `road-graph.ts:163-171`) but it is NOT drawn water. The RENDER waterType — the water
  // the player sees, and the water every believability instrument measures against — is
  // rebuilt from the hydrology raster plus the water CONNECTOME, and the connectome is a
  // pure view of that same raster (`render-water-mask.ts:47-73`,
  // `water-network-store.ts:23-36`). Neither ever reads `tile.type`, and
  // `terrain-field.ts:270` only falls back to `tile.type === 'river'` when no render
  // waterType array is supplied, which never happens on the live path.
  //
  // MEASURED at TESTBED_GEN_SEED with a lake→quay river connection authored down the
  // trough: the carve produced a continuous run of `tile.type==='river'` cells that the
  // ribbon left DRY, the road walker dutifully bridged them, and the result was a deck
  // spanning invisible water — `probe-bridge-decks` class1, i.e. EXACTLY the "bridge
  // beside the river" defect the probe exists to catch. `default.json`'s one authored
  // river hides this because it is drawn over ground hydrology already floods.
  //
  // So every water context here sits on the TOPOGRAPHIC trunk river the vale generates,
  // and the crossings below are placed on measured NARROW reaches of it.
  const connections: Connection[] = [
    // ── ROAD CROSSINGS, ONE PER ROAD CLASS ───────────────────────────────────
    // `classForConnection` ranks the BUSIER endpoint (road-graph.ts:150-160):
    //   importance first, then size, else a default rank of 1.
    //   rank ≥3 → highway · ≥2 → road · ≥1 → track · else path.
    // Road class drives carriageway width, surface and deck width. It does NOT give four
    // crossing tiers — see the CROSSING TIER note at the bottom of this file.
    //
    // Each crossing runs PERPENDICULAR across a reach measured to be 2–5 drawn cells wide
    // with dry ground on both banks: path at final x≈98, track x≈106, road x≈112,
    // highway x≈118 — spread along the trunk so their carriageways never bundle.
    // The reaches were read off the generated world (`buildRenderWaterTypeMemo`) with
    // `connections: []`, since roads do not move hydrology; re-measure that way if a POI
    // ever moves, because moving one POI moves the channel and every waypoint here.
    //
    // HIGHWAY — Kingsford Bridge (critical, rank 3) ↔ Greyward (high, rank 2) ⇒ rank 3.
    // Crosses the trunk at final x≈118, a measured 5-cell reach with dry banks. The
    // waypoints STRADDLE the channel tightly: the walker is free to wander within a
    // segment, and a highway's grade envelope (`gradeEnvelope`, road-graph.ts:342) makes
    // it hug the flat valley FLOOR — measured, one loose segment sent a highway 160 cells
    // down the trough and across the river five times.
    { from: 'kingsford_bridge', to: 'greyward_castle', type: 'road', style: 'stone',
      waypoints: [{ x: 66, y: 31 }, { x: 66, y: 33 }, { x: 66, y: 39 }, { x: 66, y: 41 },
        { x: 71, y: 45 }] },
    // ROAD — Netherquay (high, rank 2) ↔ Longacre (medium size, rank 1) ⇒ rank 2.
    // Runs WEST along the dry north bank first and crosses at final x≈112, a measured
    // 4-cell reach: the x≈124 reach where the trunk fans into the east lake is broad and
    // diagonal, and a crossing there measured class1 + class3 on `probe-bridge-decks`.
    { from: 'netherquay', to: 'longacre_farm', type: 'road', style: 'dirt',
      waypoints: [{ x: 71, y: 29 }, { x: 66, y: 29 }, { x: 60, y: 30 }, { x: 60, y: 33 },
        { x: 60, y: 39 }, { x: 60, y: 43 }, { x: 60, y: 44 }] },
    // TRACK — the Vale Crossroads (small, rank 0) ↔ Longacre (medium size, rank 1) ⇒ rank 1.
    // Crosses at final x≈106, a measured 3-cell reach.
    { from: 'vale_crossroads', to: 'longacre_farm', type: 'road', style: 'dirt',
      waypoints: [{ x: 54, y: 32 }, { x: 54, y: 35 }, { x: 54, y: 39 }, { x: 54, y: 42 },
        { x: 60, y: 44 }] },
    // PATH — the Fordstones and the Ford & Firkin are both `small` with NO `importance`,
    // so both rank 0. Crosses at final x≈98, the narrowest measured reach (2 cells).
    { from: 'fordstones', to: 'ford_and_firkin', type: 'road', style: 'dirt',
      waypoints: [{ x: 46, y: 31 }, { x: 46, y: 33 }, { x: 46, y: 36 }, { x: 46, y: 41 }] },

    // ── Dry-land roads (no crossing) — the settled network the vale reads as ──
    { from: 'kingsford', to: 'vale_crossroads', type: 'road', style: 'stone',
      waypoints: [{ x: 48, y: 20 }, { x: 50, y: 25 }, { x: 53, y: 29 }, { x: 54, y: 32 }] },
    { from: 'kingsford', to: 'sunsrest_temple', type: 'road', style: 'stone',
      waypoints: [{ x: 48, y: 20 }, { x: 50, y: 18 }, { x: 52, y: 17 }, { x: 54, y: 16 }] },
    { from: 'kingsford', to: 'millbeck', type: 'road', style: 'dirt',
      waypoints: [{ x: 48, y: 20 }, { x: 40, y: 25 }, { x: 32, y: 30 }] },
    { from: 'millbeck', to: 'fordstones', type: 'road', style: 'dirt',
      waypoints: [{ x: 32, y: 30 }, { x: 39, y: 31 }, { x: 46, y: 31 }] },
    { from: 'netherquay', to: 'kingsford_bridge', type: 'road', style: 'dirt',
      waypoints: [{ x: 71, y: 29 }, { x: 69, y: 30 }, { x: 66, y: 31 }] },
    { from: 'sunsrest_temple', to: 'northwatch', type: 'road', style: 'dirt',
      waypoints: [{ x: 54, y: 16 }, { x: 53, y: 11 }, { x: 52, y: 6 }] },
    { from: 'sunsrest_temple', to: 'ironbite_mine', type: 'road', style: 'dirt',
      waypoints: [{ x: 54, y: 16 }, { x: 44, y: 8 }, { x: 30, y: 10 }, { x: 24, y: 13 }] },
    { from: 'greyward_castle', to: 'longacre_farm', type: 'road', style: 'dirt',
      waypoints: [{ x: 71, y: 45 }, { x: 65, y: 44 }, { x: 60, y: 44 }] },
    { from: 'greyward_castle', to: 'ford_and_firkin', type: 'road', style: 'dirt',
      waypoints: [{ x: 71, y: 45 }, { x: 58, y: 45 }, { x: 46, y: 41 }] },
  ];

  const seed: WorldSeed = {
    id: TESTBED_WORLD_ID,
    name: 'The Testbed Vale',
    description:
      'A dev-only instrument world: every terrain context the catalogue needs, in one '
      + 'small vale at one pinned gen seed. Not a playable world, and never evidence '
      + 'that a siting fix works.',
    size: { width: 140, height: 100 },
    biome: 'temperate',
    era: 'medieval',
    island: true,
    climate: { tempNorth: 0.52, tempSouth: 0.68, eastWarmLean: 0.08, westWetLean: 0.10, elevationLapse: 0.40 },
    terrainShape: { kind: 'vale', strength: VALE_STRENGTH },
    style: { overrides: { mountainRelief: 44, coastDrama: 0.35, riverDensity: 0.9, terrainVerticalExaggeration: 26 } },
    pois,
    connections,
    constraints: [],
  };

  // Loud, never fatal — same contract as `terrainGenome`. An invalid testbed should
  // still boot so an author can look at what they broke.
  const v = validateWorldSeed(seed);
  if (v.errors.length) console.error('[testbed] seed invalid:', v.errors);
  if (v.warnings.length) console.warn('[testbed] seed warnings:', v.warnings);
  return seed;
}

// ─── CROSSING TIERS AT GENERATION: what is actually reachable ─────────────────
//
// Measured at source, not assumed. A gen-time span's ladder tier is read back from the
// span's own blueprint (`standingSpanTier`, `crossing-tier-store.ts:186-196`):
//   stone walls → GEN_BRIDGE_CLASS_TIER['dressed-stone'] = 6
//   an `arch_span` part → GEN_BRIDGE_CLASS_TIER.timber = 5
//   otherwise → GEN_BRIDGE_CLASS_TIER['log-plank'] = 3          (road-use.ts:418-420)
// The material class comes from `bridgeClassFor(env, ROAD_RANK[roadClass])`
// (`buildability-envelope.ts:48-53`), and `env` is NOT authorable from a seed: worldgen
// calls `detectCrossings` with HARDCODED `defaults: { era: 'late-medieval', prosperity:
// 'modest' }` (`map-generator.ts:726-729` and again at :987-990) and supplies no
// `siteParamsAt` resolver anywhere in the codebase. So every crossing generates with
// tech = 3 and economy = 1, which means:
//   highway (importance 3) → 'dressed-stone' → tier 6
//   road / track / path    → 'timber'        → tier 5
//   'log-plank' (tier 3) requires tech < 1 AND economy < 1 ⇒ UNREACHABLE at gen.
// TWO distinct tiers is therefore the ceiling for organically generated crossings, and
// no arrangement of POI size/importance/era changes that. Tiers 0/1/2/3/4 are covered by
// WP-T2's specimen `bridge-*` row — that is the designed backstop, not a gap.

// ─── WHAT THIS WORLD MEASURED AT TESTBED_GEN_SEED (WP-T1 baseline) ───────────
//
// Re-measure before blaming a round; these are the numbers to diff against.
//   map                 192×128 (24,576 tiles), headless gen ~15–25 s
//   render waterTypes   Dry 13,537 / Ocean 10,500 / Lake 174 / River 365 — all four
//                       present; 7 River cells adjacent to Ocean
//   probe-bridge-decks  4 decks · class1 0 · class2 0 · class3 0 ·
//                       27 of 28 routed bridge cells over painted water
//                       (`npx tsx scripts/probe-bridge-decks.ts <world> 12345`)
//   crossing tiers      2 distinct (5 ×3, 6 ×1) — the ceiling, see the note above
//   walls               kingsford_ring: stone `wall`, 3 gates, 11 towers ·
//                       millbeck_ring: `palisade`, 3 gates, 5 towers
//   water buildings     4 × watermill, 1 × fisherman_hut (the mire pond, via Millbeck)
//   POI type coverage   25 / 25
//   connectome-lint     75 findings — 6 error / 0 unmet requirement. NOT clean, and the
//                       shipped `default` world at the same seed measures 47 findings /
//                       4 errors, so "0 errors" is not a bar any world meets today. The
//                       6 are: 4 × claims.unresolved (barrier×building where Kingsford's
//                       and Millbeck's zones overlap), 1 × bridge.tiles-vs-deck, 1 ×
//                       wall.crossing-only-at-gate on Kingsford.
