# Small Gods — Development Notes

## Game Concept

A god game inspired by Terry Pratchett's *Small Gods*. The player is a minor deity who cultivates genuine belief among NPCs through indirect influence (whispers, omens, dreams, miracles). Rival spirits compete for the same followers.

**Two-layer architecture:**
- **Sim layer** (always running) — deterministic NPC state: beliefs, needs, mood, relationships. Belief propagates along social graphs; events (droughts, festivals, rival actions) shift needs and open opportunities for divine intervention.
- **Narration layer** (on-demand) — an LLM generates dialogue/scenes from compact sim state when the player focuses on something, and returns structured state deltas that feed back into the sim. **Rule: the sim is truth; the LLM animates it and never contradicts its numbers.**

## Project Documentation

- **[VISION.md](docs/VISION.md)** — 🧭 **Canonical** cosmology, belief model, arc. Read first; other docs defer to it on cosmology / belief / Fate / progression.
- **[ROADMAP.md](docs/ROADMAP.md)** — 🛣️ The **single** forward plan, and the source of truth for what has shipped and what is next. Each not-yet-built track gets its own brainstorm → spec → plan under `docs/superpowers/{specs,plans}/`.
- **[TECH_SPEC.md](docs/TECH_SPEC.md)** — full technical spec (systems, architecture, data models).
- Completed/superseded specs live in `docs/archive/`. **For live session state / active epics, read `MEMORY.md`, not this file.**

Sim is deterministic with seedable RNG (sfc32); snapshot/replay supports scrub + commit + re-roll + jump-forward presets. `state.paused` retired for `scheduler.getRate()`. **All `src/sim/` is `Math.random`-free** (guard: `tests/unit/no-random-in-sim.test.ts`).

**TIME IS 1:1 REALTIME (R8):** a calendar day = a solar day = 24 real hours at rate 1 (`TICKS_PER_DAY` 5,184,000; tick stays 16.667 sim-ms; rate stays a pure multiplier; NO offline catch-up). Fresh worlds start at a fixed 08:00 morning (`WORLD_START_HOUR`, `?solarhour=H` override; non-browser fallback = tick 0 = 09:00) — never anchored to the player's wall clock. Day-keyed lifecycle (mortality/births/growth) checks once per GAME HOUR (`GAME_HOUR_HZ`) with per-day meanings preserved; the belief/need economy stays REAL-TIME per-fire by design (the live loop). Pre-1:1 saves were discarded by a `SAVE_VERSION` bump at the time (**read the current value from `src/core/save-file.ts`; never restate it here**). Constants meaning fiction-days must be `TICKS_PER_DAY` multiples — never raw tick literals.

## Known gaps & gotchas (code reality)

