import type { MindPage } from '@/llm/npc-attention-store';

const STYLE = `
.sg-mind { font-family: var(--f-sans); font-size: var(--t-base); line-height: 1.7; color: var(--ink); }
.sg-crumbs { font-family: var(--f-mono); font-size: var(--t-tiny); color: var(--ink-3); margin-bottom: 10px; display: flex; flex-wrap: wrap; gap: 6px; }
.sg-crumb { cursor: pointer; pointer-events: auto; color: var(--time); }
.sg-crumb:hover { text-decoration: underline; }
.sg-crumb-sep { color: var(--ink-4); }
.sg-mind-prose { font-size: var(--t-md); line-height: 1.75; color: var(--ink); margin-bottom: 12px; }
.sg-link { cursor: pointer; pointer-events: auto; }
.sg-link[data-sg-link="entity"] { color: var(--faith); text-decoration: underline; font-weight: 600; }
.sg-link[data-sg-link="concept"] { color: var(--concept); border-bottom: 1px dashed var(--concept); }
.sg-mind-foot { font-family: var(--f-mono); font-size: var(--t-tiny); color: var(--ink-3); margin-top: 10px; display: flex; justify-content: space-between; }
.sg-mind-loading { font-style: italic; font-size: var(--t-small); color: var(--ink-4); padding: 12px 0; }
`;

export interface MindModeDeps {
  onDrill(label: string, kind: 'entity' | 'concept', entityId?: string): void;
  onCrumb(index: number): void;
  onCrossNav(entityId: string): void;
  nextCost(): number;
}

export interface MindModeHandle {
  showPage(path: string[], page: MindPage): void;
  showLoading(path: string[]): void;
  destroy(): void;
}

export function mountMindMode(body: HTMLElement, deps: MindModeDeps): MindModeHandle {
  while (body.firstChild) body.removeChild(body.firstChild);
  const style = document.createElement('style'); style.textContent = STYLE; body.appendChild(style);
  const root = document.createElement('div'); root.className = 'sg-mind'; body.appendChild(root);

  function renderCrumbs(path: string[]): HTMLElement {
    const bar = document.createElement('div'); bar.className = 'sg-crumbs';
    path.forEach((label, i) => {
      if (i > 0) { const sep = document.createElement('span'); sep.className = 'sg-crumb-sep'; sep.textContent = '▸'; bar.appendChild(sep); }
      const c = document.createElement('span'); c.className = 'sg-crumb'; c.dataset.sgCrumb = String(i); c.textContent = label;
      c.addEventListener('click', (e) => { e.stopPropagation(); deps.onCrumb(i); });
      bar.appendChild(c);
    });
    return bar;
  }

  function linkSpan(label: string, kind: 'entity' | 'concept', entityId?: string): HTMLElement {
    const s = document.createElement('span'); s.className = 'sg-link'; s.dataset.sgLink = kind;
    s.textContent = kind === 'entity' ? `⮕ ${label}` : label;
    s.addEventListener('click', (e) => {
      e.stopPropagation();
      if (kind === 'entity' && entityId) deps.onCrossNav(entityId);
      else deps.onDrill(label, kind, entityId);
    });
    return s;
  }

  return {
    showPage(path, page) {
      while (root.firstChild) root.removeChild(root.firstChild);
      root.appendChild(renderCrumbs(path));
      const prose = document.createElement('div'); prose.className = 'sg-mind-prose'; prose.textContent = page.prose;
      root.appendChild(prose);
      if (page.links.length) {
        const links = document.createElement('div');
        page.links.forEach((l, i) => { if (i > 0) links.appendChild(document.createTextNode(' · ')); links.appendChild(linkSpan(l.label, l.kind, l.entityId)); });
        root.appendChild(links);
      }
      const foot = document.createElement('div'); foot.className = 'sg-mind-foot';
      const depthEl = document.createElement('span'); depthEl.textContent = `depth ${page.depth}`;
      const costEl = document.createElement('span'); costEl.textContent = `drill deeper · ${deps.nextCost()} ⚡`;
      foot.append(depthEl, costEl);
      root.appendChild(foot);
    },
    showLoading(path) {
      while (root.firstChild) root.removeChild(root.firstChild);
      root.appendChild(renderCrumbs(path));
      const l = document.createElement('div'); l.className = 'sg-mind-loading'; l.textContent = 'reading their mind…';
      root.appendChild(l);
    },
    destroy() { while (body.firstChild) body.removeChild(body.firstChild); },
  };
}
