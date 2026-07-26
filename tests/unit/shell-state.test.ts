import { describe, it, expect } from 'vitest';
import {
  EMPTY_SHELL, type ScreenId,
  push, pop, replace, reset, topOf, depth, contains,
} from '@/render/ui/shell/shell-state';

describe('shell-state — the pure screen stack', () => {
  it('an empty stack means the in-game HUD owns the frame', () => {
    expect(topOf(EMPTY_SHELL)).toBeNull();
    expect(depth(EMPTY_SHELL)).toBe(0);
  });

  it('push goes deeper and topOf reports the last entry', () => {
    const s = push(push(EMPTY_SHELL, 'title'), 'load');
    expect(s.stack).toEqual(['title', 'load']);
    expect(topOf(s)).toBe('load');
    expect(depth(s)).toBe(2);
  });

  it('pushing the screen already on top is a no-op and returns the SAME object', () => {
    // Identity matters: `Shell.commit` uses `next === prev` to skip the render
    // kick, so a reducer that allocated a fresh equal object would repaint on
    // every key-repeat.
    const a = push(EMPTY_SHELL, 'pause');
    const b = push(a, 'pause');
    expect(b).toBe(a);
    expect(b.stack).toEqual(['pause']);
  });

  it('pushing a DIFFERENT screen with the same id deeper down still stacks', () => {
    // Only the TOP is deduped — title → settings → title is a legal path.
    const s = push(push(push(EMPTY_SHELL, 'title'), 'settings'), 'title');
    expect(s.stack).toEqual(['title', 'settings', 'title']);
  });

  it('pop comes back out one level', () => {
    const s = pop(push(push(EMPTY_SHELL, 'title'), 'load'));
    expect(s.stack).toEqual(['title']);
  });

  it('popping an empty stack is a no-op returning the SAME object', () => {
    expect(pop(EMPTY_SHELL)).toBe(EMPTY_SHELL);
  });

  it('replace swaps the top at the same depth (no screen left underneath)', () => {
    const s = replace(push(EMPTY_SHELL, 'title'), 'loading');
    expect(s.stack).toEqual(['loading']);
    expect(depth(s)).toBe(1);
  });

  it('replace on an empty stack behaves as a push', () => {
    expect(replace(EMPTY_SHELL, 'loading').stack).toEqual(['loading']);
  });

  it('replace with the screen already on top is a no-op returning the SAME object', () => {
    const a = replace(EMPTY_SHELL, 'loading');
    expect(replace(a, 'loading')).toBe(a);
  });

  it('reset discards the whole stack; reset() with no args lands on the HUD', () => {
    const deep = push(push(push(EMPTY_SHELL, 'title'), 'settings'), 'controls');
    expect(reset(['title']).stack).toEqual(['title']);
    expect(depth(reset())).toBe(0);
    // and the original is untouched — every reducer is non-mutating
    expect(deep.stack).toEqual(['title', 'settings', 'controls']);
  });

  it('contains finds a screen anywhere on the stack, not just on top', () => {
    const s = push(push(EMPTY_SHELL, 'title'), 'settings');
    expect(contains(s, 'title')).toBe(true);
    expect(contains(s, 'settings')).toBe(true);
    expect(contains(s, 'photo')).toBe(false);
  });

  it('never mutates its input', () => {
    const before: ScreenId[] = ['title'];
    const s = { stack: before, transition: null };
    push(s, 'load');
    pop(s);
    replace(s, 'pause');
    expect(before).toEqual(['title']);
  });
});
