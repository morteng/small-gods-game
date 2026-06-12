# Settlement growth & placement system (brainstorm)

**Date:** 2026-06-13 · **Status:** brainstorm (user-directed) · **Builds on:** parametric settlement epic G1 (anchors + linear structures), era-aware worldgen, D1 mortality/birth, D2 time-skip

## What the user asked for

An overall placement system that draws paths/roads/streets, places buildings
logically, and **dynamically grows a settlement from nothing to a town** —
partially WFC-constrained ("docks must be beside a river or lake") and
terrain-aware. Plus "things I'm not thinking of".

## Where we already are

- `building-placer.ts` does a road-first organic layout at WORLDGEN: internal
  settlement roads (linear/branching/grid), spiral-search placement, era-picked
  presets, Bresenham connection paths between POIs.
- G1 gave us world-space door/gate anchors and functional walls/gates that
  pass A*; `place_building` exists as an authoring verb (Create panel / Fate).
- Settlements are **static after worldgen** — no code adds buildings during
  play. D1 gives population dynamics (births/deaths) with nowhere to live.

## Core idea: one growth model, two consumers

A deterministic, seeded **SettlementPlanner** that, given a settlement's state
(population, era, wealth/belief, terrain), proposes the next placement actions.
Run it:
1. **At worldgen** — iterate it N steps to "pre-grow" a settlement of the
   target size (replaces the one-shot layout; villages get history for free —
   the oldest buildings cluster at the founding well/green).
2. **During play** — the sim triggers a step when growth conditions fire
   (population per dwelling exceeded, new trade unlocked, era advance, Fate
   asks for it). The same code path, so a town grown live looks like a town
   generated old.

This is the same "deterministic substrate + LLM flavour" split as the rest of
the game: the planner is pure sim (seeded RNG, no Math.random — the guard test
applies); Fate/narration can REQUEST growth or veto it, never place pixels.

## The placement vocabulary (slots, not coordinates)

Growth proposes **slots** scored against constraints, not raw tiles:

- **Road graph first.** A settlement is a graph: founding node (well / green /
  crossroads / dock), through-road, lanes branching as it grows. Buildings
  address slots ALONG edges (frontage), facing the road (uses G1 door
  anchors; pairs with the multi-view facing work). Ribbon development, then
  infill, then back lanes — the medieval growth sequence.
- **Constraint rules per building type** (the WFC-ish part — adjacency
  constraints solved greedily with backtracking, not a full WFC solve):
  - dock → adjacent to water edge; mill → on stream; tavern → on the
    through-road near the gate/green; smithy → settlement edge, downwind
    (fire risk); temple → green/square frontage, or hilltop; manor/keep →
    elevated, set back; barn/granary → field side; midden/tannery → downstream.
  - Soft scores (sun aspect, slope < threshold, flood distance) + hard
    vetoes (water, existing footprint, road).
- **Zones emerge, not drawn:** green/market square = a road-graph node typed
  `plaza` that repels buildings to its frontage ring; churchyard = reserved
  apron around the temple; field strips radiate outside the last lane ring.

## Growth drivers (sim integration)

- **Population pressure:** dwellings have capacity (blueprint `occupancy`);
  births (D1) over capacity → queue a cottage slot. Deaths/abandonment (the
  abandonment system exists) → ruins or infill candidates.
- **Era advance:** era change re-weights the preset table (yurt → cottage →
  townhouse) and unlocks types (temple_small → church+tower from the
  reference doc's ready specs).
- **Wealth/belief:** prosperity need + belief levels gate upgrades (shrine →
  temple; palisade → stone wall — linear structures already exist).
- **Time-skip (D2):** `applySkip` calls the planner with N years of projected
  turnover — the closed-form bridge already projects population; the planner
  converts that to K growth steps so a +50y skip returns a visibly grown town.
- **Fate/levers:** `place_building` already exists; add `grow_settlement(n)`
  as a command-channel capability so rivals/Fate can develop their followers'
  villages.

## Things you might not be thinking of (requested)

- **Bridges & fords:** the road walker should cross water at the narrowest
  point and stamp a bridge entity — instant landmark, and docks/bridges anchor
  trade settlements.
- **Wells:** every founding gets one; medieval settlements are water-radius
  bound — a natural growth limiter (new well unlocks a new quarter).
- **Graveyard:** D1 produces `remains` — give them a place; churchyard fills
  over generations (visible deep-time storytelling, perfect for time-skip).
- **Defensive rings:** palisade ring at village→town transition, gates on
  road crossings (G1 gates already pass A*), later stone; the OLD ring becomes
  an internal street when outgrown (the classic European ring-road fossil).
- **Road hierarchy rendering:** path (dirt) → lane (gravel) → street (cobble)
  by traffic/age; upgrades when frontage fills.
- **Ruins & memory:** never delete — burned/abandoned buildings decay in
  stages (sim already has abandonment); ruins are re-colonizable slots.
- **Terrain memory:** placements should leave terrain edits (cleared trees,
  levelled ground) so removal doesn't leave virgin forest in mid-town.
- **NPC workplace binding:** each non-dwelling slot creates jobs; the
  activity system should route NPCs to their workplace — growth changes
  daily-life patterns visibly.
- **Determinism & saves:** the plan state (road graph, slot queue, planner
  RNG) must serialize into the snapshot like everything else.

## Suggested slices

1. **S1 — Settlement plan model:** `SettlementPlan` (road graph + typed nodes
   + frontage slots + constraint scorer), worldgen builds it, placer consumes
   it. Pure refactor of today's layout into the plan/execute split; same
   visual output class, but doors face roads. (Foundation, no new behavior.)
2. **S2 — Iterative growth at worldgen:** generate by running K planner steps
   (founding → ribbon → infill); settlement age becomes visible.
3. **S3 — Live growth:** sim system (slow cadence like mortality 0.25 Hz)
   fires growth steps from population pressure; new buildings animate in
   (construction state = scaffold material on the blueprint).
4. **S4 — Constraint catalogue:** docks/mills/bridges/wells + water-aware
   road walker upgrades.
5. **S5 — Skip integration + Fate lever:** D2 turnover → growth steps;
   `grow_settlement` capability.

S1 should get a full spec/plan next; it's the keystone the rest stack on.
