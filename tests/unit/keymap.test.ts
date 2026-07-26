import { describe, it, expect } from 'vitest';
import {
  ACTIONS, DEFAULT_KEYMAP, resolveAction, promptFor, bind, conflictsFor,
  loadKeymap, diffFromDefault, isAction, type Action, type Keymap,
} from '@/game/input/keymap';
import { supportedGlyphs } from '@/render/ui/text/pixel-font';

describe('keymap — DEFAULT_KEYMAP matches today\'s bindings', () => {
  it('covers every Action exactly once', () => {
    expect(Object.keys(DEFAULT_KEYMAP).sort()).toEqual([...ACTIONS].sort());
  });

  it('preserves the pre-P5 controls.ts / attachTimeKeys bindings', () => {
    expect(DEFAULT_KEYMAP.toggle_labels).toEqual(['KeyL']);
    expect(DEFAULT_KEYMAP.toggle_debug).toEqual(['Backquote']);
    expect(DEFAULT_KEYMAP.follow_selected).toEqual(['KeyF']);
    expect(DEFAULT_KEYMAP.open_settings).toEqual(['KeyK']);
    expect(DEFAULT_KEYMAP.toggle_time_bar).toEqual(['KeyT']);
    expect(DEFAULT_KEYMAP.toggle_pause).toEqual(['Space']);
    expect(DEFAULT_KEYMAP.rate_1).toEqual(['Digit1']);
    expect(DEFAULT_KEYMAP.rate_2).toEqual(['Digit2']);
    expect(DEFAULT_KEYMAP.rate_4).toEqual(['Digit4']);
    expect(DEFAULT_KEYMAP.rate_8).toEqual(['Digit8']);
    expect(DEFAULT_KEYMAP.cancel).toEqual(['Escape']);
  });
});

describe('resolveAction', () => {
  it('resolves every default binding back to its action', () => {
    for (const action of ACTIONS) {
      for (const code of DEFAULT_KEYMAP[action]) {
        expect(resolveAction(code, DEFAULT_KEYMAP), `${code} -> ${action}`).toBe(action);
      }
    }
  });

  it('returns null for an unbound code', () => {
    expect(resolveAction('KeyZ', DEFAULT_KEYMAP)).toBeNull();
    expect(resolveAction('', DEFAULT_KEYMAP)).toBeNull();
  });

  it('round-trips through bind: a freshly bound code resolves to the new action', () => {
    const map = bind(DEFAULT_KEYMAP, 'toggle_labels', 'KeyZ');
    expect(resolveAction('KeyZ', map)).toBe('toggle_labels');
  });
});

describe('bind — immutable, single-binding rebind, steals conflicts', () => {
  it('does not mutate the input map', () => {
    const before = JSON.stringify(DEFAULT_KEYMAP);
    bind(DEFAULT_KEYMAP, 'toggle_labels', 'KeyZ');
    expect(JSON.stringify(DEFAULT_KEYMAP)).toBe(before);
  });

  it('returns a NEW object, not the same reference', () => {
    const next = bind(DEFAULT_KEYMAP, 'toggle_labels', 'KeyZ');
    expect(next).not.toBe(DEFAULT_KEYMAP);
  });

  it('replaces (not appends to) the target action\'s bindings', () => {
    const next = bind(DEFAULT_KEYMAP, 'toggle_labels', 'KeyZ');
    expect(next.toggle_labels).toEqual(['KeyZ']);
  });

  it('steals the code from whichever OTHER action held it', () => {
    // KeyK is bound to open_settings by default; rebind toggle_labels to it.
    const next = bind(DEFAULT_KEYMAP, 'toggle_labels', 'KeyK');
    expect(next.toggle_labels).toEqual(['KeyK']);
    expect(next.open_settings).toEqual([]); // lost it
  });

  it('every OTHER action is untouched when there is no conflict', () => {
    const next = bind(DEFAULT_KEYMAP, 'toggle_labels', 'KeyZ');
    for (const action of ACTIONS) {
      if (action === 'toggle_labels') continue;
      expect(next[action]).toEqual(DEFAULT_KEYMAP[action]);
    }
  });
});

describe('conflictsFor', () => {
  it('reports the action(s) currently bound to a code', () => {
    expect(conflictsFor(DEFAULT_KEYMAP, 'KeyK')).toEqual(['open_settings']);
  });

  it('is empty for a free code', () => {
    expect(conflictsFor(DEFAULT_KEYMAP, 'KeyZ')).toEqual([]);
  });

  it('excludes the named action from its own conflict report', () => {
    expect(conflictsFor(DEFAULT_KEYMAP, 'KeyK', 'open_settings')).toEqual([]);
  });

  it('bind is single-owner: rebinding a second action to the same code leaves only ONE holder', () => {
    const map = bind(DEFAULT_KEYMAP, 'follow_selected', 'KeyK');
    expect(conflictsFor(map, 'KeyK')).toEqual(['follow_selected']); // open_settings already lost it
  });

  it('CAN report more than one conflict for a map that was never funnelled through bind (e.g. a hand-authored diff)', () => {
    const map = loadKeymap({ toggle_labels: ['KeyK'], follow_selected: ['KeyK'], open_settings: [] });
    expect(conflictsFor(map, 'KeyK').sort()).toEqual(['follow_selected', 'toggle_labels']);
  });
});

