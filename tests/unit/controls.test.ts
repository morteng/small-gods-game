import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { attachControls } from '@/ui/controls';
import { createCamera } from '@/render/camera';

function makeCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 800;
  c.height = 600;
  document.body.appendChild(c);
  return c;
}

function fireKey(code: string, target: EventTarget = window): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { code, cancelable: true, bubbles: true });
  target.dispatchEvent(ev);
  return ev;
}

function resetBody(): void {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
}

describe('attachControls keyboard', () => {
  let canvas: HTMLCanvasElement;
  let cleanup: (() => void) | null = null;

  beforeEach(() => {
    canvas = makeCanvas();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    resetBody();
  });

  it('invokes onTogglePause when Space is pressed', () => {
    const onTogglePause = vi.fn();
    cleanup = attachControls(canvas, createCamera(), {
      onRedraw: () => {},
      onTogglePause,
    });
    fireKey('Space');
    expect(onTogglePause).toHaveBeenCalledTimes(1);
  });

  it('prevents default scrolling on Space', () => {
    cleanup = attachControls(canvas, createCamera(), {
      onRedraw: () => {},
      onTogglePause: () => {},
    });
    const ev = fireKey('Space');
    expect(ev.defaultPrevented).toBe(true);
  });

  it('does not invoke onTogglePause when focus is in an input', () => {
    const onTogglePause = vi.fn();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    cleanup = attachControls(canvas, createCamera(), {
      onRedraw: () => {},
      onTogglePause,
    });
    fireKey('Space', input);
    expect(onTogglePause).not.toHaveBeenCalled();
  });

  it('cleanup removes the key listener', () => {
    const onTogglePause = vi.fn();
    cleanup = attachControls(canvas, createCamera(), {
      onRedraw: () => {},
      onTogglePause,
    });
    cleanup();
    cleanup = null;
    fireKey('Space');
    expect(onTogglePause).not.toHaveBeenCalled();
  });
});
