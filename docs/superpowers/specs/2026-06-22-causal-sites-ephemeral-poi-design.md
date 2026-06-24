# Causal Sites — Ephemeral, Event-Born POIs (W-I)

> **Status:** design-first. No code. Grafts onto the shipped water-unification epic
> (W-E…W-H) and the Fate brain. Read [[project-climate-substrate]] and
> `docs/superpowers/specs/2026-06-18-belief-powers-divine-inbox-design.md` first.
>
> **One-line:** a *causal site* is a transient place the world produces — a flooded
> plain, a scorched field, a battle ground — that exists for a while, can be **focused**
> by the player, is **addressable by Fate**, seeds belief while it lasts, and then fades
> when it stops mattering. It is the missing "the world can make new places, not just new
> events at old places" primitive.

---

## 1. Why — the gap

The flood loop shipped in W-H proved the *edge* works: a god floods a plain →
`place_flooded` → believers' `flood` conviction rises → Fate wakes. But it leans on a
narrow hack: `buildFateContext` does `if (ev.type === 'place_flooded') poiIds.add(ev.poiId)`
to let Fate address the **existing settlement** that happened to flood. (fate-context.ts:68)

That hack reveals the real limitation in the code (confirmed by investigation):

- **POIs are static, worldgen-only.** `WorldSeed.pois: POI[]` is built at generation and
  persisted in saves; there is no runtime POI creation. (types.ts:74, schema.ts)
- **Lifetime exists only for *events at* places**, never for places themselves.
  `ActiveEvent { durationTicks, ticksElapsed }` decays and expires
  (settlement-event-system.ts:122) — but the POI it's attached to is eternal.
- **Focus is NPC-only.** `selectedNpcId` / `selectedBuildingId` exist; there is no
  `selectedPoiId` and no way to focus a *place*. (state.ts:14, interaction-controller.ts)
- **Fate can only address active-thread settlements** (`validPoiIds` from
  `thread.subject.poiId`), plus the one-off flood hack.

So today a flood on an **empty plain** (no settlement, no NPCs, no thread) produces
*nothing addressable* — no place id, no focus target, no Fate subject, no belief site.
The drama evaporates. A causal site is the entity that catches it.

This is the player-facing promise from the original water brief, made real:

> "shaking a stormcloud over a plain to rain a lot on it … pipe that back into the fate
> agent through the system, backwards, allowing the player to dynamically influence the
> state machine from the other end."

---

## 2. What — the model

A **CausalSite** is a first-class, runtime-born, time-limited place with a footprint, a
cause, a lifetime, and a decay curve. It is NOT a `WorldSeed.POI` (those stay immutable +
authored). It is a new sibling layer the rest of the game treats *as if* it were a POI for
the three things that matter: **identity (a poiId), focus, and Fate addressing.**

```ts
// src/world/causal-site.ts  (NEW — pure data + store, sim-safe, no render imports)
export type CausalKind =
  | 'flood'          // standing water on land (W-H born)
  | 'scorch'         // future: drought/fire
  | 'battlefield'    // future: combat aftermath
  | 'miracle_mark';  // future: a miracle's lingering trace

export interface CausalSite {
  id: string;                 // 'causal:flood:0007' — globally unique, poiId-compatible
  kind: CausalKind;
  name: string;               // 'The Drowned Reach' — generated from kind + locale
  pos: { x: number; y: number };
  cells: Int32Array;          // row-major footprint (reuses the flood-watch disc model)
  bornTick: number;
  lifeTicks: number;          // expected lifespan; refreshed while the cause persists
  ageTicks: number;
  intensity: number;          // 0..1 current (flood depth, fire heat…), drives decay + belief
  cause: string;              // attribution: spiritId or 'nature'
  /** Why it persists: while the underlying field still satisfies the birth condition,
   *  ageTicks is held at 0 (the site "renews"). Once the cause drains, it ages out. */
  sustained: boolean;
}
```

**Lifecycle (reuses the `ActiveEvent` decay precedent, not a new clock):**

