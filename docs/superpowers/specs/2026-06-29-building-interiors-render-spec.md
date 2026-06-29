# Building interiors — implementation spec (the foundational epic's interior layer)

**Date:** 2026-06-29 · **Status:** spec (promotes the shrine-procession *brainstorm*
[2026-06-16] + the layered-connectome interior follow-ons to a buildable plan) · **Builds on:**
[layered-connectome-expression](2026-06-28-layered-connectome-expression-design.md),
[shrine-procession brainstorm](2026-06-16-shrine-procession-connectome-design.md).

## Why this exists

The layered-connectome foundational epic's **entire above-ground surface is shipped** (L1
structure, L2a/L2b form+footprint variety, L3a fabric, L3b bay-aware openings + stone
undercroft; E3 temple→generative + axis-mundi spire + threshold stoup; E0–E4 establishments +
settlement scaling + fill fix — ART v16→v22, WORLD 33→40). The **three remaining tracks all
reduce to one missing capability:**

| Track | What it needs |
|---|---|
| **L3b walkable cellars** (`level:-1` rooms) | interior floor + below-grade volume + a way to see in |
| **E3 Law 2 — Funnel** (narrowing/darkening) | ordered-path zone ramps (`width↓`,`light↓`,`floorZ↓`) made visible |
| **E3 Law 4 — Controlled Contact** (screens/grilles) | permeable/stateful portals made visible |

The iso renderer has **only ever drawn buildings as opaque exterior masses** — there is no
floor/room geometry and no way to look inside. This is an atomic subsystem: floor geometry is
invisible without a reveal, a reveal is empty without floor geometry. Hence a dedicated spec.

The connectome zones/portals are **already attached** to every resolved blueprint
(`attachConnectome`, non-enumerable so the art-cache key is unchanged) — the interior data
exists; only its projection-to-geometry and its reveal are missing.

## Paradigm decision (the gating choice)

**In-world roof-fade-on-focus, backed by ONE cutaway geometry variant.** Rationale:

- A *floor-plan inspector overlay* is rejected for the shipped game: it conflicts with the
  standing "keep the shipped game clean of dev overlays — dev viz lives in the studios"
  preference, and it's a weaker, non-diegetic interpretation. (It MAY appear in the Object
  studio as an inspection aid — same cutaway geometry, different consumer.)
- *Roof removal / fade* is diegetic and god-game-appropriate (focus a building → its roof
  fades → you see the rooms within), and it's the only reveal that makes the procession's
  funnel/contact and the cellar legible in-world.
- One **cutaway geometry variant** (roof omitted + interior floor slab + partition walls +
  sub-grade cellar volume) is the shared foundation for BOTH the game reveal and the studio
  inspector — build it once.

## Slices

**I-1 — Cutaway geometry variant (foundation, independently verifiable as a sprite).**
- `buildingFacets` gains a `cutaway` option: omit the roof facets; add a floor slab at z=0
  and (later) interior partition walls. New resolveAsset variant axis `view:'cutaway'` (mirrors
  the `stage` axis) → a `cutawayPatch` body param `roof:'none'` + `interior:true`.
- Project the connectome zones → partition walls: lay zones out within the footprint by
  `bays` (linear) / `level` (vertical-stack), emit thin wall prims on the shared edges; a
  `level:-1` zone drops the floor (the cellar volume). Reuse the `prim`/box machinery.
- Verify: `composeStructure(toGeometry(cutawayRb))` differs from the normal sprite (no roof,
  has floor+partitions); golden-pin one. NO render-path change yet → zero risk to the game.

**I-2 — The reveal (makes I-1 visible in-world). ✅ SHIPPED.**
- The SELECTED building (`state.selectedBuildingId`, the existing click-to-select) requests the
  cutaway view. Implementation chosen: a `cutawayOf(rb)` deriving a cutaway-patched clone of the
  resolved blueprint (`src/blueprint/cutaway.ts`); `ParametricBuildingSource.peek/warm(e, cutaway)`
  caches it under the patched blueprint's distinct JSON key; `render-context.ts` resolves the
  focused building cutaway (and forces the asset/img2img sources to null so the parametric cutaway
  wins via `pickBuildingSource`); `drawCacheKey` folds in `cutawayBuildingId` so a focus rebuilds
  the static draw layer. (Not a roof-fade alpha ramp — the sprite isn't split into layers; the
  whole-pack swap is simpler and the cutaway geometry already exists from I-1.)
