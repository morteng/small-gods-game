# Handoff — Small Gods · Unified UI System

> Design reference for the chrome that wraps the iso 2D world.
> Built as an HTML prototype; **recreate it in `src/ui/`** alongside the
> existing canvas renderer.

---

## 1. About this bundle

The files under `preview/` are a **design reference**, not production code.
They are React+Babel running in a single HTML file so the look and behavior
can be inspected pan/zoom on a design canvas.

**Your job** is to recreate these designs in the `small-gods-game` codebase
using its existing environment:

- TypeScript ES modules, bundled by Vite
- Canvas 2D renderer for the world (untouched by this handoff)
- DOM overlays for UI, scoped to the `Game`'s container element
- No external dependencies — match the current "vanilla TS" style; CSS in a
  single stylesheet, components as TS modules that mount/unmount DOM
- CSP-compatible (no inline event handlers, no dynamic code)
- The game embeds in an iframe via the `embed/` API — UI must scope to the
  container, never `document.body`

The preview uses React only because it's fast for prototyping. **Do not
introduce React** to the game codebase. Translate the components into plain
TS modules that manage their own DOM — same pattern as the existing
`overlay-dispatcher`, `asset-manager`, etc.

## 2. Fidelity

**High fidelity.** Exact colors, spacing, typography, and behavior are
specified below and in `preview/tokens.css`. The visual treatment is final
unless playtesting suggests otherwise.

## 3. Design philosophy (read first)

Four principles drive every decision:

1. **Calm by default.** Three small chips at the corners. Power, time, recent
   events. Everything else is summoned by the player when they want it.
2. **Same palette as the graphics.** All UI colors derive from the iso 2D
   world's tile colors — grass, water, earth, sand, sun, dusk, clay. The
   chrome and the world agree without the chrome mimicking pixel art.
3. **The world is the canvas.** No fixed sidebars. Panels float over the
   world only while the player is using them. Click outside → gone.
4. **Plainspoken voice.** "Try a different way" instead of "Re-roll &
   commit." The dramatic phrasing belongs in the simulation, not the buttons.

## 4. Where this lives in the codebase

```
src/
  ui/
    tokens.css                  ← NEW · all design tokens (port from preview/)
    chrome.ts                   ← NEW · mounts the three corner chips
    panels/
      spirit-panel.ts           ← NEW · power + abilities, top-left
      events-panel.ts           ← NEW · recent log, top-right
      time-bar.ts               ← NEW · bottom, summoned by T
      selection-card.ts         ← NEW · right edge, slides in
      selection-callout.ts      ← NEW · floats near selected NPC
    components/
      icons.ts                  ← NEW · SVG glyph set
      meter.ts, badge.ts, sigil.ts, chip.ts, button.ts
    overlay-dispatcher.ts       ← EXISTING · still owns action registration
    controls.ts                 ← EXISTING · still owns mouse/keyboard
  game.ts                       ← imports chrome.ts; mounts on construction
```

Suggested order to land it:

1. **Tokens + primitives** (button, chip, badge, meter, sigil, icons).
   Land `tokens.css` first; the rest of the codebase ignores it until
   consumers arrive.
2. **The three corner chips** (`SpiritChip`, `EventChip`, `TimeChip`).
   Read state, no actions yet.
3. **Spirit panel** when the chip is clicked.
4. **Events panel** when the chip is clicked.
5. **Selection callout** when an NPC is clicked (replaces today's NPC
   overlay). Selection card when "More" is clicked on the callout.
6. **Time bar** (Spec B). The most complex piece — wire it into the
   `TimelineController` that lands as part of Spec B.

## 5. Layout — the screen

The game viewport is variable; the design is anchored at 1920×1080 but is
fully fluid. The layout is **absolute positioning over the world canvas**,
not a grid that shrinks the world.

```
┌──────────────────────────────────────────────────────────────┐
│  [Spirit chip]                          [Events] [Time]      │  ← 18px from edges
│                                                              │
│                                                              │
│            ( iso 2D world fills the viewport )               │
│                                                              │
│                                                              │
│                                                              │
│  [T] time   [L] log   [Space] pause             [— optional] │  ← 18px from edges
└──────────────────────────────────────────────────────────────┘
```

**Anchors (all `position: absolute`):**

