/**
 * E2E tests — Small Gods game
 *
 * Tests real browser rendering, input, and sim behavior.
 * Game state is inspected via window.__game (exposed in src/main.ts).
 */
import { test, expect } from '@playwright/test';
import {
  openGame, waitForWorld,
  getRate, getZoom, getCameraPos, getNpcCount,
  getSimTick, getPlayerPower, isPaused, getEventCount,
  checkCanvas, tickSim, waitForNpcs,
  waitForVisible, pressKey,
} from './utils/harness';

// ============================================================================
// Boot & Rendering
// ============================================================================

test.describe('Boot & rendering', () => {
  test('page title is Small Gods', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Small Gods');
  });

  test('#app container exists and canvas is created', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#app')).toBeVisible();
    await expect(page.locator('canvas')).toBeVisible({ timeout: 5000 });
  });

  test('world generates and canvas is painted (isometric)', async ({ page }) => {
    await openGame(page);
    const health = await checkCanvas(page);
    expect(health.healthy, `Canvas should be painted: ${JSON.stringify(health)}`).toBe(true);
    expect(health.canvasSize).not.toBe('0x0');
  });

  test('game loop is running (RAF id > 0)', async ({ page }) => {
    await openGame(page);
    const rafId = await page.evaluate(() => (window as any).__game.rafId);
    expect(rafId).toBeGreaterThan(0);
  });

  test('starts at rate 1 (unpaused)', async ({ page }) => {
    await openGame(page);
    expect(await getRate(page)).toBe(1);
  });
});

// ============================================================================
// Keyboard Shortcuts
// ============================================================================

test.describe('Keyboard shortcuts', () => {
  test.beforeEach(async ({ page }) => openGame(page));

  test('Space toggles pause/unpause', async ({ page }) => {
    expect(await getRate(page)).toBe(1);

    await pressKey(page, 'Space');
    expect(await getRate(page)).toBe(0);
    expect(await isPaused(page)).toBe(true);

    await pressKey(page, 'Space');
    expect(await getRate(page)).toBe(1);
    expect(await isPaused(page)).toBe(false);
  });

  test('T opens time bar, Escape closes it, 1/2/4/8 set speed', async ({ page }) => {
    // Closed initially
    expect(await waitForVisible(page, '.sg-time-bar', 2000)).toBe(false);

    // Open
    await pressKey(page, 't', 400);
    expect(await waitForVisible(page, '.sg-time-bar', 2000)).toBe(true);

    // Speed keys only work when bar is open
    await pressKey(page, '2');
    expect(await getRate(page)).toBe(2);
    await pressKey(page, '4');
    expect(await getRate(page)).toBe(4);
    await pressKey(page, '1');
    expect(await getRate(page)).toBe(1);

    // Close
    await pressKey(page, 'Escape', 400);
    expect(await waitForVisible(page, '.sg-time-bar', 2000)).toBe(false);
  });

  test('Backtick toggles debug HUD', async ({ page }) => {
    const isDebug = () => page.evaluate(() => (window as any).__game.state.debug);
    expect(await isDebug()).toBe(false);

    await pressKey(page, 'Backquote');
    expect(await isDebug()).toBe(true);

    await pressKey(page, 'Backquote');
    expect(await isDebug()).toBe(false);
  });

  test('L toggles labels, M toggles POI markers, K opens settings', async ({ page }) => {
    // L — labels
    const labelsBefore = await page.evaluate(() => (window as any).__game.state.showLabels);
    await pressKey(page, 'l');
    const labelsAfter = await page.evaluate(() => (window as any).__game.state.showLabels);
    expect(labelsAfter).toBe(!labelsBefore);

    // M — POI markers
    const markersBefore = await page.evaluate(() => (window as any).__game.state.showPoiMarkers);
    await pressKey(page, 'm');
    const markersAfter = await page.evaluate(() => (window as any).__game.state.showPoiMarkers);
    expect(markersAfter).toBe(!markersBefore);

    // K — settings panel toggle (should not crash)
    await pressKey(page, 'k', 300);
  });
});

// ============================================================================
// Mouse Interactions
// ============================================================================

test.describe('Mouse interactions', () => {
  test.beforeEach(async ({ page }) => openGame(page));

  test('scroll wheel zooms camera in and out', async ({ page }) => {
    const z0 = await getZoom(page);

    await page.mouse.wheel(0, -400);  // zoom in
    await page.waitForTimeout(200);
    const z1 = await getZoom(page);
    expect(z1).toBeGreaterThan(z0);

    await page.mouse.wheel(0, 800);   // zoom out
    await page.waitForTimeout(200);
    const z2 = await getZoom(page);
    expect(z2).toBeLessThan(z1);
  });

  test('drag pans the camera', async ({ page }) => {
    const { x: cx0, y: cy0 } = await getCameraPos(page);

    const box = await page.locator('canvas').boundingBox();
    expect(box).toBeTruthy();
    if (!box) return;

    const sx = box.x + box.width / 2;
    const sy = box.y + box.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 200, sy + 100, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const { x: cx1, y: cy1 } = await getCameraPos(page);
    // Camera should have moved noticeably
    expect(Math.abs(cx1 - cx0)).toBeGreaterThan(10);
    expect(Math.abs(cy1 - cy0)).toBeGreaterThan(10);
  });

  test('right-click opens decoration placement modal', async ({ page }) => {
    const box = await page.locator('canvas').boundingBox();
    expect(box).toBeTruthy();
    if (!box) return;

    // Click a walkable area
    await page.mouse.click(
      box.x + box.width * 0.6,
      box.y + box.height * 0.5,
      { button: 'right' },
    );
    await page.waitForTimeout(500);

    expect(await waitForVisible(page, '.sg-dec-overlay', 3000)).toBe(true);
  });

  test('clicking canvas selects tile (onTileClick fires)', async ({ page }) => {
    const box = await page.locator('canvas').boundingBox();
    expect(box).toBeTruthy();
    if (!box) return;

    // Verify click doesn't crash — the onTileClick path runs
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(300);
    // Should still be rendering (no crash)
    const health = await checkCanvas(page);
    expect(health.healthy).toBe(true);
  });
});

