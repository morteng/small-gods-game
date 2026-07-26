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

## Two halves: gather a reference, then match it

This skill has a **money-free fix loop** (below) and an optional **paid reference-gathering
probe**. When you don't know what a building type *should* look like, gather a reference FIRST;
otherwise skip straight to the loop.

### Reference-gathering (paid, opt-in — `scripts/tti-probe.ts`)

`tti-probe.ts` feeds our own geometry-true description (reused from `building-image-prompt.ts`,
MINUS the img2img scaffolding) to a **pure text-to-image** model with NO init massing — so you
see what our *words* describe vs what our *geometry* builds, and where the model adds architecture
we don't model.

```
npx tsx scripts/tti-probe.ts parish-church                     # PRINT the TTI prompt only (FREE)
OPENROUTER_API_KEY=… npx tsx scripts/tti-probe.ts parish-church --go   # generate (~$0.01/img)
npx tsx scripts/tti-probe.ts parish-church --name=slug --prompt="…broach spire…" --go  # hand-authored TARGET
```

- Output lands in `reference-library/tti/<preset|slug>/`: `model-tti.png` (what the model imagines)
  beside `ours-massing.png` (our 3D grey massing) + `prompt.txt`; cost logged to `manifest.tsv`.
  `reference-library/` is **gitignored** — paid grabs stay local.
- **`--go` SPENDS MONEY. Never run it autonomously** — the reseed freeze ("do not spend money yet")
  is in force. Print the prompt for free, and only generate with an explicit go-ahead per batch.
- Distil the finding into a hand-written **`STUDY.md`** in the folder: "what the model draws that
  we get wrong" → an ordered fix list. That STUDY, not the PNG, is the durable artifact you code
  against (see `parish-church-classic/STUDY.md`, `watermill-wheel/STUDY.md` for the format).

### Vision diff (cheap, per-iteration — `scripts/vision-diff.ts`)

Once a reference exists, `vision-diff.ts` turns "does our geometry match it?" into a
code-actionable list: a vision model reads the reference once (Pro, **cached** as
`ref-spec.md` beside the PNG), a cheap model (Flash) reads a fresh grey render of the
CURRENT geometry, and a third call emits an ordered FROM → TO geometry diff.

```
npx tsx scripts/vision-diff.ts tavern                        # ref auto-picked (newest tavern* grab)
npx tsx scripts/vision-diff.ts tavern --ref=tavern-2         # pin the reference slug
npx tsx scripts/vision-diff.ts brewhouse --focus="oast kiln drum, cowl"   # demand detail on named features
npx tsx scripts/vision-diff.ts tavern --check                # Flash read of OUR render only
```

First run vs a reference ~$0.01; repeats reuse the cached ref spec (~$0.003). Report lands in
`.dev-grabs/<preset>-vision-diff.md`. This is a *chat/vision* read — it never generates images.
Treat the diff as a hypothesis: verify each claim on the montage before coding it
(vision models miscount small features; trust them on proportions, pitch, massing).

### Walls and towers — `scripts/barrier-preview.ts`

Barrier geometry (curtain walls, mural towers, gatehouses) is not a building preset, so it lives
in its own subject registry (`src/assetgen/reference-subject.ts`) and its own preview. `tti-probe`
and `vision-diff` both accept these scene slugs exactly like a preset. A scene is an **assembly** —
a tower against a curtain, composed as one sprite — because tower defects are usually JOINT defects
that a reference of a lone tower can never show.

```
npx tsx scripts/barrier-preview.ts --list                  # the scenes
npx tsx scripts/barrier-preview.ts --metrics               # FREE, instant: proportions + tooth runs
npx tsx scripts/barrier-preview.ts wall-drum-corner        # compose one joint → PNG
npx tsx scripts/barrier-preview.ts wall-drum-corner --views  # yaw 0/90/180/270 strip (NOT an elevation)
npx tsx scripts/barrier-preview.ts wall-drum-corner --views --yaws=0,45,90,135   # other angles
npx tsx scripts/vision-diff.ts wall-square-gate            # the same paid diff, fortification checklist
npx tsx scripts/barrier-world-preview.ts --only=corner     # the placement battery, one case (~8s not ~8min)
```

**Read `--metrics` before looking at any picture.** Tower aspect ratio and merlon spacing are
numbers, and compose has one fixed 2:1 iso projector — proportions are exactly what iso hides.
The metrics table is what caught square gate towers still sitting at aspect 1.40 after the drums
had been fixed and the render "looked right".

**Distrust "the merlons are missing" in a grey render** — twice now that reading was wrong.
A curtain carries its parapet on the OUTWARD face only, so from inside you see a plain slab;
and a near-side crenel is backed by the wall-walk in the same flat grey, so the gap vanishes.
The strip runs quarter turns (0/90/180/270) so both faces of every wall appear. Before changing
geometry on visual evidence, confirm it numerically — `linearFacets(run)` and the tower's part
list are plain data, and a z-plane histogram settles "is there a parapet?" in seconds.

## The fix loop (money-free)

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

- `parish-church` — **tower/nave roof notch** (tower `w:2` vs nave `w:3`, both `x:0`).
- `castle_keep` — chimney-cube on a flat roof; `manor` — corner-straddling windows.

Render each with `--views`, confirm you can *see* the defect, then fix the parameters and
re-render until the montage reads clean. That is the whole skill.
