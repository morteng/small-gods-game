# Own the Animation, Commoditize the Appearance — implementation plan (2026-08-03)

**Status:** plan. No code yet. **Spend: $0 until G-phase seeding, which is explicit.**
**Spec:** `../specs/2026-08-03-npc-animation-appearance-spec.md` (code reality, contracts,
licensing, rejected alternatives — including the MiniMax H3 rejection; do not reopen it).

**Goal:** relieve the hand-keyframing pain (free BVH→rig motion import), make imported
motion player-visible (runtime adoption of rig clips), and turn the PixelLab dependency
into one backend behind a provider-agnostic compiler seam with the building-art
pipeline's gates — paid generation opt-in, default OFF, author-time-first.

## Ordering — validated against the code, with one amendment

The brief's ordering (importer → compiler seam → img2img path → local backend) stands,
**amended by one finding**: the paperdoll rig has NO runtime consumer today (verified —
`renderPose`/`sampleClipLayers` and `src/render/anim/animator.ts` are imported only by
paperdoll modules, the motion studio, and tests; live NPCs play vendored LPC universal
rows via `src/render/lpc/spritesheet-cache.ts` + `src/render/npc-animator.ts`). Without a
runtime-adoption slice, every imported clip stays a studio artifact and no phase before
G2 is player-visible. So Phase M gains **M3 (bake-to-runtime seam)** as its payoff slice.
M and C are file-disjoint and can run in parallel branches; G depends on C; L depends on
C and is optional. Each phase is independently shippable.

---

## Phase M — Motion: BVH → rig tracks (free, no provider, biggest pain relief)

### M0 — BVH parser + camera-plane projection (pure leaf)
New `src/render/paperdoll/bvh.ts` — node + browser, no DOM, importable by scripts and
the studio (same contract as `rig.ts`):
- `parseBvh(text) → BvhClip { joints: {name, parent, offset, channels}[], frames: number[][], frameTime }`
  — plain recursive-descent; support the rotation orders the cgspeed CMU conversion
  emits; no external deps.
- `projectToRig(bvh, map: BoneMap, opts) → Record<facing, Clip>`:
  - FK the 3D skeleton per frame; per mapped bone, project its direction vector into
    the facing's camera plane (south/north = frontal, west = sagittal; the projection
    basis auto-guessed from the hips' forward vector, overridable per import).
  - Screen angle = parent-relative `atan2` in **y-down clockwise degrees** (the rig's
    convention — `rotAbout` in `rig.ts`); the out-of-plane joint-position residual
    lands in `dx/dy`, exactly what `Keyframe` documents them for. HONEST LIMIT: a
    fixed chip cannot foreshorten, so toward-camera motion beyond the dx/dy stand-in
    is an accepted 64px artifact, judged in the studio, not silently "fixed".
  - **Loop closure:** cyclic clips detected by first/last pose distance; wrap by
    phase-preserving blend over a tail window so `t=0` and `t=1` sample identically.
  - **Keyframe fitting:** greedy error-driven insertion per track until max deviation
    < tolerance (start ~2° / 0.5px), hard cap ~12 keys/track; quantize `deg` to 0.5°
    and `dx/dy` to 0.25px so output is byte-stable (determinism contract).
  - **Foot handling:** the rig's `plant` nails a point for the WHOLE clip — right for
    stationary clips, wrong for locomotion. Stationary imports emit `plant` entries
    from detected stance (low ankle speed + height). Locomotion imports instead bake
    root-motion compensation: per-frame trunk `dx` chosen so the stance ankle's
    projected point holds still (foot-skate control at import time, not runtime).
    **CORRECTED DURING M0 — this was half wrong.** Full compensation makes the
    BODY cross the cell by one stride per cycle, and our sprites are already
    translated by the sim, so the NPC would lurch forward in its own cell and
    snap back at the loop. The linear component of the compensation is stripped
    (`rootMotion: 'in-place'`, the default); the per-frame wobble stays, because
    that is what stops a planted sole shivering. Feet then slide one stride per
    cycle and read as planted exactly when NPC ground speed matches the clip's
    stride/duration — so **foot fidelity is a walk-speed tuning knob for M2**,
    not a property of the bake. `rootMotion: 'advance'` keeps the old behaviour
    for studio comparison.
- Bone maps are data: `HUMANOID_BVH_MAP` (CMU joint names → south/north/west chip
  names), later `QUADRUPED_BVH_MAP`. NOTE (from spec): quadruped source data in CMU is
  UNVERIFIED — the quadruped map ships only if usable data exists; otherwise the sheep
  keyframes stay hand-authored and this plan says so rather than pretending.

