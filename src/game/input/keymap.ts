// src/game/input/keymap.ts
//
// The keyboard bindings map (UI v3 P5). ONE `Action` union covers everything a
// physical key can drive today — world/HUD shortcuts (`controls.ts`) plus menu
// navigation (shared with the gamepad, `gamepad.ts`) — keyed by
// `KeyboardEvent.code` (the PHYSICAL key), never `.key`, so a rebind and the
// resulting prompt are layout-independent (an AZERTY player's "A" key still
// reads as "Q" — code doesn't care).
//
// Pure module: no DOM, no `window`, no `navigator`. `controls.ts` calls
// `resolveAction` per keydown; the settings CONTROLS tab calls `promptFor` to
// label its key-chips and `bind`/`conflictsFor` to service a rebind; the game
// coordinator persists the result through `settings-store.ts` (see
// `diffFromDefault`/`loadKeymap` below).

/** Every action a physical key (or a gamepad button, via `gamepad.ts`) can
 *  drive. `menu_*`/`confirm`/`cancel` are the shared focus-ring vocabulary
 *  (`UiContext.focusNext`/`focusPrev`/`activate` and the Esc stack) — bound
 *  for keyboard/gamepad completeness even though `controls.ts` does not (yet)
 *  wire arrow-key menu nav itself; `photo_mode` is declared for P5's other
 *  half (photo screen) to consume without inventing its own binding table. */
export type Action =
  | 'toggle_labels'
  | 'toggle_minimap'
  | 'toggle_debug'
  | 'follow_selected'
  | 'open_settings'
  | 'open_tutorial'
  | 'toggle_time_bar'
  | 'toggle_pause'
  | 'rate_1'
  | 'rate_2'
  | 'rate_4'
  | 'rate_8'
  | 'menu_up'
  | 'menu_down'
  | 'menu_left'
  | 'menu_right'
  | 'confirm'
  | 'cancel'
  | 'photo_mode';

/** Iteration order for the rebinding UI (§7) — also the row order the CONTROLS
 *  tab draws in, so a designer reordering this list reorders the screen too. */
export const ACTIONS: readonly Action[] = [
  'toggle_labels', 'toggle_minimap', 'toggle_debug', 'follow_selected',
  'open_settings', 'open_tutorial', 'toggle_time_bar', 'toggle_pause',
  'rate_1', 'rate_2', 'rate_4', 'rate_8',
  'menu_up', 'menu_down', 'menu_left', 'menu_right', 'confirm', 'cancel', 'photo_mode',
];

const ACTION_SET = new Set<string>(ACTIONS);

/** Validates a value that arrived from OUTSIDE (a bus-connected agent's
 *  `rebind_key` params, or a stored keymap diff) — refuse rather than cast,
 *  same discipline as `game.ts`'s `isScreenId`/`isSaveSlot`/`isSettingsKey`. */
export function isAction(v: string): v is Action {
  return ACTION_SET.has(v);
}

/** One action → the physical codes bound to it. An empty array means
 *  "unbound" (never removed from the map — `promptFor` reports it honestly). */
export type Keymap = Readonly<Record<Action, readonly string[]>>;

/**
 * Today's bindings, verbatim (see `src/ui/controls.ts`'s pre-P5 `onKeyDown`/
 * `attachTimeKeys`): L labels, M minimap, ` debug, F follow, K settings, T time
 * bar, Space pause, 1/2/4/8 rates, Esc cancel.
 *
 * DEVIATION from the P5 brief's illustrative examples, both documented here
 * rather than silently: (1) `open_tutorial` was gated on Shift+"/" (only "?"
 * opened it); this module models bindings as bare physical codes with no
 * modifier concept, so the shift requirement is dropped — "/" alone now opens
 * it. `tutorial.ts` is slated for retirement in P6 (tiding-based first-run
 * guidance replaces it), so this is a low-stakes simplification, not a
 * feature regression worth a whole modifier system for one binding. (2) the
 * brief's example prompt for `Backquote` is a literal backtick, but the
 * pixel font (`text/pixel-font.ts`) has no backtick glyph — `promptFor` below
 * renders it "GRAVE" instead (ASCII-safe, and it actually renders).
 */
