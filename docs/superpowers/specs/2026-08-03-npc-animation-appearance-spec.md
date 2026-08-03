# Own the Animation, Commoditize the Appearance — provider-independent NPC sprite pipeline (spec)

**Direction:** get off PixelLab as a hard dependency without adopting any replacement
single-provider dependency. The split that makes this tractable: **motion is ours** (the
deterministic 2D FK paperdoll rig, fed from free mocap) and **appearance is a commodity**
(any seeded img2img provider behind one compiler seam, gated by the same
validate-before-persist machinery the building-art pipeline already shipped). The pain
point this relieves is hand-authoring: every new clip today is a keyframe-by-keyframe
authoring session in the motion studio, and the animation vocabulary must keep growing —
strange new gods require new and interesting forms of prayer, work, and war.

**The Small Gods angle:** animation vocabulary IS gameplay surface. A congregation that
can only pray-bow reads as one faith; a god whose believers dance, prostrate, or march
reads as another. Wardrobe/regalia is belief legibility — who follows whom must be
readable at zoom 1. Both halves of this pipeline exist to let the belief sim *show*
distinctions it already tracks.

## Code reality (verified 2026-08-03)

- **The rig is already a deterministic 2D FK skeleton** — `src/render/paperdoll/rig.ts`
  (809 lines): `ChipDef{name,rect,pivot,parent,z}`, `AnimTemplate{name,cell,chips}`,
  `Keyframe{t,deg,dx?,dy?}` (`dx/dy` documented as the 2D stand-in for OUT-OF-PLANE
  motion), `Couple` (secondary motion, follow-through `lag`), `Clip{frames,tracks,couple?,
  plant?,stamps?}`, `sampleTrack`/`sampleClip`/`sampleClipLayers`, `chipWorldTransforms`,
  `renderPose` (supersample + box-downscale, layer-aware), `bakeClip`. Header contract:
  "same inputs → same bytes." Support: `skin.ts` (geodesic blend-band skinning),
  `palette-snap.ts` (snap to source palette, no dither), `stamp.ts`, `attachment.ts`,
  `rig-catalog.ts` (`RIGS`/`rigById`). Harness: `src/studio/motion-studio.ts`
  (`?studio=motion`, 1010 lines). Guard tests: the `tests/unit/paperdoll-*.test.ts` family.
- **Three authored facings only** (`facing.ts`): `LPC_HUMANOID_SOUTH/NORTH/WEST`; east =
  `mirrorFrame(west)`, pixel-perfect and free. North reuses south's chip vocabulary
  (pinned by `paperdoll-north.test.ts`).
- **Seven authored humanoid clips, all devotional/social** (`lpc-humanoid.ts`, 526
  lines): pray-raise, pray-bow, pray-penitent, pray-ecstatic, despair, idle-shift,
  converse. Locomotion characterization is `gait.ts` (retiming + carriage over the
  existing walk row — no new pixels). `quadruped.ts` (754) + `quadruped-art.ts` (369)
  are CODE-DRAWN — sheep pixels are painted by us, a species is a params object.
- **GAP, and it shapes the plan: the paperdoll has NO runtime consumer.** Live NPCs play
  the vendored LPC universal sheet's own baked rows (`src/core/npc-animation.ts`:
  spellcast/thrust/walk/slash/shoot/hurt), composited per-`CharacterSpec` at boot by
  `src/render/lpc/spritesheet-cache.ts` (browser canvas, limiter of 3) and frame-ticked
  by `src/render/npc-animator.ts` (fixed `FRAME_MS` metronome). The sim selects by
  writing `p.animation: NpcAnimation` (`src/sim/npc-movement.ts`). The render-side clip
  state machine `src/render/anim/animator.ts` (crossfades via `ClipLayer` stacking) has
  no importer outside its test. So the rig's clips are studio/bake-script artifacts
  today — "own the animation" requires a runtime-adoption seam, not just more clips.
- **~408 vendored LPC part sheets** (measured: 408 PNGs under
  `public/sprites/lpc/spritesheets/{body,head,hair,torso,legs,feet,arms}/`), CC-BY-SA
  3.0/4.0, credited in `CREDITS.md` (vendored via `scripts/vendor-lpc-sprites.sh` from
  the upstream Universal LPC generator). Appearance is COMBINATORIAL and free: spec ×
  `skin.ts` × `palette-snap.ts` already yields distinct villagers at zero cost.
- **`src/services/pixellab.ts` (544 lines) is text-to-sprite + library plumbing, not
  animation.** Provider-specific: `buildRequestBody` (description, `outline`/`shading`/
  `detail` style recipe, `seed`, `init_image`+`init_image_strength` default 300,
  `color_image` palette lock from `sprites/palette/lpc-anchor.png`, view/direction).
  Generic and worth lifting: the IDB library (`smallgods.pixellab`), `RECIPE_V`,
  `buildCacheKeyInput`, `findAssets`, `listKeptSummaries`, `getAssetBlob`,
  `markAssetKept/Rejected`, `updateAssetMetadata`, key/balance management. Sole runtime
  importer of the generate path: `src/render/decoration-image-cache.ts`.
