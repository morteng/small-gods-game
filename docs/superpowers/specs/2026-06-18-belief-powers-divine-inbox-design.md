# Belief-Granted Powers + the Divine Inbox (Brainstorm / Design)

**Status:** brainstorm only — no code. The headline new system: **a god's powers are
exactly what its believers think it can do.** Belief *content* (domains) gates the action
vocabulary; an inbox surfaces prayers/opportunities/threats (curated by Fate + the
storylet reservoir); a skill panel renders belief as buttons.
**Relates to:** [[project-storylet-engine]] (the inbox = the reservoir surfaced),
[[project-fate-orchestration-layer]] (purposeful surfacing/pacing),
[[project-command-query-bus]] (capability registry = the power vocabulary),
`docs/VISION.md` (belief model + attribution win), Track 3 rivals (attribution contest).

## 1. What & why — the thesis as a mechanic

In *Small Gods*, a god is only as powerful as it is believed in, and is *shaped into*
whatever its believers think it is. We make that the core loop instead of flavour:

- The player starts with almost nothing (the subtle kit: whisper/omen/dream).
- **What dramatic powers the player has is decided by the congregation**, not a tech tree.
  If NPCs come to believe the god commands lightning, a **lightning button appears**. If
  they believe it can walk among them, a **manifest button appears**. The player earns the
  *vocabulary of action* by shaping what people believe.

Three of the player-facing ideas are **one loop**, not three features:

| Surface | Role in the loop |
|---|---|
| **Divine inbox** (prayers, omens-of-opportunity, threats) | the **acquisition channel** — where belief gets *made* |
| **Belief-content / domains** (what they think you ARE) | the **currency** — gates the action vocabulary |
| **Skill / action panel** | belief **made visible as buttons** |

> The loop: inbox surfaces a coincidence → player nudges attribution → "controls
> lightning" belief forms + spreads on the social graph → crosses a threshold → the
> Lightning button unlocks → casting it *deliberately* is even more convincing →
> reinforces the domain. Queue, powers, and panel are three views of one belief economy.

## 2. Belief-content: the domains model

Today belief is `beliefs[spiritId] = { faith, understanding, devotion }` per NPC — *how
much*. The new layer is *what about*: each NPC carries a **sparse belief-content vector**
over a small fixed enum of **domains**, layered on top of faith.

- **Domains** (each backed by a real coded capability — no button without an effect):
  `storm/lightning`, `fire`, `rain/harvest`, `healing`, `death/wrath`, `manifestation`, …
  Bounded by what the engine can actually do; Fate may *name/flavour* a domain but cannot
  invent an effect.
- Per NPC: `domains: { lightning: 0.4, ... }` — most NPCs hold 0–2 beliefs about you
  (sparse, cheap). Propagates along the social graph like faith does.
- **Aggregate** (population-weighted by faith × devotion, **attributed to the player**)
  drives *unlocks*. **Per-NPC** strength drives propagation and how a local witness
  *receives* a miracle.

## 3. Three tiers — mapped onto faith / understanding / devotion

Powers aren't a binary unlock; a domain ripens through the dimensions we already model.

- **Tier 0 — universal kit (always on).** whisper / omen / dream. The *bootstrap* layer:
  how you create belief content in the first place. (No retrofit — the existing subtle
  divine actions simply *become* this tier.)
