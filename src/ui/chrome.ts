export interface ChromeHandle {
  anchorTopLeft: HTMLElement;
  anchorTopRight: HTMLElement;
  anchorBottomLeft: HTMLElement;
  anchorBottomRight: HTMLElement;
  dispose(): void;
}

function makeAnchor(side: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'): HTMLElement {
  const el = document.createElement('div');
  el.className = `sg-anchor sg-anchor-${side}`;
  el.style.position = 'absolute';
  el.style.zIndex = '20';
  el.style.pointerEvents = 'none';
  const PAD = '18px';
  if (side === 'top-left')      { el.style.top = PAD; el.style.left  = PAD; }
  if (side === 'top-right')     { el.style.top = PAD; el.style.right = PAD; el.style.display = 'flex'; el.style.gap = '8px'; el.style.alignItems = 'flex-start'; }
  if (side === 'bottom-left')   { el.style.bottom = PAD; el.style.left  = PAD; }
  if (side === 'bottom-right')  { el.style.bottom = PAD; el.style.right = PAD; }
  return el;
}

export function mountChrome(container: HTMLElement): ChromeHandle {
  const tl = makeAnchor('top-left');
  const tr = makeAnchor('top-right');
  const bl = makeAnchor('bottom-left');
  const br = makeAnchor('bottom-right');
  container.appendChild(tl);
  container.appendChild(tr);
  container.appendChild(bl);
  container.appendChild(br);
  return {
    anchorTopLeft: tl,
    anchorTopRight: tr,
    anchorBottomLeft: bl,
    anchorBottomRight: br,
    dispose() { tl.remove(); tr.remove(); bl.remove(); br.remove(); },
  };
}

export function mountPastVeil(container: HTMLElement): { setActive(on: boolean): void; dispose(): void } {
  const veil = document.createElement('div');
  veil.className = 'sg-past-veil';
  veil.style.cssText = [
    'position:absolute', 'inset:0', 'z-index:15',
    'pointer-events:none', 'opacity:0', 'transition:opacity 200ms ease-out',
    'background: linear-gradient(180deg, oklch(0.55 0.09 225 / 0.04), oklch(0.55 0.09 225 / 0.08))',
  ].join(';');
  container.appendChild(veil);
  return {
    setActive(on) { veil.style.opacity = on ? '1' : '0'; },
    dispose() { veil.remove(); },
  };
}