- **`World` has TWO index layers.** `EntityRegistry` has its own indexes AND `World` (`world.ts`) keeps separate `spatial`/`kindIdx`/`tagIdx`; `query()` uses World's. When mutating `x/y/kind/tags`, call **`World.updateEntity()`** — never mutate entity position directly.
- **All `src/sim/` randomness flows through `ctx.rng` / passed `rng` (seeded sfc32), never `Math.random`** — enforced by a guard test.
- **Every IndexedDB open/txn must race `withIdbTimeout`** (`src/services/idb-guard.ts`). A wedged backing store leaves `indexedDB.open()` pending FOREVER (froze boot). The four stores (`save-store`, `generated-art-cache`, `pixellab`, `parametric-sprite-cache`) are guarded and degrade (fresh world / vendored art / dropped autosave / recompose). GOTCHA: burst IDB traffic under a busy main thread starves txn event delivery past the 4s timeout — sprite-cache writes are serialized + reads batched 16-per-txn for this reason.
- **LLM backfill uses the configured provider** (`LlmBackfillService`, `src/game/llm-backfill.ts`); `game.ts` builds it via `createProvider(loadProviderConfig())`. Saving LLM settings rebuilds the live client in place (`Game.applyLlmConfig` → `setClient`, no reload). `Game.llmClientCapable` (capable tier) feeds the **Fate brain** (`src/game/fate/`); the deterministic stub producer runs only as the offline fallback (`llmClientCapable === null`).
- **Story-pack effects must name verbs from the capability registry** — the live bus allowlist rejects the WHOLE pack otherwise (this silently killed the shipped pack for weeks; guard: `tests/unit/story-pack-live-verbs.test.ts`). Storylet `subject:` args don't resolve to command targets yet (subject binding is a gap).
- **Building sprites flow through ONE pipeline (runtime + author-time):** blueprint → manifold geometry → grey init (`compositeOverChroma`) → img2img (`BUILDING_IMAGE_MODEL` = `qwen/qwen-image-edit-2511` on Replicate, dispatched via `src/llm/building-image.ts` `generateBuildingImageAuto` — non-qwen model ids still route to OpenRouter) → chroma-key → quality gates (border-key ≥0.6 + silhouette IoU ≥0.9) → register onto the geometry grid with a negotiation band (`registerAlbedo`, `src/render/sprite-postprocess.ts`) → palette-quantize (Oklab + Bayer4 dither) → persist. `GeneratedBuildingArtSource` runs it at runtime (validate-BEFORE-persist; bad gens retry once then session-null, never poisoning IDB), checking IDB → vendored library → paid generation. Author-time seeding is the same pipeline: `REPLICATE_API_TOKEN=… npx tsx scripts/seed-building-art.ts [--plan]`. Geometry G-buffer hashes pinned in `tests/unit/assetgen-golden.test.ts` — geometry changes update the pins AND bump `ART_RECIPE_VERSION` (**read the current value from `src/core/content-version.ts`; never restate it here**). **Runtime paid gen defaults OFF and a reseed is FROZEN (user: "don't spend money yet") → in-game buildings render as GREY massing until a funded reseed.**
- **The camera pans in ISO-SCREEN space** (`gpu-render-frame` passes `originX: -camera.x` into the diamond projection). Any code framing a tile (fly/follow/fit) must project via `render/iso/iso-projection.worldToScreen` — the flat `tile*TILE_SIZE` mapping is a different space and lands mid-ocean. `Game.flyTo` accepts `(tx,ty)` or `({x,y})`, drops non-finite/off-map targets, and `applyCameraFly` self-heals a NaN camera.
- **Time-Debug snapshot/inject are honest stubs** (disabled buttons in `src/dev/TimeDebugPanel.ts`) — a ROADMAP item.
- **Any post-gen in-place `tile.type` write MUST call `bumpTilesRev(map)`** (`src/core/tile-rev.ts`) — the terrain color memo (`packColorFieldMemo`) keys on `map.tilesRev`; without the bump the GPU paints the old ground until reload (this silently hid live trample trails for a round). Current bumpers: trample promote/revert/settle/reconcile, settlement-growth stamping, perception realize, dev brush.

## Tech Stack

- **WebGPU** is the only scene renderer (terrain + entities + UI); Canvas2D 2D-ctx kept only for overlays/compositing. A device with no WebGPU gets an honest "WebGPU required" overlay. `pixi.js` must never be imported (guard test).
- Live overworld is **noise-based** (`terrain/terrain-generator.ts`: fractal noise → biomes → tiles) + connectome/settlement-driven (superseded WFC in the 2026-05 overhaul). **WFC** primitives are retained but **dormant** (`generateWithWFC` bypassed; `autotiler` still reads WFC `TILES`; Cell/Grid/Solver reserved for a future zone-WFC / dungeons).

## Architecture

`game.ts` is a thin coordinator; the work lives in the `src/game/` collaborator modules + subsystem dirs (`core/`, `sim/`, `world/`, `llm/`, `map/`, `render/`, `assetgen/`, `blueprint/`, `catalogue/`, `terrain/`, `ui/`, `wfc/`, `dev/`, `services/`, `embed/`).

**Embedding (for MCP UI):** `new Game(containerElement, options?)` mounts into any element via `src/embed/mount.ts`. Keep it that way — **no `document.body` assumptions and no inline handlers** (all `addEventListener`), so the embed stays CSP-compatible.

### Boot & the game shell (UI v3)

**A page load does NOT generate a world.** `Game.bootShell()` brings up the GPU device + scene and shows the **title screen** (~1–2 s); worldgen happens only when something asks — `Game.startWorld({fresh,genSeed,genome,worldSeed,ephemeral})`. `resolveAutostart` (`src/game/autostart.ts`) decides which URLs skip the title: **`?genseed` / `?genome` / `?bridge` / `?autostart` all boot straight in exactly as before**; only a plain visit reaches the title.

