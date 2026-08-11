# Testbed World — Orchestration-Ready Implementation Plan

> Status: PLAN (no code written). Base: `main` @ `ed2f54e4`, clean.
> Every `file:line` below was read at source for this plan (2026-08-10/11); claims that
> could not be pinned to a line are marked **INFERRED**.

---

## 1. What this is for — and explicitly what it is not for

**For: in-situ integration coverage.** One dev-gated world containing one of each
catalogue thing, run through the real pipeline (`planWorldLayout` →
`generateWithNoise` → the shipped renderer), so a human — or a screenshot tour —
can verify that every asset renders, sits on grade, and behaves correctly *next to
its neighbours*: a mill wheel reaching painted water, a gate seated in its wall, a
bridge spanning a drawn channel, a building terracing into a slope, a specimen of
every building/flora/barrier standing on real generated ground at world palette and
scale. `?studio=gallery` / `?studio=zoo` are contact sheets of isolated subjects; they
structurally cannot show any of those relationships, and the in-context relationships
are where most recent believability bugs lived.

**Not for: emergent-siting defects.** This is the second of two instruments, and it
must never displace the first. A tidy authored testbed at a pinned gen seed *snaps
nothing*: no settlement walks out of a lake, no plateau drags a shoreline, no road
terminates in water it drowned itself. The proof is recent and concrete —
`default/12345`, the one probed world with zero POI snaps, stayed clean all night
while `default/777` was badly broken (WCV 123/124 root cause,
`src/core/content-version.ts:172`). A testbed would have shown green throughout that
entire bug. The adversarial instruments remain the check for emergent defects:

- random gen seeds over the playable worlds (`npm run lint:world`, seeds beyond the
  defaults — `scripts/connectome-lint.ts:10`),
- `scripts/probe-bridge-decks.ts` (the acceptance instrument for bridge siting),
- `scripts/probe-hydrology-parity.ts` (one-water gate, exits non-zero on any diff),
- `scripts/probe-world.ts` / world-doctor on arbitrary seeds.

**Designed-against failure mode:** the beautiful testbed becomes *the* check while
adversarial worlds quietly stop being run. Guardrails, built into the slices below:

1. The testbed gets its **own** lint command (`npm run lint:testbed`) with a
   **zero-findings** bar. It is *not* added to `lint:world`'s default target set, so
   the adversarial baseline (~293 findings at base, agent-measured 2026-08-10 —
   re-measure before trusting) and the testbed's clean bar never blur into one
   number, and `lint:world`'s scope never silently narrows.
2. The plan states, and the testbed module's header comment must state: **a green
   testbed is never evidence that a siting fix works.** Siting fixes are accepted
   against `probe-bridge-decks.ts` / multi-seed `lint:world` on the playable worlds.
3. The testbed's own gates (coverage test, context test, `lint:testbed`) go into the
   normal vitest suite / CI so they cannot rot — but they assert *presence and
   integrity of authored content*, never generality.

---

## 2. Ground truth (verified), including corrections to the briefing

### 2.1 What exists — confirmed

| Claim | Verified at |
|---|---|
| `public/data/worlds/{default,dawn,frost}.json`, hand-authored `WorldSeed`s with POIs (26/14/14) | files on disk; loader `src/map/world-manager.ts:47,74-77` |
| `src/world/genome.ts` — code-authored seeds, **no POIs by design** (`pois: []` at :62; contract in header :10), reachable via `?genome=` | `src/world/genome.ts:10,62`; registry `TERRAIN_GENOMES` :80 (7 entries) |
| `?genseed` / `?genome` / `?bridge` / `?autostart` bypass the title; `?genome` is `devTools`-gated | `src/game/autostart.ts:36-46`; sole caller `src/main.ts:47` passes `__DEV_TOOLS__` |
| `PLAYABLE_WORLD_NAMES = ['default','dawn','frost']` | `src/world/playable-worlds.ts:21` |
| `npm run lint:world` iterates `PLAYABLE_WORLD_NAMES` | `scripts/connectome-lint.ts:41` (default targets), alias `package.json:21` |
| `src/game/new-game-seed.ts` imports the same list | `src/game/new-game-seed.ts:17`, used by `pickPlayableWorld()` :47-50 |
| Studios: object / gallery / zoo / motion / world / site / crossings / crossing-site | `src/studio/studio.ts:1774-1782` (`WORKSPACES`), param mapping :1786-1798 |

### 2.2 Corrections and additions to the briefing

1. **Flora is 43 species, not 26.** `FLORA_FACTS` has exactly 43 ids
   (`src/flora/flora-facts-data.ts:15-685`; direct count 43, including 2
   `habit:'rock'` species). "26" survives only in stale comments
   (`flora-facts-data.ts:2`, `src/studio/gallery-studio.ts:8`,
   `src/world/entity-kinds.ts:129`). The coverage slice must read the registry, never
   a doc number — this drift is itself the argument for constraint 5.
2. **`connectome-lint` already lints an arbitrary seed file**: `--world some/path.json`
   is loaded as-is (`scripts/connectome-lint.ts:32-33`, usage :12). The lint-vs-menu
   collision is therefore smaller than framed — what's missing is only an id-based
   hook for a *code-authored* seed and an npm alias.
3. **There is no `?world=` URL param today.** Named worlds boot only via the New Game
   screen, `Game.newWorld({worldSeedName})` (`src/game.ts:3281,3300`), or the
   `new_game` bus verb (`src/game.ts:2276-2287`). All of those funnel through
   `resolvePlayableWorld`, which folds unknown ids to `'default'`
   (`playable-worlds.ts:29-36`) — so the testbed is unreachable by accident, and
   also unreachable on purpose without a new (dev-gated) entry point.
4. **`terrainShape` exists but is thinner than assumed, and no shipped world uses
   it.** `TerrainShapeSpec` supports exactly `kind: 'vale'|'knoll'|'plain'`, `axis?`,
   `strength?` (`src/terrain/terrain-shape.ts:20-34`); none of
   default/dawn/frost carries one (verified by reading all three JSONs); only
   genomes and the site/crossing-site studios use it. There is no composite
   "coast row + slope row + river row" authoring primitive.