- **`AssetProvider = 'pixellab' | 'replicate' | 'fal' | 'mock'` (`src/core/types.ts:901`)
  is a provenance tag, not dispatch** (`services/base-library-loader.ts`,
  `services/asset-match.ts`). `src/services/asset-library.ts` already resolves base
  (vendored) vs live (IDB) tiers with scoring and an injection seam
  (`AssetLibraryDeps`) — only *generation* is pixellab-bound.
  `src/assetgen/compilers/` holds exactly ONE compiler (`pixflux-compiler.ts`,
  `PromptCompiler{id, compile(brief) → PixelLabGenerateOpts}`).
- **The precedent to reuse wholesale is the shipped building-art pipeline:** grey init →
  img2img (`BUILDING_IMAGE_MODEL = 'qwen/qwen-image-edit-2511'` on Replicate,
  dispatched by `src/llm/building-image.ts` `generateBuildingImageAuto`; non-qwen ids →
  OpenRouter) → chroma-key → quality gates (`MIN_BORDER_KEYED = 0.6`,
  `MIN_SILHOUETTE_IOU = 0.9`, `src/render/generated-building-art-source.ts`) →
  `registerAlbedo` → `quantizePaletteOklab` (Oklab + Bayer4) → validate-BEFORE-persist,
  retry once then session-null. Author-time seeding = same pipeline
  (`scripts/seed-building-art.ts [--plan]`). Runtime paid gen default OFF
  (`liveBuildingArtEnabled = false`, `src/game.ts:462`).
- **Prior research exists and is partially superseded:**
  `docs/ANIMATION_AND_ASSET_GENERATION.md` (2026-06-01) proposed a 3D/voxel pivot to
  unlock BVH motion. The renderer went WebGPU 2D pixel-art instead, and the paperdoll
  rig closed the "2D can't use skeletal motion" objection from the other side: BVH
  *projects* onto the rig. That doc's asset-library/Fate-director architecture (§3)
  remains live future direction; its regime table is superseded.

## Goals

1. **New motion without hand-keyframing:** an author-time BVH→`Clip` importer over the
   CMU Graphics Lab Motion Capture Database (free licence, redistribution and
   commercial use permitted), validated in `?studio=motion` against LPC's own baked
   walk/thrust/slash rows — reference frames already on disk, already licensed.
2. **Rig clips play in the live game:** baked rig rows join the universal sheet and the
   `NpcAnimation` vocabulary, so imported motion is player-visible — not studio-bound.
3. **Provider independence:** `AssetProvider` becomes real dispatch behind one
   `SpriteBackend` seam; PixelLab becomes one backend among siblings; the generic
   library/cache/curation plumbing serves all of them.
4. **A generation path we can gate:** rig frame → LOW-strength seeded img2img →
   silhouette-IoU gate against the very frame that produced it → quantize → persist.
   Per-frame + seeded is what makes the gate *expressible* — this is precisely what
   video generation could not offer.
5. **A true zero-cost tier carries the bulk of NPCs** (see Tiers below), and the spec
   says explicitly which NPCs ever need paid generation.

## Non-goals

- No new rigs beyond humanoid + quadruped this track (monsters/birds are future params
  or future templates).
- No runtime BVH parsing, no runtime retargeting, no 3D/skeletal runtime — import is
  author-time; the runtime plays baked, checked-in, deterministic clips.
- No Fate-driven generate-on-miss asset director (that is the ANIMATION doc §3 track,
  explicitly not scheduled).
- No portrait/dialogue-art pipeline changes.
- Not a renderer change: WebGPU-only stands; everything here produces sheets the
  existing entity pass already draws.

## Tiers of appearance — who needs generation (explicit)

- **Tier 0 (free, the bulk):** villagers/roles = combinatorial LPC (`CharacterSpec`
  over ~408 part sheets) × `skin.ts` recolor × `palette-snap.ts`. Animals = code-drawn
  parametric quadruped (species = params). **This tier needs NO generation, ever.**
- **Tier 1 (generated, rare, curated):** appearance the LPC parts cannot compose — a
  great god's avatar, a rival cult's regalia, a monster, an era-specific wardrobe
  piece. Author-time seeded into a vendored library; runtime paid gen exists but
  defaults OFF, same as buildings.
- Motion is NEVER tiered by cost: all motion is Tier 0 (imported or authored), because
  we own the rig.

## Contracts & invariants

1. **The library is the deterministic interface; generation never touches the sim or
   replay path** (carried verbatim from the 2026-06-01 research — it was right). The
   sim/renderer read only realized assets; generation is async and author-time-first.
2. **Motion is code:** imported clips are generated TypeScript/JSON checked into git,
   marked generated-by, reviewed in the studio. Importer is deterministic — same BVH +
   same params → byte-identical `Clip`. Runtime never sees a BVH file.
3. **One compiler seam:** no provider-specific field (PixelLab's `outline`/`shading`/
   `detail`/`color_image`/`init_image_strength`) escapes its backend. Replacements are
   provider-neutral: palette lock → post-hoc Oklab/Bayer4 quantize or
   `snapToSourcePalette`; style recipe → prompt text; strength → normalized
   `denoise01`.