**Two render modes, ONE frame loop.** `onRender` branches on `state.map == null` → `renderMeta` (sky-backdrop shader + UI pass only, no camera/terrain/entities/2D overlay); `onFrame` reports `'ambient'` in meta mode so the title doesn't spin a fan. `selectRenderer` returns `{ render, renderMeta }`.

**The shell = the screen stack** (`src/render/ui/shell/`): `shell-state.ts` is a pure reducer, each screen is a pure `(UiContext, w, h, s, view) => action` module, `shell.ts` is the only stateful glue. `UiRuntime.frame()` has ONE branch for it (the first arm of the existing menu/card/story/HUD chain, so it inherits all hit/scroll/island bookkeeping). Adding a screen = one `case` in `Shell.draw` + one pure module + one entry in `Shell.describe()` — never a branch inside another screen. A screen swallows pointer input unconditionally (in meta mode there is no world beneath). Esc routes shell → card → pause menu.

**THE ART-SETTLE RULE IS UNCHANGED:** the loading screen holds until the world is fully displayed — never grey boxes, **no wall-clock caps** (`art-settle-gate.ts`, `maxWaitMs` defaults `Infinity`). Only *where* progress draws moved (WebGPU, `src/render/ui/shell/loading-screen.ts`).

**Quit to title is IN-PROCESS**, not a reload: `Game.returnToTitle()` → `resetState(state)` (`src/core/state.ts`) clears `GameState` in place, PRESERVING the container identities collaborators built in the constructor hold (`clock`/`eventLog`/`spirits`/the stores) — the same split `restoreSnapshot` already lives by. Guarded by `tests/unit/state-reset-parity.test.ts`, which also **pins the `GameState` field count**, so adding a field fails with instructions. `location.reload()` survives only as a logged fallback. **Never `Object.assign(state, createState())`** — it dangles every collaborator.