5. **Authored rivers are real and live.** `Connection.type` includes `'river'`
   (`src/core/types.ts:263-265`); `road-graph.ts:163` maps it to a water surface
   carved along the connection's waypoints, and `default.json` ships one river
   connection (verified: 10 road + 1 river). `autoBridge` defaults ON for roads and
   OFF for rivers (`road-graph.ts:256`). This — not `terrainShape` — is the tool that
   *guarantees* a channel where the testbed needs one.
6. **Road class (and therefore generated crossing tier) is authorable via endpoint
   POIs.** `classForConnection` ranks the busier endpoint's
   `importance`/`size` into `highway|road|track|path`
   (`src/world/road-graph.ts:150-160`); class maps to a crossing tier
   (`CLASS_CROSSING_TIER = {path:2, track:3, road:5, highway:6}`,
   `src/world/road-use.ts:119`). There is **no ford/clapper tier** — 7 rungs, and
   "no affordance is not a tier" (`road-use.ts:105-111`).
7. **`tests/unit/playable-worlds.test.ts:11` pins the exact 3-world list** with
   `toEqual(['default','dawn','frost'])`. Adding the testbed to
   `PLAYABLE_WORLD_NAMES` would fail this test — which is the codebase agreeing with
   the standing rule that the shipped menu stays clean.
8. **A JSON under `public/` ships verbatim into `dist/`** (Vite copies `public/`;
   INFERRED, not verified against a dist build) — one more reason the testbed should
   be code-authored, not a JSON in `public/data/worlds/`.
9. **The "fully displayed" signal is externally observable.**
   `holdLoadingUntilArtSettled` fires `bootMark('art-settled')`
   (`src/game/boot-sequence.ts:189-193`), which emits
   `performance.mark('sg-boot:art-settled')` unconditionally
   (`src/dev/profile.ts:30-34`). A tour harness can await that mark instead of
   guessing. Capture goes through `__debug.grab()` / `grabFile()`
   (`src/dev/debug-api.ts:71,212-214,220-225`) into `.dev-grabs/` via the
   serve-only `/__grab` sink (`vite-plugins/grab-sink.ts:28-51`). There is **no
   pixel-diff baseline tooling anywhere** today (no pixelmatch / toHaveScreenshot in
   scripts/tests/tools; `scripts/vision-diff.ts` is an LLM vision compare, not a
   pixel gate).
10. **The existing Playwright e2e harness is stale w.r.t. the title screen**
    (INFERRED): `tests/e2e/utils/harness.ts:25` opens bare `/`, which since UI v3
    resolves to the title (`autostart.ts:46` returns `null`). The tour harness must
    boot via an autostart param, not `/`.
11. **Headless generation in vitest is proven**: e.g.
    `tests/integration/default-world-generation.test.ts:38-44` and
    `tests/unit/ground-holds-it.test.ts:33-37` run `planWorldLayout` +
    `generateWithNoise` on real JSONs with no WebGPU. A testbed coverage test is the
    same idiom.

### 2.3 The catalogue surface ("one of each" — the enumerable list)

Source-of-truth registries a coverage check must read (counts verified at source;
spot-checked by direct count where noted):

| Axis | Registry | Count | Where |
|---|---|---|---|
| Blueprint presets | `BUILDING_BLUEPRINTS` | 56 (20 buildings, 7 props, 4 landforms, 6 branched plants, 8 rocks, 4 stairs, 7 barriers) | `src/blueprint/presets/index.ts:160-684` |
| Catalogue building types | `MEDIEVAL_BUILDING_TYPES` | 25; **5 have no hand preset** and resolve through the generative bridge (`temple_small`, `fisherman_hut`, `tithe-barn`, `granary`, `dovecote`) | `src/catalogue/packs/medieval-europe/building-types.ts:40-270`; bridge `src/blueprint/presets/from-building-type.ts`; resolution order `presets/index.ts:734-742` |
| Vendored art | manifest | 46 entries, all with `preset`, `recipeVersion: v31` (direct count) | `public/asset-library/building-sprites/manifest.json` |
| Barrier kinds (engine) | `BarrierKind` | 6: wall/fence/palisade/rampart/barricade/hedge (direct read) | `src/world/barrier.ts:4`; defaults :106-113 |
| Barrier types (catalogue) | `MEDIEVAL_BARRIER_TYPES` | 10 | `.../medieval-europe/barrier-types.ts:27-206` |
| Crossing tiers | `CROSSING_TIER_RECIPES` | 7 rungs (log … stone-arch); recipes = 9 (`timber-trestle`, `packhorse` are recipes, not rungs) | `src/world/road-use.ts:105-126` (direct read); `src/blueprint/presets/bridges.ts:162-537` |
| Fixtures | fixture-types | 43 | `.../medieval-europe/fixture-types.ts:19-660` |
| Site types | site-types | 2 (`tavern-yard`, `wayside-shrine`) | `.../medieval-europe/site-types.ts:28-53` |
| Complex types | complex-types | 3 (`motte_and_bailey`, `ringwork`, `town_wall`) | `.../medieval-europe/complex-types.ts:32-104` |
| Flora | `FLORA_FACTS` | 43 (direct count) | `src/flora/flora-facts-data.ts:12-685` |
| POI types | `POI_TYPES` | 25 (validator set; `POI.type` is typed `string`) | `src/core/schema.ts:9-35`; influences: 23 handlers, `bridge`/`crossroads` have none (`src/terrain/poi-influence.ts:301-403`) |
| Biomes (per-tile) | `Biome` | 20 | `src/terrain/biomes.ts:9-41` |
| Seed-level biome | `BIOMES` | 7 (authored theme, distinct from per-tile) | `src/core/schema.ts:37-45` |
| NPC roles / rigs | `NpcRole` 8; rigs humanoid + sheep + goat | `src/core/types.ts:350`; `src/render/paperdoll/rig-catalog.ts:206-210` |
| Civic rules | `CIVIC_RULES` | 4: well / graveyard / mill / fishery (water-gated) | `src/world/settlement-plan.ts:629-636`; type→preset `src/world/building-placer.ts:115` |
| Site rules | `SITE_RULES` | 9 presets with siting prefs | `src/world/settlement-plan.ts:138-148` |
| Coastal landmark props | caps | sea_arch 4 / cliff_face 4 / cave_mouth 3 / hoodoo 6 | `src/world/coastal-landmarks.ts:22-26` |