- **Gated behind `?interiorReveal`/`?i2`, OFF by default** — with the flag off, `cutawayBuildingId`
  is always null, the draw-cache key is unchanged, and the render is byte-identical to before.
- Verified live (`__debug.grabFile`): focusing a cottage removes its roof and exposes the floor
  slab + walls while neighbours keep their roofs. First focus may flash the flat-block fallback
  until the cutaway pack composes (same progressive-texturing path buildings already use), then
  `onWarm` rebuilds to the cutaway.

**I-3 — Interior rooms + E3 Funnel (Law 2). ✅ SHIPPED (flag-gated).** Two findings reshaped
this slice from the original plan:
- **Buildings are SOLID massing, not hollow shells.** `buildingFacets` unions full-footprint
  storey boxes; the I-1 cutaway just lopped the roof off a solid block, so any partition/floor
  at z=0 was buried in solid rock + invisible. The cutaway now **hollows** the massing
  (`wallSolid.subtract(insetCavity)`) into a wall shell AND **cuts the camera-facing walls**
  (+x east / +y south — the iso camera sits at (1,1,1)) down to a sill, a dollhouse view you
  can see into. This is confined to the `if (cutaway)` branch, so the closed path + assetgen
  golden are byte-identical (verified).
- **The connectome is LOST on autosave reload** (it's attached NON-ENUMERABLY, so JSON
  serialization strips it). So `interiorPlan(rb)` returns undefined for save-rehydrated
  buildings and the cutaway degrades to a single open room — interiors only show on freshly
  generated worlds until a re-derive-on-load (see follow-ups). `cutawayOf` was also fixed to
  re-attach the connectome to its clone (the `{...rb}` spread dropped it).

What shipped: `src/blueprint/interior.ts` `interiorPlan(rb)` projects the connectome ROOMS
(ground-floor spine, off-spine aisles/porches excluded) into `{partitions, floorDrop}` — bay-
proportioned partition fractions + a monotonic floor sink toward the sanctum for worship
processions (the funnel). `cutawayOf` bakes it into the body `interior` param; it flows
body→compose→`buildingFacets`, which emits per-segment (sunken) floor slabs + partition walls
in the hollow cavity. Verified live (manor → divided rooms; church/temple → funnel sink).
Still flag-gated `?i2`, render-only (no version bump — parametric cutaway packs are in-memory).

**Connectome persistence ✅ (follow-up shipped).** The connectome is now persisted as an
enumerable sibling on `StoredBlueprint` (still outside `canonicalJson(rb)`, so no art-cache
impact) and re-attached to `rb` non-enumerably by `blueprintOf` on access — so a save/load
(snapshot `structuredClone`, which drops non-enumerable props just like JSON) no longer loses
it, and reloaded worlds keep their interiors.

