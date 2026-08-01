# Interaction Scaling — the physics of the one connectome

**Status:** design brainstorm (2026-08-01). No code. Extends
`2026-06-20-unified-world-connectome-design.md` with a *dynamics* layer.
**Origin:** user, after the Mindscape episode with Luis Bettencourt (settlement
scaling theory / cities as complex systems): *"one single connectome encompassing
everything, with these kinds of rules driving everything — as well as player
actions and Fate."*

## The source theory, compressed

Bettencourt/West settlement scaling (empirically robust across modern nations,
Rome, and — via Ortman — pre-Columbian Mexico, i.e. **exactly our tech era**):

- **Y = Y₀ · N^β.** Socioeconomic outputs of a settlement (wealth, invention,
  crime, disease transmission, *monument construction* — Ortman's pre-monetary
  proxy) scale **superlinearly**, β ≈ 7/6. Infrastructure (total road surface,
  pipes) scales **sublinearly**, β ≈ 5/6. Individual needs scale linearly.
- **The exponents are derived, not fitted**: from the dimension of space (2), the
  near-linear fractal dimension of individual daily movement (home→work→market),
  and whether movement is channeled through a **hierarchical network** (streets →
  highways). Amorphous settlements without street hierarchies sit in a weaker
  2/3-regime — archaeologically attested for small early settlements.
- **A settlement is a bound state of interactions, not a place.** The modern
  definition is commute flux, not the administrative boundary. What a city *is*
  is a **social accelerator**: density buys interactions per unit time; time is
  incompressible, so people literally move and live faster.
- **Differentiation is the signature of complex systems**: interaction forces
  agents to specialize (division of labor → division of *knowledge*), which is
  where the superlinear returns come from. Latent in every agent; *revealed* by
  density.
- **Failure modes**: *jamming* (density without network hierarchy), *balkanization*
  (travel too costly → the city fragments into local pockets), *exclusion*
  (poverty = disconnection from the network while paying its costs).
- **Open-endedness**: components churn (people die, buildings fall), the network
  persists. Universality vs contingency: replay the tape and the *laws* hold even
  though every particular differs.

## Why this fits Small Gods unusually well

Three pre-existing commitments make this theory nearly native:

1. **Time is 1:1 real (R8).** Bettencourt's core mechanism — *space compresses,
   time cannot* — is already a hard rule of our sim. An NPC's day is a fixed
   interaction budget; density is the only way to buy more interactions per day.
   The scaling laws are what that budget *implies*.
2. **The sim is a replayable tape.** Snapshot/scrub/re-roll + seeded RNG is
   literally Gould's thought experiment. Scaling laws are the **universality
   class** of our sim: what stays true across seeds and player choices. The
   contingent layer (which NPC, which god, which flood) is where play lives.
3. **Belief already propagates on a social graph.** The belief economy is an
   interaction economy; it just doesn't yet know that its aggregate behaviour
   should be lawful.

## The upgrade to the connectome thesis

The 2026-06-20 connectome is **structural**: nodes, `contains`/`connects`/
`spans`/`serves`, param cascade, deterministic realization. This brainstorm adds
the missing half: the connectome as a **flow network with derivable macro-laws**.

> **Thesis: the connectome's edges carry flux, and the sim's aggregate behaviour
> over that flux must reproduce settlement scaling — not because we impose the
> exponents, but because we simulate the mechanism (density × movement × network
> hierarchy) that produces them. The exponents become a TEST, not a constant.**

Concretely:

- **One `flux` concept per edge.** `connects` edges carry measured flow —
  people/day (the road-wear traffic tally already measures this), rumours/day,
  goods/day, prayers/day. All subsystems read/write the same field instead of
  keeping private tallies.
- **Settlement = bound state.** Derive settlement *extent* from interaction/
  commute flux (the P2 commute system already generates it), not from a stamped
  boundary. A "settlement" is wherever the flux is dense — which makes growth,
  merging, and balkanization emergent instead of authored.