POI anchoring vocabulary available to the author: `position`, `region` (regionFill
types only), `size`, `importance`, `coast: 'east'|'west'|'north'|'south'|'nearest'`
(`src/core/types.ts:211`), `summitM` (mountain/volcano/glacier only,
`src/core/schema.ts:119`), plus per-type influence behaviour (plateau/crater/cap
etc. are per-type in `poi-influence.ts:17-143`, not per-POI-authorable).

---

## 3. Resolutions to the six design constraints

### 3.1 The lint-vs-menu collision

**Resolution: the testbed is a code-authored, dev-gated world that never enters
`PLAYABLE_WORLD_NAMES`; lint reaches it through an id hook on `connectome-lint`'s
existing `--world` flag, exposed as `npm run lint:testbed`.**

Concretely:

- The seed lives in `src/world/testbed/` as code (like a genome, unlike a genome it
  has POIs — genomes' no-POI contract at `genome.ts:10` stays intact; we do not
  pollute it).
- Boot entry: a new dev-gated URL param handled exactly where `?genome` is
  (`autostart.ts:39-41` pattern): parsed only when `devTools`, producing
  `{kind:'fresh', ephemeral: true}` + a testbed marker; `Game.startFromAutostart`
  resolves it via a **dynamic import** mirroring `Game.genomeSeed`
  (`src/game.ts:2952-2960`), so the whole testbed chunk tree-shakes out of a
  distribution build the same way studios and genomes do (`vite.config.ts:39-41`,
  `src/main.ts:28,47,72`).
- `ephemeral: true` means it is never autosaved (same flag genomes use,
  `autostart.ts:41`) — no save-slot surface, no `SAVE_VERSION` interaction, and
  `copy_world_code` in a testbed session yields a code that folds back to
  `default` (`resolvePlayableWorld`), which is harmless and worth one code comment.
- Lint: `scripts/connectome-lint.ts` `resolveTargets` gains one case — the literal id
  `testbed` dynamic-imports the module and lints the returned seed (the script
  already runs under tsx and imports `src/` directly, :14-20). The **default target
  set stays `PLAYABLE_WORLD_NAMES`** — `lint:world` output is byte-identical.
  `package.json` gains `"lint:testbed": "tsx scripts/connectome-lint.ts --world testbed"`.
- The menu never sees it: `playable-worlds.ts` untouched;
  `tests/unit/playable-worlds.test.ts:11` continues to pin the 3-list and becomes the
  regression tripwire against anyone "helpfully" adding it.

Rejected alternative: a JSON in `public/data/worlds/` excluded from the registry.
It works (lint `--world path` already accepts it) but ships dead data in `dist/`
(§2.2.8), can't derive content from the registries (kills the anti-rot mechanism in
§3.5), and hand-maintained JSON with ~60+ specimen entries is exactly the kind of
artifact that rots.

### 3.2 Seed-adaptive anchoring vs deterministic layout

**Resolution: pin the gen seed, author the macro-terrain, let anchoring run, and
read positions back instead of hardcoding them.** The briefing's instinct (pin
terrain + fixed seed + legible category rows) is right in substance; two refinements
on evidence:

1. **Don't fight the anchors — exploit them at a pinned seed.** `coast:` snap,
   plateau stamping, and `snapDrySettlementsOffWater` are deterministic functions of
   (seed code, genSeed). At a pinned `TESTBED_GEN_SEED` the resolved positions are
   stable build-to-build until *worldgen code* changes — which is precisely when you
   want the testbed to re-verify and the screenshots to re-baseline. So the testbed
   is "stable", not "static": stations and tests must reference **POI ids and
   resolved positions read from the generated world** (post-`planWorldLayout`,
   post-snap), never hardcoded tile coordinates. This is the same lesson as the WCV
   123/124 waypoint bug: authored coordinates and final coordinates are different
   spaces; only the final one is the world the player sees.
