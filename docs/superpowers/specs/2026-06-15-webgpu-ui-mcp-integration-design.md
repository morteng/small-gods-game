# WebGPU-native UI + MCP integration — brainstorm / design

> Status: BRAINSTORM (2026-06-15). Two pivots, one spine. **(1)** Replace the
> DOM game/dev UI with a WebGPU-native, immediate-mode, pixel-art UI (touch +
> pointer parity). **(2)** Drop iframe/postMessage embedding in favour of an
> **MCP server** that connects Claude (and any MCP client) to the *running*
> game over a local WebSocket. Both are front-ends onto a single **command /
> query bus** — that bus is the spine of this design.
>
> Supersedes the iframe-embedding goal (`src/embed/api.ts` postMessage API is
> now legacy — see §7). Part of the rendering epic
> (`project-unified-renderer-epic`, `project-gpu-default-renderer`): the game is
> WebGPU-first, no Canvas2D/WebGL fallback for UI. **WebGPU is a hard
> requirement** — we optimise for the best path, not the lowest common
> denominator.

---

## North star

The world *is* the interface. A god watches; it does not read dashboards. The
screen is almost all world — terrain, settlements, mortals living — with chrome
that **appears on demand and dissolves when done** (the summoned Time bar is the
template; extend that philosophy everywhere). Information is surfaced **when you
focus**, not displayed permanently. Pixel-art aesthetic, world palette, modern
and restrained, for a mature audience that doesn't need hand-holding.

And the same world is **co-inhabited by Claude** — as Fate (DM/pacing), as a
divine co-pilot, as a dev/debug surface, and as a world/era author — through MCP.
The human's clicks and Claude's tool-calls are **the same kind of event**: both
are intents on one command bus, both recorded to the canonical event log, both
deterministic and replayable.

**Design references** (mature/modern pixel + minimal-chrome lineage we draw
from): RimWorld and Dwarf Fortress (Steam) — *inspect-on-demand, no permanent
stat bars*; Hyper Light Drifter / Hades — *diegetic minimalism, the HUD is
nearly invisible*; Songs of Conquest / Norland — *painterly mature pixel art*;
Caves of Qud — *deep information surfaced contextually, never dumped*. The thesis
across all of them: **information on demand, not on display.**

---

## The one principle: one command/query bus, two front-ends

```
        Human (WebGPU UI)            Claude (MCP server, via WS)
              │  intents                       │  tool calls
              ▼                                 ▼
        ┌─────────────────────────────────────────────┐
        │   Command bus   (typed GameCommand)          │  ← recorded to EventLog
        │   Query facade  (read-only snapshots)        │  ← never mutates
        └─────────────────────────────────────────────┘
              │ apply at tick boundary (seeded, deterministic)
              ▼
        World / sim / scheduler  (truth)
              │ state
              ▼
        WebGPU renderer  →  pixels  (+ canvas.toDataURL for MCP screenshots)
```

- **Command** = an intent to mutate (take a divine action, skip time, spawn,
  author an event, set camera/rate). Both the UI and the MCP bridge emit
  commands. Commands are validated, cost-gated (power), applied **at a tick
  boundary** through the existing dispatchers, and **recorded as authored events
  in `EventLog`** so snapshot/replay stays honest even when Claude is the author.
- **Query** = a read-only view (world summary, NPC list/detail, belief state,
  events-since, timeline, screenshot). Pure, snapshot-based, never mutates.
- The UI's action surface and the MCP tool surface are **thin adapters** over
  these two APIs. "Who asked" is decoupled from "what happens." This gives us:
  determinism (log commands), testability (replay commands in Node, no
  browser/UI), and a single place to enforce power/cost/permission rules.

This is the keystone. Build it first (Slice 0); everything else hangs off it.

---

## Part A — WebGPU-native UI

### A.1 Layered render model (all in the one WebGPU pass)

1. **World** — terrain heightfield + y-sorted entities (existing GPU scene).
2. **World-anchored UI** — selection rings, floating labels, the divine-action
   radial, ward/settlement labels. Lives *in* world space so zoom is one matrix
   multiply, **not** a DOM reflow. (This is the core perf argument for canvas UI:
   DOM overlays re-layout every zoom frame and that is the jank.)
3. **Screen-space HUD** — the presence orb, summoned time chip, contextual
   inspector, toasts. Immediate-mode, integer-scaled.
4. **DOM island** (§A.5) — the *only* DOM: text input, accessibility. Styled to
   vanish.