**I-5 — Vertical storeys + cellars (the stacked-storey half of I-3 + L3b). ✅ SHIPPED
(flag-gated, render-only).** I-3 only laid out the LEVEL-0 horizontal spine; a multi-storey
building (tower, keep) cut away as one tall hollow shell with no floor plates. `interiorPlan` now
also returns `levels` — the distinct non-ground zone levels — and `buildingFacets` draws a floor
slab per level (`z = level × storeyHeight`), so a tower/keep reads as stacked rooms. A NEGATIVE
level is a below-grade cellar: the cutaway's cavity + near-wall cuts dig down to `level ×
storeyHeight` to expose it (`cellarZ`/`cavBot`/`cutBot`; `cellarZ = 0` ⇒ bytes match I-3 for
ground-only buildings). Verified live: keep → 4 stacked storeys; tower → 3; a manor with an
injected `level:-1` zone → a sunken cellar plate dug below the footprint. This makes **L3b
walkable cellars render-ready** — the geometry + plan handle `level:-1` and a test pins it — so
the only thing left for cellars is the *content* hookup (assigning a preset a `level:-1` crypt/
cellar zone), which is a worldgen change (WORLD_CONTENT_VERSION + golden re-pin + exterior-
regression risk) and belongs in its own deliberate slice, NOT this render epic. Confined to the
`if (cutaway)` branch → closed-path golden byte-identical; no version bump.

**I-6 — Cellar CONTENT hookup (L3b, generative). ✅ SHIPPED.** I-5 made cellars render-ready;
I-6 gives real presets one. A buildingType now declares its cellar via a `cellar?: string` field
(the roomType id to sink below grade, like the existing `undercroft?: boolean`); a new content-
pure pass `deriveCellar` (`src/blueprint/connectome/cellar.ts`, mirroring `deriveSmokeEgress`)
adds that room at `level:-1` under the deepest worship zone — gated on `structure.flue` (only a
masonry frame can sink a stone vault) and wired by a stair portal reusing an interior portal type
already in the graph (no content id in the engine). `parish-church` + `temple_small` (stone)
declare `cellar:'crypt'` and a new `crypt` roomType was added to the pack. The pass runs LAST in
`expressBuilding` (after every massing/opening/vent/cap pass has read the connectome), so a
below-grade zone provably can't perturb the exterior — confirmed: `blueprint-golden-regression`
(parish-church/temple_small) + the assetgen golden stay byte-stable, no `ART_RECIPE_VERSION` /
`WORLD_CONTENT_VERSION` bump (a stale save just shows a crypt-less cutaway until regenerated).
Verified live: the parish-church cutaway now shows the rood screen (I-4) AND a sub-grade crypt
plate beneath the chancel, from real content (no test injection). Crypt depth capped to a plain
storey (I-5's `subH`) so a lofty 4.5 m nave doesn't dig a pit.

**Deferred:** `width↓` nave narrowing (needs interior screen walls — overlaps Law 4); interior
lighting/darkening; a real in-game CONSUMER for the reveal (it is still `?i2`-gated OFF, with no
gameplay entry point).

**I-4 — E3 Controlled Contact (Law 4): permeable screen. ✅ SHIPPED (flag-gated, render-only).**
The chancel screen now reads in the cutaway. Implementation note: the rood screen is modelled in
the catalogue as a *fixture* (`fixture-types.ts` `rood-screen`, `satisfies:['chancel-division']`),
but the building grammar only places a hearth — no screen fixture is generated — so rather than a
stateful `Portal`, I-4 **infers** the permeable threshold in `interiorPlan`: the partition that
crosses INTO a SANCTUM room (nave→chancel) of a worship procession is flagged `screens[i]=true`.
`buildingFacets` renders those partitions as a pierced/latticed rood SCREEN — a low solid dado +
slender balusters with see-through gaps + a head beam (the loft) — instead of a solid cross-wall.
Verified live (`scripts`-rendered cutaway): parish-church shows the lattice between nave and
chancel; the manor's room partitions stay solid (no worship procession ⇒ no screen). Confined to
the `if (cutaway)` branch → closed-path assetgen golden byte-identical (no `ART_RECIPE_VERSION`
bump; the cutaway packs are in-memory parametric, never persisted to the art cache). The stateful
contact anchor + wear accumulator stay deferred (no gameplay consumer yet).

## Risk / sequencing notes

- I-1 is pure geometry (verifiable as a sprite, no game-render change) — safe to land first.
- I-2 is the only render-path-touching slice; gate it behind the focus interaction and a flag,
  verify visually before default-on.
- Each slice keeps the per-slice discipline: tsc + targeted tests + full-suite gate + a live
  `__debug.grab` visual, branch off `main`, `--no-ff`, push only on green build.
- Versions: I-1 bumped `ART_RECIPE_VERSION` (it touched the geometry foundation). I-2/I-3/I-4
  turned out render-only — no bump — because the interior geometry is confined to the
  `if (cutaway)` branch (closed-path golden byte-identical) and the cutaway packs are in-memory
  parametric, never persisted to the IDB art cache. No `WORLD_CONTENT_VERSION` bump (the cutaway
  is a render variant, not a worldgen/placement change).

This is the buildable plan for the foundational epic's interior layer; start at I-1.
