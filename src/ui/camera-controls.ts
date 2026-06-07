/**
 * A small on-canvas camera control cluster: zoom in / zoom out / fit-to-view.
 * Buttons, not keyboard shortcuts (per the project's UX rule). Logic (which
 * camera, which viewport, which render mode) is injected via callbacks.
 */

export interface CameraControlsCallbacks {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  /** Snap to exactly 1:1 (native pixel scale) — the crisp pixel-art tier. */
  onZoomActual: () => void;
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
    b.className = 'sg-btn sg-btn--icon';
    b.style.cssText = [
      'width:38px', 'height:38px',
      'font-size:var(--t-lg)', 'line-height:1', 'pointer-events:auto',
    ].join(';');
    b.addEventListener('click', onClick);
    return b;
  };

  const zoomIn = mk('＋', 'Zoom in', cb.onZoomIn);
  const zoomOut = mk('－', 'Zoom out', cb.onZoomOut);
  const fit = mk('⊡', 'Fit map to view', cb.onFitView);
  const actual = mk('1:1', 'Zoom to 1:1 (native pixel scale)', cb.onZoomActual);
  actual.style.fontSize = 'var(--t-small)'; // "1:1" is wider than a glyph
  wrap.append(zoomIn, zoomOut, fit, actual);
  container.appendChild(wrap);

  return {
    element: wrap,
    destroy(): void { wrap.remove(); },
  };
}
