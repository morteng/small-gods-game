// src/assetgen/headless/massing-renderer.ts
/**
 * Render building guide images by driving the installed Chrome headlessly via
 * puppeteer-core. esbuild bundles render-page-entry.ts (browser side); we inject
 * it into a page, then call window.renderMassing per descriptor. Offline-only —
 * imported solely by scripts/render-guides.ts and this module's test, NEVER by
 * game code. No native build, no Chromium download.
 */
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { BuildingDescriptor } from '@/world/building-descriptor';
import { buildingBrief } from '@/assetgen/producers/building-producer';
import { VIEW_RECIPES } from '@/assetgen/view-registry';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', '..'); // src/

export interface GuideOutput { color: Buffer; depth: Buffer; width: number; height: number; }

/** Installed-Chrome path: env override, else the macOS default. */
export function resolveChromePath(): string {
  return process.env.PUPPETEER_EXECUTABLE_PATH
    || process.env.CHROME_PATH
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
}

async function bundlePage(): Promise<string> {
  const res = await build({
    entryPoints: [join(HERE, 'render-page-entry.ts')],
    bundle: true, format: 'iife', write: false, platform: 'browser',
    alias: { '@': SRC }, // mirror Vite's @/ → src
  });
  return res.outputFiles[0].text;
}

function dataUrlToBuffer(u: string): Buffer {
  return Buffer.from(u.replace(/^data:image\/png;base64,/, ''), 'base64');
}

export interface GuideRenderer {
  render(d: BuildingDescriptor): Promise<GuideOutput>;
  close(): Promise<void>;
}

/** Launch Chrome once and reuse the page across many renders (batch-friendly). */
export async function createGuideRenderer(): Promise<GuideRenderer> {
  const bundle = await bundlePage();
  const browser = await puppeteer.launch({ executablePath: resolveChromePath(), headless: true });
  // If page setup throws after launch, close the browser so we never leak a Chrome process.
  let page: Awaited<ReturnType<typeof browser.newPage>>;
  try {
    page = await browser.newPage();
    await page.setContent('<canvas id="c"></canvas>');
    await page.addScriptTag({ content: bundle });
  } catch (err) {
    await browser.close();
    throw err;
  }
  return {
    async render(d) {
      const brief = buildingBrief(d, 0);
      const { width, height } = VIEW_RECIPES['iso-3q'].nativeSize(brief);
      const out = await page.evaluate(
        (dd, w, h) => window.renderMassing(dd as BuildingDescriptor, w as number, h as number),
        d, width, height,
      ) as { color: string; depth: string };
      return { color: dataUrlToBuffer(out.color), depth: dataUrlToBuffer(out.depth), width, height };
    },
    async close() { await browser.close(); },
  };
}

/** One-shot convenience: launch, render one descriptor, close. */
export async function renderGuide(d: BuildingDescriptor): Promise<GuideOutput> {
  const r = await createGuideRenderer();
  try { return await r.render(d); } finally { await r.close(); }
}
