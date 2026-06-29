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

**I-3 — E3 Funnel (Law 2): ordered-path ramps.** Add the ordered-path-with-attribute-ramps
connectome primitive; project `width↓`/`floorZ↓` into the cutaway partition spacing + floor
steps so the nave visibly narrows + the sanctum sinks. Funnel interior reads in the cutaway.

**I-4 — E3 Controlled Contact (Law 4): permeable portals.** Permeable/stateful `Portal`
(screen/grille/fenestella) → a pierced/latticed partition prim in the cutaway, with a contact
anchor (wear accumulator deferred). The chancel screen reads in the cutaway.

## Risk / sequencing notes

- I-1 is pure geometry (verifiable as a sprite, no game-render change) — safe to land first.
- I-2 is the only render-path-touching slice; gate it behind the focus interaction and a flag,
  verify visually before default-on.
- Each slice keeps the per-slice discipline: tsc + targeted tests + full-suite gate + a live
  `__debug.grab` visual, branch off `main`, `--no-ff`, push only on green build.
- Versions: I-1/I-3/I-4 bump `ART_RECIPE_VERSION` (geometry); I-2 is render-only (no bump). No
  `WORLD_CONTENT_VERSION` bump (placement/footprints unchanged — the cutaway is a render
  variant, not a worldgen change).

This is the buildable plan for the foundational epic's interior layer; start at I-1.