```
   birth            sustain (cause active)         fade               death
   ─────►  active  ◄────────renew ageTicks=0──────► ageTicks++  ──►  expired
   place_   (focusable,                              (intensity      (removed from
   flooded   Fate-valid,                              decays,         store; emits
   edge)     belief-seeding)                          still valid)    site_faded)
```

- **Birth:** a `FloodWatch` "flooded" edge that hits a place with **no owning settlement
  POI** spawns a `CausalSite` (kind `flood`). A flood that hits an *existing settlement*
  keeps today's behaviour (settlement is the subject) — causal sites fill only the gap.
- **Sustain:** each weather tick, if the footprint still satisfies the birth predicate
  (peak `floodM ≥ FLOOD_ON_M`), `ageTicks` resets to 0 and `intensity`/`name` update. The
  site renews as long as the god holds the storm.
- **Fade:** once the cause drains (`< FLOOD_OFF_M`, same hysteresis as FloodWatch),
  `ageTicks` climbs; `intensity` eases toward 0 over `lifeTicks`.
- **Death:** `ageTicks ≥ lifeTicks` → removed; emit `site_faded`. (Mirrors
  `settlement_end` + cooldown so the same plain doesn't thrash a new site every tick.)

---

## 3. How — the three grafts

The whole design is deliberately **three small grafts onto existing seams**, not a new
subsystem. Each is independently shippable.

### Graft A — identity & store (the place exists)

`CausalSiteStore` lives on `GameState` next to `floodWatch`/`weather` (all the W-G plumbing
is already there):

```ts
// state.ts
causalSites: CausalSiteStore | null;   // init null, built in installWeather()
```

- **Deterministic + snapshotable.** Follows the exact W-G pattern: `serialize()` /
  `hydrate()`, captured in `snapshot.ts` (`causalSites?: CausalSiteSnapshot`), tolerant
  `?? []` for old saves. Ids are assigned from a monotonic counter in the store (seeded,
  not `Math.random` — sim-layer rule).
- **Born in `WeatherSystem.tick`** right where `place_flooded` is appended today
  (weather-system.ts:40): if the flooded place has no settlement POI, `causalSites.birth(...)`.
  This keeps all flood→world reaction in one deterministic system.
- **Unified poiId resolution.** A tiny helper `resolvePlace(state, poiId)` returns either a
  `WorldSeed.POI` or a `CausalSite` by id prefix (`causal:`). NPC `homePoiId`, `activeEvents`
  keys, and thread subjects are all already *just strings* — causal ids slot in without
  schema changes. This is the keystone that lets the rest of the game treat a causal site as
  a place for free.

### Graft B — focus (the player can attend to it)

Today focus is NPC/building only. Add `selectedPoiId: string | null` to `GameState` and a
hit-test for causal-site footprints in `interaction-controller.ts` (clicking inside a
site's `cells` selects it). On selection:

- The HUD shows a **site card** (name, cause/attribution, intensity, time-left) — the
  belief-inbox panel pattern from the belief-powers epic is the model.
- Selecting a causal site is a valid **LLM-backfill focus** (llm-backfill.ts): the narration
  prompt gets "a god-made flood drowns this reach; N believers nearby witnessed it" instead
  of an NPC digest. This is where "focus on the flood and get a scene" pays off.

> **Scope note:** focus is the optional, most player-facing graft. A/C deliver the
> Fate/belief loop headless; B is what makes it *visible*. Ship A+C first, B second.

### Graft C — Fate addressing (Fate can act on it)

Replace the `place_flooded` hack with a principled rule in `fate-context.ts`:

```ts
// every ACTIVE causal site is a valid Fate subject, with a one-line digest
for (const s of state.causalSites?.active() ?? []) {
  poiIds.add(s.id);
  lines.push(`- causal site "${s.name}" (${s.id}): ${s.kind}, intensity ${s.intensity.toFixed(2)}, ${s.cause}`);
}
```

- `validPoiIds` now legitimately contains causal ids; `arm_staged_beat`'s `subjectPoiId`
  validator (fate-tools.ts) accepts them unchanged.
- `StagedBeat.subject` already supports `{ kind:'settlement'; poiId }`; add
  `{ kind:'site'; siteId }` to `ThreadSubject` so a beat can be *armed against the site
  itself* ("a drowned-field omen, discovered if anyone returns here"). When the site fades
  before discovery, its armed beats expire with it (beats already have an `expired` status —
  staging-types.ts:15).
- `FateTrigger.isSignificant` already returns true for `place_flooded`; add `site_born` for
  the empty-plain case so Fate wakes for god-made sites with no settlement.

---

## 4. Belief while it lasts (closes the player→state loop)

W-H seeds `flood` belief into NPCs whose `homePoiId === floodedPoiId`. Causal sites
generalize that to **proximity, not residency**: any NPC within / adjacent to the site's
footprint who *witnesses* it accrues belief in the causing spirit, scaled by `intensity`
and decaying as the site fades. This is the mechanism by which "a god floods a plain near a
village" converts spectacle into conviction even when the plain itself has no residents —
the reusable `seedSiteBelief(world, site)` replaces the residency-only `seedFloodBelief`.

Attribution is honest (the belief-powers principle): belief is seeded **for the spirit named
in `site.cause`**, at the act site, only for NPCs who could perceive it.

---

## 5. Slices (each independently shippable, test-first)

| Slice | Deliverable | Risk |
|---|---|---|
| **W-I-a** | `CausalSite`/`CausalSiteStore` + serialize/hydrate + snapshot; born on empty-plain floods in `WeatherSystem`; `site_born`/`site_faded` events; unit tests for birth/sustain/fade/decay determinism | low — pure data, mirrors W-G |
| **W-I-b** | Fate addressing (Graft C): active sites in `validPoiIds`, `{kind:'site'}` thread subject, `site_born` trigger; remove the `place_flooded` hack | low — extends existing validator |
| **W-I-c** | Proximity belief `seedSiteBelief` replacing residency-only seeding | low — generalizes W-H |
| **W-I-d** | Focus (Graft B): `selectedPoiId`, footprint hit-test, site card, backfill focus | medium — touches interaction + UI + LLM prompt |
| **W-I-e** *(later)* | Second `CausalKind` (scorch/drought or miracle_mark) to prove the abstraction isn't flood-only | low once a/b/c exist |

**MVP = W-I-a + W-I-b + W-I-c** (headless loop: god floods empty plain → site is born →
nearby NPCs believe → Fate can stage a beat there → site fades, beat expires with it). W-I-d
makes it visible; W-I-e proves generality.

---

## 6. Determinism, layering, and what we explicitly DON'T do

- **Deterministic + snapshot-safe** from slice a (no `Math.random`; ids from a seeded
  counter; serialize/hydrate; tolerant of old saves). Verified by the existing
  `no-random-in-sim` guard + a new `causal-site` determinism test.
- **Sim never imports render.** `CausalSiteStore` is sim-side; it reads the flood field
  through the existing `WeatherStepper.floodOffsetM()` seam (the same injection W-G uses).
- **No `WorldSeed.pois` mutation.** Authored POIs stay immutable; causal sites are a parallel
  store. This keeps worldgen, save-compat, and the studio untouched.
- **Not** a generalized "runtime POI authoring" system, **not** persistent new settlements,
  **not** terrain mutation (the flood field already carves visually via W-E). Causal sites
  are *ephemeral by definition* — if a place should become permanent, that's a settlement-
  founding thread, a different epic.

---

## 7. Open questions (resolve before W-I-a)

1. **Naming.** Generated from `kind` + nearest biome/landmark? ("The Drowned Reach of
   Ironvein") — or a small seeded name table per kind? (Leaning: kind-prefixed + nearest POI
   name, deterministic.)
2. **Footprint source.** Reuse the flood-watch disc, or trace the actual wet-cell blob each
   tick? (Leaning: born from the wet-cell blob snapshot at birth, frozen — cheaper, stable
   for hit-testing and belief proximity.)
3. **Coalescing.** Two adjacent flooded plains → one site or two? (Leaning: merge by
   footprint overlap to avoid site spam; this mirrors the settlement-event cooldown intent.)
4. **Does a causal site dampen if the god stops paying attention** (Fate pacing), or purely
   on the physical cause draining? (Leaning: purely physical for v1 — the cause is the
   storm; attention is Fate's separate concern.)
