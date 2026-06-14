// src/studio/accordion.ts
// Collapsible / vertically-resizable accordion (left-pane stack). Each section
// header can carry right-aligned action buttons (e.g. Randomize on the geometry
// section) via the optional `actions` slot — clicks there don't toggle the fold.
import { h } from './theme';

interface AccordionSection {
  id: string;
  title: string;
  open?: boolean;       // initial fold state
  height?: number;      // initial px height when open (the last open section is elastic)
  build: (body: HTMLElement) => void;        // populate the body ONCE
  actions?: (host: HTMLElement) => void;     // optional right-aligned header controls
}
interface AccordionHandle { setOpen: (id: string, open: boolean) => void }

export function buildAccordion(host: HTMLElement, sections: AccordionSection[]): AccordionHandle {
  host.style.cssText += ';display:flex;flex-direction:column;overflow:hidden';
  interface Row { def: AccordionSection; wrap: HTMLElement; caret: HTMLElement; body: HTMLElement; splitter: HTMLElement; open: boolean; height: number }
  const rows: Row[] = [];

  // Layout: open sections take their px height; the LAST open section is elastic
  // (flex:1) so the stack always fills. Collapsed sections are header-only.
  function relayout(): void {
    const openRows = rows.filter(r => r.open);
    const lastOpen = openRows[openRows.length - 1];
    for (const r of rows) {
      if (!r.open) { r.wrap.style.flex = '0 0 auto'; r.body.style.display = 'none'; r.splitter.style.display = 'none'; }
      else if (r === lastOpen) { r.wrap.style.flex = '1 1 0'; r.body.style.display = 'block'; r.splitter.style.display = 'none'; }
      else { r.wrap.style.flex = `0 0 ${r.height}px`; r.body.style.display = 'block'; r.splitter.style.display = 'block'; }
    }
  }

  for (const def of sections) {
    const wrap = h('div', { style: 'display:flex;flex-direction:column;min-height:0;overflow:hidden' });
    const caret = h('span', { class: 'sg-caret' });
    const header = h('div', { class: 'sg-acc-head' }, caret, h('span', { text: def.title }));
    const body = h('div', { style: 'flex:1 1 auto;min-height:0;overflow:auto' });
    const splitter = h('div', { class: 'sg-splitter sg-splitter-row', style: 'flex:0 0 5px' });

    if (def.actions) {
      const actions = h('div', { class: 'sg-acc-actions', on: { click: (e) => e.stopPropagation() } });
      def.actions(actions);
      header.append(actions);
    }

    wrap.append(header, body, splitter);
    host.appendChild(wrap);
    const row: Row = { def, wrap, caret, body, splitter, open: def.open ?? true, height: def.height ?? 200 };
    rows.push(row);

    const setCaret = () => { caret.textContent = row.open ? '▾' : '▸'; };
    setCaret();
    header.addEventListener('click', () => { row.open = !row.open; setCaret(); relayout(); });

    splitter.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startY = e.clientY, startH = row.height;
      const move = (ev: MouseEvent) => { row.height = Math.max(60, startH + (ev.clientY - startY)); relayout(); };
      const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    });

    def.build(body);
  }
  relayout();
  return {
    setOpen: (id, open) => { const r = rows.find(x => x.def.id === id); if (r && r.open !== open) { r.open = open; r.caret.textContent = open ? '▾' : '▸'; relayout(); } },
  };
}