- **Scaling contracts in `lint:world`.** Probe worlds across settlement sizes,
  fit log-log slopes, and assert: belief-story output and monument/devotion
  activity superlinear; road surface per capita sublinear. `evaluateContracts`
  already exists; these are contracts on *dynamics*. If the slopes come out
  linear, the social reactor is broken — a diagnostic we currently lack.

## Mappings, system by system

### 1. Belief economy — superlinear by mechanism

Rumour propagation, story fidelity, ritual innovation, monument construction,
and *also* heresy, schism, and crime should all rise superlinearly with
settlement connectivity, because all are interaction products. Ortman's finding
that **monument construction** is the superlinear output of pre-monetary
settlements is a gift: monuments are already our devotion mechanic (tenet 4).
A 200-believer town is not 2× a 100-believer village — it is ~2.2× in
story-output, and that surplus is the *engine of Act 2* (cult organization
becomes possible only past an interaction threshold; priests are
division-of-labor specialists that density reveals).

### 2. The major gods are hollow BECAUSE of scaling (Act 3, derived)

Superlinear prosperity → needs met → faith decays (secularization, §3 of
VISION). Big, well-networked cities are **comfort machines**, so the gods of big
cities drift to doctrine and distance — hollow, exactly as §5 asserts. What was
a scripted trait of the endgame antagonists becomes a *consequence of the same
law that made their cities rich*. And the counterplay writes itself: the
**excluded** — the disconnected poor who pay urban costs without network access
(Bettencourt: poverty = exclusion from the network) — are the desperate, and
desperation → prayer. Small gods grow in the cracks of great cities. This is
historically exact (early cults among the urban poor) and gives Act 3 its
tactical texture: find the disconnected sub-graphs of the enemy's own city.

### 3. Gods are the non-spatial network

The podcast's aside — telecom networks scale with a *larger* exponent because
they're freed from 2D space; "AIs would have cities, but maybe not in space" —
describes the divine layer precisely. Prayer/whisper/dream is a network
unconstrained by geometry: every believer has an edge to the god at zero travel
cost, with **understanding/devotion as the bandwidth** of that edge. Two
consequences:

- **Divine intervention is "tunneling"** — the fast hierarchical layer of the
  belief network, exactly what highways are to streets. A god IS infrastructure.
- **Temple networks are a god's road system**: shrines → temples → priesthood is
  sublinear infrastructure buying superlinear reach — but every hop is
  doctrine-mediated, degrading intimacy. Great gods have highways; small gods
  walk. The intimacy-vs-reach tradeoff of the whole game is the streets-vs-
  highways tradeoff.

### 4. Fate plans on the mean field; the player plays the fluctuations

Bettencourt is explicit that scaling is a **mean-field** statement — no
individual is the average. That distinction is our two registers:

- **Fate reads aggregates**: per-settlement interaction density, unrest rate,
  faith flux, need pressure — lawful, predictable, cheap to serialize into a
  prompt. Fate's arcs are bets on mean-field tendencies ("a town this size and
  this jammed yields plague pressure; press here"), which keeps it sim-bound
  (§2.1.1) *and* makes its plans legible/foreshadowable.
- **The player operates below the mean field** — one herder, one lost sheep, one
  answered prayer. The small god's intimacy advantage is now formalized: majors
  and Fate move averages; you move *individuals*. The win condition
  (attribution) is making yourself the name individuals reach for — a
  fluctuation-level asset no mean field can erode.

### 5. Sphere of attention = simulation LOD (the deepest cut)

§2.3 says the unrealized world is fully present under Fate. Scaling theory says
*how*: **beyond the sphere of attention, settlements run as mean-field
dynamics** — aggregate stocks evolving under the measured scaling laws — and
inside it, the full per-NPC sim runs, with individuals sampled consistently
with the mean field when attention arrives (the cohort-seeding shape we already
have). This resolves cosmology and performance with one mechanism: **belief =
attention = simulation fidelity.** The realized bubble isn't just narrative
reach; it is literally where individuals exist as individuals.

### 6. Roads, wear, and the regime transition

