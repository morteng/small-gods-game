/**
 * Shared test harness for Small Gods e2e tests.
 * Provides page-level helpers for state inspection, sim control, and canvas checks.
 */
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/** Poll until world generation completes (map + world populated). */
export async function waitForWorld(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const g = (window as any).__game;
          return !!(g?.state?.map && g?.state?.world);
        }),
      { timeout: 30000, message: 'World should be generated' },
    )
    .toBe(true);
  await page.waitForTimeout(500);
}

/** Navigate to the game and wait for world gen. */
export async function openGame(page: Page): Promise<void> {
  await page.goto('/');
  await waitForWorld(page);
}

// ── State inspectors ──────────────────────────────────────────────────────

export async function getRate(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__game.scheduler.getRate());
}

export async function getZoom(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__game.state.camera.zoom);
}

export async function getCameraPos(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const c = (window as any).__game.state.camera;
    return { x: c.x, y: c.y };
  });
}

export async function getNpcCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = (window as any).__game.state.world;
    return (w?.query({ kind: 'npc' })?.length as number) ?? 0;
  });
}

export async function getSimTick(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__game.state.clock.now());
}

export async function getPlayerPower(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__game.state.spirits.get('player').power);
}

export async function isPaused(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as any).__game.scheduler.getRate() === 0);
}

export async function getEventCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__game.state.eventLog.size());
}

// ── Canvas health ─────────────────────────────────────────────────────────

export interface CanvasHealth {
  healthy: boolean;
  paintedOf: number;
  canvasSize: string;
}

export async function checkCanvas(page: Page): Promise<CanvasHealth> {
  return page.evaluate(() => {
    const c = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (!c) return { healthy: false, paintedOf: 0, canvasSize: 'none' };
    const ctx = c.getContext('2d');
    if (!ctx) return { healthy: false, paintedOf: 0, canvasSize: 'no-ctx' };
    let painted = 0;
    const pts = [
      [c.width / 2, c.height / 2],
      [100, 100],
      [c.width - 100, c.height - 100],
      [c.width / 4, c.height / 4],
      [(3 * c.width) / 4, (3 * c.height) / 4],
    ] as const;
    for (const [x, y] of pts) {
      const p = ctx.getImageData(x, y, 1, 1);
      if (p.data[3] > 0) painted++;
    }
    return { healthy: painted >= 4, paintedOf: pts.length, canvasSize: `${c.width}x${c.height}` };
  });
}

// ── Sim control ───────────────────────────────────────────────────────────

/** Directly tick the sim by ms (bypasses RAF, deterministic). */
export async function tickSim(page: Page, realDtMs: number): Promise<void> {
  await page.evaluate((dt) => {
    const g = (window as any).__game;
    if (!g.state.world) return;
    g.state.clock.advance(dt * g.scheduler.getRate());
    g.scheduler.tick(dt, {
      world: g.state.world,
      spirits: g.state.spirits,
      log: g.state.eventLog,
      clock: g.state.clock,
      rng: g.state.rng,
    });
    g.timeline.onAfterLiveTick();
  }, realDtMs);
}

// ── DOM helpers ───────────────────────────────────────────────────────────

export async function waitForVisible(page: Page, selector: string, timeout = 5000): Promise<boolean> {
  try {
    await page.locator(selector).waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

export async function pressKey(page: Page, key: string, delay = 200): Promise<void> {
  await page.keyboard.press(key);
  await page.waitForTimeout(delay);
}