### A.2 Immediate-mode GUI core

Retained DOM-mimicking widget trees are heavy and stateful. Use **immediate
mode** (Dear ImGui style): rebuild the widget list each frame from game state.
Far simpler for a game, no sync bugs between UI state and world state.

- `ui-batcher.ts` — a quad/sprite batcher feeding the WebGPU renderer: textured
  quads, 9-slice panels, text runs, all in one instanced draw where possible.
- `ui-context.ts` — per-frame immediate-mode context: `panel()`, `button()`,
  `label()`, `radial()`, `orb()`, hit-testing, hot/active tracking, layout.
- `ui-palette.ts` — UI design tokens in TS (canvas has no `tokens.css`); derived
  from the **world palette** so chrome and world share colour. Replaces the
  scoped `src/ui/tokens.css` for the canvas layer.

### A.3 Text rendering

Pixel art wants crisp glyphs. Two atlases, two jobs:

- **Bitmap pixel font**, integer-scaled, for HUD/chips/inspector — true
  pixel-art crispness, no blur. Primary.
- **SDF font atlas** for **world-anchored labels** that must scale smoothly with
  zoom (settlement names rushing toward you on zoom-in). SDF stays sharp at any
  scale.

Open question (§9): exact typeface(s) — a hand-pixelled face vs a licensed
pixel font. Wants a deliberate pick to hit "mature, competent."

### A.4 Minimal HUD — radical reduction

User directive: **reduce visible stats (power, etc.) to the absolute minimum**;
resurface later as gameplay needs prove out. Proposal:

| Element | Treatment |
|---|---|
| **Divine power** | A **presence orb** (corner), diegetic — fills/dims with power, pulses when you can afford an action. **No number** by default; exact value on hover/long-press. (We learn how much players actually need a number.) |
| **Time** | Keep the **summoned** time chip; full transport only when summoned (port the existing `time-chip`/`time-bar` UX, re-skin for canvas). |
| **Selection / focus** | A **contextual inspector** that appears only when you focus an entity — belief/needs/relationships shown *then*, nowhere else. |
| **Divine actions** | A **radial** that blooms at the focused target (whisper/omen/dream/miracle/answer-prayer), gated/greyed by power. |
| **Everything else** | Gone from the persistent HUD. Summoned or contextual only. |

Net persistent chrome at rest: **one orb + one small time chip.** The rest of the
screen is world.

### A.5 The DOM island (deliberately small, not zero)

Zero-DOM is a tar pit for the last 5%: mobile **IME** (autocorrect/CJK/emoji on
iOS/Android) effectively requires a real `<input>`, and the DOM gives
**accessibility** for free. So keep a tiny, styled-to-vanish DOM layer for:

- Text input — LLM API keys, NPC/world names, the planned conversation UI.
- Accessibility / focus semantics.

These are **not** in the per-frame hot path, so they cost ~nothing in perf and
save enormous effort. Everything *game* is canvas; this island is a service.

### A.6 Input layer — touch + pointer parity (from day one)

One unified pipeline on the canvas (no `mousedown`; `PointerEvent` only +
`touch-action: none`):

- **Router**: hit-test the immediate-mode UI first (UI claims the event), else
  route to world interaction. Reuse the GPU `pickTile`/`hitTest` (already fixed
  for GPU).
- **Gestures**: tap → select; long-press → radial/context; drag → pan or
  box-select; **pinch → zoom toward centroid**; two-finger drag → pan; wheel →
  magnitude-scaled zoom (the recent Mac-trackpad fix already lives here).
- **Feel** (the actual source of "snappy"): sample input every rAF and apply to
  the camera **immediately**, decoupled from sim tick; **inertia** on pan, eased
  zoom toward cursor/pinch centroid, pixel-snapped origin. Snappiness is a
  render-loop property, not a DOM-vs-canvas one.
- **Parity rule**: no hover-only affordances; every interaction has a touch path;
  hit targets sized for fingers.

### A.7 Full-world zoom performance

The "very snappy full-world zoom" goal is a render concern:

- Terrain is already buffer-driven heightfield (cheap to scale).
- **Entity LOD / mipmaps**: zoomed-out must not draw every sprite at full res —
  cull, mip, and batch. Define LOD tiers (full sprite → simplified → dot/heat).
- One instanced UI draw; world-anchored labels fade/cluster at distance.

---

## Part B — MCP integration (WebSocket bridge)

### B.1 Topology (chosen: WebSocket bridge)