| Element            | Anchor                                | Notes                        |
|--------------------|---------------------------------------|------------------------------|
| Spirit chip        | `top: 18px; left: 18px`                | Spirit panel drops below it  |
| Events chip        | `top: 18px; right: 18px` (paired w/ Time chip in same row) | Panel drops below |
| Time chip          | `top: 18px; right: 18px` (right of Events chip with 8px gap) | Bar appears bottom |
| Selection callout  | Anchored to NPC's screen position; offset 30px right, 64px up | Leader-line points back to NPC |
| Selection card     | `top: 110px; right: 18px`              | Slides in from right edge    |
| Time bar           | `left: 18px; right: 18px; bottom: 18px` | Slides up from bottom        |
| Help hint pill     | `left: 18px; bottom: 18px`             | Hidden when time bar is open |

Panels disappear when the player clicks outside them or presses `Esc`.

## 6. Design tokens

All values live in `preview/tokens.css`. Port verbatim to `src/ui/tokens.css`.

### 6.1 Color — world-derived palette

```
--w-sky      oklch(0.94 0.012 230)   horizon backdrop
--w-grass    oklch(0.62 0.10  140)   field tiles
--w-leaf     oklch(0.50 0.10  150)   tree tops
--w-water    oklch(0.55 0.09  225)   river / coast
--w-sand     oklch(0.80 0.05  80)    roads, beaches
--w-earth    oklch(0.46 0.06  50)    timber walls
--w-stone    oklch(0.68 0.012 60)    stonework
--w-sun      oklch(0.78 0.13  85)    harvest gold
--w-dusk     oklch(0.65 0.14  45)    late afternoon (player accent)
--w-clay     oklch(0.52 0.16  30)    terracotta (danger)
```

These are the **source of truth**. All UI accents are aliases on top:
- `--you` (player primary action) = `--w-dusk`
- `--time` (replay, lore) = `--w-water`
- `--faith` (belief thresholds, miracle) = `--w-sun`
- `--life` (growing, good) = `--w-grass`
- `--danger` (rivals, loss) = `--w-clay`

### 6.2 Surfaces

| Token       | Value                   | Use                             |
|-------------|-------------------------|---------------------------------|
| `--bg`      | `oklch(0.965 0.010 80)` | Page / behind everything        |
| `--paper`   | `oklch(0.985 0.008 80)` | Card surface                    |
| `--paper-2` | `oklch(0.945 0.012 80)` | Alt / hover                     |
| `--shade`   | `oklch(0.97 0.008 80 / 0.85)` | Translucent (chips)       |
| `--line`    | `oklch(0.88 0.012 70)`  | Hairline border                 |
| `--line-2`  | `oklch(0.80 0.014 70)`  | Stronger border                 |

### 6.3 Ink (text)

| Token     | Value                  | Use                |
|-----------|------------------------|--------------------|
| `--ink`   | `oklch(0.26 0.020 50)` | Primary            |
| `--ink-2` | `oklch(0.42 0.018 55)` | Secondary          |
| `--ink-3` | `oklch(0.58 0.014 60)` | Muted              |
| `--ink-4` | `oklch(0.72 0.012 65)` | Whisper / disabled |

### 6.4 Geometry, spacing, type

| Group   | Tokens                                                   |
|---------|----------------------------------------------------------|
| Radius  | `--r-1: 4` · `--r-2: 6` · `--r-3: 8` · `--r-4: 12` · `--r-pill: 999` |
| Space   | `--s-1: 4` · `--s-2: 8` · `--s-3: 12` · `--s-4: 16` · `--s-5: 24` · `--s-6: 32` |
| Font    | `--f-sans: 'Manrope', system-ui, ...` · `--f-mono: 'IBM Plex Mono', ...` |
| Scale   | `--t-micro: 10` · `--t-tiny: 11` · `--t-small: 12` · `--t-base: 13` · `--t-md: 14` · `--t-lg: 16` · `--t-xl: 20` |

### 6.5 Elevation

Soft warm shadows, no harsh blacks:

```css
--lift-1: 0 1px 0 oklch(0.20 0.02 60 / 0.04),
          0 1px 2px oklch(0.20 0.02 60 / 0.06);
--lift-2: 0 2px 4px oklch(0.20 0.02 60 / 0.06),
          0 8px 24px oklch(0.20 0.02 60 / 0.08);
```

