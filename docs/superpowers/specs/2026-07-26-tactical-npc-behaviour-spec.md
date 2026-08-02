# Defence, Attack & Strategic Positioning — tactical NPC behaviour (spec)

**Direction (user, 2026-07-26):** defence/attack and strategic positioning are major themes
for NPC behaviour going forward. This spec frames the substrate; the wall-garrison plan
(`../plans/2026-07-26-wall-garrison-plan.md`) is phase 1 of it.

**The Small Gods angle (why this isn't a generic RTS layer):** battles are belief events.
A siege is the highest-stakes prayer surface in the game — terror spikes the safety need,
answered pleas at the wall mint devotion, an unanswered gate lost to a rival's warband is a
schism accelerant. Every tactical mechanism below must expose seams the divine layer
(inbox, omens, Fate beats, rival claims) can act through. The sim fights; the gods matter.

## Layer model

0. **Groups** (the spine — user, 2026-07-26: "grouping and OOS targeting"). A `Group` is a
   first-class sim object between the two existing population tiers: cohort (statistical,
   always-on) and materialized NPC (near camera). `{ id, kind: 'garrison'|'patrol'|
   'warband'|'procession'|'congregation', roster: NpcId[], objective, pos, strength }`.
   The GROUP is simulated always (cheap: one position on the road graph / one objective
   step per tick-window); its MEMBERS are individually simulated only when materialized —
   the same camera→materialize contract cohorts already honour. This is what makes
   off-screen coherence (a warband marching while unwatched, a patrol holding its circuit)
   affordable, and it is REQUIRED before the attack side: war parties must move as one
   object, not twelve pathfinding entities.
   **OOS targeting:** `group` becomes a command targetKind, so player/agent/Fate/rival
   verbs (whisper to the captain, omen over the procession, muster the garrison) address a
   group whether or not it is materialized. (Growing targetKind verb sets breaks the
   hover-affordance ranking pins — update them in the same commit, as always.)
   Phase 1 pre-shapes this: the garrison roster is held as ONE settlement-keyed object
   (a proto-group), never scattered per-NPC.

1. **Tactical positions** (static, pure world derivation) — a typed vocabulary of places
   worth standing, derived deterministically from what worldgen already committed:
   - `wall_station` — allure posts between merlons (barrier runs; phase 1 W0)
   - `gate_choke` — the snapped gate opening, inside face (the place you hold)
   - `tower_post` — tower crowns (overwatch; `TowerPlacement` already records role)
   - `rally` — where civilians shelter: temple > keep > market, per settlement
   - `approach` — outside positions an attacker wants: per-ring-side, only on
     `defends === 'open'` legs (the `RingSegment` classification worldgen already emits —
     water/steep legs defend themselves; that data was built for exactly this and has no
     sim consumer yet)
   One module owns this (`src/world/tactical-positions.ts`, grown from phase 1's
   `barrier-circulation.ts`); everything downstream speaks position ids, not coordinates.

2. **Threat field** (dynamic, sim) — per-settlement `ThreatState { level, kind, dirHint }`.
   First source: the contention ladder (`tension`→`schism`→`holy_war` maps to rising threat).
   Later sources: war parties (their real approach direction), beasts, Fate-forced events.
   Hysteretic like contention itself; decays when the source cools.

3. **Posture** (per settlement, derived) — `calm | wary | mustered | besieged`, a pure
   function of threat + standing orders. Posture drives role behaviour:
   - soldiers: calm=drill/patrol circuits · wary=gate watches manned · mustered=walls manned
     (phase 1) with **threat-weighted assignment** (threatened open legs first) · besieged=
     all stations + towers, no sleep rotation
   - civilians: wary=stay near home · mustered+=flee to `rally`, indoors at night
   - priests: at the temple, worship activity (a frightened town praying is the point)
   - the lord: existing `lord.ts` stances become the order source (`set_lord_stance` is
     already Fate-coached — posture is how those words reach feet on the ground)

4. **Attack side** (last) — war-party MVP: a hostile band (rival-aligned soldiers) spawned
   by an event/Fate beat, approaching along roads toward an `approach` position, contesting
   a gate. Resolution abstract at first (strength vs garrison strength + wall bonus, no
   per-hit combat), but the *positioning* is real: they stand where the derivation says
   attackers stand, defenders man the legs facing them. Outcomes feed belief: terror events,
   plea storms, rival claim pressure, lord/lineage consequences (D1 mortality already
   handles deaths).

## Phase plan

- **Phase 1 — SHIPPING NOW** (wall-garrison plan, W0–W5): stations, garrison, muster,
  render-on-wall, tower circulation.
- **Phase 2 — T-slices** (next orchestration round):
  - T0 Group substrate: the `Group` object, group-tier stepping, materialize/fold contract,
    `group` targetKind + verbs; garrison retrofits onto it (its roster already has the shape)
  - T1 generalise positions module (gate_choke, tower_post, rally, approach)
  - T2 ThreatField + posture derivation (sim system; contention-fed)
  - T3 threat-weighted garrison + civilian shelter behaviour
  - T4 patrol circuits + gate watches (the peacetime read of the same positions)
- **Phase 3 — T5+**: war-party MVP, siege beats (Fate `arm_staged_beat` fits unchanged),
  divine interventions at the wall (miracle targets: gate holds, wall stands), narrated
  battle tidings.
- **Real combat is a confirmed goal, sequenced AFTER animals** (user, 2026-07-26: "bows and
  arrows, swords, the whole bit… animals first"). The weapon layer (projectiles, hit
  resolution, wounds, kill path) is BORN in the animals track (hunting/predators — see
  `2026-07-26-animals-spec.md` A3/A4) and warfare inherits it; the war-party MVP's abstract
  strength-vs-strength resolution is the placeholder that upgrade replaces.

## Invariants (carried from phase 1, non-negotiable)
Sim is truth; positions/threat/posture are sim state and the renderer only expresses them.
`src/sim/` cycle-free, `Math.random`-free, no render imports. Wall tiles stay unwalkable —
on-structure movement is parametric. All orders/UI through registry verbs + affordances.
1:1 realtime windows. Every layer symmetric for player, rivals, and no-god settlements.