The road-wear economy (traffic tally → wear class → tier upgrade → desire-line
adoption) is Bettencourt's hierarchical-network formation, already built. What
scaling adds is the *payoff*: a settlement without a street hierarchy sits in
the weak 2/3-regime (interaction-poor, jam-prone); when wear promotes a trunk
hierarchy, the settlement transitions to the networked regime and its exponents
shift. Settlement growth stops being a stamp and becomes a **phase transition
the player can see coming** — and that Fate can foreshadow ("the market road is
worn to mud; something is about to change here").

### 7. Failure modes = the four needs, pressed lawfully

- **Jamming** → disease (superlinear transmission), fire, crime → `safety`.
- **Balkanization** → community fragments into local pockets → `community`; local
  cults and schisms nucleate in the fragments (Track 3 contention gets a
  spatial *cause*).
- **Exclusion** → urban poverty → `prosperity` + `meaning`; the recruitment pool
  of §2 above.
- **Comfort** → secularization → the god's own failure mode. All four are now
  productions of one mechanism rather than four tuned dials.

### 8. Festivals, pilgrimage, migration

- **Seasonal gatherings are pulsating proto-cities** (the podcast's
  hunter-gatherer aggregations / Burning Man). A festival is a deliberate,
  temporary density spike → a superlinear burst of story propagation and
  devotion. *This is why gods want festivals* — they are interaction
  accelerators, and now the bonus is derived, not decreed.
- **Pilgrimage** creates long-range edges — belief's highways.
- **Migration**: the universal migrant is 18–30, prospect-driven, and keeps
  social edges to the origin village — which are exactly the edges belief flows
  *back* along. Missionary dynamics for free, and the Kenya anecdote (who you
  call predicts whether you stay) is a ready-made NPC mechanic: an NPC whose
  interaction flux still points home will return home, carrying your name or a
  rival's.

### 9. The pantheon is itself a settlement

Scale-free means the same *dynamics*, not just the same vocabulary, at every
tier. Gods interact (contention, coalition, holy war), and they **differentiate
under interaction pressure** — domains (rain, war, the hearth) are division of
knowledge among gods, driven by the differentiated needs of a growing believer
network. Divine identity (§6, the Book) is specialization revealed by density,
one tier up.

## What NOT to do

- **Do not hand-impose 1.16 anywhere.** A tuned multiplier kills the emergence,
  the replay-universality, and the diagnostic value. Build the mechanism
  (density → encounter rate; movement budget; network hierarchy), then
  *measure*.
- **Do not let the mean field contradict the individual sim** at the attention
  boundary — the handoff must conserve stocks (population, belief mass, need
  pressure) exactly, or scrub/replay breaks. Same discipline as
  snapshot/restore.
- **Do not make Fate omniscient about fluctuations.** Fate reads aggregates;
  rival spirits read the player. Keeping Fate mean-field is what keeps it
  impersonal (§2.1) — now for a structural reason, not just a rule.

## Cheapest first probes (order of increasing commitment)

1. **Measure what we already have.** Offline probe across genSeeds and
   settlement sizes: log-log encounter rate, rumour spread, road surface vs
   population. Establishes our *current* exponents (probably ~linear —
   the gap is the roadmap).
2. **Unify edge flux.** One field, road-wear tally as the first producer,
   rumour/commute as readers. Pure plumbing, immediately useful to Fate prompts.
3. **Scaling contracts in `lint:world`** once (1) shows a mechanism worth
   pinning.
4. **Mean-field settlement stub** for out-of-sphere settlements — the LOD
   architecture of §5 — behind the same determinism/conservation tests as
   snapshot/restore.
5. **Fate mean-field observables** — replace raw lists in Fate prompts with
   per-settlement aggregates + trends.

## Relationship to existing docs

- Extends `2026-06-20-unified-world-connectome-design.md` — structure stays as
  specced; this adds the dynamics layer and gives "scale-free" its stronger
  meaning (same *laws*, not just same vocab, at every scale).
- Serves VISION.md — no cosmology changes; §2 (hollow majors), §4 (Fate
  mean-field) and §5 (attention = LOD) are *derivations* of existing tenets,
  which is the strongest kind of support. The two open loops (§9 rows 11–12,
  need-direction and prayer-subject) become more urgent: differentiated need is
  the microstate the whole theory runs on.