4. **The rig frame is the contract for generation:** every generated frame passes
   `alphaIoU` vs its source rig frame (threshold per the building precedent, tuned in
   the studio) + `borderKeyedFraction`; validate-BEFORE-persist; retry once then
   session-null — a bad generation never poisons a store.
5. **Paid generation stays opt-in and default OFF.** Author-time seeding scripts are
   the paid path, explicit, never autonomous, never `--go`.
6. **Versioning:** a new `NPC_ART_RECIPE_VERSION` in `src/core/content-version.ts`
   keys generated-sheet cache identity; any bump updates
   `tests/unit/content-version.test.ts` in the SAME commit. `RECIPE_V` stays scoped to
   the PixelLab backend's own cache keys.
7. **Licence lineage is metadata, not memory:** every library asset records
   `lineage: 'lpc-derived' | 'owned'`; LPC-derived output ships CC-BY-SA + credited
   and is never relicensed (see below).
8. **`src/sim/` is untouched** except (at most) widening the `NpcAnimation` union in
   `src/core/npc-animation.ts` — pure data, already the shared core seam. No new sim
   randomness, no cycles, nothing for `no-random-in-sim` to see.
9. Dev/diagnostic UI lives in the STUDIOS; any player-facing surface goes through
   Commands + affordances + UiSpec. 1:1 pixel-perfect: baked cells render at native
   size on the integer zoom ladder.

## Rejected alternatives

- **MiniMax H3 / video generation (researched, REJECTED — do not reopen):** no seed
  parameter (no reproducibility), no documented pose/skeleton conditioning, the
  `H3-Context-IR` component powering reference mode is withheld from open weights,
  768p/24fps minimum against a 64px target, unsolved loop-closure and cross-facing
  phase-lock, and the open-weight licence's "Applicable Territory" excludes the
  EU/UK/US. Every one of those is the negation of a contract above.
- **Spine / Rive / DragonBones 2D skeletal runtimes** (from the 2026-06-01 research):
  Spine's runtime is gated on a paid editor licence; Rive's editor is proprietary
  SaaS; DragonBones is adrift — and all of them solve rigging we have already solved
  in 809 lines we own.
- **The 3D/voxel pivot** (`docs/ANIMATION_AND_ASSET_GENERATION.md`): a renderer
  rewrite plus a GPU generation service, bought to obtain BVH compatibility that the
  projection importer gets for free against the existing pixel identity.
- **Runtime BVH retargeting:** nondeterministic-adjacent (float-order sensitive across
  platforms), a per-frame cost with no gameplay payoff over baked clips, and it would
  put a motion file format on the replay path.
- **Replacing PixelLab with another single hosted provider:** trades one hard
  dependency for another. The seam is the deliverable; providers are cattle.

## Licensing position (explicit, no hand-waving)

- **LPC parts (CC-BY-SA 3.0/4.0, share-alike):** our composited sheets and rig-baked
  frames are derivatives — already shipped as CC-BY-SA with `CREDITS.md` chain; no
  change. **An img2img output whose init image contains LPC pixels is a derivative of
  LPC art**: it must carry `lineage:'lpc-derived'`, ship CC-BY-SA, and be credited. We
  accept this for Tier-1 humanoid wardrobe (we already comply for the base sheets). If
  an output must be self-owned, its init must be self-owned — the code-drawn quadruped
  cells and any future code-drawn humanoid qualify; LPC-derived inits never do.
  Using LPC only as a *text style description* (no LPC pixels in the request) does not
  create a derivative; the compiler records which case applied.
- **CMU mocap:** free to use, modify, and redistribute, including commercially; credit
  requested, not required — we credit anyway (`CREDITS.md`: "This data was obtained
  from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217.").
  The cgspeed BVH conversion inherits these terms. Vendored BVH files used by imports
  are checked in so the import is reproducible.
- **Model outputs:** Qwen-Image-Edit weights are Apache-2.0 open weights and Replicate's
  terms assign output rights to the customer as between the parties — but **verify the
  2511 model card and current Replicate ToS before shipping any ownership claim**; until
  then, treat generated Tier-1 art conservatively (same CC-BY-SA posture as its inits
  where LPC-derived, internal-library otherwise). RISK, stated plainly: model-output
  copyright is unsettled law in several jurisdictions; nothing in this pipeline may
  *depend* on owning generated pixels — the free tier must always be sufficient to ship.

## Relationship to other tracks

The animals track (`2026-07-26-animals-spec.md` A0) already banks on the parametric
quadruped — this pipeline's importer must handle quadruped BVH (CMU has dog/horse-adjacent
data is NOT verified; TrueBones/AnyTop remain the fallback noted in the research doc — a
question for the plan's quadruped slice, not assumed solved). The tactical track's
posture/combat vocabulary (march, brace, loose arrow) is the next big clip consumer.
Implementation slices: `../plans/2026-08-03-npc-animation-appearance-plan.md`.
