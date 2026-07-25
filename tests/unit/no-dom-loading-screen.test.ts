import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * ONE progress surface, and the Shell owns it.
 *
 * The DOM loading overlay (`src/ui/loading-screen.ts`) was mounted
 * UNCONDITIONALLY in `GameUi`'s constructor — an opaque `inset:0; z-index:100`
 * div. Once the WebGPU shell became the progress surface, nothing hid the DOM one
 * in shell mode, so it sat over the title screen forever: every player saw a stuck
 * "Small Gods / LOADING…" splash and the real title was only visible after
 * `display:none`-ing `.sg-loading` by hand. Caught in a live GPU pass, not by any
 * test — which is exactly why these are source-level assertions.
 *
 * A jsdom "construct a Game and assert no .sg-loading" test cannot cover this
 * (Game needs WebGPU), so this reads the source instead: the module must not
 * exist, nothing may import it, and nothing may inject its stylesheet or class.
 */

const SRC = resolve(__dirname, '../../src');

function readAllSources(): Array<{ file: string; text: string }> {
  // Small, dependency-free recursive walk — the repo has no glob helper in tests.
  const out: Array<{ file: string; text: string }> = [];
  const walk = (dir: string): void => {
    for (const entry of require('node:fs').readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|js)$/.test(entry.name)) out.push({ file: full, text: readFileSync(full, 'utf8') });
    }
  };
  walk(SRC);
  return out;
}

/** Strip line + block comments so a comment MENTIONING the old module (there are
 *  several, deliberately, explaining why it is gone) is not read as a use. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('the DOM loading overlay is gone', () => {
  it('src/ui/loading-screen.ts no longer exists', () => {
    expect(existsSync(resolve(SRC, 'ui/loading-screen.ts'))).toBe(false);
  });

  it('nothing imports it', () => {
    const offenders = readAllSources()
      .filter(({ text }) => /from\s+['"][^'"]*ui\/loading-screen['"]/.test(stripComments(text)))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('nothing creates a second progress overlay (no .sg-loading class or style id)', () => {
    // The old overlay was identified by the `sg-loading` class and its
    // `sg-loading-styles` <style> id. Any reappearance means a second progress
    // surface is being mounted over the shell's.
    const offenders = readAllSources()
      .filter(({ text }) => /sg-loading/.test(stripComments(text)))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('GameUi exposes no loadingScreen handle', () => {
    // The Game must have exactly one place to report progress. A `loadingScreen`
    // field on GameUi would be a second one.
    const text = readFileSync(resolve(SRC, 'game/game-ui.ts'), 'utf8');
    expect(stripComments(text)).not.toMatch(/loadingScreen/);
  });

  it('boot progress is typed against the shell surface, not a DOM handle', () => {
    const text = stripComments(readFileSync(resolve(SRC, 'game/boot-sequence.ts'), 'utf8'));
    expect(text).toMatch(/loading:\s*LoadingSurface/);
    expect(text).not.toMatch(/LoadingScreenHandle/);
  });
});
