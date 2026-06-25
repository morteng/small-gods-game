# Authored Music Cues + the Composer — score as part of the story system

**Status:** **DESIGN** (no code). Supersedes the runtime generative half of the
2026-06-19 presentation-director score (`MusicDirector`'s bar-by-bar emitter).
Keeps everything else in `src/presentation/` (the observer rule, SFX, camera,
voice). **Related:** presentation-director (as-built), storylet-engine,
fate-brain/fate-director, vision-cosmology.

## What the user asked

> "The director should handle this, working off of audio composed by a composer
> (or spinning off compositions as needed). The generative stuff is not cutting
> it — use a powerful brain to generate really great MIDI that can be queued and
> triggered by the system as needed, like movies and TV-shows and games do it. Is
> it part of the same system that runs stories, really?"

Two claims, both correct:

1. **The runtime generative score is the wrong model.** It should be *authored
   cues*, selected and triggered at runtime — not notes synthesized bar-by-bar.
2. **Music should live in the story system, not beside it.** Today it doesn't.

## Why the generative score isn't cutting it (code reality)

`src/presentation/music-director.ts` emits notes **per bar, forever**, while the
sim runs and `loadEnabled()` defaults **true**:

- **Harmony never moves.** Root is fixed per season (`SEASON_ROOT`); the scale is
  major/minor pentatonic around that one root. There is no chord progression,
  ever. It's a static drone over a fixed ostinato (pad triad at bar 0, bass on
  beats 0/4, pluck `inBar % 5`, bell at `inBar === 4`).
- **It never rests.** Something plays every bar indefinitely. There is no
  silence-as-an-instrument — calm sounds like the same loop, quieter.
- **Mood is a micro-lever.** `computeMood` → the director only toggles layers and
  nudges bpm/velocity. The music can't *go anywhere* because there's nothing
  composed to go to.

This is precisely the "aimless, repetitive" failure the user wants to avoid. The
fix is not better generation — it's to stop generating at runtime.

## The reframe: interactive cues, not generation

This is how **games** score (not film/TV — that's a linear cue sheet on a
timeline). The game model is *interactive music* (Wwise/FMOD): a library of
**authored cues**, and a runtime that **selects, layers, crossfades, and
triggers** them from state and story beats. The runtime never composes; it
*sequences authored material*. Composition moves to author-time.

The "powerful brain" — the LLM **Composer** — is that author-time tool: it writes
actual MIDI/note data for the cue library, and can spin off new cues on demand.

## The load-bearing insight: this IS the story system's architecture

The story system already invented every pattern an authored-cue score needs. We
are not designing a new mechanism — we are pointing music at the existing one.

| Story system (`src/story/`, `src/game/fate/`) — exists | Music system — proposed |
|---|---|
| `StagedBeat` — dormant, armed, fires on a trigger | **MusicCue** — dormant, queued, triggered by beat/mood |
| Fate `warmEnrichment()` — author content *just-ahead-of-need*, cache by `slotId`, agent never in the hot path | **Composer** warms a cue ahead of need, cache by `cueId`, never in the hot path |
| `DumbDirector` — no key → authored fallbacks, fully playable | **Base cue library** (pre-composed at build) → keyless players get real composed music |
| `StagedBeat.storylet` ref → enter an interactive card on fire | `StagedBeat.musicCue` ref → trigger the score for that beat |
| `FateDirector.chooseNext()` — agent narrows the eligible pool for pacing/theme | Director picks the next cue from eligible cues for pacing/theme |

So the answer to *"is it part of the same system that runs stories, really?"* is:
**not today, but it should be — and the story system already has the shape.** A
fired beat already carries a `storylet`; it should equally carry a `musicCue`, and
**one Director** should route prose + camera + score off the **same beat
substrate** instead of music reacting to a separate, thin `cueBeat` mood ping.

## The one rule (still load-bearing)

**Presentation observes the sim; it never mutates it.** Cues are wall-clock,
non-deterministic, client-side. The `presentation-no-sim-import` guard test stays
green: `src/sim`/`src/core` never import `src/presentation`, and presentation
imports no sim mutators. The Composer's on-demand calls happen at the same async
boundaries Fate uses (between sync runner steps), never in the frame/tick path; a
slow/declined/absent Composer falls back to the base library with zero desync.

```
story beats (StagedBeat: storylet? + musicCue?) + sim aggregates (mood)
        │  read-only, wall-clock, off the deterministic path
        ▼
   Director ──┬── prose     (storylet card)        exists
              ├── camera    (cinematic framing)     exists
              └── score ── CueSequencer ── MusicBackend (tinysynth today)
                              ▲
                              │ warm-ahead-of-need (async, advisory)
                           Composer (capable-tier LLM) → cue library (MIDI)
                              ▲
                              └ base cue library (pre-composed at build, committed)
```

## The model

### 1. `MusicCue` — the new primitive

A cue is short, authored note data plus routing metadata. MIDI-ish, compact,
diff-able, committed as an asset (kilobytes, deterministic, hand-editable).

```ts
type CueRole =
  | 'bed'      // sustained/looping ambient layer, may be silent
  | 'stinger'  // one-shot accent on an event (the SFX half generalised)
  | 'swell'    // a phrase that rises then recedes to silence
  | 'leitmotif'; // a subject/theme motif

interface MusicCue {
  id: string;
  role: CueRole;
  // When is this cue eligible? Mood ranges + tags it answers to.
  mood?: { tension?: [number, number]; reverence?: [number, number]; liveliness?: [number, number] };
  tags?: string[];                 // 'miracle','death','settlement_founded','dawn','winter',…
  themeKey?: string;               // for leitmotifs: which subject/god/settlement
  // Composed payload: a list of timed note events on named voices.
  notes: CueNote[];                // { voice, midi, atBeat, durBeats, vel }
  bpm: number;
  loop: boolean;                   // beds loop; swells/stingers don't
  transition?: 'crossfade' | 'cut' | 'on_bar'; // how to leave the previous cue
}
```

