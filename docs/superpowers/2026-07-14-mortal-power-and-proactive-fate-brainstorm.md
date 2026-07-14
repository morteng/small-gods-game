# Brainstorm — Mortal Power & Proactive Fate

**Date:** 2026-07-14 · **Status:** brainstorm (→ two specs) · **Origin:** user, after *The Rest Is History* ep. 550 ("Rise of the Normans" — castles, knights, mottes)

> The user's ask: *"can we get more of this kind of atmosphere and feeling in our demo?"* followed by
> *"I think Fate should be proactive, too — based on initiative and pre-planned storylets and story
> arcs that are dynamically woven."*

---

## 1. The thesis

A small god feeds on **need**. Today the only things that manufacture need in our world are weather,
sickness, and rival spirits — all impersonal. The Norman material describes a machine that
manufactures need **deliberately, locally, and with a face on it**:

> A strongman throws up a mound of earth where there was nothing. Armed men on horses ride out from
> it and take your grain to pay for their own mail. You are herded off your scattered farmstead into
> a village under his walls, because a concentrated peasantry is a *harvestable* peasantry. You are
> protected, and you are miserable, and you are newly aware of how small you are.

**That is a belief farm.** The castle is the best divine-power engine we could possibly build — and
we have already built 80% of it as scenery.

### 1.1 The refinement that makes it a game and not a slogan

The lord does not simply *add* need. He **changes which need is unmet**:

| | he supplies | he drains |
|---|---|---|
| **safety** | ✅ the walls are real; the raiders do stop | |
| **prosperity** | | ✅ the tithe, the levy, the corvée |
| **meaning** | | ✅ you are cattle in a pen |
| **community** | | ✅ (weakly — he breaks the old scattered kin-network to build his village) |