```
Claude / MCP client ──stdio or http── MCP server (Node, server/)
                                          │  ws://localhost:PORT  (token handshake)
                                          ▼
                              Browser game (WebGPU, live)  ── WS client on boot
```

- A Node MCP server (lives in `server/` or `src/mcp/`; run via `tsx`; registered
  in `.mcp.json` alongside the existing Playwright entry).
- It also runs a **local WebSocket server**. The browser game connects as a WS
  client on boot (configurable URL, retry/reconnect, tolerates "no server").
- MCP tools translate to WS messages; the game executes them against the **live
  command/query bus** and returns results. If no game tab is connected, tools
  return a clear "no game connected" error.

### B.2 Wire protocol

JSON messages, request/response correlation + a push channel:

```
{ id, type: 'req'|'res'|'event', method, params?, result?, error? }
```

- **req/res**: Claude → game commands and queries (correlated by `id`).
- **event**: game → Claude push channel — notable belief/mood crossings, deaths,
  settlement events, prayers. This is what lets Claude *be Fate*: it subscribes
  to the world's pulse and reacts. (Feeds from the existing event ring buffer /
  `belief_cross`/`believer_lost` signals.)
- **Backpressure / determinism**: queries read the current snapshot; commands
  **enqueue onto the dispatcher and apply at the next tick boundary**, then
  return the resulting deltas — so external authorship stays seeded + ordered.

### B.3 Tool surface (all four hats, mapped onto the bus)

Read tools hit the **Query facade**; the rest emit **Commands** (recorded to
`EventLog`).

- **Observe (query)** — `get_world_summary`, `query_npcs(filter)`, `get_npc(id)`,
  `get_belief_state`, `get_settlement(id)`, `get_events(since)`, `get_timeline`,
  **`get_screenshot`** (canvas `toDataURL` → image; the single highest-leverage
  tool for every hat — Claude can *see*). Builds on the existing `__debug`
  surface (`inventory/query/focusKind/grab`).
- **Divine co-pilot (command)** — `whisper`, `omen`, `dream`, `miracle`,
  `answer_prayer` — the **same dispatcher the human uses**
  (`divine-actions-controller`), power-gated identically.
- **Fate / DM (command)** — `author_event` (inject settlement event),
  `set_pacing`, `coach_rival`, `narrate` (push narrative that surfaces in-game),
  `nudge_need`.
- **Dev / debug (command, dev-mode-gated)** — `spawn`, `kill`, `set_time` /
  `skip`, `set_rate`, `snapshot`/`restore`, `force_event`, `set_camera`/`focus`.
- **World / era authoring (command)** — `generate_world(seed|recipe)`,
  `author_settlement`, `author_lineage`, **`author_era`** (the deferred D2
  time-skip era-authoring half — finally gets its author).

### B.4 Determinism, safety, sharing

- **Replay-honesty**: every MCP-driven mutation is recorded as an authored event,
  exactly like a player action, so snapshot/replay reconstructs Claude's hand.
  This *is* the "sim is truth; the LLM animates it, never contradicts its
  numbers" rule, enforced structurally.
- **Auth**: localhost-only WS + a token handshake (the game and server share a
  token via the dev server). Dev/debug tools gated behind dev-mode.
- **Sharing**: human + Claude co-inhabit one world (free-for-all by default — see
  §9 for whether turn-taking/locking is ever needed). Commands serialise through
  the one bus, so there is no race on world state — order is the tick queue.

---

## Part D — Generated UI skin (deep-research-grounded, 2026-06-15)

The UI chrome (frames, 9-slice panels, buttons, icons, ornament, backgrounds) is
**painted by the image-gen pipeline**, not hand-drawn — re-skinnable by era
(early-medieval first) off the existing era/descriptor variant axis. Claude +
the immediate-mode engine own *structure* (layout, hit-test, text, state); the
model owns only the cosmetic *skin*. A deep-research pass (`wf_19624f8e-9b7`,
2026-06-15: 18 sources, 73 claims, 23/25 verified) sets the technique stack and
exposes one strategic fork.

### D.1 The first principle this confirms: never trust raw diffusion output

Verified, mechanistic: latent-diffusion VAEs compress to ~⅛ resolution and
discard high-frequency spatial info, so raw output has **varying pixel sizes,
off-grid "pixels", palette drift, distorted text, and unreliable alpha** — the
same root cause as wrong finger counts. The fix is deterministic post-processing,
which the project's pipeline already half-does. So **four properties are enforced
in code, never trusted from the model**: pixel grid, palette, alpha, and text.

