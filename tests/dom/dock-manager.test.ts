import { describe, it, expect, beforeEach } from 'vitest';
import { createDockManager } from '@/dev/dock-manager';

function fakePanel(id: string) {
  const element = document.createElement('div');
  let open = false;
  return { id, element, setOpen: (o: boolean) => { open = o; }, get open() { return open; } };
}
function stubBounds(el: HTMLElement, r: { left: number; top: number; right: number; bottom: number }) {
  el.getBoundingClientRect = () => ({ ...r, width: r.right - r.left, height: r.bottom - r.top, x: r.left, y: r.top, toJSON() {} }) as DOMRect;
}

describe('dock-manager', () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    stubBounds(container, { left: 0, top: 0, right: 1000, bottom: 800 });
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  it('docks left when dropped near the left edge, right near the right edge, floats in the middle', () => {
    const dm = createDockManager({ container, edgeThreshold: 32 });
    const a = fakePanel('a'), b = fakePanel('b'), c = fakePanel('c');
    dm.register(a); dm.register(b); dm.register(c);
    dm.onDragEnd('a', { left: 5, top: 100, width: 200, height: 150 });   // near left
    dm.onDragEnd('b', { left: 790, top: 100, width: 200, height: 150 }); // right edge: 990 within 32 of 1000
    dm.onDragEnd('c', { left: 400, top: 300, width: 200, height: 150 }); // middle → float
    expect(dm.getState('a').kind).toBe('left');
    expect(dm.getState('b').kind).toBe('right');
    expect(dm.getState('c')).toEqual({ kind: 'float', x: 400, y: 300 });
  });

  it('stacks two left-docked panels with increasing order and distinct tops', () => {
    const dm = createDockManager({ container });
    const a = fakePanel('a'), b = fakePanel('b');
    dm.register(a); dm.register(b);
    dm.onDragEnd('a', { left: 2, top: 100, width: 200, height: 150 });
    dm.onDragEnd('b', { left: 2, top: 100, width: 200, height: 150 });
    expect((dm.getState('a') as any).order).toBe(0);
    expect((dm.getState('b') as any).order).toBe(1);
    dm.relayout();
    expect(a.element.style.top).not.toBe(b.element.style.top);
    expect(a.element.style.left).toBe('0px');
  });

  it('persists and restores layout via localStorage', () => {
    const dm = createDockManager({ container, storageKey: 'test-layout' });
    const a = fakePanel('a'); dm.register(a);
    dm.onDragEnd('a', { left: 2, top: 100, width: 200, height: 150 }); // dock left
    // New manager + panel, same key → restore
    const dm2 = createDockManager({ container, storageKey: 'test-layout' });
    const a2 = fakePanel('a'); dm2.register(a2); dm2.restore();
    expect(dm2.getState('a').kind).toBe('left');
  });

  it('ignores an unknown persisted id on restore', () => {
    try { localStorage.setItem('k', JSON.stringify({ ghost: { dock: { kind: 'left', order: 0 }, open: true } })); } catch { /* ignore */ }
    const dm = createDockManager({ container, storageKey: 'k' });
    expect(() => dm.restore()).not.toThrow();
  });

  it('restore applies dock position but does not call setOpen (visibility stays owned by caller)', () => {
    try { localStorage.setItem('k2', JSON.stringify({ a: { dock: { kind: 'left', order: 0 }, open: true } })); } catch { /* ignore */ }
    const dm = createDockManager({ container, storageKey: 'k2' });
    const a = fakePanel('a'); dm.register(a); dm.restore();
    expect(dm.getState('a').kind).toBe('left'); // position restored
    expect(dm.isOpen('a')).toBe(true);          // open flag tracked
    expect(a.open).toBe(false);                 // but setOpen was NOT invoked → panel not shown
  });
});