Per VISION §6 (*a god's identity is defined by whose prayers it answers and how*), **a god that grows
up under a tyrant becomes a god of the oppressed — by arithmetic, not by authoring.**

### 1.2 The trap (this is the point)

**If you topple the lord, you remove the fear that feeds you.**

Do you break him — or do you let him grind on, because his boot on their necks is your congregation?

This is not a bolt-on moral dilemma. It falls directly out of the existing power formula and VISION's
already-canonical counter-loop (*"comfort kills belief… a god who only ever answers crises dissolves
itself"*). The castle turns that abstract warning into **a choice with a face on it**. It is Pratchett
to the bone.

---

## 2. The blocker that outranks everything else

**The engine cannot see the thesis.** Verified by reading, not by trusting:

- `computeMood()` (`src/sim/npc-sim.ts:55`) returns the **flat mean** of the four needs.
- `tickNpcEntity` reads *only that mean*: comfort-decay above 0.6, desperation-boost below 0.4.
- ⇒ **drain `prosperity` by X and supply `safety` by X, and faith moves by exactly zero.** To the
  belief engine, the castle is a **no-op**. It cannot distinguish oppression from drought from plague
  from nothing-at-all.

Worse:

- `worship` fires **only** on `meaning < 0.3` (`npc-activity-system.ts:104`) — low `community` even
  pre-empts it; low `safety` and low `prosperity` have **no branch at all**.
- `work` self-restores `prosperity` (+0.3 `SELF_AGENCY_RESTORE`); `sleep` self-restores `safety`.
- ⇒ **A starving peasant cannot pray.** Prayer is a *meaning-clock*, not a cry of need. And since
  `worship` is the sole channel `answer_prayer` feeds and rivals claim, **the entire belief economy
  runs on one need out of four.**

> **Nothing else in this design matters until need has a *direction*.** Recorded as VISION §9 rows
> 11–12. This is P0 of the mortal-power spec and it is ~10 lines for the first, decisive half.

The happy corollary: **secularization already works, unmodified.** A lord who raises `safety` pushes
`avgNeeds` up; cross 0.6 and `COMFORT_DECAY` fires and the player's faith bleeds, resisted only by
`devotion`. *"The castle keeps them safe, and safety makes them forget you"* is **free today**. That
is the strongest half of the thesis and it needs no engine work at all.

---

## 3. Why Fate must become proactive (and what that costs)

The user's second directive is not a separate feature — it is the **engine** this content needs.

### 3.1 The canon was already at war with itself

VISION §2.1 called Fate *"a storyteller — cold, inevitable, amused — moving mortals as game pieces
toward drama,"* invoking the Discworld Fate who plays a literal board game against The Lady — and then
three paragraphs later forbade Fate from planning. **You cannot be a board-game player and be purely
reactive.** Amended in VISION 1.1.0 (§2.1, §2.1.1).

### 3.2 The architectural gap is not a prompt problem

- `FateBrainService.deliberate()` is **stateless**: it reads world state, arms at most one beat, and
  **forgets**. Every deliberation is a fresh single-shot reaction with no memory of intent.
- `FateTrigger` only ever wakes on an **incoming event**. There is no heartbeat, so Fate has no way to
  act on initiative *even in principle*.

Making the prompt more ambitious would not have worked. Fate needs **memory** and **a pulse**.

### 3.3 What replaces "reactive" as the guarantor of earned drama

"Reactive" was doing a real job: it guaranteed drama grew out of the world rather than being dropped
onto it. Four constraints take that job over (VISION §2.1.1):

1. **Plan in intentions, pay in sim-currency.** An arc is *conditions Fate wants true* + *pressures it
   applies*, never events it fires. Not *"the lord dies on pilgrimage"* but *"I want him far from home
   and his heir a child"* — then his piety rises, a pilgrimage rumour spreads, the odds of a fever on
   the road tick up. Every step is something the sim could have produced on its own.
2. **Portents are the interface.** A beat may not land un-heralded. *A Fate you cannot read is a
   tyrant; a Fate you can read is a worthy opponent.* Historically exact — the chroniclers always
   report the star before the fall.
3. **Arcs are dispositions, not scripts.** Player disruption ⇒ Fate **re-plans**. A thwarted Fate is
   the point; an unthwartable one is a rail.
4. **Latency and discovery stand** (§2.3) — staged content materializes on player attention.

**Weaving:** hold 2–4 live arcs; prefer the pressure that **advances the most live arcs at once**. One
drought serves the famine arc and the tyrant arc together. That is how plot braids rather than queues.

### 3.4 It retroactively fixes the lord

An earlier framing had the lord *emerging by luck* from sim conditions, because a reactive Fate
couldn't cause him. Under a proactive Fate, **Fate cultivates the conditions for a lord** — ambition, a
defensible crag, an absent authority — which is both more tractable and more honest.

---

## 4. What we already have (the pleasant surprises)

From the codebase sweep — all shipped, tested, and **unused by the game**:

- **`placeComplexOnPatch`** (`src/world/place-complex.ts`) already plants a **motte-and-bailey on an
  arbitrary hilltop with no settlement**: raises the motte, cuts the ditch (spoil-conserved), commits
  ring barriers, drops `castle_keep` on the motte top, arcs the bailey buildings away from the
  approach. Its only caller today is the **studio**.
- **The fortification ladder is data**: `complex-types.ts` defines `ringwork` and `motte_and_bailey`
  and frames the ladder (ringwork → motte → … → concentric) as *a wealth/era ladder*. **Timber → stone
  is a data change, not a code change.**
- **The siting brain exists**: `siteSelect()` scores affordances against
  `DEFENSIVE_SITE_WEIGHTS {strat 0.4, def 0.5, cost 0.1}`. Today the game passes it a *single*
  candidate, so its argmax is a no-op. Feed it N hilltops and it chooses for free.
- **`noble` and `soldier` are already `NpcRole`s.** The lord is a `noble`; knights are `soldier`s.
  **No new entity kind** — model a knight as an NPC and inherit movement, pathfinding, y-sort,
  animation, belief, memory, mortality. (The render graph draws *only* barriers, blueprint entities and
  vegetation — a new moving kind would mean touching the GPU entity pass. Don't.)
- **`lineageId` already exists** (root-ancestor grouping) ⇒ **the dynasty mechanic is free**.
- **Belief already lifts what a settlement may build** (`liftEraByUnderstanding`) — a castle lifting
  `wealth` the same way is an established pattern.
- **`raiders` is already a `SettlementEventType`** applying `{safety −0.008, prosperity −0.004}`/tick ×
  severity. **A lord's extraction is mechanically a persistent, inverted `raiders` event** — which
  means Fate's *existing* `nudge_event_severity` and `force_next_event` tools can coach his greed with
  **no new Fate tooling at all**.

---

## 5. What the history gives us that we didn't ask for

Three ideas from the research that are better than anything in the original pitch:

### 5.1 The Peace of God — *what a religion can actually DO to a warlord*

Late-10th-c. southern France, exactly the world of ep. 550. The church's institutional counter-attack
against the castle-and-knight extraction machine:

> Bishops convene an open-air assembly. They **parade the relics out of the churches into the field**.
> Crowds gather to venerate them. The knights are made to **swear oaths, on those relics, before that
> crowd**, not to prey on peasants, clergy, pilgrims or cattle. The sanction is excommunication.

**That is a complete gameplay verb.** A religion converts *accumulated popular belief* into *a binding
constraint on armed men*, using a relic as the transaction medium and a crowd as the witness. It is the
best answer we have found to *"what is the player's move against the castle that isn't a lightning
bolt?"* — and it is a move that **spends devotion, not power**, which makes devotion matter.

### 5.2 A conqueror overwrites the local saints

By Domesday, **one** native English bishop remained in post; nearly every cathedral was rebuilt. The
conquest severed the organic link to the pre-conquest saints. **A winning rival should be able to erase
your saints and re-found the shrines in its own name.** And the counter-move — *the small god's
weapon* — is **syncretism**: the old rite survives underneath the new name, waiting.

### 5.3 The chronicler's causal model cannot contradict the sim

The monastic chronicler does not *explain* events, he **annotates** them: disaster ⇒ therefore sin ⇒
identify the sin. He infers backwards from outcome, and attributes cause to God, sin, or portent —
never to politics. Alcuin blamed Lindisfarne on the Northumbrians' drunkenness, fornication, **and
their haircuts**.

> **A narrator who explains everything by sin and portent literally cannot contradict our simulation,
> because he is not making causal claims about it.** He records our numbers faithfully and then tells
> you what they *mean*, morally.

That is *precisely* the shape of a narration layer for a "sim is truth" architecture (VISION §10). The
register and the architecture want the same thing. It is also **cheap**: parataxis needs no long-range
coherence, so the fast tier can hold it.

**Register spec** (for `chronicle-prompt-builder.ts`): short annalistic clauses joined by "and";
records numbers, dates, feast-days, what was taken, the weather, the condition of a corpse; breaks the
list into sudden lament and then resumes it; **praises a man and condemns him in the same sentence and
does not reconcile the two**; portents come first and *explain* what follows; never says "I don't know
why" — says *what sin it was for*.

---

## 6. Where the thesis fought the canon (and lost, productively)

**"The lord competes with the player-god for the same souls"** — ✗ **rejected.** VISION §3 says belief
is tracked **per spirit**; §5 names the whole cast (player, rival small gods, major gods). Giving a
mortal a `beliefs[]` entry invents a *fifth category of god*, and forces a bad choice: register him in
`ctx.spirits` (and `SpiritSystem` immediately grants him **divine power regen**) or don't (and every
`Object.values(p.beliefs)` loop walks a dead entry forever). **If a peasant can pray to the lord, the
two-force cosmology is broken.**

**The reconciliation is better than the original thesis.** The lord competes for **allegiance**, never
for **belief**. He is a *need-satisfier* — and tenet 9 is literally *"Mortals act first; the god is the
margin."* **A lord is the most vivid possible expression of mortals acting first.** He does not steal
your believers; he **removes the crisis that made them believers.** That is the comfort trap *with a
face*, and it is squarely canonical.

And there is a free path to *real* competition with zero canon damage: **a lord who endows a shrine to
a rival god** grants that rival territorial presence → `isRivalPresent()` → prayer-claiming rights via
`rival-claims.ts`. **He fights you by proxy, through machinery that already ships.**

---

## 7. The two specs

| | |
|---|---|
| **[Proactive Fate](specs/2026-07-14-proactive-fate-arcs-portents.md)** | the **engine** — arcs, portents, weaving, a pulse, and memory. Also closes Fate's two listed roadmap gaps (pacing beyond single-beat reactions; era-authoring). |
| **[Mortal Power](specs/2026-07-14-mortal-power-lord-castle-knights.md)** | the **content** — need-direction (P0), the chronicler, epithets, the lord, the castle, knights, the Peace of God. Supplies proactive Fate's first real arc library. |

Everything in both is **$0**: sim, prompt, and parametric geometry. The paid img2img spend gate stays
**OFF**.