## 7. Primitives (port to `src/ui/components/`)

### 7.1 Button

```ts
type BtnVariant = "default" | "primary" | "time" | "danger" | "ghost";
type BtnSize    = "default" | "big" | "icon";
```

Padding `6px 12px`; primary uses `--you` as background. See `.sg-btn*` rules
in `tokens.css` for exact treatment. Active state: `aria-pressed="true"`
maps to `--you-soft` background. Keycap hints render as `.sg-key` children
on the right.

### 7.2 Chip

A pill-shaped clickable surface that anchors to a screen corner.
`backdrop-filter: blur(8px)` over the world, `1px` hairline border, soft
shadow. Standard contents: a glyph or sigil, a label, a small data badge.

### 7.3 Sigil

A 26px (default), 36px (lg), or 48px (xl) framed glyph — the spirit's
mark. Variants: default (you · dusk), `--time`, `--danger`. Used to identify
the player spirit and rivals.

### 7.4 Meter

Thin (4px) progress bar with optional threshold pips at fractions. Color
variants: default (`--you`), `--faith`, `--time`, `--life`, `--danger`.
Pips are 1px verticals through the bar.

### 7.5 Badge

Small pill labels: default (neutral), `--you`, `--time`, `--life`,
`--faith`, `--danger`. Used in selection cards and the Book.

### 7.6 Icons

A small set, 16×16 viewBox, 1.4 stroke, all `currentColor`. The full set is
in `preview/components/primitives.jsx` under `const G = { ... }`. **Port as
TS-returned SVG strings or factory functions.** Names: `whisper`, `miracle`,
`beliefRise`, `beliefFall`, `birth`, `death`, `realize`, `rival`, `mood`,
`pause`, `play`, `rewindEnd`, `forwardEnd`, `clock`, `book`, `branch`,
`reroll`, `chat`, `eye`, `pin`, `chevDown`, `chevUp`, `close`, `settings`.

## 8. Screens

For each, the **anchor**, **trigger**, **layout**, and **content** are
specified. Reference `preview/Small Gods UI System.html` for visual truth.

### 8.1 Spirit chip (resting)

- Anchor: top-left.
- Always visible.
- Content: `[sigil "ƒ"] [power "67"] | [4 believers] [chevron]`.
- Click: toggles the Spirit panel below it.

### 8.2 Spirit panel (expanded)

- Anchor: directly below the chip (8px gap).
- Width: 280px.
- Sections, in order:
  1. **Identity row.** Sigil (lg, 36px), `Spirit, unnamed` (15px/600),
     `Stirring · regen +0.04/s` (11px ink-3).
  2. **Power meter.** Label `power` left, value `67 / 100` right (mono, you
     color). Meter with pips at 0.30, 0.55, 0.85.
  3. **Three stat tiles.** Believers · stories · realm. Each: paper-2 bg,
     mono value 14px, 10px ink-3 label.
  4. **Hairline.**
  5. **Abilities list** (ghost buttons):
     - Whisper (W, 0–1)
     - Make rain (R, 15)
     - Bless (B, 5–10)
     - Heal (H, 10)
     - Manifest (locked · "needs Rising") — at 0.55 opacity, no hotkey
- Tile values for the demo (override at runtime):
  ```ts
  { power: 0.67, regen: 0.04, believers: 4, stories: 1, realm: 142 }
  ```
- Dismiss: click outside, press `Esc`, or click chip again.

### 8.3 Events chip (resting)

- Anchor: top-right (left of the Time chip, 8px gap).
- Content: `[book icon] recent [+N]` where N is new since last open.
- Badge color: `--you`. White text, 700 weight, mono.
- Click: toggles the Events panel.
- Hotkey: `L`.

### 8.4 Events panel (expanded)

- Anchor: directly below the chips row.
- Width: 340px. Max height: 340px scrollable.
- Header row: `recent · 142 in the log` + a Book icon + a close icon.
- Each row:
  ```
  [t 1838]  [glyph]  Mira's faith passes 0.30.
  ```
  - Tick (10px mono, ink-4, right-aligned in 44px column)
  - Event glyph (16px, color by type)
  - Prose (12.5px ink) — italic for "the world's voice", plain for system
- Chapter-marked events get a 2px `--time` rail on the left edge.
- Click a row → scrub the time bar to that tick.
- Hover bg: `--paper-2`.

