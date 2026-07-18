# Paperdoll → Game: full runtime integration brainstorm

**Date:** 2026-07-18 · **Status:** brainstorm (pre-spec) · **Epic:** motion-studio / paperdoll
**Prompt:** "fully integrate the custom animation system into the game — music beat / dancing,
2+ NPC interaction, crowds (join/leave), marching formations, fighting, ragdoll on death, blunt
impacts, arrows, combining animations (run while waving arms), dismemberment, blood. What am I
not thinking of? Time to do NPCs properly."

---

## 0. Ground truth (what exists today)

- **Rig** (`src/render/paperdoll/rig.ts`): `AnimTemplate` (chips: rect+pivot+parent+z),
  `Clip` (keyframe `tracks` per chip, `couple` gain/lag couplings, `stamps` pre-FK pixel
  swaps + post-FK **anchored** stamps, `plant` exact ground anchoring), `sampleClip` →
  `ChipPose[]`, `chipWorldTransforms`, `renderPose` (supersample rotate + quantize),
  `bakeClip` → PNG strip. All CPU, all deterministic, all authoring-time today.
- **Studio** `?studio=motion`: donor sheets → live clip playback → baked strips.
- **Runtime NPCs**: stock LPC spritesheet frames picked by movement state; y-sorted
  instanced WebGPU entity pass (`entity-draw-list.ts` → `gpu-scene.ts`).
- **Adjacent seams we will reuse**: SimEvent bus + tidings ring, site-connectome seats
  (`pickSeat`/`siteSelect`), `tagScreenPoints` anchor-effects seam (lanterns/birds),
  parametric-sprite-cache (IDB, keyed compose cache), authored music cues, seeded sfc32
  everywhere, trample/decal precedent for ground marks, mood/needs/traits per NPC.

## 1. The core architectural move: pose space is the runtime currency

Everything requested falls out of ONE promotion: stop treating the paperdoll as a
bake-time tool. Make `ChipPose[]` a first-class runtime value with a three-tier ladder:

- **Tier 1 — baked strips** (exists): common loops (walk/idle/pray) baked to atlas
  strips. Zero runtime cost. Crowds at zoom-out live here.
- **Tier 2 — pose player + frame cache**: run `sampleClip` (+ layering, §2) at runtime →
  pose → CPU `renderPose` raster → **memo cache** keyed
  `(templateId, wardrobeHash, quantized pose)`. Anything periodic converges to a small
  frame set and stops rasterizing. A 64px cell raster is ~microseconds; budget ~32 fresh
  rasters/frame, LRU in RAM, optionally spilling to the parametric-sprite-cache IDB store.
- **Tier 3 — physics poses**: ragdoll / impact springs write `ChipPose[]` directly (no
  clip). Uncacheable by design, but only a handful of NPCs are ever mid-death/mid-flinch.

Pixel-perfection is preserved because ALL tiers rasterize through the same supersample +
quantize path — the GPU never rotates a limb quad; it always draws a finished cell.

**Determinism boundary (write this in stone):** the sim stays truth; animation is
presentation. Animator state (current clip, phase, blends) lives render-side, is never
snapshotted, and never feeds back into sim numbers. Where presentation must persist
(corpse pose, severed-limb rest position, blood pools), derive it from sim facts via
seeded sfc32 (`seed = hash(npcId, deathTick)`) and fixed-step simulation → same replay,
same corpse, no `Math.random`, nothing stored.

## 2. Layered composition — "run while waving arms"

`PoseLayer { clip, phase, chips?: mask, mode: 'override' | 'additive', weight }`

