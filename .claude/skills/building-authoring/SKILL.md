---
name: building-authoring
description: Author or fix a parametric building's 3D geometry (blueprints/presets) with a look→lint→refine loop. Apply when creating a new building type, editing a preset's massing/roof/openings, or debugging a building that renders wrong (sunken dormer, roof notch, missing window).
user-invocable: true
---

Author buildings by editing a **semantic blueprint** (parts + features + materials), never
raw geometry. A blueprint compiles to 3D via `resolve → toGeometry → composeStructure`. Your
job is to get the *parameters* right; the pipeline builds the mesh. Two feedback signals keep
you honest — a **deterministic lint** (authoring errors) and a **multi-angle montage** (how it
actually looks). Use both every iteration. Everything here is browserless, deterministic, and
**money-free** (no img2img/paid gen — buildings render as grey massing by design; judge the
massing, not the skin).

## The loop

1. **Read what's authorable** — the capability catalogue (part/feature knobs, ranges, defaults):
   ```
   npx tsx scripts/building-preview.ts --catalogue
   ```
2. **Edit the blueprint.** Presets live in `src/blueprint/presets/index.ts` (`BUILDING_BLUEPRINTS`).
   A part is `{ type, at?, size?, params?, features? }`; a feature is `{ type, face?, params? }`.
   Parts key into the registry (`body`, `wing`, `tower`, …); features are `door`/`window`/`vent`/
   `dormer`. Set `params` only from the catalogue — an unknown key throws at resolve.
3. **Lint** (authoring errors — cheap, deterministic):
   ```
   npx tsx scripts/building-preview.ts <preset> --lint
   ```
   Fix every `ERR`. `warn`/`note` are advisory (eave-clamped window, part off the footprint,
   two parts overlapping — usually a placement slip).
4. **Look** (the montage — 4 turntable corners with numbered part marks):
   ```
   npx tsx scripts/building-preview.ts <preset> --views
   ```
   Writes `.dev-grabs/<preset>-views.png`; **Read that PNG** and check each corner. The legend
   prints `mark → part`, so "mark 2's roof notches into mark 1" maps straight to a part to edit.
   The montage catches what lint cannot: **proportion/placement defects** (a dormer that reads
   as a sunken pit, a tower narrower than the nave it caps, a chimney on a flat roof).
5. **Refine and repeat** until lint is clean and every corner reads right.

## What lint vs the montage each catch

- **Lint** = authoring errors the rules can detect: window taller than the wall (eave-breach),
  an opening on a part with no wall to carve, a part poking outside the footprint, a dormer on a
  flat roof (silently dropped), overlapping wall parts. Structural, not aesthetic.
- **Montage** = geometry that's *valid but wrong-looking*. Lint says "clean"; your eyes say
  "that dormer is a hole." Always look, even when lint is clean.

## Rules

- **Semantic parts, not coordinates.** Reach for a `roof` enum / `plan` / `levels` / a `dormer`
  feature — never hand-place boxes. If a shape isn't expressible, the gap is a missing part
  *type* (add one to `src/blueprint/parts/` with a `paramSchema`), not a hack in a preset.
- **Footprint contains everything.** Every part's `at + size` must fit inside `footprint`.
- **Multi-part alignment.** When a `tower`/`wing` abuts a `body`, align their shared edge
  (match widths/origins) or you get a roof notch — the classic parish-church bug.
- **Keep it deterministic.** No `Math.random`; the preset seed fixes any variation.
- **Verify programmatically too.** The gate is `authorBlueprint(input)` (`src/blueprint/
  authoring.ts`) → `{ rb, lints, ok }`. `ok === false` means don't ship it. This same function
  is what the in-game Fate author-building tool calls, so a blueprint that passes here is one a
  runtime agent could also commit.

## Over MCP (driving from an agent, no game needed)

The pipeline is exposed as pure compute tools on the `small-gods` MCP server:
`building_catalogue`, `lint_blueprint` (preset or full blueprint JSON → verdict + diagnostics),
`render_building_views` (→ the labelled montage PNG). Same loop, tool-shaped.

## Known open defects to practise on

- `tavern` — dormers render as **sunken pits** (`solids.ts:783` dormer proportions).
- `parish-church` — **tower/nave roof notch** (tower `w:2` vs nave `w:3`, both `x:0`).
- `castle_keep` — chimney-cube on a flat roof; `manor` — corner-straddling windows.

Render each with `--views`, confirm you can *see* the defect, then fix the parameters and
re-render until the montage reads clean. That is the whole skill.