- **Tier 1 — CLAIM (gated by faith).** Enough belief → you can *claim* a **natural** event
  of that domain. Opportunistic, timing-based, inbox-driven ("strike now — the storm is
  overhead"). Cheap, unreliable, exploits coincidence.
- **Tier 2 — COMMAND (gated by understanding).** They grasp the mechanism → the
  **deliberate button** appears: cast on demand for a power cost, targeted.
- **Tier 3 — DOCTRINE (gated by devotion).** Cheaper, wider area, reliable, finer control,
  and **decay-resistant**. The progression goal — belief becomes self-sustaining doctrine.

## 4. Bootstrapping (the chicken-and-egg)

You can't summon lightning until they believe you command it — but they won't believe it
until they see it. Resolution: **coincidence + attribution.**

- The sim already throws natural events (storms, droughts, fires, births, deaths). The
  **inbox surfaces upcoming ones as opportunities.**
- If the player has drawn attention near an event (an omen, a whisper, presence) and an
  NPC's **understanding/suggestibility** clears the bar, the NPC *attributes* the event to
  the god → seeds/strengthens that domain belief.
- So early game = **exploiting natural events** you can't yet cause. This is what makes the
  inbox load-bearing rather than decorative: it *is* the early power-acquisition game.

## 5. The bidirectional tension (the actual game)

Powers are a **live mirror** of the congregation's model of you, not permanent unlocks.

- **Decay.** Stop using a domain and belief (and the button) fades. Anti-snowball; keeps
  the inbox relevant. *Lean:* slow decay, **Tier-3 doctrine freezes it.*
- **Attribution contest (rivals, Track 3).** A rival storm-spirit competes for the same
  domain; whoever gets attributed grows. Ties directly to VISION's *attribution win*.
- **Identity / portfolio commitment.** Dramatic acts define *what kind of god you are*.
  Grill a beloved elder → fear + some faith, but devotion/love craters and you've branded
  yourself wrath-storm-death — which can **lock you out of** healing/mercy or make them
  ruinous. The portfolio is a *commitment*, not a shopping list. You become what you're
  believed to be.
- **Powers you didn't ask for (the Om horror-comedy).** Belief shapes the god regardless
  of intent: they decide you demand sacrifice → a "demand sacrifice" affordance appears, or
  worse, NPCs start doing it *unprompted*. Emergent, on-theme, and a great hook.

## 6. The divine inbox

A curated, triageable queue — the god's attention surface.

- **Item kinds:** **prayers** (NPC-originated asks tied to needs/events), **opportunities**
  (sim events the player could exploit for attribution), **threats** (rival moves,
  apostasy, a believer in danger).
- **Triage verbs:** **Ignore** (decays off the queue) · **Investigate** (routes into the
  existing focus → mind-page drill / LLM backfill) · **Act** (opens the skill panel scoped
  to this target).
- **Curation = the storylet reservoir surfaced.** An item is (often) a storylet whose
  `when` preconditions matched. **No key:** deterministic *salience scoring* ranks the
  queue. **With key:** **Fate surfaces items purposefully** to drive story — plant an
  opportunity to bait the belief work that unlocks a teased power, escalate a rival, set up
  a dilemma, pace the arc. Fate already stages beats (`arm_staged_beat`); a Fate-surfaced
  inbox item is a staged storylet with intent + high salience, and acting on it can advance
  a plot thread. Same content, two directors — exactly the storylet engine's contract.

## 7. The skill / action panel

Belief made visible. Rendered from `bus.capabilities()` filtered by a per-capability
**belief-gate predicate** — one source of truth (same registry the MCP surface reads).

- A locked power shows **why** and **what would unlock it** — legibility is the #1 UX risk.
  `bus.preview()` already returns rejection reasons; "They don't yet believe you command
  the storm — 38% of Stormhaven, need 60%" is just a richer rejection the panel renders as
  a greyed button with a hint + a progress read.
- Buttons **appear / brighten / fade** as domains cross thresholds and decay — the panel is
  a dashboard of who-thinks-you-are-what, not a static toolbar.
- WebGPU-native (immediate-mode UI, `src/render/ui/`), per the renderer decree.

## 8. Architecture mapping

**Reuses (most of the scaffolding exists):**
- **Capability registry** (`CapabilityView`, `implemented`) → add a belief-gate predicate;
  the panel + MCP both read the filtered set.
- **Command bus** validate/gate/`preview` → "not yet believed" becomes a first-class
  rejection with the progress payload.
- **PerceptionSystem** (understanding-gated sign perception) → the attribution hook: a
  witnessed miracle/coincidence emits a perceivable event; witnesses run attribution.
- **Belief propagation / social graph** → domain vectors propagate like faith.
- **Storylet engine + Fate** → the inbox content + curation; staging arms opportunities.
- **Belief-power economy** → dramatic miracles are expensive; witness radius matters (an
  unseen miracle is wasted belief).

**Genuinely new (the careful part):**
- The **per-NPC belief-content vector** + the **attribution loop** — deterministic,
  `Math.random`-free (seeded `ctx.rng`), snapshot-compatible, lean over many NPCs (sparse).
- The **domain → capability gate** + threshold/decay math.
- The **inbox salience model** (deterministic baseline) + the **Fate surfacing seam**.
- The **skill panel** UI + the legibility/progress payload.

## 9. Open decisions

1. **Bootstrapping** — confirm coincidence+attribution as the seed (recommended; makes the
   inbox load-bearing).
2. **Decay** on/off and whether Tier-3 doctrine freezes it (lean: slow decay, doctrine
   locks).
3. **Domain granularity** — fixed enum bounded by implemented capabilities (rec) vs
   Fate-authored freeform (flavour only, no new effects).
4. **Identity axis** — do dramatic acts shift a temperament/portfolio axis that *gates*
   other domains (richer, bigger), or purely additive (simpler)?
5. **Aggregate threshold shape** — flat % of population, or weighted by reach/influence
   (a believed elder counts more)? Per-settlement vs world-wide unlock?
6. **Attribution windows** — how tight is the timing to claim a natural event, and how does
   understanding widen it?
7. **Inbox capacity / decay** — queue size, staleness, and how "Ignore" feeds back into
   belief (ignored prayers erode devotion?).

## 10. Proposed vertical slice (MVP — feel the loop turn once)

Smallest cut that exercises the *entire* belief→power→reinforce loop end-to-end, no key:

- **B-A — belief-content model:** sparse per-NPC domain vector + propagation + aggregate
  read; one domain (`storm/lightning`). Deterministic, snapshotable, guard-tested.
- **B-B — attribution:** a natural storm event + a witness/attribution hook in
  PerceptionSystem; an omen/presence near it seeds `lightning` belief.
- **B-C — gated capability + panel:** a `lightning` capability behind the belief-gate; the
  WebGPU skill panel renders it locked→unlocked with the legibility/progress hint; casting
  it reinforces the domain (and costs power, needs witnesses).
- **B-D — inbox (two item kinds):** a **prayer** and a **storm-opportunity**, triageable
  (ignore/investigate/act); deterministic salience. Acting on the opportunity routes into
  the claim/cast.
- **B-E — Fate surfacing seam (stub):** the inbox reads a "surfaced/intent" flag a staged
  storylet can set, so Fate can later promote an item — wired but dumb-director by default.

Later slices: more domains, decay + doctrine lock, identity/portfolio axis, rival
attribution contest, manifestation domain (→ conversation/storylet payload), "powers you
didn't ask for."

## 11. Determinism & perf guardrails

- All belief-content math flows through seeded `ctx.rng` — `Math.random`-free
  (`tests/unit/no-random-in-sim.test.ts` must stay green).
- Domain vectors are **sparse** (most NPCs hold 0–2) — don't allocate dense N×D arrays.
- Belief-content is sim state → must round-trip through `core/snapshot.ts` (scrub/commit/
  time-skip). Time-skip (D2) needs a closed-form domain-belief turnover, like faith.
- The skill panel is rebuilt immediate-mode each frame from the registry + a cached
  aggregate read (don't recompute population aggregates per frame — cache, invalidate on
  belief tick).

## Branch / worktree

Design-only so far. The inbox shares the storylet reservoir, so this brainstorm lives on
`feat/storylet-engine` (sg-story) alongside the engine it builds on. **The branch for
*code* is still an open call** (fresh off `main` vs continue on the storylet branch) —
decide when B-A starts.