### D.2 Technique stack (what's verified to work)

| Concern | Verified approach | Maps to / needs |
|---|---|---|
| **Pixel fidelity** | Snap-to-grid + **seeded k-means palette quantize** (`k_seed`, e.g. 42 → byte-deterministic). Refs: Scenario Pixel Snapper, Sprite Fusion/ComfyUI ports, Retro Diffusion, SD-πXL (SIGGRAPH Asia '24). | Extend the **existing palette-quantize stage** to a fixed seed → reproducible across builds, feeds `ART_RECIPE_VERSION` cache-busting. |
| **Keyable alpha** | Native-RGBA generation via **LayerDiffuse** (latent transparency, single pass; beats matting on soft edges/glows, >97% preference). | **Self-hosted only** (UNet/latent access). For hard-edged frames the current **chroma-key + quality-gate** path suffices; soft-edged glow/ornament may force the self-hosted lane (§D.3). |
| **9-slice panels** | Generate **seamlessly tileable** center/edge regions — **Tiled Diffusion** (CVPR '25, names game assets as a target) — then quantize, then assemble the 9-slice **in-engine**. | Engine owns the stretch/layout; model supplies corner/edge/center skins. *Open: does quantize re-introduce seams? → maybe a seam-aware quantize pass.* |
| **Set coherence** | **IP-Adapter** (decoupled cross-attn, scale ~0.5 balanced) + **InstantStyle** (style-only blocks, separates colour/texture from layout). | **Self-hosted only.** Closed-API fallback: one **style-anchor reference** via FLUX.2 multi-reference img2img + **single-seed/single-batch** + a **locked shared palette** at quantize. |
| **Interactive states** | Derive normal/hover/pressed/disabled/focused from **ONE base** via programmatic tint/glow/desaturate **in the WebGPU layer** — zero silhouette drift. *(medium confidence — inferred from the drift failure modes.)* | Generate one base per element; never generate states independently. |
| **Era restyling** | Hold base **geometry/silhouette fixed**; patch **style only** — era token + style-anchor reference + palette swap + re-quantize to the era palette. | Exactly the **era/descriptor patch axis** already in the variant DB. |
| **Hybrid text** | **Never** generate dynamic text (FLUX.2 ~60% accuracy even improved; card warns of distortion). Generated frame + **engine font-atlas text** on a solid backing plate within a contrast budget. | Confirms the bitmap+MSDF font-atlas decision; defines where gen art must **not** go. |

### D.3 The strategic fork: closed-API lane vs self-hosted diffusers lane

The three strongest coherence/alpha techniques — **LayerDiffuse, IP-Adapter,
InstantStyle** — need attention-block / latent access, i.e. a **self-hosted
SD/SDXL/FLUX-Dev UNet** workflow. They are **NOT** available on the project's
current closed API models (FLUX.2 Klein via OpenRouter, gemini-2.5-flash-image).

- **Lane A — closed-API (recommended start).** Stay on the existing pipeline:
  FLUX.2 Klein 4B multi-reference img2img + single-seed batches + chroma-key +
  quality-gate + deterministic palette-quantize. Good for **hard-edged frames,
  buttons, icons** — exactly what the pipeline already does well. Lowest new
  infra. Approximates set-coherence via the style-anchor + locked palette.
- **Lane B — self-hosted diffusers (defer until needed).** Stand up an SDXL/
  FLUX-Dev lane to unlock LayerDiffuse (true soft-edged alpha) + IP-Adapter/
  InstantStyle (tightest kit coherence). Only worth it **if Lane A hits a wall**
  on soft-edged glow/ornament alpha or kit coherence — decide empirically (D.5).

**Model pick:** FLUX.2 Klein 4B (Apache-2.0, ~13 GB VRAM, sub-second distilled,
unified t2i + multi-reference) stays the verified default — but its own card
makes **no alpha and no pixel-grid guarantees** (consistent with the in-house
gemini-3 opaque-checkerboard finding), so both are gated empirically, never
assumed. *Caveat: model rankings move fast; the architecture (post-process the
fidelity, keep text in-engine, derive states programmatically) is the durable
part, the specific model is not.*

### D.4 Production workflow (research + existing pipeline agree)

UI skins are **author-time seeded only — never on the boot hot path** (a missing
button has no graceful degrade, unlike a building). Seed offline →
validate-before-persist quality-gate → deterministic seeded quantize → **vendor
into the repo** → content-version stamp. The immediate-mode engine renders
**gray-box placeholder rects** with no skin (S1) so the game is fully playable
unskinned; skins drop into skin slots later (S3.5). This separation keeps dev
iteration instant (layout/logic in code) while the stable skin is baked rarely.

### D.5 New open questions (carry into the S3.5 spec)

1. Does **gemini-2.5-flash-image or FLUX.2 Klein via OpenRouter** yield usable
   keyable alpha for UI ornament in practice, or does the gemini-3
   opaque-checkerboard mode recur — i.e. is **Lane B actually required** for
   soft-edged alpha, or is chroma-key enough for hard-edged frames? *(Decides the
   fork. Answer empirically with a spike before committing.)*
2. Measured **per-asset cost + latency** to seed a full early-medieval UI kit
   through the pipeline — within the funded-reseed budget?
3. Can the **palette-quantize stage be made byte-deterministic** (fixed `k_seed`)
   so skins reproduce identically and feed `ART_RECIPE_VERSION` cleanly?
4. For 9-slice tiles, does feeding a **tileable region through chroma-key +
   quantize preserve seam continuity**, or does quantization re-introduce seams
   needing a **seam-aware quantize** pass?

---

## Part C — Sequencing (slices, each its own spec → plan → build)

| Slice | Scope | Why here |
|---|---|---|
| **S0 — Command/Query bus** | Extract typed `GameCommand` + `GameQuery` facade over the existing controllers (`divine-actions-controller`, `timeline`, `world`, `__debug`); record commands to `EventLog`. Pure refactor, no behaviour change, Node-testable by replay. | The spine. Unblocks both UI and MCP. De-risks everything. |
| **S1 — WebGPU UI foundation** | `ui-batcher` + bitmap-font atlas + programmatic 9-slice + immediate-mode `ui-context` + `ui-palette`. Renders with **gray-box placeholder skins** (solid rects) — fully playable unskinned. | The canvas you draw all UI on; decouples "does UI work" from "is UI pretty". |
| **S2 — Input layer** | Unified `PointerEvent`/keyboard/gesture router; UI-then-world hit-test; camera inertia + eased pinch/wheel zoom toward centroid. Touch+pointer parity. | Makes it feel snappy; parity is cheap now, a rewrite later. |
| **S3 — Minimal HUD + inspector** | Presence orb, summoned time chip (port), contextual focus inspector, divine-action radial. Begin retiring the old DOM chrome. | First playable new UX; proves the minimal-stat thesis. |
| **S3.5 — Generated UI skin (early-medieval)** | Claude authors the **asset manifest** (each element → pixel size, 9-slice regions, states, text zones, style anchor) + prompts; pipeline seeds author-time → gate → deterministic quantize → vendor; skins drop into S1's skin slots. **Spike first** (D.5 Q1) to settle the Lane A/B fork. | Skins the gray-box; proves the gen-UI + era-restyle thesis. See **Part D**. |
| **S4 — MCP skeleton + WS bridge** | Node MCP server + WS server, browser WS client + handshake, command/query relay, `get_world_summary` + `get_screenshot` + one divine action end-to-end. | Smallest vertical slice of Claude-in-the-world. |
| **S5 — Full MCP tool surface** | All four tool families onto the bus; commands recorded as authored events; the `event` push channel for Fate. | Claude wears all four hats. |
| **S6 — DOM island** | The thin retained DOM layer: text input (keys/names/conversation) + a11y, styled to vanish. Migrate LLM/settings config here off the old chrome. | Closes the IME/a11y gap without chasing zero-DOM. |
| **S7 — Polish & optimisation** | Entity LOD/mipmaps for full-world zoom, batched UI draws, profiling, delete remaining legacy DOM UI (and the iframe `embed/` postMessage path). | Hits the performance north star; removes the dead embedding code. |

Studio/dev tooling is large and somewhat separate — §9 flags how much to port vs
leave on DOM for now.

---

## What we reuse (seams that already exist)

- **GPU renderer** — `gpu-scene`, `gpu-render-frame`, `terrain-field`; GPU
  `pickTile`/`hitTest` (already fixed). UI draws in the same pass.
- **`__debug` API** (`src/dev/debug-api.ts`: `inventory/query/focusKind/grab`) —
  the seed of the Query facade + `get_screenshot`.
- **Divine action dispatcher** (`divine-actions-controller`,
  `overlay-dispatcher`) — the command back-end the human already uses.
- **`EventLog`** (`src/core/events.ts`) — command recording for replay-honesty.
- **Summoned time bar** (`src/ui/panels/time-*`) — the UX template *and* the
  first port to canvas.
- **`.mcp.json`** — already registers Playwright; pattern for the new server.
- **`src/embed/api.ts`** — the postMessage host API; now **legacy**, removed in
  S7.

---

## Resolved decisions (2026-06-15)

All seven open questions resolved with the user. These are now constraints for
the spec, not options.

1. **Fonts — one family, two atlases.** A single high-legibility licensed pixel
   typeface drives both: a **crisp bitmap blit** for integer-scaled HUD/chips
   /inspector, and an **MSDF atlas generated from the same TTF** for
   world-anchored labels that scale with zoom (MSDF preserves the font's sharp
   corners at any scale). Recommended primary: **Pixel Operator** (OFL,
   proportional, has bold, extremely legible); alt for a more terminal/tech-mature
   register: **Departure Mono** (OFL). Swappable later — it's just an atlas, no
   code change. *Rationale: HUD and world labels share one identity; bitmap stays
   pixel-crisp, MSDF stays sharp under zoom.*
2. **MCP packaging — `mcp/` dir, stdio to Claude, embedded WS server.** New
   top-level `mcp/`, run via `tsx`. Transport to Claude Code = **stdio**,
   registered in `.mcp.json` as a `command` (Claude Code spawns it on session
   start — same pattern as the existing Playwright entry). That one process also
   runs the **WebSocket server** the browser connects to (port from env, default
   e.g. `7777`). Vite does **not** own it (separation: Vite serves the browser
   app). Standalone `npm run mcp` for non-Claude-Code MCP clients. Shares a thin
   protocol module + `src/core/types`. *Rationale: stdio is the standard, lowest-
   friction MCP transport and lets Claude Code manage lifecycle; the WS server
   rides along in the same process.*
3. **Power — diegetic orb, no resident number.** The presence orb encodes power
   by fill + pulse (pulse = "you can afford the hovered/selected action").
   **Hold/hover reveals** exact value + regen rate as a transient readout; it is
   never permanently on screen. Validated in S3. *Rationale: matches the
   stat-minimalism directive while keeping the number one gesture away.*
4. **Human ↔ Claude — free-for-all + visible attribution, no locks.** Commands
   serialise through the one bus (order = tick queue), so there is no data race;
   locks/turn-taking would be premature. Every command carries
   `author: 'player' | 'fate' | 'claude'`, surfaced in the event log **and** as a
   transient in-world marker ("Fate stirs…" + the affected entity flashes) so the
   human is never confused by a spontaneous change. *Rationale: serialisation
   already removes the race; the real risk is *legibility*, solved by attribution,
   not concurrency control.*
5. **Legacy UI — Studio + dev panels stay on the DOM island; not ported.** Canvas
   UI is **game-facing only**. Studio and heavy dev panels are tools (yours, not
   players'); porting them is low-value churn. Moreover the **MCP dev/debug tool
   surface (S5) absorbs most dev-panel need** (Claude spawns/inspects/time-travels
   /screenshots via tools), so those panels can be retired *by replacement* over
   time rather than rewritten. *Rationale: spend the canvas budget on player UX;
   let MCP tools eat the dev panels.*
6. **WS auth — 127.0.0.1 bind + auto-generated shared token, no pairing.** MCP
   server generates a token at boot; the dev server hands it to the browser (file
   or a `/mcp-token` dev endpoint); the browser sends it in the WS handshake.
   Origin-checked. **No interactive pairing** for localhost (friction, no benefit).
   Revisit only if we ever expose beyond localhost. *Rationale: localhost + shared
   secret is sufficient for a same-machine dev/play setup.*
7. **Mobile WebGPU — explicit minimum targets, hard gate otherwise.** Test
   targets: desktop Chrome/Edge/Firefox + Safari 18+; **mobile iOS Safari 18+**
   (WebGPU shipped 2024) and **Chrome Android 121+**. S2 gestures are tested on
   those mobile targets specifically. Devices without WebGPU get a clear "WebGPU
   required" screen — no fallback. *Rationale: per the WebGPU-hard-requirement
   directive; we name the real devices so touch parity is tested where it ships.*

---

## Non-goals (for now)

- Canvas2D/WebGL UI fallback. WebGPU is required.
- Re-implementing IME/text-shaping on canvas (the DOM island owns text).
- Iframe embedding / postMessage host API (replaced by MCP; removed in S7).
- Resurfacing the full stat panel — minimalism first, add back only what play proves.
