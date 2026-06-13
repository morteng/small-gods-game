# Slice 1 — props through the generative pipeline (wells & graveyards) — spec

**Date:** 2026-06-13 · **Epic:** [world rendering](2026-06-13-world-prop-vegetation-rendering-design.md) · **Branch:** `feat/render-props-slice1` (off main `982317e`)

## Goal

Wells and graveyards are emitted as entities but **never drawn** (`entity-draw-list.ts` only emits barriers, blueprinted buildings, vegetation — `category:'prop'` falls through). Make them **geometry-backed blueprint entities** (as the S6 mill already is) so they render + PBR-light through the existing building branch. This also proves the "Blueprint goes class-generic" move slices 2–4 depend on.

## Why this is surgical (verified)

- `toGeometry` (`src/blueprint/compile/to-geometry.ts`) dispatches on **`prim` type**, not `class` — and the yurt already produces a spec of only standalone prims (cylinder + dome, no `building` prim) that composes fine. Wells (cylinder + posts + cap) and graveyards (headstone prisms) need **zero** changes to the compiler or `composeStructure`.
- The render path (`entity-draw-list.ts:79` → `pickBuildingSource`) keys off `blueprintOf(e)` presence, **class-agnostic**. A prop-class blueprint entity renders without special-casing.
- Naming the presets `well`/`graveyard` means `blueprintEntity` sets `kind = rb.preset = 'well'/'graveyard'` → **`recordBurial`'s `world.query({kind:'graveyard'})` and all S5/S6/brush kind-queries keep working unchanged.**

## Changes

1. **`src/blueprint/types.ts`** — add `'prop'` to `EntityClass`.
2. **`src/blueprint/parts/civic.ts`** (new) — `wellPartType`, `graveyardPartType`:
   - **well** (footprint 1×1): stone curb `cylinder` + two timber `box` posts + a small `cone` cap. Metric heights via `mToTiles`.
   - **graveyard** (footprint 2×2): a deterministic scatter of ~5 stone headstone `box`/`prism`s (fixed layout, no rng — keeps determinism). `stones` param (default 5) is a Fate seam; later driven by `graveyard.buried`.
   - Both: `toCollision` = footprint cells; `toAnchors` = none; `toBrief` = a prompt phrase.
3. **`src/blueprint/register-buildings.ts`** — register the two new part types.
4. **`src/blueprint/presets/index.ts`** — add a `prop()` helper (`class:'prop'`) + `well` (category `civic`) and `graveyard` (category `religious` → sacred) presets.
5. **`src/blueprint/entity.ts`** — derive entity `category`/primary tag from `rb.class` instead of hardcoding `'building'`. `building`→`building` (default, byte-unchanged for all existing presets), `prop`→`prop`, `plant`→`vegetation`, `barrier`→`barrier`. **Consequence (intended):** props no longer counted as buildings and don't block placement via `canPlaceIgnoringNature`.
6. **`src/world/building-placer.ts`** — fold `well`/`graveyard` into the blueprint-emission branch (rename `CIVIC_BUILDING_PRESETS`→`CIVIC_PRESETS = {mill:'watermill', well:'well', graveyard:'graveyard'}`); mill keeps the `workplace` tag, well/graveyard get `['settlement','civic']`. Remove the now-dead `CIVIC_ENTITY_KINDS` bare-prop branch. `poiId` preserved (recordBurial).

## Test fallout (intended, fix precisely)

Tests that did `result.entities.filter(e => blueprintOf(e))` to count **buildings** will now also catch wells/graveyards (which now carry blueprints). Correct fix = discriminate genuine buildings by `blueprintOf(e)?.rb.class === 'building'` (or `category`), preserving the test's intent ("buildings on lots/frontage"). Files: `settlement-plan.test.ts`, `settlement-plan-s2.test.ts`, `building-placer-descriptor.test.ts`, `default-world-generation.test.ts`. Kind-based queries (S5/S6/brush) are unaffected.

## New tests (`tests/unit/render-props-slice1.test.ts`)

- well/graveyard `synthesizeBlueprint` resolve with `class:'prop'`; `toGeometry` yields ≥1 non-building prim each (no throw).
- placer emits well/graveyard as **blueprint** entities with `kind` preserved (`'well'`/`'graveyard'`), `category:'prop'`, `poiId` set, not tagged `'building'`.
- `blueprintOf(well)` is defined → the draw-list building branch would pick it up.
- `recordBurial` still finds the graveyard by kind after it became a blueprint entity (regression guard).
- graveyard preset is `religious` → `religiousSignificance:'sacred'`.

## Out of scope

img2img texture seeding for props (a follow-up; keyless players get the parametric grey-geometry render, which already proves the slice). Market stalls / fences / troughs (future prop presets — the part-type pattern is now in place).