*Tests:* `tests/unit/bvh-import.test.ts` — golden parse of a small vendored BVH;
byte-identical re-import pin; loop-closure endpoint equality; y-down sign convention
pin (a raised arm in BVH lands as the correct rig angle); root-motion stance pin.

### M1 — Importer script + vendored motion data
`scripts/motion-import-bvh.ts` (author-time, free, offline):
- `npx tsx scripts/motion-import-bvh.ts vendor/mocap/cmu/07_01.bvh --clip walk --facing all`
  → writes generated clip modules under `src/render/paperdoll/clips/` with a
  "GENERATED by scripts/motion-import-bvh.ts — do not hand-edit; re-run to change"
  header + the import params embedded (reproducibility).
- Vendor the handful of source BVH files under `vendor/mocap/cmu/` + `CREDITS.md`
  entry (CMU terms permit redistribution; credit line per spec).
- Register imported clips in `rig-catalog.ts` so the studio sees them immediately.

*Tests:* generated-module lint cleanliness (oxlint stays zero — generated code obeys the
gate too); `paperdoll-facing.test.ts` extended: every imported clip names only chips the
facing template owns.

### M2 — Validation against LPC's own baked rows (the free ground truth)
Motion-studio extension (STUDIO ONLY — dev viz never ships in the game):
- A REFERENCE lane: load the LPC sheet's own hand-pixeled walk/thrust/slash row beside
  the imported clip's bake (both already on disk, both already licensed); scrub-locked
  side-by-side + a per-frame pixel-diff readout.
- Acceptance for the imported walk: reads as a walk at the IN-GAME 32px lane, foot
  plants don't skate past 1px, and the diff against LPC's walk row is qualitatively
  close (the LPC row is a different artist's cycle — the bar is "reads right", the
  numbers are instrumentation, per the verify-empirically working preference).
- Re-tune `couple`/`plant` per imported clip here (the studio's end-pose sliders are
  the bench for exactly this).
- Land the first batch of clips gameplay actually pulls on: work loops (hammer, dig,
  carry), social (wave, festival dance), and a march — chosen against existing
  `NpcActivity` values, not invented.

*Tests:* `tests/unit/paperdoll-imported-clips.test.ts` — each landed clip bakes
deterministically (hash pin, same style as `assetgen-golden`), frames > 0, loops closed.

### M3 — Runtime adoption: rig rows join the universal sheet (the payoff slice)
- `src/render/lpc/spritesheet-cache.ts`: after (or beside) `renderCharacter`, bake
  selected rig clips PER LAYER from the `CharacterSpec`'s own part sheets (the same
  per-layer bake `scripts/paperdoll-bake.ts` does — per-layer is load-bearing: the
  flattened sheet re-poses with baked inter-layer shadow smear) and append the frames
  as extra rows below the standard LPC block on a taller canvas.
- `src/core/npc-animation.ts`: widen `NpcAnimation` + `LPC_ANIMATIONS` with the
  appended rows (rowBase/firstCol/lastCol/directional/loop — pure data, core-safe for
  both sim and render). The sim keeps selecting by writing `p.animation`
  (`npc-movement.ts`) — no sim logic change beyond naming new states where activities
  already exist.
- Perf: bake LAZILY per (specHash, clip) behind the existing `createLimiter(3)`; until
  baked, the NPC plays its current standing animation (graceful, honest). Cache is the
  existing in-memory Map — no IDB, no version constant. MEASURE at boot with a full
  town before declaring done; if bake cost bites, pre-bake only the two commonest
  clips and demand-bake the rest.
- East stays free: bake west, `mirrorFrame` per finished frame (the `facing.ts` rule).

*Tests:* `tests/unit/lpc-spritesheet-rows.test.ts` — appended rows collide with no
standard row; `npc-animation.test.ts` extended for the widened table; a bake-parity test
pinning that the runtime-baked strip equals `bakeClip`'s offline bytes for the same
layers (determinism made visible).

**Phase M exit:** new motions authored in hours not days, visible on live NPCs, zero
providers involved, zero spend.

---

## Phase C — Promote the compiler seam (structural, $0)

