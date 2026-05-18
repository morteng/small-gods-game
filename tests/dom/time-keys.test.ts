// tests/dom/time-keys.test.ts
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { attachTimeKeys } from '@/ui/controls';

describe('time keys', () => {
  it('T calls onToggleTimeBar', () => {
    const onToggle = vi.fn();
    const detach = attachTimeKeys(window, {
      onToggleTimeBar: onToggle,
      onTogglePause: () => {},
      onSetRate: () => {},
      timeBarOpen: () => false,
      onEscape: () => {},
    });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'T' }));
    expect(onToggle).toHaveBeenCalled();
    detach();
  });

  it('1/2/4/8 only fire when timeBarOpen returns true', () => {
    const onSetRate = vi.fn();
    const detach = attachTimeKeys(window, {
      onToggleTimeBar: () => {},
      onTogglePause: () => {},
      onSetRate,
      timeBarOpen: () => false,
      onEscape: () => {},
    });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '4' }));
    expect(onSetRate).not.toHaveBeenCalled();
    detach();

    const onSetRate2 = vi.fn();
    const detach2 = attachTimeKeys(window, {
      onToggleTimeBar: () => {},
      onTogglePause: () => {},
      onSetRate: onSetRate2,
      timeBarOpen: () => true,
      onEscape: () => {},
    });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '4' }));
    expect(onSetRate2).toHaveBeenCalledWith(4);
    detach2();
  });

  it('does nothing while a text input is focused', () => {
    const onPause = vi.fn();
    const onToggle = vi.fn();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const detach = attachTimeKeys(window, {
      onToggleTimeBar: onToggle,
      onTogglePause: onPause,
      onSetRate: () => {},
      timeBarOpen: () => true,
      onEscape: () => {},
    });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true }));

    expect(onPause).not.toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();

    detach();
    input.remove();
  });

  it('does nothing while a contenteditable element is focused', () => {
    const onPause = vi.fn();
    const div = document.createElement('div');
    div.contentEditable = 'true';
    div.tabIndex = 0;
    document.body.appendChild(div);
    div.focus();

    const detach = attachTimeKeys(window, {
      onToggleTimeBar: () => {},
      onTogglePause: onPause,
      onSetRate: () => {},
      timeBarOpen: () => false,
      onEscape: () => {},
    });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(onPause).not.toHaveBeenCalled();

    detach();
    div.remove();
  });
});