### 8.5 Selection callout (NPC clicked)

- Anchor: floats near the NPC; leader-line and dashed ring point back to
  the NPC's tile.
- Width: ~200px min.
- Content: `[sigil] [Mira | faith 0.34 · farmer · 34] [Whisper W] [▼]`
- Click the chevron → expands to the full Selection Card.
- Hold-click on the NPC → opens the card directly.

### 8.6 Selection card (NPC opened)

- Anchor: top: 110px; right: 18px.
- Width: 320px.
- Sections:
  1. **Identity.** Portrait slot (52px rounded sq, drag-drop), name (16/600),
     `believer` badge, role/age/location (11/ink-3), close button.
  2. **Belief in you.** Faith meter with pips at 0.3/0.6/0.9, value, kind
     badge (`habit`). One-line italic flavor below.
  3. **State.** Five tight rows (mood / safety / prosperity / community /
     meaning). Each: 70px label, meter, 28px value. Highlight rows use
     `--faith` color (e.g., `meaning` in the demo).
  4. **Personality.** Small badges: `pious` `storyteller` `curious`
     `skeptical ↓`.
  5. **4 moments touched her.** Vertical list of recent events involving
     this NPC. Same row format as the events panel but tighter.
  6. **Actions.** Two-up grid: `Whisper (W)` primary, `Bless` default.
     Below: `Her stories` ghost button full-width.
- Demo data:
  ```ts
  {
    name: "Mira", role: "farmer", age: 34, location: "the cradle field",
    faith: 0.34, kind: "habit",
    mood: 0.61, needs: { safety: 0.72, prosperity: 0.40, community: 0.55, meaning: 0.38 },
    personality: { pious: 0.72, storyteller: 0.40, curious: 0.55, skeptical: 0.18 },
    moments: [
      { t: 1840, type: "whisper", text: "you whispered" },
      { t: 1788, type: "beliefRise", text: "faith past 0.30" },
      { t: 1620, type: "miracle", text: "rain in the drought" },
      { t: 1612, type: "realize", text: "this field came to be" },
    ]
  }
  ```

### 8.7 Time chip (resting)

- Anchor: top-right (right of the Events chip).
- Content: `[clock icon] Y1 spring · 30/96  [1×]` (or `[paused]` badge).
- Paused state: pause icon, `--time` color on icon and badge.
- Click: toggles the Time bar.
- Hotkey: `T` to toggle, `Space` to pause.

### 8.8 Time bar (summoned — Spec B)

This is the in-flight feature. Specification follows
`docs/superpowers/specs/2026-05-17-spec-b-time-design.md`.

**Anchor:** `left: 18px; right: 18px; bottom: 18px`. Slides up.

**Layout** (single row when live):

```
[◄◄] [▮▮] [►►] ┃ ━━━━━━━●━━━━━━━━━━━━━━━━━━━━━ ┃ 1840 / 1840 ┃ 1× 2× 4× 8× ┃ ×
              transport          scrub track             label         speed   dismiss
```

**Layout** (two rows when scrubbed — commit row prepended):

```
─────────────────────────────────────────────────────────────────
 ● You're looking back to tick 1180.  Change what happens next?
                          [↻ Back to now] [Continue] [Try a different way ↻]
─────────────────────────────────────────────────────────────────
[◄◄] [▮▮] [►►] ┃ ━━━●╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌ ┃ 1180 / 1840 ┃ 1× 2× 4× 8× ┃ ×
```

**Specifics:**

- Transport: rewind-to-start, pause/play, jump-to-now (all ghost icon buttons).
- Track: 32px tall; 2px line; live-tail portion solid `--time`; scrubbed
  future portion 8px dashed `--line-2`.
- Event glyphs: 18×18 rounded squares on the track, color by type:
  - `whisper` → `--you`
  - `miracle` → `--w-sun`
  - `rival` → `--danger`
  - `beliefRise` → `--w-sun`
  - `realize` → `--time`
  - `mood` → `--ink-3`
  - Chapter markers get a 4×4 `--time` dot above the glyph.
  - Events past the scrub head are dimmed (ink-4 border, 0.55 opacity).
- Scrub head: 2px vertical line + 10px circular handle with white border.
  Color: `--you` when live, `--time` when scrubbed.
