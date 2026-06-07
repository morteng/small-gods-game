/**
 * Building info panel — the building-side analogue of the NPC attention panel.
 *
 * Click a building → this panel shows its title, the tri-aligned human
 * description, and structured facts (size, era, materials, door). In dev mode it
 * also exposes a "guidance ⇄ result" toggle: the init_image we send to the art
 * model (footprint grid + massing + door marker) vs the sprite we got back —
 * so generated art can be eyeballed against the geometry it was guided by.
 */
import type { BuildingInfo } from '@/world/building-helpers';

export interface BuildingPanelView {
  info: BuildingInfo;
  /** base64/data-URL of the guidance image we send (grid + massing), or null. */
  guidanceUrl: string | null;
  /** Current sprite src we got back from the library, or null (massing only). */
  spriteUrl: string | null;
}

export interface BuildingInfoPanelHandle {
  render(view: BuildingPanelView): void;
  show(): void;
  hide(): void;
  destroy(): void;
}

export interface BuildingInfoPanelDeps {
  onClose: () => void;
}

export function mountBuildingInfoPanel(
  container: HTMLElement, deps: BuildingInfoPanelDeps,
): BuildingInfoPanelHandle {
  const panel = document.createElement('div');
  panel.className = 'sg-scroll';
  panel.style.cssText = [
    'position:absolute', 'top:14px', 'right:14px', 'width:340px',
    'max-height:calc(100% - 28px)', 'overflow-y:auto',
    'padding:16px 18px', 'background:var(--shade)',
    'backdrop-filter:blur(10px)', '-webkit-backdrop-filter:blur(10px)',
    'border:1px solid var(--line)', 'border-radius:var(--r-4)',
    'box-shadow:var(--lift-2)', 'color:var(--ink)', 'pointer-events:auto',
    'display:none', 'z-index:21', 'box-sizing:border-box',
    'font-family:var(--f-sans)',
  ].join(';');
  container.appendChild(panel);

  // Which image the dev toggle shows. Persists across re-renders of the same id.
  let mode: 'guidance' | 'result' = 'result';
  let lastId: string | null = null;

  function render(view: BuildingPanelView): void {
    const { info, guidanceUrl, spriteUrl } = view;
    if (info.id !== lastId) { mode = spriteUrl ? 'result' : 'guidance'; lastId = info.id; }

    const facts = info.facts
      .map((f) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:3px 0;border-bottom:1px solid var(--line)">
          <span style="color:var(--ink-3);text-transform:uppercase;letter-spacing:.05em;font-size:var(--t-micro)">${esc(f.label)}</span>
          <span style="font-weight:600">${esc(f.value)}</span></div>`)
      .join('');

    const shown = mode === 'guidance' ? guidanceUrl : spriteUrl;
    const caption = mode === 'guidance'
      ? 'Sent → footprint grid + massing + door marker'
      : (spriteUrl ? 'Got back → generated sprite' : 'No sprite yet — placeholder massing renders');
    const imgHtml = shown
      ? `<img src="${esc(shown)}" alt="${esc(mode)}" style="max-width:100%;image-rendering:pixelated;background:repeating-conic-gradient(#0000 0% 25%, #ffffff14 0% 50%) 50%/16px 16px;border:1px solid var(--line);border-radius:var(--r-2)">`
      : `<div style="padding:20px;text-align:center;color:var(--ink-3)">(none)</div>`;
    const devBlock = `
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line)">
        <div style="font-size:var(--t-micro);color:var(--ink-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Sent ⇄ Received</div>
        <div style="display:flex;gap:6px;margin-bottom:8px">
          <button data-mode="guidance" class="sg-btn ${mode === 'guidance' ? '' : 'sg-btn--ghost'}" style="flex:1;font-size:var(--t-micro)">Guidance</button>
          <button data-mode="result" class="sg-btn ${mode === 'result' ? '' : 'sg-btn--ghost'}" style="flex:1;font-size:var(--t-micro)">Result</button>
        </div>
        ${imgHtml}
        <div style="margin-top:6px;font-size:var(--t-micro);color:var(--ink-3)">${esc(caption)}</div>
      </div>`;

    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <div style="flex:1;font-size:var(--t-md);font-weight:700">${esc(info.title)}</div>
        <button data-close style="background:none;border:none;color:var(--ink-3);font-size:18px;cursor:pointer;line-height:1">×</button>
      </div>
      <div style="font-size:var(--t-small);line-height:1.5;color:var(--ink-2);margin-bottom:12px">${esc(info.description)}</div>
      <div style="font-size:var(--t-small)">${facts}</div>
      ${devBlock}`;

    panel.querySelector<HTMLButtonElement>('[data-close]')?.addEventListener('click', () => deps.onClose());
    panel.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => {
      b.addEventListener('click', () => { mode = b.dataset.mode as 'guidance' | 'result'; render(view); });
    });
  }

  return {
    render,
    show() { panel.style.display = 'block'; },
    hide() { panel.style.display = 'none'; lastId = null; },
    destroy() { panel.remove(); },
  };
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}