### C0 — Lift the generic library out of `pixellab.ts`
New `src/services/sprite-library.ts` owning what is provider-neutral today:
the IDB store (keep DB name `smallgods.pixellab` — a rename buys a migration and
nothing else; note it as historical), `findAssets`, `listKeptSummaries`,
`getAssetBlob`, `markAssetKept/Rejected`, `updateAssetMetadata`, `listRecentAssets`,
plus the new `lineage` metadata field from the spec's licensing contract.
**Leaf + REPOINT the importers** (`src/services/asset-library.ts`,
`src/render/decoration-image-cache.ts`) — a re-export does not cut the edge (house
rule). `pixellab.ts` keeps only: request building, its own `RECIPE_V` cache keys,
key/balance management. Every IDB touch keeps racing `withIdbTimeout`
(`src/services/idb-guard.ts`) — non-negotiable.

*Tests:* `tests/unit/sprite-library-store.test.ts` — behaviour parity with the old
store (reuse `_resetDbForTesting` pattern); curation round-trip; lineage persisted.

### C1 — `SpriteBackend`: `AssetProvider` becomes real dispatch
- New `src/assetgen/compilers/backend.ts`:
  ```ts
  interface SpriteJob {
    prompt: string; negative?: string;
    width: number; height: number; seed: number;
    init?: { raster: Raster; denoise01: number };  // 0 = keep init, 1 = ignore it
    palette?: Raster;                               // advisory; enforcement is post-hoc
  }
  interface SpriteBackend {
    provider: AssetProvider;
    generate(job: SpriteJob): Promise<{ raster: Raster; costUsd: number }>;
  }
  ```
- `pixellab-backend.ts` adapts the existing `generate()` (maps `denoise01` onto
  `init_image_strength`, applies the house style recipe); `replicate-backend.ts` goes
  through the same dispatcher family as buildings — extract the provider split from
  `src/llm/building-image.ts` into a leaf (`src/llm/image-dispatch.ts`) and REPOINT
  `building-image.ts` at it, so buildings, flora and NPCs share one Replicate/OpenRouter
  seam instead of growing a second. `mock` backend for tests. `fal` stays a declared
  provider with no backend until wanted (dispatch refuses it honestly).
- `pixflux-compiler.ts` is untouched in role (brief → prompt lore) but its output type
  narrows toward `SpriteJob`; PixelLab-only fields move into the pixellab backend.
- Replacement mapping (the de-PixelLab-ing, per spec contract 3): `color_image` palette
  lock → post-hoc `quantizePaletteOklab`/`snapToSourcePalette`; `outline`/`shading`/
  `detail` → prompt recipe text in the compiler; `init_image_strength` → `denoise01`.

*Tests:* `tests/unit/sprite-backend-dispatch.test.ts` — provider routing, honest
refusal for backend-less providers, mock round-trip; existing building-art tests stay
green after the `image-dispatch` repoint (that repoint is the risky edit of the phase —
do it as its own commit with server CI).

**Phase C exit:** no runtime behaviour change; PixelLab demoted from load-bearing wall
to plugin.

---

## Phase G — Rig-frame → img2img sprite path (the gated paid path)

### G0 — The per-frame pipeline (pure until the backend call)
New `src/assetgen/npc-sprite-pipeline.ts`, mirroring the building pipeline stage for
stage: rig frame (already posed, already pixel-art, already palette-correct) →
nearest-upscale (×4 first guess — 64px is below every model's native band; the studio
decides the factor) → `compositeOverChroma` → LOW-`denoise01` seeded img2img via a
`SpriteBackend` → chroma-key → **gates: `alphaIoU` vs the source rig frame ≥ 0.9 +
`borderKeyedFraction` ≥ 0.6** (constants adopted from
`generated-building-art-source.ts`; re-tuned only with studio evidence) →
`boxDownscale` to cell → quantize with ONE shared per-sheet palette (per-frame palettes
shimmer) → assemble rows → validate-BEFORE-persist, retry once then session-null.
Seed policy: one seed per SHEET (temporal coherence), derived `hash(clipName,
layerSetHash, NPC_ART_RECIPE_VERSION)`.
- New `NPC_ART_RECIPE_VERSION` in `src/core/content-version.ts`; introduced (and ever
  bumped) with `tests/unit/content-version.test.ts` updated in the SAME commit.
- Every persisted record carries `provider`, `model`, `seed`, `lineage` (LPC-derived
  init ⇒ `'lpc-derived'`, CC-BY-SA — spec licensing contract).

*Tests:* `tests/unit/npc-sprite-gates.test.ts` — a mock backend returning a drifted
silhouette is rejected; retry-once-then-null; validate-before-persist (nothing lands in
the store on failure); shared-palette pin across frames.