export const DEFAULT_KEYMAP: Keymap = Object.freeze({
  toggle_labels: ['KeyL'],
  toggle_minimap: ['KeyM'],
  toggle_debug: ['Backquote'],
  follow_selected: ['KeyF'],
  open_settings: ['KeyK'],
  open_tutorial: ['Slash'],
  toggle_time_bar: ['KeyT'],
  toggle_pause: ['Space'],
  rate_1: ['Digit1'],
  rate_2: ['Digit2'],
  rate_4: ['Digit4'],
  rate_8: ['Digit8'],
  menu_up: ['ArrowUp'],
  menu_down: ['ArrowDown'],
  menu_left: ['ArrowLeft'],
  menu_right: ['ArrowRight'],
  confirm: ['Enter'],
  cancel: ['Escape'],
  photo_mode: ['KeyP'],
}) as Keymap;

/** Resolve a physical `KeyboardEvent.code` to the action bound to it, or null
 *  when nothing is bound to that code. First match wins (a code should only
 *  ever be bound to one action at a time — `bind` below enforces that). */
export function resolveAction(code: string, map: Keymap): Action | null {
  for (const action of ACTIONS) {
    if (map[action].includes(code)) return action;
  }
  return null;
}

/** Every action currently bound to `code` (excluding `exclude`, so a caller
 *  checking "what would REBINDING this action to this code steal from
 *  someone else" doesn't report itself as its own conflict). Empty when the
 *  code is free. */
export function conflictsFor(map: Keymap, code: string, exclude?: Action): Action[] {
  return ACTIONS.filter((a) => a !== exclude && map[a].includes(code));
}

/**
 * Rebind `action` to exactly `code` (single-binding rebinding — the settings
 * screen's REBIND affordance replaces, it doesn't add a second chord), and
 * steal `code` away from any OTHER action that held it, so the resulting map
 * never has two actions racing for the same physical key (`resolveAction`
 * would otherwise silently prefer whichever comes first in `ACTIONS`). Pure:
 * returns a NEW map, `map` is untouched.
 */
export function bind(map: Keymap, action: Action, code: string): Keymap {
  const next = { ...map } as Record<Action, readonly string[]>;
  for (const a of ACTIONS) {
    if (a !== action && next[a].includes(code)) {
      next[a] = next[a].filter((c) => c !== code);
    }
  }
  next[action] = [code];
  return Object.freeze(next) as Keymap;
}

// ── display ──────────────────────────────────────────────────────────────

/** Physical codes whose default console-style label isn't just the trailing
 *  letter/digit — kept ASCII-only (the pixel font's coverage guard scans
 *  `src/render/ui/**` string literals, not this module, but the resulting
 *  strings ride into a `key-chip` drawn there, so they must render for real). */
const CODE_LABELS: Readonly<Record<string, string>> = {
  Backquote: 'GRAVE', // no backtick glyph in the pixel font — see DEFAULT_KEYMAP's doc
  Space: 'SPACE',
  Escape: 'ESC',
  Enter: 'ENTER',
  Tab: 'TAB',
  Slash: '/',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Backspace: 'BKSP',
  CapsLock: 'CAPS',
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',
  ShiftLeft: 'SHIFT',
  ShiftRight: 'SHIFT',
  ControlLeft: 'CTRL',
  ControlRight: 'CTRL',
  AltLeft: 'ALT',
  AltRight: 'ALT',
  MetaLeft: 'META',
  MetaRight: 'META',
};

/** A short display label for one physical code — ASCII-only, always something
 *  the pixel font can actually render (verified by
 *  `tests/unit/keymap.test.ts`'s glyph-coverage check against the real
 *  `supportedGlyphs()` table, since this module sits outside the coverage
 *  guard's file scan). */
function labelForCode(code: string): string {
  const known = CODE_LABELS[code];
  if (known) return known;
  if (code.startsWith('Key') && code.length === 4) return code.slice(3); // KeyL -> L
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5); // Digit1 -> 1
  if (code.startsWith('Numpad')) return `NUM ${code.slice(6)}`;
  return code.toUpperCase();
}

