# Animals — livestock, wildlife, and the road to combat (spec draft)

**Direction (user, 2026-07-26):** actual fighting — bows and arrows, swords, the whole bit —
is a confirmed future goal, but **animals come first**. Animals are both an aliveness win in
their own right and the proving ground for every combat mechanism: hunting debugs projectiles
and hit resolution, predators debug threat/response, an animal death debugs the kill path —
all before a human ever draws a sword on a human.

**The Small Gods angle:** animals are belief material. Flocks are wealth (prosperity need),
a wolf among the sheep is terror (safety need → pleas), a plague on the herds is an omen
surface, a saved flock mints devotion, and sacrifice/first-fruits are classic small-god
tribute. Livestock loss must flow into the need/plea economy, not just a counter.

## Code reality (verified 2026-07-26)
No animal entities exist. `Entity.kind` is an open string; NPCs are `kind:'npc'` with an
LPC paperdoll rig + animation set (`src/core/npc-animation.ts`, motion studio `?studio=motion`).
Birds (WP-J) are render-ambient only. Motion studio's recorded NEXT is the **sheep template**
— the intended path is a parametric quadruped paperdoll, not one-off sprites. Movement/
pathfinding, mortality (D1), and the two-tier population (cohort ↔ materialize) are all
reusable substrate. Herds should be **Groups** (tactical spec T0) from day one.

## Slices
- **A0 — Quadruped rig + sheep template** (motion studio; parallel-safe with the garrison
  epic — studio/render-lpc files only). Side-view paperdoll quadruped: walk/idle/graze/
  startle/death frames. Sheep first; the template must parameterize to goat/pig/cattle/deer/
  boar/wolf later (proportions + palette, not new rigs). Sprite sourcing decision (parametric
  chips vs PixelLab) is a SPEND decision — confirm before any paid batch.
- **A1 — Animal entities + flock groups.** `kind:'animal'` entities with species props;
  a flock/herd is a Group (roster, pasture objective, group-tier stepping off-camera,
  materialize on camera). Livestock: pens/pastures near farms (parcel data exists). Wild:
  deer/boar in woodland biomes. Deterministic wander/graze/flee steering (ctx.rng).
- **A2 — Husbandry loop (light).** Flock size ↔ settlement prosperity need; shepherd role
  (or farmer activity) tends the flock; births/aging on the day-keyed lifecycle (GAME_HOUR
  cadence like D1). No produce-item economy yet — the flock IS the asset.
- **A3 — Predator threat.** Wolves as a wild group with a hunt objective; flock panic +
  flee (startle propagation через the group), shepherd/soldier response via the tactical
  posture layer; abstract resolution first (strength vs strength — the SAME shape the
  war-party MVP will use); losses → terror events, safety-need drop, pleas, tidings.
- **A4 — Hunting = first real combat.** Hunter role/activity, bow + arrow: projectile
  entity, flight, hit test, wound/kill on animals. THIS is where the weapon layer is born
  (weapon stats, range, cooldown, projectile render) — human combat later inherits it
  wholesale. Divine seams: guided arrows (answered hunter's prayer), spared quarry (omen).

## Sequencing vs other tracks
A0 can start NOW (disjoint files from the garrison epic). A1 wants T0 (Group substrate)
first — do T0 immediately after the garrison branch lands, then A1–A3, then T1–T4 tactical
slices interleaved as needed, then A4 (weapons), and only then human fighting (bows/swords
warfare — phase 3 war-party MVP upgraded from abstract to real resolution).

## Invariants
Sim truth first (a flock exists and moves off-camera); `src/sim/` cycle-free + rng-only;
positions via `World.updateEntity`; day-keyed lifecycle at GAME_HOUR cadence; all
interactions through registry verbs/affordances; symmetric for every god.
