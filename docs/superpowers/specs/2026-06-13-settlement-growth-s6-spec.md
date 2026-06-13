# Settlement growth S6 — civic life (graveyard-filling, working mill, ward verbs)

**Date:** 2026-06-13 · **Status:** spec · **Branch:** `feat/settlement-growth-s6` (off main `39eb74f`)
**Builds on:** S5 (civic entities + reservation) — closes the three deferred tails.

## Goal

S5 emitted civic *entities* (well, graveyard) and reserved their ground. S6 makes
them *live*: the graveyard fills as mortals die, the mill becomes a real working
building (not just reserved ground), and Fate/the Create panel can rename and
re-type wards. All deterministic, `Math.random`-free, agents-direct-via-intents.

## Sub-slice A — graveyard-filling (`buried` count over deep time)

A churchyard 2×2 plot can't physically hold centuries of dead, so the scalable
model is a **count**, not relocation (the persistence principle is unchanged — the
NPC still becomes a persistent `remains` entity; the graveyard just *tallies* it).

- `recordBurial(world, poiId)` (new, `src/world/civic.ts`): find the graveyard
  entity (`kind === 'graveyard'`, `properties.poiId === poiId`); increment
  `properties.buried` (init 0). No-op if the settlement has no graveyard (a camp,
  a lake). Pure, deterministic, no rng.
- `killNpc` calls it with the dead NPC's `homePoiId`. This covers **both** death
  paths automatically — the live `MortalitySystem` and the closed-form
  `applySkip`/`projectTurnover` both route through `killNpc` — so a 200-year skip
  past a settlement leaves a graveyard whose `buried` reflects the turnover.
- `buried` rides in the entity's `properties`, so it serializes in the snapshot
  with no schema change.

## Sub-slice B — mill as a working building

S5 reserved 2×2 mill ground beside water but emitted no structure. S6 makes the
mill a real building entity so it renders (y-sorts, casts shadow) and can host
work.

- New `watermill` Blueprint preset (`src/blueprint/presets/index.ts`): 2×2
  footprint, timber walls / wood roof, a south door, a wall vent for the wheel
  housing read. Matches the `CIVIC_RULES.mill` 2×2 reservation.
- In `placeSettlement`, the civic loop emits a **blueprint building** for `mill`
  (via `blueprintEntity` + `clearFootprint`, tagged `building` + `mill` +
  `workplace`) instead of a prop — keyed `${poi.id}_civic_mill`. Well/graveyard
  stay props. The mill's tiles are already in `civicSet` (reserved), and
  `clearFootprint` makes them solid like any building.
- `CIVIC_ENTITY_KINDS` is now `{ well, graveyard }` only; the mill takes the
  building branch. Unknown/agent civics still reserve-only.
- `WORLD_CONTENT_VERSION` 6 → 7 (worldgen output gains mill building entities).

## Sub-slice C — ward verbs (`rename_ward`, `retype_ward`)

District authoring on the command channel, mirroring `grow_settlement`.

- `CommandVerb` gains `'rename_ward' | 'retype_ward'` (authoring tier).
- Target `{ kind: 'settlement', poiId }`; payload `{ wardId, name }` (rename) or
  `{ wardId, type }` (retype, validated against the `Ward['type']` union).
- `renameWard*/retypeWard*` in `src/sim/command/ward-verbs.ts`: precondition
  rejects a non-settlement target, a missing plan, a missing ward id, or an
  invalid type; apply mutates `plan.wards[i].name`/`.type` in place. Deterministic,
  no entity churn.
- `registry.ts` registers both (authoring tier, cost 0, targetKind settlement);
  verb count 16 → 18; `command-registry.test.ts` updated.

## Invariants kept

Seeded/deterministic; `Math.random`-free (guard green); agents direct via typed
intents + planner inputs, never raw tile edits; civic ground stays reserved so
buildings never overlap the well/graveyard/mill.

## Tests (`tests/unit/settlement-growth-s6.test.ts`)

A: burial increments the right graveyard; no graveyard ⇒ no-op; death via
`killNpc` tallies; `applySkip` deep-time accrues `buried`. B: a village beside
water emits a `mill` **building** (carries a blueprint) on reserved ground, no
overlap; landlocked villages emit none. C: rename/retype mutate the plan;
preconditions reject bad target/ward/type; `executeCommand` end-to-end.