describe('promptFor — ASCII-only, pixel-font-safe display labels', () => {
  const glyphs = supportedGlyphs();

  function assertRenderable(s: string): void {
    for (const ch of s) {
      expect(ch >= ' ' && ch <= '~', `"${ch}" in "${s}" is not printable ASCII`).toBe(true);
      if (ch !== ' ') {
        expect(glyphs.has(ch.toUpperCase()), `"${ch}" in "${s}" has no pixel-font glyph`).toBe(true);
      }
    }
  }

  it('every default binding prompts to a renderable ASCII label', () => {
    for (const action of ACTIONS) {
      const label = promptFor(action, DEFAULT_KEYMAP);
      assertRenderable(label);
    }
  });

  it('known letter/digit codes prompt to their trailing character', () => {
    expect(promptFor('toggle_labels', DEFAULT_KEYMAP)).toBe('L');
    expect(promptFor('rate_1', DEFAULT_KEYMAP)).toBe('1');
  });

  it('named special keys get a friendly ASCII label', () => {
    expect(promptFor('toggle_pause', DEFAULT_KEYMAP)).toBe('SPACE');
    expect(promptFor('cancel', DEFAULT_KEYMAP)).toBe('ESC');
    expect(promptFor('toggle_debug', DEFAULT_KEYMAP)).toBe('GRAVE'); // no backtick glyph — see module doc
  });

  it('an unbound action prompts "NONE"', () => {
    const map = bind(DEFAULT_KEYMAP, 'toggle_labels', 'KeyK'); // steals KeyK from open_settings
    expect(promptFor('open_settings', map)).toBe('NONE');
    assertRenderable(promptFor('open_settings', map));
  });

  it('a rebound key relabels the prompt (the whole point of sharing one map)', () => {
    const map = bind(DEFAULT_KEYMAP, 'toggle_labels', 'KeyZ');
    expect(promptFor('toggle_labels', map)).toBe('Z');
  });
});

describe('persistence: diffFromDefault / loadKeymap', () => {
  it('diffFromDefault is empty for the untouched default map', () => {
    expect(diffFromDefault(DEFAULT_KEYMAP)).toEqual({});
  });

  it('diffFromDefault reports ONLY the actions that changed', () => {
    const map = bind(DEFAULT_KEYMAP, 'toggle_labels', 'KeyZ'); // KeyZ is free — no conflict, no other action changes
    expect(diffFromDefault(map)).toEqual({ toggle_labels: ['KeyZ'] });
  });

  it('diffFromDefault includes a conflict LOSER too (its binding really did change)', () => {
    const map = bind(DEFAULT_KEYMAP, 'toggle_labels', 'KeyK'); // steals KeyK from open_settings
    expect(diffFromDefault(map)).toEqual({ toggle_labels: ['KeyK'], open_settings: [] });
  });

  it('loadKeymap(null/undefined) is exactly the default', () => {
    expect(loadKeymap(null)).toEqual(DEFAULT_KEYMAP);
    expect(loadKeymap(undefined)).toEqual(DEFAULT_KEYMAP);
  });

  it('round-trips a rebind through diff -> load', () => {
    const map = bind(DEFAULT_KEYMAP, 'toggle_labels', 'KeyZ');
    const diff = diffFromDefault(map);
    const restored = loadKeymap(diff);
    expect(restored).toEqual(map);
  });

  it('merges a PARTIAL stored diff over the default (migration-safe)', () => {
    const restored = loadKeymap({ toggle_labels: ['KeyZ'] });
    expect(restored.toggle_labels).toEqual(['KeyZ']);
    expect(restored.open_settings).toEqual(DEFAULT_KEYMAP.open_settings);
    expect(restored.cancel).toEqual(DEFAULT_KEYMAP.cancel);
  });

  it('drops an unknown action key from a foreign/stale diff instead of throwing', () => {
    expect(() => loadKeymap({ some_retired_action: ['KeyQ'] } as Record<string, unknown>)).not.toThrow();
    const restored = loadKeymap({ some_retired_action: ['KeyQ'] } as Record<string, unknown>);
    expect(restored).toEqual(DEFAULT_KEYMAP);
  });

  it('drops a malformed value (not a string array) instead of throwing', () => {
    const restored = loadKeymap({ toggle_labels: 'KeyZ' } as unknown as Record<string, unknown>);
    expect(restored.toggle_labels).toEqual(DEFAULT_KEYMAP.toggle_labels);
  });
});

describe('isAction', () => {
  it('accepts every real action', () => {
    for (const a of ACTIONS) expect(isAction(a)).toBe(true);
  });
  it('refuses an unknown string', () => {
    expect(isAction('nope')).toBe(false);
    expect(isAction('')).toBe(false);
  });
});

// Type-level sanity: Action/Keymap stay structurally aligned with ACTIONS.
void ((_a: Action, _m: Keymap) => { /* compile-time only */ })('cancel', DEFAULT_KEYMAP);
