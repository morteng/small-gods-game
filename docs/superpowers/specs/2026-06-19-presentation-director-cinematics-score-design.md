# Presentation Director — Cinematics, Adaptive Score, Audio & Voice (As-Built)

**Status:** **BUILT** on branch `feat/presentation-director` (worktree
`/Users/Morten/mcpui/sg-presentation`, off main `0059e71`). Slices P-A (adaptive
score), P-B (SFX stingers + story-modal duck), P-C (cinematic camera) and P-E
(opt-in voiceover) are implemented, unit-tested (41 tests), and browser-verified.
P-D (acting/motion) is **deferred** — hard-blocked on the NPC sprite rebuild.
**Reference:** [g200kg/webaudio-tinysynth](https://g200kg.github.io/webaudio-tinysynth/).
**Related:** storylet-engine, fate-brain, vision-cosmology.

## 1. What & why

The narrative **logic** is shipped (storylets `src/story/`, Fate `src/game/fate/`,
the WebGPU story card). This epic adds the **presentation** of it: how a beat *feels*
when it lands — camera framing, a swell in the score, a divine stinger, optional spoken
narration. The "show" half of the storytelling system.

## 2. The one rule (load-bearing)

**Presentation observes the sim; it never mutates it.** The sim is `Math.random`-free,
seeded, snapshot/replay/scrub-able. Camera/audio/voice are wall-clock, non-deterministic,
client-side. Routing them through the command bus would poison replay (scrub would
re-fire stingers, peg music to tick). So the layer is a **read-only observer**, mirroring
the game's two-layer model (sim always running; narration reads on demand). A guard test
(`presentation-no-sim-import`) enforces that `src/sim` and `src/core` never import
`src/presentation`, and that presentation imports no sim mutators.

```
state.eventLog + onStoryletBeat callback + cheap sim aggregates
        │  (read-only, wall-clock, off the deterministic path)
        ▼
   PresentationDirector ──┬── MusicDirector  (adaptive score)        P-A ✅
                          ├── SfxDirector    (event stingers)        P-B ✅
                          ├── CameraDirector (cinematic framing)     P-C ✅
                          └── VoiceDirector  (opt-in narration)      P-E ✅
```

Scrub/past-veil ducks audio for free (the observer just reacts to "we're scrubbed").
Turning the whole layer off leaves the game bit-identical.

## 3. As-built modules (`src/presentation/`)

- **`mood.ts`** — `computeMood(state)`, a PURE projection of GameState → a mood vector
  (tension / reverence / liveliness / timeOfDay / season) from belief, unmet needs, rival
  pressure, population and active events. `eventMoodNudge(type)` maps sim events to
  transient accents.
- **`music-backend.ts`** — `MusicBackend` interface (+ `NoteEvent`, `NullMusicBackend`).
  The director only ever talks to this, so swapping tinysynth → Tone.js → ogg stems is an
  aesthetic change, not a rewrite.
- **`tinysynth-backend.ts`** — first backend, wraps `webaudio-tinysynth` (GM timbre,
  embraced). **Dynamically imported** so it never loads under Node/tests; owns its own
  AudioContext + master gain + gesture-gated resume.
- **`music-director.ts`** — mood → key/mode/tempo/active layers; a pentatonic, layered,
  look-ahead generative sequencer (pad bed always; bass/pluck/bell gated by mood);
  per-subject leitmotifs via `leitmotifFor(key)`. Subtle 56–92 BPM, master 0.35.
- **`sfx-director.ts`** — shares the music backend on reserved channels 6–8; `playFor(type)`
  schedules subtle GM stingers (omen shimmer, miracle swell, smite crack, prayer chime,
  death/birth/settlement tones).
- **`camera-director.ts`** — pure smoothstep tween over the Camera (focusTile → move →
  hold → release). One-rung pixel-perfect push-in (end zoom snaps to an iso rung); any
  user input cancels it (player agency wins).
- **`voice-director.ts`** — browser SpeechSynthesis wrapper, **opt-in (default off)**,
  gentle rate/pitch, cancellable; speaks the story card's opening line. No-op where the
  Speech API is absent.
- **`presentation-director.ts`** — the observer/orchestrator: throttled mood recompute
  (750 ms), eventLog subscription (nudge + sfx), focal-NPC leitmotif, `cueBeat` (leitmotif
  + cinematic framing), `setStoryActive` (duck to 0.12 while the card is up), `speakLine`,
  `cameraActive`, audio-unlock + cinematic-cancel listeners, `localStorage` persistence.

## 4. Wiring (`src/game.ts`, `src/dev/debug-api.ts`)

- Constructed after the veil with a viewport getter; `attach()`d; `destroy()`d.
- `update(dtMs, {live, scrubbed})` every frame in the rAF loop (off the sim path); the
  loop skips `applyFollowCamera` while `cameraActive()` and forces a render then.
- Staged-beat callback → `cuePresentationBeat(subject)` resolves the subject to a tile and
  calls `cueBeat` (leitmotif + cinematic) before `playStorylet`.
- `playStorylet` → `speakLine(openingLine)`; `onStoryToggle` → `setStoryActive` (duck).
- `__debug.music(...)`: `()` inspect · `true/false` toggle · `0.5` volume · `'voice'` /
  `'camera'` toggle those · `'cinematic'` preview a framing on the selected/first NPC.

## 5. Decisions (locked)

- Score is **parametric/adaptive** (mood vector → layered motifs), not a cue-list.
- **Lean into the tinysynth GM timbre** as folk/chiptune pixel-art identity; kept behind
  `MusicBackend` so it's swappable later.
- Voiceover is **opt-in / default-off** (SpeechSynthesis is robotic; high uncanny risk).
- Cinematic camera **never grabs the view in free play** — only on fired beats, and **any
  input cancels it**.

## 6. Deferred / next

- **P-D acting/motion** — NPC micro-gesture / turn-to-face / emote on beats. Hard-blocked
  on the NPC sprite rebuild (LPC stopgap today); revisit after that lands.
- Polish: a WebGPU settings panel for master/music/sfx/voice volumes + camera/voice
  toggles (today they live on `__debug.music`); richer leitmotif authoring; SFX tuning.
- Hook the VoiceDirector to every story `say` line (not just the opener) once a story-card
  line-advance event is exposed.

## 7. Non-goals

- No change to sim determinism, snapshot, or the command bus. No new sim verbs.
- No audio asset pipeline (tinysynth is procedural/zero-asset).
- No DAW-grade adaptive-music engine; layered cross-fade + leitmotifs is enough.
