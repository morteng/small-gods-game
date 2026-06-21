# Spike — procedural skeletal biped → animation atlas via the asset pipeline

**Date:** 2026-06-21 · **Status:** ✅ spike complete (throwaway proof; not wired into the game)
**Script:** [`scripts/spike-biped-bake.ts`](../../../scripts/spike-biped-bake.ts) ·
**Run:** `npx tsx scripts/spike-biped-bake.ts` → `tmp/biped-spike/{walk-albedo,walk-normal}.png`

> A spike answers a feasibility question with throwaway code; it is **not** a spec or a plan.
> When the NPC visual rebuild is scheduled it gets its own brainstorm → spec → plan per the
> ROADMAP convention. Related: [`ANIMATION_AND_ASSET_GENERATION.md`](../../ANIMATION_AND_ASSET_GENERATION.md)
> (the 3D/voxel + Fate-asset-library research this de-risks one corner of), and the flora
> multi-view bake plan `docs/superpowers/plans/2026-06-21-flora-multiview-bake-atlas-plan.md`
> (the static-yaw half of the same shared bake seam).

---

## The question

Can we model an NPC procedurally as a **3D skeleton**, pose it into animation frames, and
"render" those frames to sprites through the **same geometry → `SpritePack` pipeline that
buildings and trees already use** — rather than building a new live-3D renderer or hand-drawing
spritesheets? And does it stay pixel-perfect and deterministic?

**Answer: yes, end-to-end, with no new rendering code.** The figure in `tmp/biped-spike/walk-albedo.png`
is a procedural biped walking, baked as an **8-direction × 8-frame** atlas, lit by the same banded
PBR lighting the buildings get, produced headlessly in ~3 s.

---

## What was built

`scripts/spike-biped-bake.ts` — a self-contained `tsx` script:

1. **A rig from existing primitives.** The skeleton's bones are flora **`Limb`**s — the tapered
   capsule segments (`a → b`, radius `r0 → r1`) that trees use for branches. Hands, feet and head
   are flora **`Leaf`** blobs. A skeleton *is* a flora skeleton; the only new thing is posing the
   joints with forward kinematics instead of an L-system turtle. Human proportions in tile units
   (1 tile = 2 m), total ≈ 1.85 m.
2. **A walk cycle by FK.** `poseBiped(phase)` swings the hips (`STRIDE·sin`), flexes the knee on the
   lift, counter-swings the arms against the same-side leg, bobs the pelvis at double-support, and
   leans the upper body forward. Each frame → a fresh `{ prim:'flora', limbs, leaves }` part.
3. **Bake through the real pipeline.** Each (frame, yaw) pair calls
   `composeStructure(spec, undefined, { yaw })` — the **same** entry point buildings and flora use.
   The `yaw` rotor (turntable about the vertical axis) gives the 8 directions for free.
4. **Stable atlas, croppable output.** Omitting `spec.size` takes the **`fixedFit`** path: a
   *constant metric scale* (px per cube-unit), so the figure never "breathes" frame-to-frame. We
   crop each result to its opaque bbox and bottom-anchor it into fixed cells to build the contact
   sheet. Both the **albedo** (`grey`) and the full **normal** G-buffer are written, proving the
   whole PBR stack (albedo + normal + material + emissive + cast shadow) comes through unchanged.

---

## What it de-risks

- **The plumbing is already there.** "Bake a parametric biped → multi-direction + animation atlas"
  needs *no* renderer work — it reuses `composeStructure`, the flora limb/leaf mesher, the dimetric
  projection, the z-buffer rasteriser, and the banded lighting verbatim. This is the same
  multi-angle bake seam the flora multi-view plan builds first; NPCs add the **animation-frame
  dimension** on top of flora's **yaw dimension**.
- **Pixel-perfect is preserved.** Output is plain AABB sprite blits at a fixed metric scale — no
  per-instance rotation/scale in the instance buffer or shader, no live mesh pass. Honours the 1:1
  rule.
- **Deterministic & headless.** Pure `tsx`, no WebGPU/browser, no `Math.random`. Per-entity yaw/
  pose selection at runtime would be a pure function of entity id (the determinism rule that must
  survive into any real spec — generation/baking never touches sim or replay).

## Honest limitations (what the spike does *not* solve)

- **Grey massing only — no img2img skin.** Per the standing money freeze, no paid generation runs
  here; these are clean lit primitives, exactly like in-game buildings render today. Painting
  clothing/skin onto the frames via the img2img leg of the pipeline is the obvious next overlay, and
  it inherits the **temporal-consistency ("boiling") problem** — per-frame img2img drifts between
  frames; whole-sheet or pose-conditioned approaches are the mitigation to evaluate.
- **Dimetric foreshortening on toward/away directions.** Rows where the walk runs along the depth
  axis read squatter than the side views — inherent to the 2:1 projection, and exactly why LPC
  hand-draws front/back differently from the sides. A characteristic to design around, not a bug.
- **The rig is crude.** Box-jointed FK, no IK foot-planting (it's a treadmill-in-place cycle, which
  is actually correct for a looping sprite), placeholder proportions, one pose (walk). A real rig
  needs proper joints/proportions and a pose library.

---

## If/when picked up (not scheduled)

This feeds [[project-generative-npc-system]]. The remaining work is **content and policy, not
plumbing**:

1. **A real rig** — proper humanoid proportions/joints, maybe parameterised (body type, height) for
   crowd variety; reuse for animals/monsters via the same limb primitives.
2. **A pose library** mapping the existing `LPC_ANIMATIONS` vocabulary (idle/walk/spellcast/thrust/
   slash/shoot/hurt) onto FK keyframe sets, so the sim→render animation seam (`NpcActivitySystem` →
   `getSpriteCoords`) can drive baked atlases instead of LPC sheets.
3. **Atlas packing + draw-list integration** — bake to a packed texture, select cell by
   `(direction = yaw bucket from entity id, frame = animation clock)`; wire into
   `entity-draw-list.ts` behind a flag (the flora multi-view plan establishes the cache/selection
   shape first).
4. **img2img skin strategy** — decide per-frame vs whole-sheet vs pose-conditioned to beat boiling;
   evaluate against the money-freeze and the building img2img quality gates.
5. **Direction count vs foreshortening** — 8 yaws is enough for variety; decide whether toward/away
   poses get bespoke treatment or accept the dimetric squash.

**Reproduce:** `npx tsx scripts/spike-biped-bake.ts` (rows = 8 yaw directions, columns = 8 walk
frames; albedo + normal sheets land in `tmp/biped-spike/`).
