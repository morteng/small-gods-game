# Procedural Material Subsystem — stonework taxonomy + geometry-authored UVs + wiring

> Status: SPEC (2026-06-27). Extends the K0 Material+Finish engine
> (`src/assetgen/render/material-surface.ts`, shipped K0a–K0d) into the comprehensive
> texturing half of the structural-parts-kit epic
> ([[project-structural-parts-kit]], brainstorm `2026-06-27-structural-parts-kit-brainstorm.md`).
> Freeze-safe: 100% procedural, $0, no paid gen.

## Why

K0 proved analytic, world-continuous, 1:1-metric surface texturing on in-game buildings
(IQ Voronoi-border stone + tangent-frame UVs, commit 877b287). But a real medieval world needs
**many masonry types** (a cut-ashlar keep ≠ a rubble cottage ≠ a cobbled yard), the engine
**wired into every structure** (walls, kit parts, aperture surrounds — not just box bodies), and
**UV correct on every geometry** including round towers and trim. Today every facet carries a flat
`Mat` and the texturer guesses a frame from the normal — good for axis-aligned walls, wrong for
curved barrels and unable to express "ashlar quoins on a rubble wall."

## Scope decisions (user, 2026-06-27)

1. **Taxonomy = focused medieval set (~6 stoneworks):** ashlar, coursed_rubble, random_rubble,
   cobble, dry_stone, flint. Plus a couple of brick/timber works. More later.
2. **Buildings / walls / kit parts first.** Roads & terrain keep their current WGSL exemplar
   texturing; unifying them onto these material defs is a follow-up (KR, deferred).
3. **UV authored where it matters:** cylindrical unwrap for round towers/columns/wells, swept
   frames for arches, run-aligned frames for trim/vents/kit parts; flat faces keep the
   tangent-from-normal frame. No full per-facet UV channel on every generator (yet).

## Architecture

### Material model — `SurfaceWork`

A facet's surface descriptor grows from `Mat` to `{ family: Mat, work?: SurfaceWork, finish?, tint? }`.
`work` selects the bond/pattern within a family; `PATTERNS` becomes `PATTERNS[family][work]`, every
entry composed from the shared primitives already in `material-surface.ts` (`voronoiEdge`, `bond`,
`fbm`, `cellular`). Sensible family→work defaults keep call sites that only pass `family` working
(`stone` → `coursed_rubble`, `brick` → `running`, `timber` → `plank`).

Stoneworks (all from voronoiEdge/bond + grain, tuned constants only):
- **ashlar** — finely cut, coursed (bond), thin tight joints. Keeps, churches, quoins.
- **coursed_rubble** — irregular stones in rough rows (voronoi, v-compressed). General walls. *(shipped as `stone` default)*
- **random_rubble** — uncut, no courses (voronoi, full jitter).
- **cobble** — small domed rounded stones (small voronoi + dome highlight). Yards, road shoulders.
- **dry_stone** — flat stacked stones, thin dark gaps, no mortar colour (tight bond + voronoi break).
- **flint** — small dark knapped nodules (small voronoi, dark, glint).

### UV authored in geometry

`WorldFacet` gains `frame?: TangentFrame { uAxis: Vec3; vAxis: Vec3; origin?: Vec3 }` (world metres).
- `manifoldToFacets(mesh, material, projector?)` — `projector?(centroid, normal) → TangentFrame`
  lets a generator author the frame; absent ⇒ facets carry none and the texturer derives
  tangent-from-normal (today's behaviour, unchanged for boxes).
- **Cylindrical unwrap** for `solidCylinder`/`solidCone`/`solidPrism`: `uAxis` = tangent around the
  barrel at the facet centroid (so u = arc-length), `vAxis` = world-z. Courses wrap seamlessly; no
  per-facet seam that normal-derived frames would introduce on a tessellated barrel.
- **Swept frame** for `solidArch`: `vAxis` along the arch sweep, `uAxis` across the soffit.
- **Run-aligned** frames for `linear` runs, aperture surrounds, and kit trim: `uAxis` along the run.
- The texturer (`prepareSurface`) takes an optional authored frame, else `frameFor(normal)`.
- **1:1 metric guarantee:** all axes are unit world vectors; u/v are world-metre arc-length /
  projected distance. A test asserts a known curved facet's UV span equals its world arc length.

### Wiring — make Palette real

`Blueprint.materials` + `Palette { walls, roof, trim }` resolve to a per-region
`SurfaceSpec { family, work, finish, tint }` carried onto the right facets (wall body, roof, trim/
quoins, aperture surrounds). This finally makes `Palette` drive appearance, not just img2img prompts.
ERA/tech gating (which works a society can build — ashlar = advanced) defers to the
buildability-envelope spec.

## Slices

- **K0d — texture in-game + IQ stone + tangent UVs** ✅ (877b287). ParametricBuildingSource composes
  with surfaceTexture on; stone = IQ Voronoi-border; frame = tangent-from-normal.
- **KW — stonework taxonomy** ✅ (28561e6). `SurfaceWork` union + `WORK_PATTERNS` + the 6 stoneworks
  (+ brick `running|flemish`, timber `plank|board_batten`). `DEFAULT_WORK` per family. +4 tests.
- **KC — wiring / descriptor→work** ✅ (c16c935). `WorldFacet/ScreenFacet += work/finish/tint`;
  `manifoldToFacets(…, work?)`, `buildingFacets(… wallWork?)`; `WALL_WORK` LUT resolved in
  body/wing/structural. (Roof works + aperture-surround tagging are a follow-up.)
- **KU — UV in geometry** ✅ (7005982). `SurfaceFrame` (planar | cylindrical); `manifoldToFacets`
  `FacetProjector` arg; `cylindricalProjector` on cylinder/cone/prism barrels; `prepareSurface(…, frame?)`
  branches (per-pixel angular sampler for cylinders). +3 tests inc. arc-length metric-invariance.
  *(Swept arch frames + run-aligned trim/vent frames are a follow-up — not yet authored.)*
- **K0e — shader honours roughness + finish** ⬜ (#60). banded-PBR (`lit-wgsl.ts`) currently does
  diffuse + AO only, no specular to modulate; **also resolve the channel wrinkle**: `rasterize`
  writes metallic→`material.a` but `lit-wgsl` reads `.a` as AO-strength. A deliberate lighting slice.
- **KR — roads/terrain share the engine** ⬜ (DEFERRED per scope decision).

## Verification

- `npm test` green; new per-slice unit tests (work distinctness, UV metric parity).
- Visual (decisive): dev server :3000, clear IDB `small-gods-saves`, `__debug.grabFile` — confirm
  distinct masonry per building class, round towers wrap without seams, trim/surrounds texture
  correctly, all at consistent metric scale.
- Goldens stay pinned (surfaceTexture-off path) until/unless a deliberate flip; parametric in-game
  render is in-memory so no `ART_RECIPE_VERSION` churn for buildings.

## Constraints carried

Freeze-safe ($0, procedural). WebGPU-only renderer. Replay-safe determinism (integer-hash noise,
no `Math.random`). Commit explicit paths; branch `feat/material-finish-engine`; not pushed without ask.
