import { describe, it, expect, beforeEach } from 'vitest';
import { injectDevStyles } from '@/dev/dev-styles';
import { createFloatingPanel } from '@/dev/FloatingPanel';
import { createFloatingPanel as cfp2 } from '@/dev/FloatingPanel';

describe('injectDevStyles', () => {
  beforeEach(() => { document.head.querySelectorAll('#sg-dev-styles').forEach(n => n.remove()); });

  it('injects a single <style id="sg-dev-styles"> and is idempotent', () => {
    injectDevStyles();
    injectDevStyles();
    const styles = document.head.querySelectorAll('#sg-dev-styles');
    expect(styles.length).toBe(1);
    expect(styles[0].textContent).toContain('.sg-dev-panel');
    expect(styles[0].textContent).toContain('.sg-dev-tree-node');
  });

  it('includes toolbar + dock classes', () => {
    injectDevStyles();
    const css = document.getElementById('sg-dev-styles')?.textContent ?? '';
    expect(css).toContain('.sg-dev-toolbar');
    expect(css).toContain('.sg-dev-toolbar__btn');
    expect(css).toContain('.sg-dev-rail-hint');
  });
});

describe('createFloatingPanel', () => {
  let container: HTMLElement;
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); });

  it('mounts hidden, with the dev panel class and default z-index 600', () => {
    const p = createFloatingPanel({ container, title: 'Test' });
    expect(p.element.classList.contains('sg-dev-panel')).toBe(true);
    expect(p.element.style.zIndex).toBe('600');
    expect(p.isVisible()).toBe(false);
    expect(p.element.style.display).toBe('none');
  });

  it('show/hide/toggle work and body is a child element', () => {
    const p = createFloatingPanel({ container, title: 'Test' });
    expect(p.body).toBeInstanceOf(HTMLElement);
    expect(p.element.contains(p.body)).toBe(true);
    p.show(); expect(p.isVisible()).toBe(true);
    p.hide(); expect(p.isVisible()).toBe(false);
    p.toggle(); expect(p.isVisible()).toBe(true);
  });

  it('setTitle updates the chrome title text', () => {
    const p = createFloatingPanel({ container, title: 'Before' });
    p.setTitle('After');
    expect(p.element.textContent).toContain('After');
  });

  it('destroy removes the panel from the container', () => {
    const p = createFloatingPanel({ container, title: 'Test' });
    p.destroy();
    expect(container.contains(p.element)).toBe(false);
  });
});

describe('FloatingPanel dock integration', () => {
  it('registers with the dock manager and notes open/close', () => {
    const container = document.createElement('div'); document.body.appendChild(container);
    const calls: string[] = [];
    const dock = {
      register: (p: any) => calls.push(`register:${p.id}`),
      onDragEnd: (id: string) => calls.push(`drag:${id}`),
      noteOpen: (id: string, open: boolean) => calls.push(`open:${id}:${open}`),
      getState: () => ({ kind: 'float', x: 0, y: 0 }), restore() {}, relayout() {}, destroy() {},
    } as any;
    const p = cfp2({ container, title: 'T', id: 'panel-x', dock });
    expect(calls).toContain('register:panel-x');
    p.show(); p.hide();
    expect(calls).toContain('open:panel-x:true');
    expect(calls).toContain('open:panel-x:false');
  });
});
