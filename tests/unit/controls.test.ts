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

  it('invokes onToggleFollow on F', () => {
    const onToggleFollow = vi.fn();
    cleanup = attachControls(canvas, createCamera(), {
      onRedraw: () => {},
      onToggleFollow,
    });
    fireKey('KeyF');
    expect(onToggleFollow).toHaveBeenCalledTimes(1);
  });

  it('fires onUserCameraInput when the user pans', () => {
    const onUserCameraInput = vi.fn();
    cleanup = attachControls(canvas, createCamera(), {
      onRedraw: () => {},
      onUserCameraInput,
    });
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 0, bubbles: true }));
    expect(onUserCameraInput).toHaveBeenCalled();
  });

  it('fires onUserCameraInput when the user zooms', () => {
    const onUserCameraInput = vi.fn();
    cleanup = attachControls(canvas, createCamera(), {
      onRedraw: () => {},
      onUserCameraInput,
    });
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
    expect(onUserCameraInput).toHaveBeenCalled();
  });

  it('invokes onToggleDebug on Backquote', () => {
    const onToggleDebug = vi.fn();
    cleanup = attachControls(canvas, createCamera(), {
      onRedraw: () => {},
      onToggleDebug,
    });
    fireKey('Backquote');
    expect(onToggleDebug).toHaveBeenCalledTimes(1);
  });

  it('invokes onToggleLabels on L', () => {
    const onToggleLabels = vi.fn();
    cleanup = attachControls(canvas, createCamera(), {
      onRedraw: () => {},
      onToggleLabels,
    });
    fireKey('KeyL');
    expect(onToggleLabels).toHaveBeenCalledTimes(1);
  });

  it('invokes onTogglePoiMarkers on M', () => {
    const onTogglePoiMarkers = vi.fn();
    cleanup = attachControls(canvas, createCamera(), {
      onRedraw: () => {},
      onTogglePoiMarkers,
    });
    fireKey('KeyM');
    expect(onTogglePoiMarkers).toHaveBeenCalledTimes(1);
  });

  it('does not invoke toggles when an input is focused', () => {
    const onToggleLabels = vi.fn();
    const onTogglePoiMarkers = vi.fn();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    cleanup = attachControls(canvas, createCamera(), {
      onRedraw: () => {},
      onToggleLabels,
      onTogglePoiMarkers,
    });
    fireKey('KeyL', input);
    fireKey('KeyM', input);
    expect(onToggleLabels).not.toHaveBeenCalled();
    expect(onTogglePoiMarkers).not.toHaveBeenCalled();
  });

  it('invokes onToggleSettings on K', () => {
    const onToggleSettings = vi.fn();
    cleanup = attachControls(canvas, createCamera(), {
      onRedraw: () => {},
      onToggleSettings,
    });
    fireKey('KeyK');
    expect(onToggleSettings).toHaveBeenCalledTimes(1);
  });

  it('does not invoke onToggleSettings when an input is focused', () => {
    const onToggleSettings = vi.fn();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    cleanup = attachControls(canvas, createCamera(), {
      onRedraw: () => {},
      onToggleSettings,
    });
    fireKey('KeyK', input);
    expect(onToggleSettings).not.toHaveBeenCalled();
  });

  it('does not invoke onTileClick after a drag-pan', () => {
    const onTileClick = vi.fn();
    const onCanvasClick = vi.fn();
    cleanup = attachControls(canvas, createCamera(), {
      onRedraw: () => {},
      onTileClick,
      onCanvasClick,
    });
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 150, clientY: 120, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 140, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('mouseup', { clientX: 200, clientY: 140, bubbles: true }));
    expect(onTileClick).not.toHaveBeenCalled();
    expect(onCanvasClick).not.toHaveBeenCalled();
  });

  it('invokes onTileClick on a stationary click (no drag)', () => {
    const onTileClick = vi.fn();
    cleanup = attachControls(canvas, createCamera(), {
      onRedraw: () => {},
      onTileClick,
    });
    canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('mouseup', { clientX: 101, clientY: 101, bubbles: true }));
    expect(onTileClick).toHaveBeenCalledTimes(1);
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