- Hover tooltip: `tick N`, mono, follows cursor along the track.
- Tick label (right of track): `[current] / [max]` mono, current color
  matches scrub-head color. Below: `now` or `looking back`.
- Speed buttons: `1×`, `2×`, `4×`, `8×`, each active state uses
  `--you-soft` bg + `--you-line` border + `--you` color.
- Dismiss `×` button on the far right (matches `Esc` and `T` toggle).

**Commit row (only when scrubbed):**

- Background: `--time-soft`. Bottom border: `--line`.
- Left: pulsing `--time` dot + "You're looking back to tick N. Change what
  happens next?" (13px ink with ink-3 trailing clause).
- Right: three buttons:
  1. `Back to now` — ghost. `[forwardEnd] Back to now`. Returns scrub head
     to live tail without committing.
  2. `Continue` — default. Truncates the future, keeps RNG, replays
     forward.
  3. `Try a different way` — danger. `[reroll] Try a different way`.
     Truncates, swaps RNG state, replays forward.

**Wire-up (Spec B):**

```ts
import { TimelineController } from "../core/timeline";

class TimeBar {
  constructor(public timeline: TimelineController) {}

  // user drags scrub head
  onScrub(targetTick: number) { this.timeline.jumpTo(targetTick); }

  // user clicks "Continue"
  onCommit() { this.timeline.commit({ reroll: false }); }

  // user clicks "Try a different way"
  onReroll() { this.timeline.commit({ reroll: true }); }

  // user clicks "Back to now"
  onReturn() { this.timeline.returnToLive(); }

  // speed buttons
  onSetRate(rate: number) { this.scheduler.setRate(rate); }
}
```

The TimeBar should subscribe to `EventLog` for live updates of event glyphs
on the track. Use `eventLog.subscribe(e => addGlyph(e))` on mount; render
glyphs from the existing event ids/types, not from a hard-coded array.

### 8.9 Cinematic mode (Spec D · future)

Letterbox at top (56px) and bottom (88px). Chips fade to 0. World gets a
gentle `--time` tint overlay. Top: chapter title eyebrow + beat counter.
Corner framing brackets in `--you`. Bottom: prose in italic 17px ink, plus
`Hold` / `skip (S)` / `Let it play` buttons. Reuses the same TimeBar
collapsed-mode treatment in the bottom right.

### 8.10 Branches (Spec C · future)

When the player commits with re-roll, the discarded future is stashed.
A "Branches" surface exposes them as cards:

- Diagram (SVG): a current branch (solid `--you`) and discarded branches
  (dashed `--time` with `--danger` × markers at their truncated end). All
  diverge from shared "chapter" knots in `--w-dusk`.
- Three branch cards below: A · here (current, you-soft bg), B · peek, C
  · peek (discarded, paper-2 bg with a faint `--past-veil` overlay on
  their preview).

### 8.11 The Book (Spec E · future)

Two-page paper spread, 28px padding, 1px center spine. Left page: chapter
eyebrow, title (22/700), fidelity + generations + carriers badges, prose
in 14/1.65 with italic margin notes. Right page: "what actually happened"
inset (`--paper-2`), lineage (G1→G2→G3→G4 nodes with fidelity %), themes
badges.

## 9. Generated imagery (NPC portraits · area vistas · chapter scenes · god portrait)

Per `docs/AI_VISUALS_AND_AUDIO.md` and `docs/ai-asset-generation-plan.md`,
the game commissions painted images at runtime: NPC portraits per age-stage
(rd-animation), high-res isometric scenes when the player zooms in
(rd-plus, 384×384), and a god portrait that emerges from believer
narratives. Budget is finite (~50 portraits/session, ~10 map regens/hr).

The UI is designed so **generation feels intentional**: latency is visible,
absence is honest, the budget is a quiet companion not an error state.

### 9.1 The six states (every painted asset passes through these)

| State      | Treatment                                                       | When                              |
|------------|------------------------------------------------------------------|-----------------------------------|
| `empty`    | Initials over diagonal-stripe paper                              | Never requested yet               |
| `queued`   | Same placeholder + `queue · 3` corner badge                      | Awaiting capacity                 |
| `painting` | Sweep animation across the slot + `painting · 12s` corner badge  | Request in flight                 |
| `ready`    | The image, fade-in blur 280ms                                    | Generation complete               |
| `stale`    | Image dimmed (brightness 0.9, saturate 0.85) + `repaint pending` corner | Entity changed, regen queued |
| `failed`   | Initials + `↻ retry` button in corner                            | Generation failed                 |

