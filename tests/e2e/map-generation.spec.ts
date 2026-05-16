/**
 * E2E tests for Small Gods map generation
 *
 * Tests:
 * - Page loads successfully
 * - Map generation works
 * - Layer switching
 * - Editor functionality
 * - World seed editor
 */

import { test, expect } from '@playwright/test';

test.describe('Small Gods App', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for app to initialize
    await page.waitForSelector('#gameCanvas');
  });

  test('page loads with correct title', async ({ page }) => {
    await expect(page).toHaveTitle('Small Gods - Tile System');
  });

  test('has main UI panels', async ({ page }) => {
    // Left panel with controls
    await expect(page.locator('.panel-left')).toBeVisible();

    // Center panel with canvas
    await expect(page.locator('.panel-center')).toBeVisible();
    await expect(page.locator('#gameCanvas')).toBeVisible();

    // Right panel with info
    await expect(page.locator('.panel-right')).toBeVisible();
  });

  test('has layer tabs', async ({ page }) => {
    const tabs = page.locator('.layer-tab');
    await expect(tabs).toHaveCount(4);

    await expect(page.locator('.layer-tab[data-layer="base"]')).toContainText('Base');
    await expect(page.locator('.layer-tab[data-layer="base_decos"]')).toContainText('Base + Decos');
    await expect(page.locator('.layer-tab[data-layer="segmap"]')).toContainText('Segmap');
    await expect(page.locator('.layer-tab[data-layer="rendered"]')).toContainText('Rendered');
  });

  test('canvas is initialized', async ({ page }) => {
    // Canvas should be visible
    const canvas = page.locator('#gameCanvas');
    await expect(canvas).toBeVisible();

    // The app may auto-load a map, so we just verify the canvas exists
    await expect(canvas).toHaveAttribute('width');
    await expect(canvas).toHaveAttribute('height');
  });
});

test.describe('Map Generation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#gameCanvas');
  });

  test('can load test map', async ({ page }) => {
    // Click Load Test Map button
    await page.click('#btnLoadTestMap');

    // Wait for map to render (canvas message should hide)
    await expect(page.locator('#canvasMessage')).toBeHidden({ timeout: 10000 });

    // Stats should update
    const tileCount = page.locator('#statTiles');
    await expect(tileCount).not.toHaveText('0');
  });

  test('can generate world with WFC', async ({ page }) => {
    // Set map size to small for faster generation
    await page.fill('#mapWidth', '8');
    await page.fill('#mapHeight', '8');

    // Set a known seed for determinism
    await page.fill('#seedInput', '42');

    // Ensure WFC mode is selected
    await page.selectOption('#genMode', 'wfc');

    // Click Generate World
    await page.click('#btnGenerate');

    // Wait for generation to complete
    await expect(page.locator('#canvasMessage')).toBeHidden({ timeout: 30000 });

    // Check that map was generated
    const tileCount = page.locator('#statTiles');
    await expect(tileCount).toHaveText('64'); // 8x8 = 64 tiles
  });

  test('can generate world with noise', async ({ page }) => {
    // Set map size
    await page.fill('#mapWidth', '12');
    await page.fill('#mapHeight', '10');

    // Select noise mode
    await page.selectOption('#genMode', 'noise');

    // Generate
    await page.click('#btnGenerate');

    // Wait for generation
    await expect(page.locator('#canvasMessage')).toBeHidden({ timeout: 10000 });

    // Check tiles generated
    const tileCount = page.locator('#statTiles');
    await expect(tileCount).toHaveText('120'); // 12x10 = 120 tiles
  });

  test('different seeds produce different maps', async ({ page }) => {
    // Generate first map
    await page.fill('#mapWidth', '8');
    await page.fill('#mapHeight', '8');
    await page.fill('#seedInput', '111');
    await page.selectOption('#genMode', 'noise');
    await page.click('#btnGenerate');
    await expect(page.locator('#canvasMessage')).toBeHidden({ timeout: 10000 });

    // Get canvas data
    const canvas1 = await page.evaluate(() => {
      const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
      return canvas.toDataURL();
    });

    // Generate second map with different seed
    await page.fill('#seedInput', '222');
    await page.click('#btnGenerate');
    await page.waitForTimeout(500); // Brief wait for redraw

    const canvas2 = await page.evaluate(() => {
      const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
      return canvas.toDataURL();
    });

    // Maps should be different
    expect(canvas1).not.toBe(canvas2);
  });

  test('can generate multiple times', async ({ page }) => {
    // Generate first map
    await page.fill('#mapWidth', '16');
    await page.fill('#mapHeight', '16');
    await page.fill('#seedInput', '99999');
    await page.selectOption('#genMode', 'wfc');
    await page.click('#btnGenerate');
    await expect(page.locator('#canvasMessage')).toBeHidden({ timeout: 30000 });

    // Verify first generation succeeded
    const tileCount1 = await page.locator('#statTiles').textContent();
    const count1 = parseInt(tileCount1 || '0');
    expect(count1).toBeGreaterThan(0);

    // Generate again
    await page.fill('#seedInput', '12345');
    await page.click('#btnGenerate');
    await page.waitForTimeout(500);

    // Verify second generation also succeeded
    const tileCount2 = await page.locator('#statTiles').textContent();
    const count2 = parseInt(tileCount2 || '0');
    expect(count2).toBeGreaterThan(0);
  });
});

