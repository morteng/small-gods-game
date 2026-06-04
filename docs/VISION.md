# Small Gods — Vision & Cosmology

**Version**: 1.0.0
**Status**: Canonical — core design tenet
**Last Updated**: 2026-05-31

> This is the **read-this-first** design document. It defines the cosmology, the
> belief model, the core gameplay loop, and the start-to-end arc that every other
> design doc must serve. Where any other top-level doc contradicts this one on
> cosmology, belief, Fate, or progression, **this document wins** and the other
> should be reconciled to it.

---

## 1. The premise

You are a **small god** — at the start, barely more than a whisper in the dark.
You cannot command anyone. You cannot move a stone directly. Your only power is
**belief**, and belief must be earned the way it was actually earned in the
ancient world: not through theology, but by **answering the concrete needs of
frightened people**.

The design is grounded in Terry Pratchett's *Small Gods* and, just as directly,
in the real archaeology of pre-Islamic Arabian religion — the Safaitic
inscriptions catalogued by Ahmad Al-Jallad: tens of thousands of first-person
prayers scratched into desert basalt. *"I lost a sheep — O Allāt, cause me to
find it."* No doctrine. A herder, a missing animal, and a goddess he trusted to
be listening. That is the texture we are building. (See §11 for the source
principles.)

---

## 2. The Two-Force Cosmology

Al-Jallad reconstructs the nomads' worldview as a struggle between **two great
forces**, and that split is the spine of this game:

### 2.1 Fate — the world, and the storyteller

**The computed, deterministic simulation IS Fate.** The world exists and grinds
forward with or without belief — seasons turn, herds starve, predators hunt,
children are born and die — all of it produced algorithmically by the sim layer.
That baseline reality is *Fate's substrate*.

**Fate is also the DM agent** — the background LLM that biases and escalates
events toward a *good story for the player*. Fate has two registers, and they are
the same entity:

- **Meta register (yours, the author's):** a storyteller — cold, inevitable,
  amused — moving mortals as game pieces toward drama. (In Discworld, Fate is a
  literal deity who plays mortal lives as a board game against The Lady.)
- **In-world register (the mortals', and often your *felt* experience):** the
  uncaring force that *"lay in wait"* and *"struck down"* — unpetitionable,
  unbargainable, unnameable. The Safaitic *manāt*. **No one prays to Fate.** No
  one sacrifices to Fate. When Fate strikes, the most a mortal can ask a *god*
  for is **compensation or meaning** — never undoing.

This duality is the point: Fate genuinely is trying to tell a good story, and a
good story contains the flood, the failed hunt, the death. So Fate *reads as*
malevolent and uncaring from inside, while actually being the author.

> **Design rule — Fate is impersonal and reactive.** Fate amplifies and escalates
> what the simulation is already producing; it does not inject arbitrary plot
> devices, and it is never addressed or bargained with from in-world. Player
> "modelling" belongs to **rival spirits** (who learn your strategy), not to Fate.

**Fate may prepare the stage.** Fate is still reactive: any content it stages must (a) **amplify or escalate an existing sim condition** (a recognized plot thread), never an arbitrary plot device, and (b) be **latent until discovered** — it materializes only when the player's attention reaches its subject. Fate sets out grounded possibilities; the sim and the player's attention decide which become real. (This is the attention/realization cosmology of §2.3 applied to narrative.)

### 2.2 Gods — the intervenors

Gods — the player (a small god), rival small gods, and distant major gods — are
**not creators of the world. They argue with it.** A god spends **belief** to
bend Fate's computed tendencies toward its believers' needs. Fate says *drought*;
a god spends power to make it *rain this turn*. Next turn Fate generates drought
again, and if the god does not spend, the drought returns. **Gods are not
destiny. Gods are intervention at the margin.**

### 2.3 Reality vs. attention

Belief does **not** make the world exist — that was an early misframing. The
unrealized world is fully present in the sim under Fate. What belief buys a god
is a **sphere of attention/influence**: the `realized` tiles are where *this
god's* belief is strong enough to be present and to draw narrative detail (LLM
backfill). The cradle start is small because your *attention and belief* are
small — not because the world is. As faith grows, your reach (and your narrated
world) expands.

```
   FATE (computed sim) ─── the world, always running, unpetitionable
        │  generates events that press on mortal needs
        ▼
   MORTALS ─── try to meet their own needs first; pray when they can't
        │  unmet need → desperation → openness to belief
        ▼
   GODS (player / rivals / major gods) ─── spend BELIEF to intervene at the margin
        │  answered need → faith; sphere of attention expands
        ▼
   BELIEF ─── the only divine currency; earned from need, spent on intervention
```

---

## 3. The Belief Model (canonical)

There is **one** belief model. (Historically the code tracked a lean
`faith/understanding/devotion` model while the docs described a separate, unbuilt
`Stories/Credence` model. The doc model is **retired**; its good ideas are folded
in below. See §9.)

Each NPC tracks belief **per spirit**, and a mortal can hold belief in *several*
spirits at once. Mortals **know** the gods exist — the whole pantheon, and more
they've never heard of; mere existence is common knowledge, not the currency.
What a god lives on is **practised allegiance**: do they *follow*, *pray*,
*sacrifice* to you — or to a rival, or to several? That distribution of practice
across gods is the source of every god's power, summed per spirit.

| Component | What it is | Earned from | Its job (must be wired) |
|---|---|---|---|
| **Faith** | Active allegiance — that this god is the one worth *following and praying to* (not mere awareness that it exists; everyone knows that) | Answered need, witnessed intervention | The *floor* of power. Cheap, fast, **fickle** — decays over time, **defects to rivals** when unanswered. |
| **Understanding** | How well they grasp *who* this god is — its domain, the correct form to invoke it | Dreams, teaching, accurate stories, ritual | **Story fidelity.** Gates whether they perceive your signs, pray effectively, and pass on *accurate* belief. Low understanding = belief in "something," misattributed. |
| **Devotion** | Behavioural commitment — costly acts | Sacrifice, shrine-building, prayer, evangelism | **Power multiplier + propagation engine.** Makes belief *durable* (survives comfort) and *contagious* along the social graph. |

**Mortal needs** (what belief is transacted *for*): `safety`, `prosperity`,
`community`, `meaning`. These map directly onto the inscriptions — predators and
plague (safety), lost sheep and drought (prosperity), reunion with loved ones
(community), grief, vengeance, and the rites of the dead (meaning).

**Power formula (canonical):**

```
spirit.power regen  ∝  Σ_believers ( faith × understanding × devotion )
```

This is the formula the docs always claimed and the code never implemented
(current code is `Σ faith × 0.02`). Wiring it makes the central truth *true in
the math*: **quantity of believers ≠ power.** A million fearful nominal
believers (the Om-as-tortoise failure) is weaker than a hundred who *understand*
and are *devoted*.

**Two registers of belief** (folding in the retired `BeliefState` enums):
- *Fearful / transactional* — high faith, low understanding/devotion. Spikes in
  crisis, evaporates in comfort. The trap.
- *Devotional / identity* — high understanding and devotion. Survives comfort.
  The endgame asset.

**Secularization is a real failure mode.** When needs are met, desperation falls,
and faith decays. A god who only ever answers crises *dissolves itself* by
removing the fear that fed it. Converting fearful belief into devotional identity
is the central late-game problem (§7, Act 3).

---

## 4. The Master Loop

```
Fate generates events  ──►  events press on NPC needs
        ▲                              │
        │                    mortals meet what they can themselves
        │                    (the god is the MARGIN, not the only actor)
        │                              │
   sphere of attention          unmet need ──► desperation ──► reach out
   (realized tiles)                    │
   expands with faith         whoever ANSWERS gains faith  ◄── rivals claim
        ▲                              │                       what you ignore
        │                  faith × understanding × devotion ──► power
        │                       │                    │
   god tier grows ──────────────┘            stories propagate belief
        │                                     along the social graph
        ▼                                            │
   bigger interventions, wider reach  ◄───────────────┘
        ▼
   dwarf rivals ──► supplant ──► (Fate escalates against dominance)
```

**The counter-loop is the game's tension** and the built-in anti-snowball:
1. **Comfort kills belief** — meeting every need erodes faith (secularization).
2. **Rivals eat your neglect** — every unanswered prayer is a defection opportunity.
3. **Fate resists ascension** — a god that is winning makes a *boring* story, so
   Fate (the storyteller) escalates against dominance: floods, prophets of doubt,
   a rival's miraculous return, a hubris arc. The bigger you get, the harder Fate
   pushes back.

---

## 5. The cast of gods

- **You — a small god.** Weak, intimate, local. Your strength is that you are
  *close* to individual mortals.
- **Rival small gods.** Your peers and direct competitors — they fight over the
  *same* villagers, whisper-for-whisper, and claim the prayers you can't afford.
  They learn your strategy (this, not Fate, is where player-modelling lives).
- **Major / established gods.** Distant, powerful, organized (priesthoods,
  temples, doctrine) — but *hollow*: disconnected from individual need. Hard to
  dislodge by force, vulnerable to **intimacy** (Brutha vs. the Church). They are
  the endgame antagonists, beatable precisely because they stopped answering needs.

**God lifecycle.** A god is only as real as its belief. When faith across all
believers falls below a fading threshold, a god shrinks toward "nothing but
names" — the tortoise. This applies to you, your rivals, and the great gods alike.

---

## 6. Emergent divine identity

A god has no inherent form or character. **Its believers define it** (the
"Pratchett Principle," already embodied in `AI_VISUALS_AND_AUDIO.md`). The god
you *become* is constrained by *how you grew*: answer the prayers of the
frightened with wrath and you become a god of wrath; answer the prayers of the
poor with mercy and you become a god of mercy. This identity — accumulated in the
**Book of [Spirit Name]** — then gates which interventions feel in-character and
cost less. Play style → identity → mechanics, in a closed loop.

---

## 7. The Arc — start to end

### Act 0 — The First Believer (stone-age tutorial)
One human, one fire, the dark — Fate — pressing in on every side. A need you
*can* answer (a whisper that guides the hunt). The answered need yields your
**first faith**; your realized bubble flickers wider; the believer **marks it**
(an ochre handprint — first devotion). Then **Fate strikes a loss you cannot
prevent** — and you can only give it *meaning* (a rite over the dead, a vow of
vengeance). **How you give that loss meaning names your god** and writes the
first page of the Book. *The tutorial must teach the loss half, or the player
never feels the Gods-vs-Fate stakes.*

### Act 1 — The Small God (early game; the Safaitic herder period)
A handful of fickle, transactional believers. The master loop runs hot; Fate's
threats are visceral (predators, cold, drought). A **rival small god** appears,
eating the prayers you ignore. You learn that fear-faith is cheap and fades, while
understanding and devotion endure. First shrine; first standardized ritual form
("address them in the form they recognize").

### Act 2 — The Cult (mid game)
Belief *organizes*: priests as proxies who channel you, shrines as power anchors,
seasonal rituals, stories that spread without you present. You feel the **comfort
trap** — settled, safe believers drift — and must convert transactional belief
into **devotional identity** (festivals, doctrine, the Book). Fate escalates
*because* you are succeeding.

### Act 3 — The Ascension (endgame)
You confront **major gods** — powerful but hollow — and undercut them with
intimacy, answering the prayers their priesthoods ignore.

**Win condition: attribution, not comfort.** You do not win by making everyone
safe (that would dissolve you). You win by becoming **the name mortals reach for
in crisis *and* in plenty** — understanding and devotion so deep that comfort no
longer erodes you. Supplanting rivals and great gods means **starving their
belief until they fade to "nothing but names."** The final temptation: become
distant and abstract yourself (and one day fall, as they did), or stay
small-and-real. Fate's last story.

---

## 8. Design tenets (the principles, tagged to systems)

Each is drawn from the Safaitic material (§11) and bound to the system it governs:

1. **Belief is born from need, not theology.** → needs → desperation → faith.
2. **You stand between mortals and Fate.** Belief runs hottest where Fate's threat
   is most visceral. → crisis = opportunity; comfort = decay.
3. **Belief is fickle and competitive — mortals shop around.** → per-spirit faith,
   decay, defection to rivals on unanswered need.
4. **Costly + permanent signalling deepens and spreads belief.** → devotion;
   sacrifice and monuments make faith durable and contagious on the social graph.
5. **You are heard only in the form they recognize.** → understanding gates
   perception of signs, prayer efficacy, and story fidelity.
6. **The whisper is the primal, contested channel.** → whisper is the entry-tier
   action; rivals whisper too; early game is a war of whispers in the dark.
7. **Fate is unaddressable — that is the emotional core.** → you cannot undo a
   death; you can only convert loss into devotion (rites, vengeance vows).
8. **Smallness and locality define identity.** → the same force, named differently
   per community; your character emerges from whom you serve (§6).
9. **Mortals act first; the god is the margin.** → NPCs meet their own needs when
   they can; divine intervention is the crisis exception, which is what makes it
   matter.
10. **Defying Fate has a price.** → time-scrub / re-roll is "defying Fate" and must
    carry a cost (belief expenditure and/or Fate escalation), or it trivializes the
    antagonist.

---

## 9. Open loops to close (doc → code marching orders)

The vision above is largely *designed* but only partly *built*. The current code
tracks the right shapes but leaves the loops open. Closing them is the work:

| # | Open loop (current state) | Close it by |
|---|---|---|
| 1 | `understanding` & `devotion` are written but **read by nothing**; power = `Σ faith × 0.02`. | Implement `power ∝ Σ (faith × understanding × devotion)` (§3). |
| 2 | Activities don't satisfy needs — mortals have no self-agency. | On activity completion, restore the matching need (worship→meaning, socialize→community, work→prosperity). Tenet 9. |
| 3 | Rival spirits are **inert scaffolding** (`rival-spirit.ts` never ticks). | Wire a `RivalSystem`: rivals regen power, claim unanswered prayers, whisper competitively. |
| 4 | LLM writeback (`state-writeback.ts`) exists but is **never called**. | Feed narration deltas back into sim state on each inference. Narration must never contradict Fate's numbers — it *interprets* them. |
| 5 | `belief_cross` / `mood_cross` events fire but are **consumed by nothing**. | Drive Fate's attention, the timeline UI, and Book entries from them. |
| 6 | No progression/win state; no god tiers; no follower counts. | Add god tier, believer accounting, and the attribution-based win (§7). |
| 7 | No god lifecycle / fading. | Add the fading threshold (§5) for player, rivals, and great gods. |
| 8 | Stories/Credence subsystem described in docs but never built. | **Retired.** Fold fidelity into `understanding`, credence into personality `skepticism` (§3). |
| 9 | Realization framed (in some docs) as belief *creating* reality. | Reframe as **sphere of attention** (§2.3): the world exists under Fate regardless. |
| 10 | Vestigial adapters (`toRenderNpc`, `simStateFromEntity`, `NpcInstance`, `NpcSimState`). | Remove per the existing render-refactor track. |

> These are design directives, not an implementation plan. Each gets its own
> brainstorm → spec → plan when scheduled.

---

## 10. Relationship to the other docs

This document is canonical for **cosmology, belief, Fate, progression, and the
arc.** The others defer to it as follows:

- **`TECH_SPEC.md`** — Fate = the DM agent *is* impersonal/reactive (no
  player-modelling in Fate); belief power uses the §3 formula.
- **`DATA_MODELS.md`** — one belief model (`faith/understanding/devotion` +
  4 needs); the computed sim is Fate's layer, belief is the interpretation layer.
- **`STORY_MECHANICS.md` / `STORY_CREDENCE.md`** — Stories/Credence retired as a
  separate subsystem; fidelity folds into `understanding`, credence into
  `skepticism`.
- **`DYNAMIC_WORLD.md`** — events *interpret* what the sim produces; they do not
  invent plot. Player intervention overrides a Fate tendency *for that turn only*.
- **`LLM_INTEGRATION.md`** — two-layer rule: the sim is truth; the LLM animates it
  and never contradicts its numbers.
- **`ENTITIES_AND_POWERS.md`** — magic/wizards: clarify whether reality-bending
  outside belief exists (open question; default: priests channel a god's belief,
  they are not independent operators).
- **`AI_VISUALS_AND_AUDIO.md`** — already aligned (emergent divine form from
  believer narratives); §6 is its conceptual home.

---

## 11. Provenance — the Safaitic source

The cosmology is lifted, deliberately, from Ahmad Al-Jallad's reconstruction of
pre-Islamic Arabian religion via the Safaitic inscriptions:

- **Two forces:** negotiable gods vs. deaf, hunting **Fate** (*manāt* — *"lay in
  wait," "struck down"*), with all of mortal life lived in the gap between.
- **Practical, not theological:** prayers are for lost sheep, safe travel,
  reunion, vengeance — daily human need, not doctrine.
- **Fickle and competitive:** when one god withholds (Baʿal Samīn won't send
  rain), the petitioner turns to another (Allāt) mid-inscription.
- **Costly + permanent signalling:** animal sacrifice was an economic blow;
  carving it on a boulder made the bargain permanent and public — "a witness to
  her side of the bargain."
- **Heard only in the recognized form:** prayers were rigidly structured
  (invocation + name + imperative + request + genealogy).
- **The whisper:** *"O Rodā, aid him against a whisperer's mischief"* — the
  malevolent invisible voice (cf. the Qur'an's "stealthy whisperer").
- **Locality:** the same fortune-god (Gad) named per tribe; gods begin small and
  local.
- **Death of a god:** belief withdrawn, a god becomes *"nothing but names"* — the
  exact mechanic of the tortoise endgame.