### G1 — Author-time seeder (the ONLY place money moves)
`scripts/seed-npc-art.ts [--plan]` mirroring `scripts/seed-building-art.ts`: `--plan`
prints keys/prompts with NO api calls; the paid run needs the token env var explicitly;
writes `public/asset-library/npc-sprites/{manifest.json, <key>.png}`. First real target:
ONE Tier-1 subject (a rival cult acolyte wardrobe over the standard walk row) as the
pilot — small spend, confirmed with the user first, never `--go`, per standing SPEND
rules.

### G2 — Runtime source, default OFF (optional this round)
`GeneratedNpcArtSource` in the mould of `GeneratedBuildingArtSource` (IDB → vendored
library → paid gen), gated by a `liveNpcArtEnabled = false` flag beside
`liveBuildingArtEnabled` (`src/game.ts:462`). Ship the flag wiring; leave it OFF; the
vendored library from G1 is what players see. Can slip to a later round without
weakening M/C — the seeded library is consumable via the base tier
(`asset-library.ts`) alone.

**Phase G exit:** a curated, gated, versioned generation path exists end-to-end;
default play costs nothing and looks identical until a library ships.

---

## Phase L — Optional local backend (zero-provider endgame)

`local-sd-backend.ts` implementing `SpriteBackend` against a localhost ComfyUI/SD HTTP
endpoint (user-run; we bundle NO weights, no Python). Config through the existing
settings surface (agent-driven UI system — no bespoke panel). Determinism note recorded
honestly: local SD with fixed seed/sampler is reproducible on one machine, not across
GPUs — acceptable because the library, not the generator, is the deterministic
interface (spec contract 1). SLICE SKETCH ONLY — planned in detail when someone wants
it; nothing in M/C/G depends on it.

---

## Risks & mitigations

- **BVH projection reads poorly at 64px** (the whole phase's bet). Mitigate: M2's
  LPC-row ground truth BEFORE landing clips; keyframe tolerance and `couple`/`plant`
  re-tune in the studio; worst case the importer still produces first-draft tracks a
  human polishes — still beats keyframing from nothing.
- **M3 boot cost** (per-layer baking is supersampled raster math × clips × facings).
  Mitigate: lazy bake behind the limiter, measure on a full town, pre-bake shortlist.
- **Img2img temporal shimmer across frames** (per-frame generation's known weakness).
  Mitigate: one seed per sheet, low `denoise01`, one shared palette, IoU gate per
  frame; accept that Tier-1 generation suits SLOW/stately motion first (worship,
  procession) and say so in the seeder targets.
- **`image-dispatch` extraction destabilizes shipped building art.** Mitigate: leaf +
  repoint as an isolated commit; building-art tests + `assetgen-golden` pins must pass
  untouched (no geometry change ⇒ no `ART_RECIPE_VERSION` bump).
- **Licence contamination** (an LPC-derived generation mistaken for owned). Mitigate:
  `lineage` is a REQUIRED field in the C0 store schema, set by the pipeline, not by
  hand; the seeder refuses to write a record without it.
- **CMU quadruped data may not exist** — recorded as unverified in the spec; the
  quadruped map is conditional, the sheep stays hand-authored otherwise.

## Out of scope (this track)

Monster/new-template rigs; Fate-driven generate-on-miss asset direction
(`docs/ANIMATION_AND_ASSET_GENERATION.md` §3 — future track); portraits; turning
`liveNpcArtEnabled` ON by default; any reseed of the building-art library
(FROZEN by user directive); 3D anything.

## Verification bar (per slice and at end)

`npx tsc --noEmit` clean (inline editor diagnostics are FALSE — trust only tsc) ·
`npm run lint` ZERO · targeted suites green · full suite parsed from the SUMMARY ·
`./scripts/ci-on-server.sh` green (grep `✓ Server CI passed`) before any branch is
declared done · version-constant commits carry their test update · NO paid calls in any
test or CI path (mock backend only).

## Suggested ROADMAP entry (do not apply — for the ROADMAP editor)

> **NPC animation & appearance pipeline** — own the motion (BVH→rig importer over CMU
> mocap + runtime adoption of paperdoll clips), commoditize the look (provider-agnostic
> `SpriteBackend` dispatch; PixelLab becomes one backend; rig-framed img2img with
> silhouette gates, paid path opt-in/default OFF). Spec/plan:
> `docs/superpowers/{specs,plans}/2026-08-03-npc-animation-appearance-{spec,plan}.md`.