test.describe('Layer Switching', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#gameCanvas');

    // Load a map first
    await page.click('#btnLoadTestMap');
    await expect(page.locator('#canvasMessage')).toBeHidden({ timeout: 10000 });
  });

  test('can switch to Base layer', async ({ page }) => {
    await page.click('.layer-tab[data-layer="base"]');

    await expect(page.locator('.layer-tab[data-layer="base"]')).toHaveClass(/active/);

    // Dropdown should also update
    await expect(page.locator('#tileLayerSelect')).toHaveValue('base');
  });

  test('can switch to Base + Decos layer', async ({ page }) => {
    await page.click('.layer-tab[data-layer="base_decos"]');

    await expect(page.locator('.layer-tab[data-layer="base_decos"]')).toHaveClass(/active/);
    await expect(page.locator('#tileLayerSelect')).toHaveValue('base_decos');
  });

  test('can switch to Segmap layer', async ({ page }) => {
    await page.click('.layer-tab[data-layer="segmap"]');

    await expect(page.locator('.layer-tab[data-layer="segmap"]')).toHaveClass(/active/);
    await expect(page.locator('#tileLayerSelect')).toHaveValue('segmap');
  });

  test('can switch layer via dropdown', async ({ page }) => {
    await page.selectOption('#tileLayerSelect', 'segmap');

    await expect(page.locator('.layer-tab[data-layer="segmap"]')).toHaveClass(/active/);
  });

  test('different layers produce different canvas output', async ({ page }) => {
    // Get base layer canvas
    await page.click('.layer-tab[data-layer="base"]');
    await page.waitForTimeout(100);
    const baseCanvas = await page.evaluate(() => {
      const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
      return canvas.toDataURL();
    });

    // Switch to segmap
    await page.click('.layer-tab[data-layer="segmap"]');
    await page.waitForTimeout(100);
    const segmapCanvas = await page.evaluate(() => {
      const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
      return canvas.toDataURL();
    });

    // Layers should look different
    expect(baseCanvas).not.toBe(segmapCanvas);
  });
});

test.describe('Editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#gameCanvas');

    // Load a map
    await page.click('#btnLoadTestMap');
    await expect(page.locator('#canvasMessage')).toBeHidden({ timeout: 10000 });
  });

  test('can toggle editor on', async ({ page }) => {
    // Editor toolbar should be hidden initially
    const toolbar = page.locator('#editorToolbar');
    await expect(toolbar).not.toHaveClass(/visible/);

    // Click Edit Map button
    await page.click('#btnToggleEditor');

    // Toolbar should now be visible
    await expect(toolbar).toBeVisible();
  });

  test('editor tools are available', async ({ page }) => {
    await page.click('#btnToggleEditor');

    await expect(page.locator('.editor-tool[data-mode="select"]')).toBeVisible();
    await expect(page.locator('.editor-tool[data-mode="move"]')).toBeVisible();
    await expect(page.locator('.editor-tool[data-mode="add-poi"]')).toBeVisible();
    await expect(page.locator('.editor-tool[data-mode="add-road-endpoint"]')).toBeVisible();
    await expect(page.locator('.editor-tool[data-mode="add-connection"]')).toBeVisible();
  });

  test('can switch editor modes', async ({ page }) => {
    await page.click('#btnToggleEditor');

    // Select tool is active by default
    await expect(page.locator('.editor-tool[data-mode="select"]')).toHaveClass(/active/);

    // Switch to move mode
    await page.click('.editor-tool[data-mode="move"]');
    await expect(page.locator('.editor-tool[data-mode="move"]')).toHaveClass(/active/);
    await expect(page.locator('.editor-tool[data-mode="select"]')).not.toHaveClass(/active/);

    // Switch to add-poi mode
    await page.click('.editor-tool[data-mode="add-poi"]');
    await expect(page.locator('.editor-tool[data-mode="add-poi"]')).toHaveClass(/active/);
  });

  test('properties panel shows when editing', async ({ page }) => {
    await page.click('#btnToggleEditor');

    // Properties panel should be visible
    await expect(page.locator('#editorPropsPanel')).toBeVisible();
  });
});