**Meta capability verbs are an EXTERNAL AGENT API, not internal plumbing.** The bus/MCP seam is becoming a product feature (a player connects their own agent and drives the game). `new_game`/`load_slot`/`save_slot`/`delete_slot`/`rename_slot`/`quit_to_title`/`open_screen`/`close_screen`/`set_setting`/`rebind_key`/`capture_photo`/`copy_world_code` are registry verbs at `tier:'meta'`, `targetKind:'none'`, no `apply` — intercepted in `Game.handleMetaCommand`, never enqueued. They work **with no world loaded**. Every shell action (including a player's own click) is routed as one of these, so a click and an agent's `emit_command` share one path. `Shell.describe()` exposes screen + enumerated choices (with enabled state and refusal reasons) so a headless agent navigates menus without screenshots — its `choices` MUST derive from the same function the renderer walks. Verb/param names are API: renaming one is a breaking change.

**Saves:** slots (`autosave` + `slot1..3`), a separate `save-meta` store so listing never deserialises a ~171k-tile blob, and an append-only `event-journal` (the log is no longer in the SaveFile — it was O(total history) per autosave). Blob + meta + journal delta land in ONE transaction. A stale save (`slotCompat` → `stale-save` / `stale-world`) is **shown and refused, never silently regenerated over**.

Rendering internals are documented in [`src/render/CLAUDE.md`](src/render/CLAUDE.md), which loads when you work under `src/render/`.

## Development

```bash
npm run bus -- ping # drive a running game from the CLI (needs the tab on ?bridge)
npm run mcp         # stdio MCP server over the running game (.mcp.json → `small-gods`)
npm run lint:world  # evaluate connectome contracts on the default world
npm run lint        # oxlint over src/tests/tools/scripts (~2s) — MUST stay at zero
```

(`npm run dev` on port 3000, `npm run build`, `npm test` are the standard invocations — see `package.json`.)

**Lint is a bug gate, not a style gate** (`.oxlintrc.json`). Every rule left on is one
worth blocking a commit for; taste-only rules are off *with a written reason*, so a
non-empty run always means something. Two rules are off because they are actively wrong
here — `unicorn/no-useless-spread` (the flagged `[...x]` are deliberate snapshots of
collections the loop then mutates) and `import/no-cycle` (10 real cycles remain in
render/world/assetgen; they work only because every cyclic binding is read inside a
function). Don't "fix" code to satisfy a rule — turn the rule off and say why.

**`src/sim/` is import-cycle-free — keep it that way.** The pattern for breaking one is
`src/sim/divine-costs.ts`: pull the pure leaf values into a module that imports nothing,
then **repoint the importer at it** — a re-export from the original module does *not* cut
the edge.

**Dev bus bridge (out-of-process control).** With the game on `?bridge` (read-only) or `?bridge=rw` (writes), the in-browser `GameBus` seam is published over a WebSocket broker (Vite plugin on `/__bus`) so a CLI (`tools/bus-cli.ts`) or a stdio **MCP server** (`tools/mcp-server.ts`) can drive + inspect a live game. The tab is the *game peer* and does all dispatch (inherits the bus's gating/replay). **DEV ONLY — Fate and the WebGPU UI call `GameBus` in-process and must never round-trip through the bridge.**

## CI, Build & Release

**Never move CI, asset generation, or the desktop build onto GitHub Actions.** Tests, heavy asset jobs, and the Electron build all run on the shared ephemeral Hetzner box `ci-eph` via `./scripts/ci-on-server.sh`. The GitHub Pages deploy (`.github/workflows/deploy.yml`, auto-deploys on push to `main`) is the **only** Actions workflow we use — leave it there.

**Never commit or expose secrets.** They live in `.env` (gitignored) and are injected into remote runs `--env-file` 0600, deleted the instant the run ends. No Hetzner API token ever lives on the box.

Full mechanics — server-CI flags, heavy asset jobs, the desktop release flow — are in the **`ci-and-release`** skill and [docs/RELEASING.md](docs/RELEASING.md).

## Gameplay Architecture

Track status lives in [ROADMAP.md](docs/ROADMAP.md) — this section covers the *design contracts*, not what has shipped.

- **NPC sim** — traits, belief per spirit (faith/understanding/devotion), needs (safety/prosperity/community/meaning), social graph, event ring buffer, mortality + birth + lineage (D1).
- **Divine actions** — whisper/omen/answer-prayer/dream/miracle, each costs belief-power (= belief × understanding × devotion); understanding gates sign-perception & prayer efficacy. Extended by **belief-granted powers + the divine inbox** (a god's vocabulary = what its believers think it can do).
- **LLM backfill** — ~500-token prompt → narrative + JSON delta; runs the **fast/chat tier** (`DEFAULT_CHAT_MODEL`) of the two-tier OpenRouter catalog (`src/llm/openrouter-catalog.ts` is the source of truth for model ids).
- **Rival spirits** (Track 3) — `RivalSystem` (0.5 Hz) decides from real per-settlement follower data (`buildRivalSituation`) and **claims prayers left unanswered past `PRAYER_CLAIM_WINDOW_TICKS` (half a day = ~12 real hours)** via the shared `answer_prayer` command path (`src/sim/rival-claims.ts`); contested + lost pleas surface as inbox threats → alert pins. Fate coaches rival stances (`set_rival_stance`). Power-economics: spend/save policy (`AMBITION_BANK`/`WEALTH_PRESSURE`), other-rival awareness (`opposingFollowersInSettlement`/`otherRivals`), undermine targets the strongest god overall, `rival_dispute` → coalesced inbox tiding.
- **Fate / DM agent** (Track 4) — background LLM on the **capable tier** (`DEFAULT_CAPABLE_MODEL`) via `Game.llmClientCapable`. The codebase calls this layer **"Fate."** `FateBrainService` (`src/game/fate/`, async — off the sim tick) is woken by `FateTrigger` on significant thread events + sustained rival claim pressure (≥2 claims/sim-day window), cooldown-throttled; 4 constrained drift-guarded tools — `arm_staged_beat` (optionally with a validated `storylet` ref → interactive card on discovery), `nudge_event_severity`, `force_next_event`, `set_rival_stance` (anti-snowball coaching, deltas capped ±0.2 both sides of the LLM boundary).
- **God lifecycle** (Track 5) — a god is only as real as its belief. `beliefMass` / `intimacy` / `tier` are derived every sim second in `SpiritSystem` and persisted on `Spirit`; `src/sim/god-tier.ts` is the pure half (hysteretic `tierFor`, `stepFading`, `isSilenced`). A god below `FADE_MASS` for a sustained window fades and **keeps only `whisper`** — canon (tenet 6) and the anti-softlock guarantee. Symmetric for player, rivals, and great gods.