- **Chip groups**: `locomotion` (root, legs), `gesture` (arms, trunk-lean, head). A layer
  claims a group; run-clip owns locomotion while wave-clip overrides arms and *adds* its
  trunk lean (additive keeps the run's bounce underneath).
- **Order of operations** (extends today's `sampleClip` pipeline): sample each layer →
  merge by mask/mode/weight → apply each clip's `couple` **within its own mask** → apply
  `plant` from the locomotion layer only (an airborne/ragdoll layer suppresses plants) →
  anchored stamps from whichever layer owns that chip.
- **Crossfade**: pose-space lerp (deg/dx/dy) over ~150 ms on every clip switch. This one
  feature kills all animation popping forever and costs a lerp.
- **Parameterization**: per-layer `weight` scales additive amplitude → one flinch clip
  serves light tap to heavy blow; one sway clip serves calm to ecstatic.

## 3. The animator: sim intent → presentation

New render-side component per NPC (NOT in `src/sim/`):

```
sim (truth)                animator (presentation)
  movement state      →      gait layer: idle/walk/run + rate from speed
  activity intent     →      base one-shots & loops (pray, work, carry, dance…)
  SimEvents           →      reactions: struck → flinch, died → ragdoll,
                             prayer answered → raise arms
  mood / needs        →      MODULATION: amplitude, tempo, posture offsets
```

- **Intents, not frames**: sim publishes `npc.intent = 'pray-ecstatic'`; the animator
  owns clip choice, transitions, layering. Small state machine: gait layer always
  running; one-shots stack and pop back.
- **Mood drives the body** (the sim-is-truth payoff): despairing NPCs get a standing
  slump additive layer; joyful ones walk with +15% bounce; fear tightens gestures. The
  numbers already exist — this makes them *visible*, which is the entire game thesis.
- **Game-rate**: animators tick on real time. At high rate / time-skip, skip animators
  entirely and resolve outcomes instantly (corpse = final rest pose, pools = final
  decal). Never try to fast-forward presentation physics.

## 4. Music beat + dancing

- **Beat clock**: the music layer publishes `{ bpm, beatPhase, nextBeatAt }` off
  `AudioContext.currentTime` (the only honest audio clock). Global singleton; the
  authored-music-cues system already owns tempo knowledge.
- **Dance clips are authored in beats, not seconds**: `durationBeats: 4`; playback rate
  = bpm. Clips start snapped to the next beat boundary.
- **Group sync is free**: every dancer reads the same clock ⇒ a festival crowd is
  automatically in step. Life comes from *deliberate* variety: per-NPC amplitude from
  mood, occasional half-beat offset dancers, mirrored variants.
- Festivals: `festival` SimEvent → congregation group (§6) at the site → members get
  `dance` intent. Fate can call it via a command verb.

## 5. Two-plus NPC interactions

- **Author paired clips to a shared contact frame, snap actors to slots.** No runtime
  IK between sprites — at 32px it's wasted precision. A handshake is two mirrored clips
  authored against a fixed A↔B offset; the session snaps both NPCs to those offsets.
- **`InteractionSession`** (render-side): participants, per-role clips, shared start
  time (⇒ sync), owner site/slot. Sim side: both NPCs in `interacting` state pointing at
  the session; site-connectome seats already solve "where do they stand".
- Vocabulary: converse (bust exists), trade hand-over, paired dance, spar, carry-body
  (two-slot), mourn at grave.

## 6. Crowds, formations, fighting — groups as first-class sim objects

The user's crowd note generalizes §5 from pairs to N:

- **`Group`** (sim-level, deterministic): `{ id, kind: 'crowd'|'congregation'|'formation'|
  'battle-line'|'dance-ring', members, anchor (point | site | moving path), layout }`.
  The layout function hands each member a **slot** (position + facing): ring for
  congregations, wedge/column grid for formations, loose Poisson scatter for crowds.
- **Join/leave is an NPC verb**: join = claim a slot, pathfind to it, adopt the group's
  intent channel; leave = release slot (layout backfills). Crowd assembly/dispersal is
  then emergent — and *watchable*, which matters for a god game (a miracle should
  visibly pull a crowd).
- **Formation march**: slots attach to a moving anchor following a road path (the road
  graph exists); members steer to their moving slot. March = walk clips **phase-locked
  to a step clock** (the beat clock with bpm = cadence) ⇒ everyone steps together;
  half-beat offset for left/right ranks reads as drill. `plant` metadata gives footfall
  timestamps ⇒ synced march-step audio for free.
- **Fighting**: a battle-line group pairs opposing slots into spar sessions (§5); combat
  *resolution* stays sim-side (a deterministic exchange system decides hits/wounds/
  deaths); animation consumes the event stream — strike one-shots, flinch overlays (§7),
  ragdoll on the death event (§8). Morale-break = leave-group en masse → rout, which is
  just crowd dispersal reused.
- **Perf**: a phase-locked crowd is tier-1 — every member shows the SAME frame index of
  the same baked strip (one texture, N instances). Crowds are the *cheapest* thing on
  screen, not the most expensive. Individual tier-2 animators activate only near-camera.

## 7. Impacts: blunt blows and arrows

- **Flinch** = additive overlay, 150–250 ms, direction-parameterized (sign/mirror),
  weight ∝ impulse. Trunk recoil + head whiplash + one-step stagger (root dx spring).
- **Knockback** = critically-damped spring on the root offset. No physics engine needed.
- **Arrows**: projectile = ordinary draw-list entity (rotated quad). On hit it becomes an
  **attachment**: pinned to a chip, carried by `chipWorldTransforms` — exactly the
  anchored-stamp math, but rendered as a separate quad so it can overhang the cell and
  z-sort. Sticks through flinch, ragdoll, and into the corpse pose.
- **Generalize immediately: `Attachment { chip, offset, deg, sprite }`** — arrows,
  held tools (scythe, bucket, torch), banners, lanterns. This is arguably the single
  highest-value mechanism in the whole plan for daily-life texture, and it's ~already
  built (it IS `applyAnchoredStamps` with a quad instead of a pixel paste).
- **What LPC gives us for props/weapons**: upstream ULPC has large weapon/shield
  layer sets (swords, spears, bows, staves, kite/round shields, some tools) — but they
  are **pre-posed full-sheet overlays** hand-aligned to the STOCK animations frame by
  frame, with **no attachment-point metadata**; they cannot follow our custom clips.
  Our local harvest vendored wardrobe only (arms/body/feet/hair/head/legs/torso).
  Plan: harvest each weapon ONCE — crop it from a frame where it sits clear of the
  body (e.g. thrust-extended) or from the LPC flat item-icon collections — and pin it
  via our attachment system. Our chip world transforms give LPC the attachment points
  it never had; one cropped sprite then works in every clip we ever author. LPC's
  scenery/clutter collections (furniture, containers, food, farm tools) are unrigged
  static tiles — fine as-is for site props, harvestable as hand-held attachments too.

## 8. Ragdoll on death

- On `npc:died`: capture current pose → convert chips to a 2D **verlet chain** (joints =
  particles, bones = distance constraints, per-joint angle limits) in cell space; gravity
  down-screen; ground = terrain-lifted sole line; ~0.5–1 s of tumble with damping →
  rest → rasterize ONCE → corpse is a static cached sprite thereafter.
- Initial impulse from cause (arrow direction/velocity on the struck chip; blunt = big
  root impulse) so deaths read differently.
- **Deterministic**: fixed-step, seeded by `(npcId, deathTick)` ⇒ replay/scrub shows the
  identical crumple; nothing persisted but the sim death fact.
- Verlet on ≤10 particles is trivially cheap; cap ~8 concurrent ragdolls, instant-settle
  the overflow.

## 9. Dismemberment + blood

Chips ARE limbs, so severing is architecturally almost free — but see the tone gate.

- **Sever**: drop chip + descendants from the render set; spawn a debris entity from the
  chip's raster (single rigid tumble, land, rest — mini-ragdoll); stump = pre-FK stamp
  (zero-crop eraser + stump patch) at the joint — the stamp system as-is.
- **Blood**: (a) spurt = small GPU particle burst at the joint's world transform
  (`tagScreenPoints` seam); (b) drips from debris; (c) **pooling = ground decal layer**
  — fading splat sprites, NOT tile mutation (trample taught us tile writes need
  `bumpTilesRev` and permanence we don't want). Decals grow seconds, fade over
  game-hours, are presentation-only (not saved).
- **Tone gate (decide before building)**: Pratchett-adjacent world — does it want gore?
  Ship a dial: `off | pixel-tasteful (default) | full`. Severing as a *sim fact* (a
  one-armed veteran NPC with changed capabilities) is a separate, bigger design
  decision than the VFX — flagged, not assumed.

## 10. What you weren't thinking of

1. **Facing coverage is the real cost multiplier.** Everything so far is south-facing.
   Combat, marching, and dance mostly read in PROFILE. Side template + mirroring
   (east = flipped west) is the priority prerequisite — already the epic's NEXT
   (side-facing kneel gate). Every clip needs a per-facing variant or a mirror rule.
2. **Transitions.** Without pose-space crossfade (§2) every feature above pops. Build it
   first; it's a lerp.
3. **Wardrobe × runtime FK.** Per-layer chip rasters compose per NPC; cache keys need a
   `wardrobeHash` (parametric-sprite-cache pattern). Also unlocks visible droppable/
   attachable gear later.
4. **Sound is animation metadata.** `plant` contacts = footsteps; clip event tags
   (`{t, event:'strike'}`) = whoosh/thud/cloth. The march step-clock doubles as the
   drum track.
5. **LOD.** Far/zoomed-out NPCs: baked strips only, no tier-2/3, no decals. Cap fresh
   rasters/frame; the cache makes steady-state cheap but spikes (festival start) need
   the compose-scheduler treatment (front/back lanes exist).
6. **Time-skip must resolve presentation instantly** (§3) — no ragdoll simulation during
   a year-skip; corpses/pools jump to final state.
7. **Cell overflow.** Ragdolls, debris, and attachments can exceed the 64px cell —
   render them as free draw-list entities, never clamp to the cell raster.
8. **Fate + agent-driven UI.** Animation intents should be **Commands** in the
   capability registry (`play_gesture`, `assemble_crowd`, `set_formation`) so Fate and
   the MCP tools can direct scenes — per the standing all-UI-through-agents rule. A
   miracle beat where Fate makes the crowd kneel is pure payoff.
9. **Authoring throughput is the long pole.** The vocabulary is ~30–50 clips × facings
   (gaits, work loops per profession, combat set, dances, socials, reactions). Clips are
   plain data ⇒ LLM-draftable (Fate-authored clips validated in studio, like
   `author_building`); BVH/Mixamo ingest (already on NEXT) retargets mocap to chip
   rotations for the hard ones (fights, dances).
10. **Injury as sim state** (limp gait = permanent locomotion modifier, bandage overlay
    stamps) — cheap follow-on once §7 exists, big narrative texture.
11. **Corpse/grave lifecycle.** D1 mortality already exists — corpses should decay to
    graves (site-connectome objects, mourning interactions) instead of persisting as
    pixels forever.

## 11. Suggested sequencing (each slice ships alone)

| # | Slice | Unlocks | Risk |
|---|-------|---------|------|
| 1 | **Pose player + layering + crossfade + animator/intent seam** | everything | core; medium |
| 2 | **Attachments** (props/arrows as chip-pinned quads) | daily life, combat feel | low |
| 3 | **Reactions**: flinch/knockback additives + SimEvent wiring | combat feel | low |
| 4 | **Beat clock + dance + festival congregation** | charm, group sync proof | low |
| 5 | **Groups**: join/leave, slots, formation march on roads | crowds, armies | medium |
| 6 | **Interaction sessions** (paired clips on site slots) | social texture | medium |
| 7 | **Ragdoll + corpse baking** (seeded verlet) | death | medium |
| 8 | **Combat resolution loop** (sim) consuming 3+5+7 | fighting | high (sim design) |
| 9 | **Dismemberment + blood decals** (behind the gore dial) | spectacle | low tech / tone Q |
| — | **Side facing** | multiplies all of the above | parallel track, start early |
| — | **Flora wind (baked)** — paperdoll grass/flower templates, seamless sine-loop clips, per-instance phase; replaces vertex sway with on-grid frames (AUTHORIZED 2026-07-18) | pixel-perfect wind + low-power floor | low; shader frame-select dial is a later renderer slice |

## 12. Open questions for the user

- Gore dial default? And is limb loss ever a *sim* fact (one-armed NPCs)?
- Combat scope: skirmish flavor (raids, brawls) or real battles (formations of 20+)?
- Dance: authored clips only, or beat-procedural (parametric bounce/step from bpm)?
- Do we commit to side-facing BEFORE slice 1 lands, or prove the runtime south-only?
