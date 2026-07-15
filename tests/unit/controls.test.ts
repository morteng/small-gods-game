import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { attachControls, attachTimeKeys } from '@/ui/controls';
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

  it('Space is no longer handled by attachControls (owned by attachTimeKeys)', () => {
    // Space was moved to attachTimeKeys so that the time system owns pause.
    // attachControls should NOT call onTogglePause for Space any more.
    const onTogglePause = vi.fn();
    cleanup = attachControls(canvas, createCamera(), {
      onRedraw: () => {},
      onTogglePause,
    });
    fireKey('Space');
    expect(onTogglePause).not.toHaveBeenCalled();
  });

  it('attachTimeKeys invokes onTogglePause when Space is pressed', () => {
    const onTogglePause = vi.fn();
    const detach = attachTimeKeys(window, {
      onToggleTimeBar: () => {},
      onTogglePause,
      onSetRate: () => {},
      timeBarOpen: () => false,
      onEscape: () => {},
    });
    const ev = new KeyboardEvent('keydown', { key: ' ', code: 'Space', cancelable: true, bubbles: true });
    window.dispatchEvent(ev);
    expect(onTogglePause).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
    detach();
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

  it('continuous zoom scales with wheel delta magnitude (not a fixed step)', () => {
    // Zoom OUT — the camera starts at native (zoom 1); this test only exercises the
    // zoom-out magnitude mapping (both events drive factor < 1, landing below 1).
    const big = createCamera();
    const small = createCamera();
    const cb = { onRedraw: () => {} };
    const cleanBig = attachControls(canvas, big, cb);
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
    cleanBig();
    const cleanSmall = attachControls(canvas, small, cb);
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 10, bubbles: true, cancelable: true }));
    cleanSmall();
    // A bigger scroll zooms out more; both zoom out (factor < 1).
    expect(big.zoom).toBeLessThan(small.zoom);
    expect(small.zoom).toBeLessThan(1);
  });

  it('continuous zoom is proportional: many small events ≈ one big event', () => {
    const many = createCamera();
    const one = createCamera();
    const cb = { onRedraw: () => {} };
    let clean = attachControls(canvas, many, cb);
    for (let i = 0; i < 10; i++) canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 10, bubbles: true, cancelable: true }));
    clean();
    clean = attachControls(canvas, one, cb);
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
    clean();
    expect(many.zoom).toBeCloseTo(one.zoom, 4);
  });

  it('clamps a single huge wheel event so zoom cannot jump wildly', () => {
    const cam = createCamera();
    cleanup = attachControls(canvas, cam, { onRedraw: () => {} });
    // Huge zoom-out — the per-event factor is clamped to 1/ZOOM_FACTOR_CLAMP, so
    // one event can't collapse zoom (it lands at 1 × 1/1.6, not near 0).
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100000, bubbles: true, cancelable: true }));
    expect(cam.zoom).toBeGreaterThanOrEqual(1 / 1.6 - 1e-9); // ZOOM_FACTOR_CLAMP
  });

  it('quantized (iso) zoom accumulates: sub-threshold scroll does not step', () => {
    const cam = createCamera();
    const quantize = (cur: number, dir: -1 | 0 | 1) => (dir > 0 ? cur * 2 : dir < 0 ? cur / 2 : cur);
    cleanup = attachControls(canvas, cam, { onRedraw: () => {}, getZoomQuantize: () => quantize });
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 10, bubbles: true, cancelable: true })); // < 40px step
    expect(cam.zoom).toBe(1); // no rung crossed yet
    // Three more 10px events cross the 40px threshold once → one zoom-out rung.
    for (let i = 0; i < 3; i++) canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 10, bubbles: true, cancelable: true }));
    expect(cam.zoom).toBe(0.5);
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

  it('invokes onTileRightClick on contextmenu and prevents default', () => {
    const onTileRightClick = vi.fn();
    cleanup = attachControls(canvas, createCamera(), {
      onRedraw: () => {},
      onTileRightClick,
    });
    const ev = new MouseEvent('contextmenu', {
      clientX: 64, clientY: 96, bubbles: true, cancelable: true,
    });
    canvas.dispatchEvent(ev);
    expect(onTileRightClick).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('does not invoke onTileClick after a right-click', () => {
    const onTileClick = vi.fn();
    const onTileRightClick = vi.fn();
    cleanup = attachControls(canvas, createCamera(), {
      onRedraw: () => {},
      onTileClick,
      onTileRightClick,
    });
    // Right-click: button 2 mousedown + contextmenu + mouseup
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2, clientX: 50, clientY: 50, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('contextmenu', { clientX: 50, clientY: 50, bubbles: true, cancelable: true }));
    canvas.dispatchEvent(new MouseEvent('mouseup', { button: 2, clientX: 50, clientY: 50, bubbles: true }));
    expect(onTileRightClick).toHaveBeenCalledTimes(1);
    expect(onTileClick).not.toHaveBeenCalled();
  });

  it('cleanup removes the key listener', () => {
    const onToggleLabels = vi.fn();
    cleanup = attachControls(canvas, createCamera(), {
      onRedraw: () => {},
      onToggleLabels,
    });
    cleanup();
    cleanup = null;
    fireKey('KeyL');
    expect(onToggleLabels).not.toHaveBeenCalled();
  });
});
