/**
 * A small on-canvas camera control cluster: zoom in / zoom out / fit-to-view.
 * Buttons, not keyboard shortcuts (per the project's UX rule). Logic (which
 * camera, which viewport, which render mode) is injected via callbacks.
 */

export interface CameraControlsCallbacks {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
}

export interface CameraControlsHandle {
  element: HTMLElement;
  destroy(): void;
}

export function createCameraControls(
  container: HTMLElement,
  cb: CameraControlsCallbacks,
): CameraControlsHandle {
  const wrap = document.createElement('div');
  wrap.style.cssText = [
    'position:absolute', 'right:12px', 'bottom:200px',
    'display:flex', 'flex-direction:column', 'gap:4px',
    'z-index:12',
  ].join(';');

  const mk = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.style.cssText = [
      'width:34px', 'height:34px', 'cursor:pointer',
      'background:rgba(10,10,20,0.75)', 'color:#9fd8ff',
      'border:1px solid rgba(255,255,255,0.2)', 'border-radius:5px',
      'font:16px ui-monospace,monospace', 'line-height:1',
    ].join(';');
    b.addEventListener('mouseenter', () => { b.style.background = 'rgba(40,40,70,0.9)'; });
    b.addEventListener('mouseleave', () => { b.style.background = 'rgba(10,10,20,0.75)'; });
    b.addEventListener('click', onClick);
    return b;
  };

  const zoomIn = mk('＋', 'Zoom in', cb.onZoomIn);
  const zoomOut = mk('－', 'Zoom out', cb.onZoomOut);
  const fit = mk('⊡', 'Fit map to view', cb.onFitView);
  wrap.append(zoomIn, zoomOut, fit);
  container.appendChild(wrap);

  return {
    element: wrap,
    destroy(): void { wrap.remove(); },
  };
}
