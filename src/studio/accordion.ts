// src/studio/accordion.ts
// Collapsible / vertically-resizable accordion (left-pane stack). Moved out of
// studio.ts (pure refactor).

// ── collapsible / vertically-resizable accordion (left-pane stack) ───────────
interface AccordionSection {
  id: string;
  title: string;
  open?: boolean;       // initial fold state
  height?: number;      // initial px height when open (the last open section is elastic)
  build: (body: HTMLElement) => void;   // populate the body ONCE
}
interface AccordionHandle { setOpen: (id: string, open: boolean) => void }
export function buildAccordion(host: HTMLElement, sections: AccordionSection[]): AccordionHandle {
  host.style.cssText += ';display:flex;flex-direction:column;overflow:hidden';
  interface Row { def: AccordionSection; wrap: HTMLElement; header: HTMLElement; body: HTMLElement; splitter: HTMLElement; open: boolean; height: number }
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
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;min-height:0;overflow:hidden;border-bottom:1px solid #2a2a3a';
    const header = document.createElement('div');
    header.style.cssText = 'flex:0 0 auto;cursor:pointer;user-select:none;padding:6px 10px;background:rgba(20,20,32,0.9);color:#ffd35a;font:bold 11px monospace;display:flex;align-items:center;gap:6px';
    const body = document.createElement('div');
    body.style.cssText = 'flex:1 1 auto;min-height:0;overflow:auto';
    const splitter = document.createElement('div');
    splitter.style.cssText = 'flex:0 0 5px;background:#2a2a3a;cursor:row-resize';
    wrap.append(header, body, splitter);
    host.appendChild(wrap);
    const row: Row = { def, wrap, header, body, splitter, open: def.open ?? true, height: def.height ?? 200 };
    rows.push(row);

    const caret = () => (row.open ? '▾' : '▸');
    const setLabel = () => { header.textContent = `${caret()} ${def.title}`; };
    setLabel();
    header.addEventListener('click', () => { row.open = !row.open; setLabel(); relayout(); });

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
    setOpen: (id, open) => { const r = rows.find(x => x.def.id === id); if (r && r.open !== open) { r.open = open; r.header.dispatchEvent(new Event('click')); } },
  };
}