Implementation reference: `preview/components/image-slot.jsx` (`ImageSlot`).

**Slot sizes:**

| Kind       | Pixels    | Use                                                  |
|------------|-----------|------------------------------------------------------|
| `portrait` | 96×96     | NPC face, god face. Used inside selection card and spirit dock |
| `vista`    | 320×200   | Area painting (rd-plus output rendered down)         |
| `scene`    | 480×270   | Chapter beat painting, used in the Book and event log |

### 9.2 Where painted assets appear

| Surface                | Asset                       | State the player most often sees                          |
|------------------------|-----------------------------|-----------------------------------------------------------|
| Spirit dock identity   | God portrait (52×52)        | `ready` after first chapter; `stale` during form shift    |
| Selection card header  | NPC portrait (64×64)        | `painting` for newly-met NPCs; `stale` when they age      |
| Event ticker chapter   | Scene thumb (48×32)         | `ready` once the chapter is logged; `painting` while it's being made |
| Vista panel            | Area vista (full width)     | `painting` for first 10–20s when "look closer" is invoked |
| Book chapter spread    | Scene image (420×200)       | `ready` — this is the canonical, slowly-painted version   |
| God portrait evolution | Portrait at increasing size | Demonstrates the form coalescing over generations         |

### 9.3 The Vista panel

A new surface. Anchor: `left: 18px; bottom: 60px` (sits above the time bar
if the time bar is also open; otherwise above the help hint).

Triggered by:
- **Double-clicking a tile** on the world canvas
- **Pressing `V`** with a tile or NPC selected
- **Clicking a chapter row** in the event panel (jumps to the moment + opens vista of where it happened)

Contains:
- Header: "look closer" eyebrow, place name, brief location subtitle, close button.
- The `ImageSlot` (kind `vista`) — shows the painting while it's being made.
- Three or four place-related badges (terrain counts, building count, believer count).
- A short prose paragraph in the world's voice.
- Footer: ghost actions (`Stories from here`, `Hold the view`).

Wiring:
```ts
// when triggered
const req = await imageService.requestVista({
  centerX, centerY, radius: 5,
  styleSeed: world.styleSeed,
  weatherTimePrompt: world.atmosphere(),
});
panel.setState({ imgState: 'queued', queuePos: req.queuePos });
req.onStart(() => panel.setState({ imgState: 'painting', eta: req.eta }));
req.onReady(img => panel.setState({ imgState: 'ready', src: img.url }));
req.onError(()  => panel.setState({ imgState: 'failed' }));
```

### 9.4 The Image-queue chip

A fourth corner indicator, top-right, placed left of the Events chip when
there's anything pending or in flight. Hidden completely when the queue is
empty (showQueue ? ... : null).

Shows total `painting + queued`. Click expands to a list of current
requests with thumbnails (not designed in detail yet — propose to land that
in a follow-up).

### 9.5 God portrait evolution

The god portrait in the Spirit dock is **the player's first emotional
attachment** to their spirit. It changes with belief, and that change is
itself a moment:

- When the dominant believer perception shifts (per `GodIdentity`
  `dominantForm`), mark the current portrait `stale` and queue a repaint.
- When the new portrait is ready, swap it with a 280ms blur-in fade.
- **Append an `entity_emerged` (or new `god_form_shifted`) event to the
  log** so the chapter detector and the Book can mark this beat.