Silence is expressible directly: a `bed` cue with no notes, or simply *no
eligible cue* → the sequencer plays nothing. **Quiet is the default state**, not a
gap between loops.

### 2. The CueSequencer (replaces the bar emitter)

Owns one bed slot + a stinger bus. Per update it:

- resolves the **eligible bed** from mood/tags (Director may override the pick for
  pacing); crossfades when the choice changes; **plays nothing if none eligible**.
- fires **stingers/swells** on beats/events on reserved channels (reuses today's
  `SfxDirector` channel discipline, 6–8 vs music 0–4).
- triggers a **leitmotif** cue when a beat names a subject (replaces the
  procedural `leitmotifFor`).

It schedules authored `CueNote`s against the backend's look-ahead clock — the same
mechanism that exists, fed by composed data instead of per-bar synthesis. The
`MusicDirector` mood→layers→velocity logic is **deleted**; mood now only *selects*
cues, it doesn't *compose* them.

### 3. The Composer (author-time LLM pass + on-demand warm)

- **Author-time (build):** a script (`scripts/compose-cues.ts`, mirroring
  `scripts/seed-building-art.ts`) prompts the capable-tier LLM to write the base
  cue library as `MusicCue` JSON, committed under `public/asset-library/cues/`.
  This is the **fallback library** — keyless players get genuinely composed music,
  not procedural mush. **Respects the funding freeze** (`OPENROUTER_API_KEY` gated,
  `--plan` dry-run); cues are committed assets, so the freeze only blocks *new*
  composition, never playback.
- **On-demand:** when the world coins something that wants its own theme (a newly
  named god/settlement/rival), the Director asks the Composer for a `leitmotif`
  cue via Fate's existing warm-ahead seam, cached by `cueId`, with the base
  library as the deterministic fallback. Same `StoryAgent`-style advisory
  contract: returning null defers to the library; the agent is never required.

### 4. Unify the seam

- Add `musicCue?: string` to `StagedBeat` (`src/sim/threads/staging-types.ts`),
  alongside the existing `storylet?`. A fired beat can request a cue the same way
  it requests a card.
- Route it through the existing fired-beat callback in `game.ts` (where
  `cueBeat`/`playStorylet` already live), so **one Director** drives prose, camera,
  and score off one beat. Mood-driven bed selection continues for the ambient
  bed; *beats* drive swells/leitmotifs/stingers.

## Two axes, kept separate

- **Composition** (this spec) — what notes, when. Authored cues are a large step
  up regardless of synth.
- **Timbre** — how it sounds. Even great MIDI through GM `webaudio-tinysynth` will
  read a bit "MIDI." Out of scope here, but flagged: a later pass on synth voices
  / a small sampled instrument set is where "sounds good" actually comes from.
  Decide before claiming the audio is "great."

LLM-composed MIDI is viable *because cues are short and triggered in context* —
leitmotifs, stingers, modal ambient beds are well within reach. It won't write a
symphony; the cue model doesn't ask it to.

## Proposed slices

- **M-0 — Cue sequencer + hand-authored library (vertical slice, no LLM).**
  `MusicCue` type, `CueSequencer` replacing the bar emitter, ~8 hand-written cues
  (calm bed, tension bed, miracle swell, death dirge, settlement founded, dawn
  bed, two leitmotifs), **default-silent-ish** behaviour. Goal: *hear the
  difference* and validate the silence-as-default feel before any LLM work.
- **M-1 — Unify the seam.** `StagedBeat.musicCue`; one Director routes
  prose+camera+score off beats; retire the standalone `cueBeat` mood ping for
  beats (keep mood for the ambient bed only).
- **M-2 — Composer author-time pass.** `scripts/compose-cues.ts` → committed base
  library (freeze-safe), replacing the hand-authored M-0 cues with a fuller set.
- **M-3 — On-demand leitmotifs.** Warm-ahead Composer for newly-named subjects via
  Fate's seam; base library fallback.
- **M-4 (separate epic) — Timbre.** Synth voices / sampled instruments.

## Open questions

1. **Cue format:** custom compact `MusicCue` JSON (above) vs standard `.mid`
   files. JSON is diff-able/LLM-friendly and matches the asset-library pattern;
   `.mid` is portable but opaque in git. Leaning JSON.
2. **How sparse is "default"?** Is there *ever* a continuous bed at rest, or is the
   resting state true silence with cues only on beats/mood-thresholds? (User's
   instinct says lean silent; M-0 should let us tune this by ear.)
3. **Composer determinism:** cache warmed cues as the persistence unit (like
   warmed enrichment slots) so re-roll/replay yields identical music?
4. **Per-beat ducking vs mood ducking:** today story cards duck via volume; should
   a `swell` cue instead *replace* the bed for its duration?

## Non-goals

- Streaming/recorded audio (this is MIDI/synth, tiny and deterministic).
- Linear film-style cue sheets — the model is interactive/state-driven.
- Touching the sim's determinism, the observer rule, or the SFX/camera/voice
  directors beyond generalising stingers into the cue vocabulary.