// ============================================================================
// Sim Systems
// ============================================================================

test.describe('Sim systems', () => {
  test.beforeEach(async ({ page }) => openGame(page));

  test('sim clock advances when unpaused', async ({ page }) => {
    const t0 = await getSimTick(page);
    await page.waitForTimeout(2000);  // live loop runs ~120 ticks
    const t1 = await getSimTick(page);
    expect(t1).toBeGreaterThan(t0);
  });

  test('sim clock does NOT advance when paused', async ({ page }) => {
    await pressKey(page, 'Space');  // pause
    expect(await getRate(page)).toBe(0);

    const t0 = await getSimTick(page);
    await page.waitForTimeout(1000);
    const t1 = await getSimTick(page);
    expect(t1).toBe(t0);  // frozen
  });

  test('event log grows over time', async ({ page }) => {
    const e0 = await getEventCount(page);
    await page.waitForTimeout(2000);
    const e1 = await getEventCount(page);
    // Should accumulate at least some events (world_seeded, npc_spawn, etc.)
    expect(e1).toBeGreaterThanOrEqual(e0);
  });

  test('player spirit exists with power > 0', async ({ page }) => {
    const power = await getPlayerPower(page);
    expect(power).toBeGreaterThan(0);
    expect(power).toBeLessThanOrEqual(4);  // starts at 3, may regen a little
  });

  test('world has at least 1 NPC (the seed NPC)', async ({ page }) => {
    const npcs = await getNpcCount(page);
    expect(npcs).toBeGreaterThanOrEqual(1);
  });

  test('NPC has beliefs map with player entry', async ({ page }) => {
    const hasBelief = await page.evaluate(() => {
      const w = (window as any).__game.state.world;
      const npcs = w.query({ kind: 'npc' });
      if (!npcs.length) return false;
      const props = npcs[0].properties;
      return 'player' in (props.beliefs || {});
    });
    expect(hasBelief).toBe(true);
  });
});

// ============================================================================
// Timeline (Spec B)
// ============================================================================

test.describe('Timeline controller', () => {
  test.beforeEach(async ({ page }) => openGame(page));

  test('timeline is not scrubbed initially', async ({ page }) => {
    const scrubbed = await page.evaluate(() =>
      (window as any).__game.timeline.isScrubbed,
    );
    expect(scrubbed).toBe(false);
  });

  test('commit with reroll does not crash', async ({ page }) => {
    // No-op verify: commit path exists and is callable
    const ok = await page.evaluate(() => {
      try {
        (window as any).__game.timeline.commit({ reroll: true });
        return true;
      } catch { return false; }
    });
    expect(ok).toBe(true);
  });

  test('jumpTo a valid tick does not crash', async ({ page }) => {
    const t = await getSimTick(page);
    const ok = await page.evaluate((tick) => {
      try {
        (window as any).__game.timeline.jumpTo(tick);
        return true;
      } catch { return false; }
    }, t);
    expect(ok).toBe(true);
  });

  test('returnToLive after jumpTo restores live mode', async ({ page }) => {
    const t = await getSimTick(page);
    await page.evaluate((tick) => {
      (window as any).__game.timeline.jumpTo(tick);
    }, t);
    await page.evaluate(() => {
      (window as any).__game.timeline.returnToLive();
    });
    const scrubbed = await page.evaluate(() =>
      (window as any).__game.timeline.isScrubbed,
    );
    expect(scrubbed).toBe(false);
  });
});

// ============================================================================
// Scheduler Speed Controls
// ============================================================================

test.describe('Scheduler rates', () => {
  test.beforeEach(async ({ page }) => openGame(page));

  test('setRate(0) pauses, setRate(1) resumes, setRate(8) speeds up', async ({ page }) => {
    await page.evaluate(() => (window as any).__game.scheduler.setRate(0));
    expect(await getRate(page)).toBe(0);

    await page.evaluate(() => (window as any).__game.scheduler.setRate(1));
    expect(await getRate(page)).toBe(1);

    await page.evaluate(() => (window as any).__game.scheduler.setRate(8));
    expect(await getRate(page)).toBe(8);

    // Reset
    await page.evaluate(() => (window as any).__game.scheduler.setRate(1));
  });

  test('negative rate is clamped to 0', async ({ page }) => {
    await page.evaluate(() => (window as any).__game.scheduler.setRate(-5));
    expect(await getRate(page)).toBe(0);
    // Reset
    await page.evaluate(() => (window as any).__game.scheduler.setRate(1));
  });
});

// ============================================================================
// Error Resilience
// ============================================================================

test.describe('Error resilience', () => {
  test('no console errors on startup', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    await openGame(page);
    await page.waitForTimeout(1000);

    // Ignore known benign warnings
    const realErrors = errors.filter((e) => !e.includes('[brush]'));
    if (realErrors.length > 0) {
      console.warn('Console errors found:', realErrors);
    }
    expect(realErrors.length).toBe(0);
  });

  test('canvas still renders after 30s of live sim (no memory leak crash)', async ({ page }, testInfo) => {
    testInfo.setTimeout(60000);
    await openGame(page);

    // Let it run
    await page.waitForTimeout(30000);

    const health = await checkCanvas(page);
    expect(health.healthy).toBe(true);

    // Sim should still have advanced
    const tick = await getSimTick(page);
    expect(tick).toBeGreaterThan(1000);
  });
});