2. **Accept — and label — that the world is not seed-general.** The module header
   and this plan both state it: the testbed is defined at `TESTBED_GEN_SEED` only.
   `lint:testbed` runs that one seed (unlike `lint:world`'s two). Running it at other
   seeds is allowed as an ad-hoc probe but is out of the acceptance contract —
   seed-generality is the adversarial instruments' job (§1).

Macro-terrain: `island: true` + `terrainShape: {kind:'vale', axis, strength≈0.9}`
gives, by construction (`terrain-shape.ts:52-107`): ocean ring (coast on all
sides), one topographic river corridor down the tilted trough, flat buildable
terraces on both flanks (`VALE_FLANK 0.62`), and a continuous cross-slope band
between flank and trough. On top of that, POI influences author the rest: a
`mountain` + `summitM` for the peak/snow band, coast-anchored `cliffs` for the
plateau/rim, `lake`, `forest`/`swamp` regions, `sea_stacks`/`cove`/`headland`,
`volcano`. `default.json` already proves a temperate seed hosts desert/volcano/
glacier POIs simultaneously.

Layout legibility ("a water row, a slope row, …") applies **within** that terrain:
category groupings are placed on the flats/banks the vale guarantees, not on an
abstract grid the terrain must be flattened to fit. A fully gridded world would
need `plain` everywhere and would then have no river, no coast drama, no slope —
defeating the purpose (§3.3).

### 3.3 Guaranteeing each feature its context (not hoping)

Three mechanisms, in order of strength:

1. **Construction guarantees.** The vale *is* a river+terrace+slope machine
   (§3.2); `island` *is* a coast machine. Where topographic hydrology is not
   trusted to put water exactly where a context needs it, **author the channel**: a
   `Connection.type:'river'` carves drawn water along its waypoints
   (`road-graph.ts:163,169`; live in default.json). The bridge/mill/dock/fishery
   contexts get their water by authored connection + waypoints, not by hoping the
   flow-accum river lands there. Crossings are guaranteed by authoring road
   connections whose endpoints' `size`/`importance` produce each road class
   (§2.2.6), with waypoints that force each road across the channel.
2. **Placement rules that already encode context.** `CIVIC_RULES` gates mill/fishery
   on `nearWater 3` (`settlement-plan.ts:629-636`); `SITE_RULES` prefers dock/
   tavern/temple sitings. Putting the port settlement on the shore and the mill
   village on the channel makes the existing rules do the guaranteeing.
3. **Enforcement, not inspection.** The guarantee is a **failing test**, not an
   authoring convention: WP-T3's context gate generates the testbed headlessly at
   the pinned seed and asserts each context predicate (all four `WaterType`s
   present; a River cell adjacent to Ocean; one bridge per road class with every
   deck cell over painted water — reusing `probe-bridge-decks`' classifier; a
   watermill within wheel-reach of drawn water; a dock pier over water; a wall run
   with a gate; every `POI_TYPES` value instantiated; ≥12 of 20 per-tile biomes
   present). If a future worldgen change silently removes a context, CI goes red —
   the testbed cannot quietly rot into a shed-next-to-no-river.

Fallback, pre-authorized for WP-T1 only if the vale + POIs + authored channels
cannot produce a required context at the pinned seed: extend `TerrainShapeSpec`
with one additive kind (e.g. banded testbed relief). The module's own contract
makes this safe — "Absent ⇒ behaviour is byte-identical, so live worlds never
change" (`terrain-shape.ts:13`) — but it is a fallback, not the plan: prefer
authoring within today's vocabulary, because every new dev-only terrain primitive
is surface the real game never exercises.

### 3.4 No new render path, no new worldgen path

Satisfied by construction: the testbed is a `WorldSeed` entering
`Game.startWorld` → `bootstrapWorld` → `planWorldLayout` → `generateWithNoise` →
the shipped renderer — the exact genome precedent (`genome.ts:3-8`,
`bootstrap-world.ts:139-170`). The studios already prove the render path is shared
(`main.ts:30-31`, `world-studio.ts:319`).

One deliberate exception needs stating honestly: the **specimen ground** (WP-T2)
adds a dev-gated post-generation placement pass for the ~60 registry entries that
organic settlement growth will never place all of (era-gated yurts, all 8 rock
kinds, all 43 flora, all 4 stairs…). Rules that keep it honest:

- It runs *after* `generateWithNoise`, inside the normal bootstrap flow, only for
  the testbed (a single dev-gated call — same shape as other post-gen passes).
- It must go through the **real registration APIs**: entities enter via the same
  path settlement placement uses (`World` entity registration; `World.updateEntity`
  for any mutation — the dual-index rule), and any in-place `tile.type` write calls
  `bumpTilesRev(map)` (`src/core/tile-rev.ts` rule). No parallel sprite/compose
  path exists or is added — specimens resolve art through the identical
  `pickBuildingSource` chain as every other building.
- Its purpose is render/grade/scale coverage, **not siting coverage** — specimens
  are exempt from siting believability judgments, and the specimen apron is a
  distinct, labeled region so screenshots can't be mistaken for organic townscape.

### 3.5 Enumerable, checkable coverage

**Resolution: derive, don't enumerate by hand.** The specimen ground iterates the
registries at runtime (`Object.keys(BUILDING_BLUEPRINTS)` in sorted order,
`FLORA_FACTS` ids, bridge recipe keys, barrier presets), so a newly added
catalogue entry is *automatically* placed. The coverage test (WP-T3) then closes
the loop from the other side: it generates the testbed and asserts every id in
each registry has ≥1 placed instance in the world. Two failure modes are covered:

- New entry, placement pass missed it (e.g. a new `class:` of preset the specimen
  iterator doesn't know) → coverage test fails naming the id.
- Entry placed but the pipeline dropped it (blueprint throws, placement returns
  null) → same failure.

Coverage axes and their checks:

| Axis | Instance check |
|---|---|
| 56 blueprint presets + 5 preset-less buildingTypes | entity with that preset/type exists in `World` |
| 43 flora | vegetation entity per species id (clutter species included — assert at the entity/clutter level the renderer consumes; exact mechanism is WP-T2's to pin) |
| 6 engine barrier kinds + gates + towers | a specimen run per kind, each with ≥1 gate and ≥1 tower where the kind supports them, plus the organic town wall |
| 7 crossing tiers | tiers {2,3,5,6} via authored road classes at gen (`CLASS_CROSSING_TIER`, minus `CROSSING_LAG` mechanics — exact gen-time tier is WP-T1's to verify against `GEN_BRIDGE_CLASS_TIER`, `road-use.ts:418`); tiers 0/1/4 covered as specimen `bridge-*` presets over an authored channel segment. All 9 bridge recipes appear as specimens. |
| 25 POI types | every `POI_TYPES` value has a POI in the seed (static assert on the seed, plus post-gen existence where a handler exists) |
| Biomes | ≥12 of 20 per-tile biomes present (all 20 is not honestly reachable in one small world — ice+tropical+desert+volcanic coexist via POI stamps, but a few (e.g. `sacred_grove`) may need a dedicated POI; WP-T1 maximizes and the test pins the achieved set exactly so regressions are loud) |
| Fixtures/sites/complexes | the 2 site types + ≥1 complex (`town_wall` on the city; `motte_and_bailey` if the placer supports it organically — else complexes join the specimen ground) — fixtures render indoors/at-site and are **partially deferred**: the 43 fixture types are covered only insofar as placed buildings/sites expand them; a dedicated fixture row is out of scope v1 (INFERRED that most have no exterior render today) |
| NPC roles / animals | seed `npcs:` rosters cover all 8 roles; a garrison (marching soldiers) and a sheep+goat flock present |

The **test is the definition of done** — "one of each" means "the coverage test
enumerates the registry and passes", not "someone once placed one".

### 3.6 Visual verification

**In scope (v1): a scripted screenshot tour producing a stable, human-reviewable
set. Out of scope (deferred): automated pixel-diff baselines.**

- Capture per house rules: `__debug.grabFile(name)` → `.dev-grabs/` via the
  `/__grab` sink (`debug-api.ts:220-225`, `grab-sink.ts:28-51`); never
  `page.screenshot` (stalls headed — `debug-api.ts:12-13`). Framing: zoom ≈ 1,
  centred on the target tile via `Game.flyTo` (which projects through iso
  `worldToScreen` — the camera-space gotcha is already handled inside it).
- Boot determinism: `?solarhour=10` pins the light; the tour waits for
  `performance.mark('sg-boot:art-settled')` (§2.2.9) with **no wall-clock cap**
  (the art-settle rule), then sets sim rate 0 before framing (resume is not needed
  for stills; note the flyTo-freezes-when-paused gotcha — fly first or use the
  instant camera set, WP-T4's call).
- Stations are data (`TESTBED_STATIONS`): one per context (mill-at-water, each
  bridge class, gate-in-wall, terrace band, port/dock, coastal landmarks, night
  variant of the town for emissives) plus a sweep of the specimen apron rows.
  Station targets are POI ids / named specimen rows resolved at runtime (§3.2.1).
- Output: `.dev-grabs/testbed/<station>.png` + the existing `npm run gallery`
  index (`scripts/dev-gallery.ts`) for one-page eyeballing. The acceptance judge
  for "looks right" is the user, per standing preference (eyeball live).
- **Pixel-diff is deferred, deliberately.** No diff infra exists (§2.2.9), renders
  contain animated water/vegetation/NPCs, and a tolerance chosen carelessly is a
  convenient-metric trap (three bridge rounds shipped green against a proxy).
  Prerequisites for a later slice: rate-0 + pinned solar hour verified
  byte-stable across two boots on one machine; a masking story for animated
  regions; an agreed per-station tolerance. Until then the tour's contract is
  *presence + human review*, and it must say so in its header.

---

## 4. Slices

**Concurrency verdict:** the briefing's instinct is confirmed — this decomposes
far better than the urban-form epic. WP-T1 (terrain/POIs), WP-T2 (specimen pass),
WP-T3 (gates), WP-T4 (tour) own disjoint files; the interface between them is
pinned *here* (module contract below) so all four can be developed concurrently,
with a short serial integration at the end. The genuinely serial parts are (a) the
interface contract — resolved by this plan, (b) final acceptance runs, which need
T1+T2 merged before T3/T4 can go green, and (c) a possible one-export touch on
`building-placer.ts` (a file other epics serialise on).

**Module contract (all slices code against this; changing it requires touching the
consumers in the same commit):**

```
src/world/testbed/testbed-world.ts
  export const TESTBED_WORLD_ID = 'testbed'
  export const TESTBED_GEN_SEED = 12345          // matches lint/probe default
  export function testbedSeed(): WorldSeed        // POIs incl. specimen-apron
                                                  // region POI id 'specimen_apron'
src/world/testbed/specimens.ts
  export function placeSpecimens(map, world): void   // registry-derived; idempotent;
                                                     // exact param types WP-T2's to
                                                     // finalize against bootstrap's
                                                     // post-gen call site
src/world/testbed/stations.ts
  export const TESTBED_STATIONS: ReadonlyArray<{ id: string;
    target: { poi: string } | { specimenRow: string }; zoom?: number; hour?: number }>
```

Isolation rule (hard-won 2026-08-10): **any slice that measures runs its
measurement in an isolated tree** (worktree or `git archive HEAD` export) — two
agents with disjoint file ownership still corrupt each other's baselines when one
measures against the other's half-applied edits. Additionally, other live sessions
share the main checkout — all slice work happens in worktrees.

---

### WP-T1 — The testbed seed and boot entry

- **Files owned:** `src/world/testbed/testbed-world.ts` (new),
  `src/game/autostart.ts`, `src/game.ts` (one branch in
  `startFromAutostart`/`startWorld`, mirroring `genomeSeed` at :2952-2960),
  `src/game/bootstrap-world.ts` (one dev-gated post-gen call invoking
  `placeSpecimens` — the *call site* is T1's, the callee is T2's),
  `tests/unit/autostart.test.ts` (extend). ⚠ Serialization: `game.ts` and
  `bootstrap-world.ts` are high-traffic files — keep the diff surgical; no other
  testbed slice touches them.
- **Dependencies:** none. Runs first / concurrently with all others.
- **Work-package brief (self-contained):**
  You are adding a dev-only "testbed" world to the Small Gods repo
  (`/Users/Morten/mcpui/small-gods-game`; read `CLAUDE.md` first). It is a
  code-authored `WorldSeed` (like `src/world/genome.ts` but WITH POIs — do not
  touch genome.ts or its no-POI contract) whose purpose is in-situ integration
  coverage: every terrain context the catalogue's features need, in one small
  world at one pinned gen seed. Create `src/world/testbed/testbed-world.ts`
  exporting `TESTBED_WORLD_ID`, `TESTBED_GEN_SEED = 12345`, and
  `testbedSeed(): WorldSeed`. Seed shape: `island: true`,
  `terrainShape: {kind:'vale', strength≈0.9}` (see
  `src/terrain/terrain-shape.ts`), size chosen so headless generation stays under
  ~60s in vitest (start ≈ 140×100; `default.json` is 230×163 for scale). Author:
  one POI for **every** value in `POI_TYPES` (`src/core/schema.ts:9-35`) using the
  anchoring vocabulary (`coast:`, `summitM`, `region`, `size`, `importance` —
  `src/core/types.ts:191-251`); settlements sited so existing rules guarantee
  water features (mill/fishery need `nearWater 3`, `settlement-plan.ts:629-636`;
  dock via `SITE_RULES` :138-148); a walled city (gate-in-wall context); an
  authored river `Connection` (`type:'river'` — see the one in
  `public/data/worlds/default.json` and `road-graph.ts:163,256`) carving a channel
  from the lake to the coast; four road connections crossing it whose endpoint
  `size`/`importance` yield one crossing per road class
  (`classForConnection`, `road-graph.ts:150-160`; verify the generated tier per
  class against `GEN_BRIDGE_CLASS_TIER`, `road-use.ts:418`); NPC rosters covering
  all 8 `NpcRole`s; a garrison and sheep/goats; and a flat `plains`-type region
  POI with id `specimen_apron` on a vale flank, clear of settlements, reserved for
  WP-T2. Boot entry: extend `resolveAutostart` (`src/game/autostart.ts`) with a
  dev-gated param (suggest `?world=testbed`; first grep that `world` is an unused
  param name) returning a fresh + ephemeral autostart, and add the resolution
  branch in `src/game.ts` via dynamic import (copy the `genomeSeed` pattern
  exactly so the chunk tree-shakes from distribution builds). Add the dev-gated
  post-gen call site in `bootstrap-world.ts` invoking
  `placeSpecimens(map, world)` from `src/world/testbed/specimens.ts` (create a
  temporary no-op stub for that file if WP-T2 has not landed; WP-T2 owns its
  contents). Author-time loop: iterate with
  `npx tsx -e 'import {testbedSeed} from "./src/world/testbed/testbed-world"; console.log(JSON.stringify(testbedSeed()))' > /tmp/testbed.json`
  then `npx tsx scripts/probe-world.ts` / `scripts/connectome-lint.ts --world /tmp/testbed.json`
  and `scripts/probe-bridge-decks.ts` until the acceptance predicates hold.
  Do NOT add the world to `PLAYABLE_WORLD_NAMES` (`tests/unit/playable-worlds.test.ts:11`
  must keep passing untouched). Do NOT bump any version constant. The world is
  ephemeral (never autosaved). `npm run lint` stays zero; `npx tsc --noEmit`
  clean. Work in a worktree; measure in an isolated tree.
- **Version impact:** none. No `WORLD_CONTENT_VERSION` bump (additive, dev-gated;
  existing worlds' generation untouched — the autostart/game diffs are pure
  additions), no `ART_RECIPE_VERSION`, `tests/unit/content-version.test.ts`
  untouched.
- **Acceptance criterion (end-state, measured on the generated world at
  `TESTBED_GEN_SEED`, in an isolated tree):** all of — (a) all four `WaterType`s
  present and ≥1 River cell adjacent to Ocean; (b) `probe-bridge-decks.ts` on the
  testbed reports every bridged cell over water the player sees and 0 dry/off-bank
  decks; (c) four road-over-channel crossings with four distinct generated tiers;
  (d) a wall run with ≥1 gate and ≥1 tower on the city; (e) a watermill and a
  fishery placed with their water affordance satisfied (mill-site/fishery-site
  stores non-empty); (f) a dock placed with pier cells over water; (g) every
  `POI_TYPES` value present in the laid-out seed; (h)
  `connectome-lint --world <exported json>` reports 0 errors / 0 unmet at the
  pinned seed; (i) `?world=testbed` boots to the running world in a dev browser
  and a plain `vite build` succeeds with no testbed chunk (verify via build output
  grep). Screenshots are NOT this slice's acceptance — the world existing
  correctly is.
- **Model tier: opus** — terrain/POI authoring is an iterative design loop against
  probes, the highest-judgment work in the epic.

### WP-T2 — Specimen ground (registry-derived one-of-each)

- **Files owned:** `src/world/testbed/specimens.ts` (new; replaces T1's stub),
  possibly ONE export-only diff in `src/world/building-placer.ts` if the real
  placement/registration internals aren't reachable (⚠ serialization point: other
  epics (urban form WP-6…9) serialise on this file — the orchestrator schedules
  this touch as a standalone tiny commit, coordinated, or T2 finds an already-
  exported path and touches nothing).
- **Dependencies:** interface-only on T1 (apron region id, call-site signature —
  both pinned in the module contract). Can be developed fully in parallel against
  any flat world (`?genome=grass-island`) and integrated when T1 lands.
- **Work-package brief (self-contained):**
  In `/Users/Morten/mcpui/small-gods-game` (read `CLAUDE.md` first), implement
  `placeSpecimens(map, world)` in `src/world/testbed/specimens.ts`: a
  deterministic, registry-derived post-generation pass that places one specimen of
  every renderable catalogue entry on the testbed's `specimen_apron` region (a
  flat reserved region POI authored by WP-T1; resolve its rect from the world's
  laid-out POIs at runtime, never hardcode coordinates). Rows, in sorted-key
  order for stability: (1) every `BUILDING_BLUEPRINTS` key
  (`src/blueprint/presets/index.ts:160`) except `bridge-*`; (2) the 5 preset-less
  `MEDIEVAL_BUILDING_TYPES` (they resolve through the generative bridge,
  `presets/index.ts:734-742`); (3) every `FLORA_FACTS` species id
  (`src/flora/flora-facts-data.ts`; clutter species per their real render path —
  check `isClutterFloraKind`, `src/flora/flora-registry.ts:96`); (4) one short
  barrier run per `BarrierKind` (`src/world/barrier.ts:4`), each with a gate, and
  a tower where the kind supports it; (5) the 9 `BRIDGE_RECIPES` as `bridge-*`
  presets spanning a short authored wet segment inside the apron (coordinate the
  wet strip with WP-T1 if the apron needs one — else place them over the main
  channel's specimen reach); (6) the 4 stair presets on a graded bank edge.
  HARD RULES: derive every row from the registry at runtime (a new registry entry
  must appear with zero edits here); use the SAME registration path organic
  placement uses — find how `building-placer.ts` registers building entities and
  reuse it (add a minimal export if needed, nothing more); never mutate entity
  x/y/kind/tags except through `World.updateEntity()`; any in-place `tile.type`
  write must call `bumpTilesRev(map)` (`src/core/tile-rev.ts`); no `Math.random`
  anywhere near sim state (grid layout needs no rng — keep it rng-free); the pass
  must be idempotent and run only for the testbed (the call site is dev-gated by
  WP-T1). Purpose is render/grade/scale coverage, not siting — say so in the
  header, and state that a green testbed is never evidence for a siting fix.
  `npm run lint` zero; `npx tsc --noEmit` clean. Work in a worktree.
- **Version impact:** none (dev-gated, testbed-only execution; no shared-path
  behaviour change). If a `building-placer.ts` export is added, confirm
  `lint:world` output at base is unchanged (export-only diffs must be).
- **Acceptance criterion:** headless generation of the testbed at
  `TESTBED_GEN_SEED` (isolated tree) yields ≥1 placed instance for EVERY id in:
  `BUILDING_BLUEPRINTS` (56), the 5 preset-less buildingTypes, `FLORA_FACTS`
  (43), all 6 `BarrierKind`s with gates, all 9 bridge recipes, all 4 stairs —
  verified by scanning the resulting `World`/stores, with zero placement errors
  logged; no specimen entity sits on water unless its row is the wet row; run
  twice → identical specimen positions.
- **Model tier: opus** — the placement-API reuse judgment (reuse vs. minimal
  export, entity registration correctness, tile-rev discipline) is where a
  mechanical agent would silently fork a parallel path.

### WP-T3 — Coverage, context and lint gates

- **Files owned:** `tests/unit/testbed-coverage.test.ts` (new),
  `tests/integration/testbed-context.test.ts` (new),
  `scripts/connectome-lint.ts` (the `testbed` id hook in `resolveTargets` only),
  `package.json` (`lint:testbed` script only). No other slice touches these.
- **Dependencies:** interface-only on T1/T2 (imports `testbedSeed`,
  `TESTBED_GEN_SEED`; predicates from §3.3/§3.5). Tests can be written test-first
  in parallel and will go green at integration.
- **Work-package brief (self-contained):**
  In `/Users/Morten/mcpui/small-gods-game` (read `CLAUDE.md` first), build the
  testbed's enforcement gates. (1) `tests/unit/testbed-coverage.test.ts`: generate
  the testbed headlessly ONCE per file (the existing idiom —
  `tests/integration/default-world-generation.test.ts:38-44`: `testbedSeed()` →
  `planWorldLayout` → deep-clone POIs → `generateWithNoise(…, TESTBED_GEN_SEED)`),
  then assert registry coverage: every id in `BUILDING_BLUEPRINTS`, the
  preset-less `MEDIEVAL_BUILDING_TYPES`, `FLORA_FACTS`, `BarrierKind`, bridge
  recipes, and stairs has ≥1 instance (WP-T2's placement contract). The failure
  message must NAME the missing ids. Prove the test can fail (temporarily add a
  fake registry entry locally; do not commit it) and note that in a comment.
  (2) `tests/integration/testbed-context.test.ts`: the context predicates from
  the plan §3.3 — four `WaterType`s; river-mouth adjacency; one bridge per road
  class, every deck cell over painted water (reuse `probe-bridge-decks`'
  classifier logic — import, don't copy); mill/fishery affordances satisfied;
  dock pier over water; wall+gate+tower present; every `POI_TYPES` value
  instantiated; the achieved per-tile biome set pinned exactly (with a comment
  that widening it is good and shrinking it is a regression). Every assertion is
  about the observable end state of the generated world — no proxy counts.
  (3) `scripts/connectome-lint.ts`: in `resolveTargets`, make the literal id
  `testbed` resolve by dynamic-importing `src/world/testbed/testbed-world.ts` and
  linting the returned seed at `TESTBED_GEN_SEED` (default targets and all other
  behaviour byte-identical — `npm run lint:world` output must not change).
  (4) `package.json`: add `"lint:testbed": "tsx scripts/connectome-lint.ts --world testbed"`.
  Budget: the two test files together must stay under ~120s locally. `npm run
  lint` zero; `npx tsc --noEmit` clean. Work in a worktree; run acceptance in an
  isolated tree AFTER T1+T2 are merged (before that, your tests are expected
  red — that is the point of test-first).
- **Version impact:** none. `tests/unit/content-version.test.ts` untouched.
- **Acceptance criterion:** on the integrated tree — `npm run lint:testbed` exits
  0 with **0 errors / 0 unmet requirements**; both new test files pass under
  `npx vitest run`; `npm run lint:world` output at base is byte-identical to
  pre-change (diff the two runs); the coverage test demonstrably fails (with the
  id named) when a registry entry has no instance.
- **Model tier: sonnet** — predicates and wiring are fully specified above;
  the work is mechanical translation.

### WP-T4 — Visual tour harness

- **Files owned:** `scripts/testbed-tour.ts` (new),
  `src/world/testbed/stations.ts` (new). No other slice touches these.
- **Dependencies:** interface-only on T1 (POI ids for station targets; boot
  param). Needs T1 merged to *run*; can be written in parallel against the
  module contract and smoke-tested on `?genome=grass-island` with a dummy
  station list.
- **Work-package brief (self-contained):**
  In `/Users/Morten/mcpui/small-gods-game` (read `CLAUDE.md` first), build the
  screenshot tour for the dev-only testbed world. (1)
  `src/world/testbed/stations.ts`: export `TESTBED_STATIONS` (shape in the plan's
  module contract) — one station per context (mill-at-water, each of the four
  bridge classes, gate-in-wall, terrace/slope band, port+dock, coastal landmarks
  row, the walled city, one `hour: 22` night variant of the city for window
  emissives) plus one station per specimen row. Targets are POI ids / row names,
  never tile coordinates. (2) `scripts/testbed-tour.ts` (tsx + playwright —
  `playwright` is already a dependency; model the boot handling on
  `scripts/e2e-smoke.mjs` but note the title-screen change: you MUST navigate to
  `http://localhost:3000/?world=testbed&solarhour=10`, never bare `/`). Flow:
  assume the dev server is running on :3000 (start it if not); navigate; wait for
  `performance.getEntriesByName('sg-boot:art-settled').length > 0` in-page with
  NO wall-clock cap (the loader-holds-until-fully-displayed rule — set the
  playwright timeout generous, e.g. 10 min, and fail loudly on timeout rather
  than capturing early); set sim rate 0 through the real command path (the meta/
  bus verb the pause menu uses — find it in `src/game.ts`'s `handleMetaCommand` /
  the capability registry; do NOT poke private fields); for each station: resolve
  the target POI's FINAL position from the live world (`window.__game` query —
  positions post-snap, never authored coords), frame at zoom ≈ 1 centred on the
  tile via the game's own fly/centre API (mind the paused-flyTo gotcha: set the
  camera before or use the instant path), settle one frame, then
  `await window.__debug.grabFile('testbed-' + station.id)` (house rule: grab(),
  never `page.screenshot` — `src/dev/debug-api.ts:12-13`); for the night station
  re-navigate with `&solarhour=22`. Output lands in `.dev-grabs/` via the
  `/__grab` sink; finish by running the gallery index build
  (`scripts/dev-gallery.ts`) so `.dev-grabs/index.html` shows the set. The
  script's header must state: output is for HUMAN review; there is no pixel-diff
  baseline, deliberately (plan §3.6); and a green tour is never evidence for a
  siting fix. `npm run lint` zero; `npx tsc --noEmit` clean.
- **Version impact:** none.
- **Acceptance criterion:** on the integrated tree with the dev server up, one
  command (`npx tsx scripts/testbed-tour.ts`) produces one PNG per station in
  `.dev-grabs/` — every file non-empty and non-uniform (assert size > 20 KB and
  ≥2 distinct pixel values via a trivial decode check in the script), every
  capture taken strictly after the art-settled mark, station count == 
  `TESTBED_STATIONS.length`, and the gallery index lists them all. Running the
  tour twice produces the same station set (byte-identical images NOT required).
- **Model tier: sonnet** — the mechanics are fully specified; the judgment calls
  (framing, boot signal) are pre-made above.

### WP-T5 — Integration and human acceptance (serial, last)

- **Files owned:** none new (merge + fixups only, plus `docs/ROADMAP.md` entry for
  the shipped instrument — one line, per the single-forward-plan rule).
- **Dependencies:** T1–T4 merged.
- **Brief:** merge the four slices onto a fresh branch off `main`; run the full
  gate in an isolated tree: `npm run lint` (zero), `npx tsc --noEmit`, the full
  suite via `./scripts/ci-on-server.sh` (grep `✓ Server CI passed` BEFORE any
  push; measure pre-existing fails at base first; a suite whose run window
  overlaps edits is void), `npm run lint:testbed` (0/0), `npm run lint:world`
  (byte-identical to base), a `vite build` with a grep proving no testbed chunk
  ships, and the tour. Then hand the `.dev-grabs/index.html` set to the user for
  the eyeball pass — the user is the acceptance judge for "looks right".
- **Acceptance criterion:** all gates above green + explicit user sign-off on the
  screenshot set. Push to `main` only after CI green (standing rule).
- **Model tier: sonnet** — checklist execution.

**Dependency graph:** T1 ∥ T2 ∥ T3 ∥ T4 (development, against the pinned module
contract) → T5 (integration, serial). True file overlaps: none between slices
except (a) T1 creates a no-op `specimens.ts` stub that T2 replaces — T2 rebases
over T1, trivial; (b) the possible one-export `building-placer.ts` touch in T2,
which the orchestrator serialises against other epics' work on that file. If the
orchestrator prefers lower coordination risk over wall-clock, run T1 → (T2 ∥ T3 ∥
T4) → T5; the contract-first parallel schedule is sound but assumes implementers
respect the module contract verbatim.

---

## 5. Honest unknowns

1. **`GEN_BRIDGE_CLASS_TIER` values** (`road-use.ts:418`) were located but not
   read; the exact tier each road class gets *at generation* (vs. the earned
   ceiling `CLASS_CROSSING_TIER − CROSSING_LAG`) is unverified. WP-T1 must verify
   empirically which tiers appear at gen and adjust the split between organic
   crossings and specimen `bridge-*` rows. Tiers 0–1 may be unreachable
   organically at gen time — the specimen row is the designed backstop.
2. **The building-placement registration API surface.** Whether `placeSpecimens`
   can reuse an already-exported placement function or needs a minimal new export
   from `building-placer.ts` is unknown until WP-T2 reads that file
   (`building-placer.ts:115` is the civic map; the entity-registration internals
   were not enumerated). This is the plan's largest integration risk and why T2
   is opus-tier.
3. **Clutter flora coverage semantics.** Herb/grass/fern species render as clutter
   billboards, not entities (`flora-registry.ts:96`) — what "one placed instance"
   means for them (entity? clutter-field entry?) is WP-T2/T3's to pin against the
   real render input. The coverage test must assert whatever the renderer
   actually consumes.
4. **Fixture-type coverage is partial by design** (§3.5 table): 43 fixture types
   exist but most express indoors or at site-expansion; v1 covers only what
   placed buildings/sites expand. A dedicated fixture instrument (interior
   views?) is out of scope and unplanned.
5. **Biome ceiling.** Whether all 20 per-tile biomes (notably `sacred_grove`,
   `tundra`+`tropical_forest` coexistence) are reachable in one ~140×100 island
   is unknown; the context test pins the achieved set rather than asserting 20.
6. **`?world` param name collision** — believed free (autostart reads
   genseed/genome/bridge/autostart; main reads studio; bootstrap reads
   genseed/genome/solarhour) but not exhaustively grepped; WP-T1 greps before
   claiming it.
7. **Headless gen cost of the testbed** (size vs. the ~60s test budget) is an
   estimate from `default.json`-based tests; WP-T1 sizes empirically and may
   shrink the world or split the specimen apron scan into the integration suite.
8. **Sim-side behaviour of specimens** (do 60 ownerless buildings perturb the
   settlement economy / perception systems in ways that make the testbed *behave*
   oddly over long sessions?) — unexamined. The testbed is a visual instrument
   run for minutes, ephemeral, never saved; if long-run sim oddities matter later,
   that is a new requirement, not this epic.
9. **`dawn`/`frost` gen-time coverage** — this plan verified their JSON shape
   (14 POIs each, no terrainShape) but nothing about what they place; nothing in
   the plan depends on them.
