/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from 'vitest';
import { createCameraControls, type CameraControlsHandle } from '@/ui/camera-controls';

describe('createCameraControls', () => {
  let handle: CameraControlsHandle | null = null;
  let container: HTMLElement;
  afterEach(() => { handle?.destroy(); container?.remove(); handle = null; });

  it('renders four buttons and fires the matching callbacks; destroy() removes it', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    let zin = 0, zout = 0, fit = 0, actual = 0;
    handle = createCameraControls(container, {
      onZoomIn: () => zin++, onZoomOut: () => zout++, onFitView: () => fit++, onZoomActual: () => actual++,
    });

    const btns = handle.element.querySelectorAll('button');
    expect(btns.length).toBe(4);
    (btns[0] as HTMLButtonElement).click();
    (btns[1] as HTMLButtonElement).click();
    (btns[2] as HTMLButtonElement).click();
    (btns[3] as HTMLButtonElement).click();
    expect([zin, zout, fit, actual]).toEqual([1, 1, 1, 1]);

    handle.destroy();
    handle = null;
    expect(container.querySelector('button')).toBeNull();
  });
});