/** The chip label for `action`'s current binding(s) — what `key-chip` renders
 *  and what a rebind instantly relabels everywhere (both read the SAME map).
 *  Multiple bindings join with " / "; no binding reads "NONE". */
export function promptFor(action: Action, map: Keymap): string {
  const codes = map[action];
  if (!codes || codes.length === 0) return 'NONE';
  return codes.map(labelForCode).join(' / ');
}

// ── persistence (diff-against-default, so a future default change still
//    reaches an existing player who never touched that action) ─────────────

/** Merge a partial, untrusted diff (as stored by `settings-store.ts`, or
 *  handed in fresh from a save made by an older build with fewer actions)
 *  over `DEFAULT_KEYMAP`. Unknown keys are dropped (an action retired since
 *  the diff was written must not resurrect a dangling binding); a malformed
 *  value (not a string array) is dropped the same way — this is the one
 *  place a stored keymap re-enters trusted code, so it is validated exactly
 *  as strictly as a bus-supplied `rebind_key`. */
export function loadKeymap(diff: Readonly<Record<string, unknown>> | null | undefined): Keymap {
  if (!diff) return DEFAULT_KEYMAP;
  const next = { ...DEFAULT_KEYMAP } as Record<Action, readonly string[]>;
  for (const [key, value] of Object.entries(diff)) {
    if (!isAction(key)) continue;
    if (!Array.isArray(value) || !value.every((c) => typeof c === 'string')) continue;
    next[key] = [...value];
  }
  return Object.freeze(next) as Keymap;
}

/** The inverse of `loadKeymap`: everything in `map` that differs from
 *  `DEFAULT_KEYMAP`, action-by-action — what actually gets persisted, so a
 *  future default-binding change still reaches a player who never rebound
 *  that particular action. */
export function diffFromDefault(map: Keymap): Record<string, readonly string[]> {
  const diff: Record<string, readonly string[]> = {};
  for (const action of ACTIONS) {
    const a = map[action];
    const b = DEFAULT_KEYMAP[action];
    if (a.length !== b.length || a.some((c, i) => c !== b[i])) diff[action] = a;
  }
  return diff;
}

/** Best-effort `KeyboardEvent.code` for an event that only carries `key`.
 *
 *  Real browsers always populate `code`, and resolving by PHYSICAL key is the
 *  right call for a game (WASD stays put on AZERTY). But synthetic events —
 *  tests, automation drivers, the dev bus — routinely dispatch `{ key: 'T' }`
 *  with no `code` at all, and before this those silently did nothing. Mapping the
 *  common cases back keeps those paths working without giving up physical
 *  binding for real input. */
export function codeFromKey(key: string): string | null {
  if (!key) return null;
  if (key.length === 1) {
    const ch = key.toUpperCase();
    if (ch >= 'A' && ch <= 'Z') return `Key${ch}`;
    if (ch >= '0' && ch <= '9') return `Digit${ch}`;
    const PUNCT: Record<string, string> = {
      '`': 'Backquote', '~': 'Backquote', '?': 'Slash', '/': 'Slash',
      '-': 'Minus', '=': 'Equal', '[': 'BracketLeft', ']': 'BracketRight',
      ' ': 'Space', ',': 'Comma', '.': 'Period', ';': 'Semicolon', "'": 'Quote',
    };
    return PUNCT[key] ?? null;
  }
  // Multi-char `key` values that ARE their own code (Escape, ArrowUp, Tab, …).
  if (/^[A-Z][A-Za-z]+$/.test(key)) return key;
  return null;
}

/** Resolve an action from a real or synthetic keyboard event. Prefers `code`
 *  (physical), falls back to deriving one from `key` — see `codeFromKey`. */
export function resolveActionFromEvent(
  e: { code?: string; key?: string },
  map: Keymap,
): Action | null {
  const direct = e.code ? resolveAction(e.code, map) : null;
  if (direct) return direct;
  const derived = e.key ? codeFromKey(e.key) : null;
  return derived ? resolveAction(derived, map) : null;
}
