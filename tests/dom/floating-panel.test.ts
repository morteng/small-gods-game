import { describe, it, expect, beforeEach } from 'vitest';
import { injectDevStyles } from '@/dev/dev-styles';

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
});