UI copy: the eyebrow above the portrait reads "as Mira sees you" (or "as
the faithful see you" once there are multiple). This subtle attribution is
how the Pratchett principle reads.

### 9.6 NPC portrait life events

When a life event from `APPEARANCE_MODIFIERS` (battle scar, divine
blessing, plague survivor, etc.) fires for a known NPC:

1. Mark the cached portrait `stale`.
2. Queue a repaint with the modified prompt.
3. On ready, swap. The selection card shows a one-line italic note above
   the portrait: `the years have changed her — a new likeness is being
   painted` (during `stale`) or `marked by the divine blessing` (when
   `ready` and the cause was a blessing event).

### 9.7 Fallback hierarchy

Per `docs/AI_VISUALS_AND_AUDIO.md` §5, when generation is unavailable or
budget exceeded:

| Asset          | Fallback                                                      |
|----------------|---------------------------------------------------------------|
| NPC portrait   | Initials placeholder (state stays `empty`) — never blocks UI  |
| Area vista     | Vista panel renders a stylized iso-world-tinted stub          |
| Chapter scene  | The Book renders the page without the image, prose only       |
| God portrait   | Sigil glyph fallback (the "ƒ" / spirit name initial)          |

All surfaces must remain functional when no images can be generated.
**No surface should require a painted image to be usable.**

### 9.8 Principles (summary)

A. **Latency is part of the design** — generation is slow, the UI shows it.
B. **The placeholder is honest** — initials over stripes, not fake silhouettes.
C. **Absence is a state, not an error** — only `failed` shows a retry.
D. **The budget is a quiet companion** — chip is small, never alarming.

### 9.9 Acceptance for generated imagery

- [ ] `ImageSlot` component supports all six states + three kinds; mounted in spirit dock, selection card, vista panel, book, event ticker.
- [ ] `ImageQueueChip` appears in the corner whenever painting/queued > 0; hides otherwise.
- [ ] Vista panel opens on double-click or `V`; mounts and unmounts cleanly; image requests are cancellable on dismiss.
- [ ] God portrait evolves over time; transitions emit a log event.
- [ ] All surfaces remain usable with all images failing (fallback hierarchy honored).

---

## 10. Behavior

### 9.1 Mounting

`Chrome` is constructed by `Game` and attached to the container element.
It owns the four corner anchors and three panels. Panel mount/unmount is
animated with the `sg-fade-up` keyframe (200ms ease-out, `translateY(4px)`
+ opacity 0 → 1).

### 10.2 Keyboard

| Key       | Action                                  |
|-----------|-----------------------------------------|
| `Space`   | Toggle pause                            |
| `T`       | Toggle time bar                         |
| `L`       | Toggle events panel                     |
| `V`       | Open Vista panel (look closer)          |
| `1/2/4/8` | Set rate (when time bar is visible)     |
| `W`       | Whisper (on selected NPC)               |
| `R`       | Make rain (if power suffices)           |
| `B`       | Bless (on selected NPC)                 |
| `H`       | Heal (if power suffices)                |
| `Esc`     | Close the top-most panel; deselect      |

### 9.3 Dismissal rules

- Click anywhere outside an open panel (excluding the chip that opened it)
  closes that panel.
- A new panel can replace another (e.g., opening the events panel doesn't
  force the spirit panel closed; they coexist).
- Only one selection card at a time. Selecting another NPC replaces the
  current card.
- The time bar coexists with all other panels.

### 9.4 Scrubbed-world visual treatment

When `timeline.isScrubbed === true`, the world canvas gets a subtle blue
tint via the `.sg-past-veil` overlay (a 4% blue gradient + 1px scanline
texture). The Spirit/Event chips do **not** change. The Time chip swaps to
its paused state. This matches the iso "looking back" mood without
desaturating the world.

### 9.5 Iframe scoping

All DOM mounts go through the container the `Game` was constructed with.
Use a class prefix `sg-` everywhere to avoid host CSS bleed. The stylesheet
is injected into a `<style>` tag inside the container, **not** the host
`<head>`. The bundled font imports (`Manrope`, `IBM Plex Mono`) must be
included this way too, or replaced with a self-hosted base64 woff2 if the
sandbox blocks Google Fonts.

## 10. Voice & copy

| Voice            | Use                       | Style                                                       |
|------------------|---------------------------|-------------------------------------------------------------|
| **The world**    | NPC reactions, prose      | Italic, 13/1.55, ink. "Mira pauses while grinding grain."   |
| **The system**   | Stats, ticks, costs       | Plain, 12/1.55, ink-2. "Whisper cast. Cost 1."              |
| **The Book**     | Chapter text              | Roman, 14/1.65, ink. "And in the third winter the rain came." |

Copy that the dev will need verbatim:

| UI string                                              | Where               |
|--------------------------------------------------------|---------------------|
| `A spirit, unnamed`                                    | Spirit panel name   |
| `Stirring · regen +0.04/s`                             | Spirit panel sub    |
| `believers`, `stories`, `realm`                         | Spirit panel tiles  |
| `Make rain`                                            | Ability name        |
| `Bless`, `Heal`, `Whisper`, `Manifest`                  | Ability names       |
| `needs Rising`                                         | Locked detail       |
| `recent · 142 in the log`                              | Events panel header |
| `believer` `habit` `genuine` `fearful`                  | Belief kind badges  |
| `4 moments touched her`                                | Selection card sub  |
| `Her stories`                                          | Selection card btn  |
| `You're looking back to tick {N}. Change what happens next?` | Commit row prompt |
| `Back to now` / `Continue` / `Try a different way`     | Commit row buttons  |
| `now` / `looking back`                                 | Time bar state      |
| `T time · L log · Space pause`                         | Bottom-left hint    |

## 11. Assets

No raster assets in this handoff. All icons are inline SVG (see §7.6).
Fonts via Google Fonts (`Manrope`, `IBM Plex Mono`); plan to either:

1. Add to the iframe-scoped `<style>` block via `@import`, or
2. Vendor woff2 files under `public/fonts/` and reference locally.

The portrait slot in the Selection card is a `<image-slot>` (see
`preview/image-slot.js`) — a drag-and-drop target. In the real game,
replace with the existing portrait rendering pipeline once it lands; for
the MVP, a striped placeholder is fine.

## 12. Files in this bundle

```
README.md                        ← this file
preview/
  Small Gods UI System.html      ← entry point — open in browser
  tokens.css                     ← all design tokens (port verbatim)
  app.jsx                        ← canvas composition (reference only)
  design-canvas.jsx              ← preview infra (not for production)
  image-slot.js                  ← drag-drop image slot (web component, optional)
  components/
    primitives.jsx               ← Panel, Chip, Btn, Sigil, Meter, Badge, Eyebrow, G
    image-slot.jsx               ← ImageSlot, ImageQueueChip — state machine for generated assets
    vista.jsx                    ← Vista panel + stub painting helpers
    foundations.jsx              ← tokens specimen (reference)
    world-placeholder.jsx        ← iso 2D stub (reference)
    spirit-dock.jsx              ← spirit chip + panel (with god portrait)
    selection-card.jsx           ← NPC callout + card (with portrait)
    event-ticker.jsx             ← events chip + panel (with chapter thumbs)
    time-bar-safe.jsx            ← time chip + bar
    full-screen.jsx              ← composed 1920×1080 demos
    branching.jsx                ← Spec C teaser
    cinematic.jsx                ← Spec D teaser
    book.jsx                     ← Spec E teaser (with chapter scene image)
```

## 13. Acceptance — done means

- [ ] `src/ui/tokens.css` loaded by `Game` on mount; all tokens documented in §6 are present and pixel-match the preview.
- [ ] Three corner chips render over the existing world canvas; clicking each toggles a panel.
- [ ] Selection callout replaces today's NPC info overlay; "More" opens the card.
- [ ] Time bar mounts when `T` is pressed and dispatches to `TimelineController` (per Spec B).
- [ ] Keyboard map in §9.2 is wired through `controls.ts`.
- [ ] All copy in §10 matches the strings table exactly.
- [ ] Game still passes its 526 unit tests; new UI gets its own DOM tests.
- [ ] No regressions in iframe embedding — UI scoped to container; no `document.body` mutations.
- [ ] Manrope + IBM Plex Mono loaded inside the container's style scope, or vendored locally.

## 14. Open questions for the dev

1. **Fonts in the iframe** — Google Fonts `@import` vs. self-hosted woff2.
   Pick whichever the existing `embed/` API plays nicely with.
2. **Portrait slot** — vendored placeholder for now, or wire to a real
   portrait generator when available?
3. **Hotkey collisions** — `W` already does anything? `T`?
4. **Event glyph subset on the time-bar track** — Spec B open question;
   the design defaults to: `whisper`, `miracle`, `beliefRise`, `realize`,
   `rival`, `mood` (per the rows in §8.8).
5. **Animation perf** — `backdrop-filter: blur` on chips. Acceptable for
   the target browsers, or fall back to solid `--paper`?

---

*Designed and handed off · May 17, 2026. Single source of truth: this README
+ `preview/tokens.css`. The HTML preview exists to inspect, not to copy.*
