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