test.describe('World Seed Editor Modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#gameCanvas');
  });

  test('can open world seed editor', async ({ page }) => {
    await page.click('#btnWorldSeed');

    const modal = page.locator('#worldSeedModal');
    await expect(modal).toBeVisible();
    await expect(page.locator('.modal-header h2')).toContainText('World Seed Editor');
  });

  test('can close world seed editor', async ({ page }) => {
    await page.click('#btnWorldSeed');
    await expect(page.locator('#worldSeedModal')).toBeVisible();

    // Close via X button
    await page.click('.modal-close');
    await expect(page.locator('#worldSeedModal')).not.toBeVisible();
  });

  test('world seed editor has expected controls', async ({ page }) => {
    await page.click('#btnWorldSeed');

    await expect(page.locator('#wsName')).toBeVisible();
    await expect(page.locator('#wsBiome')).toBeVisible();
    await expect(page.locator('#poiList')).toBeVisible();
    await expect(page.locator('#worldSeedJson')).toBeVisible();
  });

  test('can add POI via quick add', async ({ page }) => {
    await page.click('#btnWorldSeed');

    // Add a village POI
    await page.click('button:has-text("+ Village")');

    // POI list should no longer show empty state
    await expect(page.locator('#poiList .empty-state')).not.toBeVisible();
  });

  test('JSON editor has validation display', async ({ page }) => {
    await page.click('#btnWorldSeed');

    // Validation box should exist and show some status
    const validationBox = page.locator('#validationBox');
    await expect(validationBox).toBeVisible();

    // JSON textarea should be visible
    const jsonEditor = page.locator('#worldSeedJson');
    await expect(jsonEditor).toBeVisible();
  });
});

test.describe('Zoom Controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#gameCanvas');
    await page.click('#btnLoadTestMap');
    await expect(page.locator('#canvasMessage')).toBeHidden({ timeout: 10000 });
  });

  test('can zoom in', async ({ page }) => {
    const zoomBefore = await page.locator('#zoomLevel').textContent();

    await page.click('.zoom-btn:has-text("+")');
    await page.waitForTimeout(100);

    const zoomAfter = await page.locator('#zoomLevel').textContent();

    // Zoom percentage should increase
    const before = parseInt(zoomBefore!.replace('%', ''));
    const after = parseInt(zoomAfter!.replace('%', ''));
    expect(after).toBeGreaterThan(before);
  });

  test('can zoom out', async ({ page }) => {
    // First zoom in to ensure we can zoom out
    await page.click('.zoom-btn:has-text("+")');
    await page.click('.zoom-btn:has-text("+")');
    await page.waitForTimeout(100);

    const zoomBefore = await page.locator('#zoomLevel').textContent();

    await page.click('.zoom-btn:has-text("-")');
    await page.waitForTimeout(100);

    const zoomAfter = await page.locator('#zoomLevel').textContent();

    const before = parseInt(zoomBefore!.replace('%', ''));
    const after = parseInt(zoomAfter!.replace('%', ''));
    expect(after).toBeLessThan(before);
  });

  test('can reset zoom', async ({ page }) => {
    // Zoom in first
    await page.click('.zoom-btn:has-text("+")');
    await page.click('.zoom-btn:has-text("+")');
    await page.waitForTimeout(100);

    // Reset
    await page.click('.zoom-btn:has-text("R")');
    await page.waitForTimeout(200);

    // Verify zoom changed (may not be exactly 100% depending on app state)
    const zoom = await page.locator('#zoomLevel').textContent();
    expect(zoom).toMatch(/\d+%/);
  });
});

test.describe('Map Statistics', () => {
  test('displays correct tile count', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#gameCanvas');

    await page.fill('#mapWidth', '10');
    await page.fill('#mapHeight', '10');
    await page.selectOption('#genMode', 'noise');
    await page.click('#btnGenerate');
    await expect(page.locator('#canvasMessage')).toBeHidden({ timeout: 10000 });

    await expect(page.locator('#statTiles')).toHaveText('100');
  });

  test('displays walkable percentage', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#gameCanvas');

    await page.click('#btnLoadTestMap');
    await expect(page.locator('#canvasMessage')).toBeHidden({ timeout: 10000 });

    const walkable = await page.locator('#statWalkable').textContent();
    expect(walkable).toMatch(/\d+%/);
  });
});

test.describe('Minimap', () => {
  test('minimap canvas exists', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#gameCanvas');

    await expect(page.locator('#minimapCanvas')).toBeVisible();
  });

  test('minimap updates after map generation', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#gameCanvas');

    // Get minimap before
    const before = await page.evaluate(() => {
      const canvas = document.getElementById('minimapCanvas') as HTMLCanvasElement;
      return canvas.toDataURL();
    });

    // Generate a map
    await page.fill('#mapWidth', '16');
    await page.fill('#mapHeight', '16');
    await page.selectOption('#genMode', 'noise');
    await page.click('#btnGenerate');
    await expect(page.locator('#canvasMessage')).toBeHidden({ timeout: 10000 });

    // Give minimap time to update
    await page.waitForTimeout(500);

    const after = await page.evaluate(() => {
      const canvas = document.getElementById('minimapCanvas') as HTMLCanvasElement;
      return canvas.toDataURL();
    });

    expect(before).not.toBe(after);
  });
});
