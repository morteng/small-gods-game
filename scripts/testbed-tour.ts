#!/usr/bin/env -S npx tsx
/**
 * testbed-tour — a scripted screenshot tour of the dev-only testbed world
 * (`?world=testbed`, `src/world/testbed/`), for HUMAN REVIEW.
 *
 * ── THIS IS NOT A PASS/FAIL SITING CHECK ───────────────────────────────────────
 * There is NO pixel-diff baseline here, deliberately (see
 * `docs/audit/TESTBED-WORLD-PLAN.md` §3.6): no diff infra exists in this repo,
 * every capture contains animated water/vegetation/NPCs so two "correct" runs are
 * never byte-identical, and a carelessly chosen tolerance is a convenient-metric
 * trap — three bridge-siting rounds shipped green against a proxy metric before the
 * real defect was found. A GREEN TOUR IS NEVER EVIDENCE THAT A SITING FIX WORKS.
 * The testbed world is authored and pinned to ONE gen seed; it cannot show
 * emergent siting defects by construction (see `testbed-world.ts`'s own header).
 * Siting fixes are accepted only against `scripts/probe-bridge-decks.ts` and
 * multi-seed `npm run lint:world` on the PLAYABLE worlds — never against this tour.
 * This script's only job is: does every station render something real, so a human
 * can look at `.dev-grabs/index.html` and judge it.
 *
 * Usage:
 *   npm run dev                      # dev server on :3000 (started for you if not up)
 *   npx tsx scripts/testbed-tour.ts
 *   URL=http://localhost:3010 npx tsx scripts/testbed-tour.ts   # point at another port
 *   HEADED=1 npx tsx scripts/testbed-tour.ts
 *
 * GOTCHA (this host): Playwright's bundled Chromium build does not support this
 * machine's macOS version ("mac12" / Monterey) — `npx playwright install chromium`
 * fails outright. This script launches via `channel: 'chrome'` (the locally
 * installed Google Chrome) instead of the bundled build. If Chrome isn't
 * installed, install it or adjust the launch channel.
 *
 * Boot handling is modelled on `scripts/e2e-smoke.mjs` (its documented lessons —
 * capture via the debug API, never `page.screenshot`, drive the camera via the
 * game's own API) with ONE change: UI v3 means a bare `/` resolves to the TITLE
 * SCREEN, not a world (`tests/e2e/utils/harness.ts:25` is stale in exactly this
 * way — do not copy it). This script always navigates to an explicit
 * `?world=testbed&solarhour=H` autostart URL.
 */
import { chromium, type Page } from 'playwright';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { PNG } from 'pngjs';
import { TESTBED_STATIONS, type TestbedStation } from '@/world/testbed/stations';
import { SPECIMEN_TAG, SPECIMEN_ROW, SPECIMEN_APRON_POI_ID } from '@/world/testbed/specimens';
import { PLAYER_SPIRIT_ID } from '@/sim/believers';

// ─── Config ─────────────────────────────────────────────────────────────────────

const URL = process.env.URL || 'http://localhost:3000';
const HEADED = process.env.HEADED === '1';
const OUT_DIR = '.dev-grabs';
/** THE ART-SETTLE RULE IS ABSOLUTE (CLAUDE.md): the loading screen — and this tour
 *  — holds until the world is FULLY displayed. No wall-clock cap on worldgen
 *  itself; this is Playwright's own outer safety net so a truly wedged boot fails
 *  loudly instead of hanging the CI/dev-loop invocation forever. Generous on
 *  purpose (measured testbed gen is ~15-25s headless; this is 10 minutes). */
const ART_SETTLE_TIMEOUT_MS = 10 * 60 * 1000;
/** Solar hour used for every station that doesn't declare its own `hour`. */
const DEFAULT_HOUR = 10;
/** Minimum bytes a real (non-blank) WebGPU capture should be. A blank/near-blank
 *  PNG compresses far smaller than this at 1280x800. */
const MIN_CAPTURE_BYTES = 20 * 1024;

interface CaptureResult {
  id: string;
  path: string;
  bytes: number;
  distinctPixels: number; // capped probe — see distinctPixelProbe
  capturedAfterSettle: boolean;
  /** True when a specimenRow station had 0 live entities and fell back to framing
   *  the bare apron (see `resolveSpecimenRowOrApronFallback`) — surfaced so the
   *  final summary states plainly which captures show empty ground. */
  emptyRow: boolean;
}

function log(msg: string): void {
  console.log(`[testbed-tour] ${msg}`);
}

// ─── PNG sanity check ───────────────────────────────────────────────────────────
//
// "Every file non-empty and non-uniform" (WP-T4 acceptance): decode the PNG and
// walk pixels until 2 DISTINCT rgba values are seen (early-exit — we only need to
// prove the frame isn't a flat grey/black rectangle, not characterise it).
function distinctPixelProbe(pngBuffer: Buffer): number {
  const png = PNG.sync.read(pngBuffer);
  const { data, width, height } = png;
  const seen = new Set<number>();
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    // Pack rgba into one int for a cheap Set key.
    const packed = (data[o] << 24) | (data[o + 1] << 16) | (data[o + 2] << 8) | data[o + 3];
    seen.add(packed);
    if (seen.size >= 2) return seen.size; // early exit — cheap "non-uniform" proof
  }
  return seen.size;
}

// ─── In-page resolution helpers ─────────────────────────────────────────────────
//
// Targets are POI ids or specimen-row names, NEVER tile coordinates (see
// `stations.ts`'s header — authored coords and final/laid-out coords are
// different spaces, the WCV 123/124 lesson). Both resolvers read the LIVE,
// post-layout world exactly the way `src/world/testbed/specimens.ts` itself does
// (`findApronPoi` for POIs; the specimen tag + row property for rows) — the same
// path, not a parallel one.

interface ResolvedTarget { x: number; y: number; count?: number }

async function resolvePoiTarget(page: Page, poiId: string): Promise<ResolvedTarget | null> {
  return page.evaluate((id) => {
    const g = (window as unknown as { __game?: { state?: { map?: { worldSeed?: { pois?: { id: string; position?: { x: number; y: number } }[] } } } } }).__game;
    const pois = g?.state?.map?.worldSeed?.pois ?? [];
    const p = pois.find((x) => x.id === id);
    if (!p?.position) return null;
    return { x: p.position.x, y: p.position.y };
  }, poiId);
}

/**
 * The live entity of `kind` OWNED BY `ofPoi`. A blueprint entity's `kind` IS its preset
 * name and a civic building records its settlement in `properties.poiId`
 * (`blueprint/entity.ts`), so `kind:'watermill'` + `poiId:'netherquay'` is exactly one
 * mill. `world.query({kind})` goes through World's own kind index — the same read path
 * the renderer uses, not a parallel scan.
 *
 * OWNERSHIP, NOT PROXIMITY. Resolving "the nearest watermill" instead returned a
 * DIFFERENT settlement's mill (Greyward's, 5.0 tiles from the Netherquay POI, against
 * Netherquay's own at 7.1) — a plausible capture of the wrong building, which is the
 * exact failure mode this target type exists to remove.
 */
async function resolveEntityKindTarget(
  page: Page, kind: string, ofPoi: string,
): Promise<ResolvedTarget | null> {
  return page.evaluate(({ kind, ofPoi }) => {
    type Ent = { x: number; y: number; properties?: Record<string, unknown> };
    const g = (window as unknown as { __game?: { state?: { world?: { query: (o: { kind: string }) => Ent[] } } } }).__game;
    const owned = (g?.state?.world?.query({ kind }) ?? []).filter((e) => e.properties?.poiId === ofPoi);
    if (owned.length === 0) return null;
    return { x: owned[0].x, y: owned[0].y, count: owned.length };
  }, { kind, ofPoi });
}

async function resolveSpecimenRowTarget(
  page: Page, row: string, tag: string, rowKey: string,
): Promise<ResolvedTarget | null> {
  return page.evaluate(({ row, tag, rowKey }) => {
    type Ent = { x: number; y: number; properties?: Record<string, unknown> };
    const g = (window as unknown as { __game?: { state?: { world?: { query: (o: { tag: string }) => Ent[] } } } }).__game;
    const w = g?.state?.world;
    if (!w) return null;
    const ents = w.query({ tag }).filter((e) => e.properties?.[rowKey] === row);
    if (ents.length === 0) return null;
    let sx = 0, sy = 0;
    for (const e of ents) { sx += e.x; sy += e.y; }
    return { x: sx / ents.length, y: sy / ents.length, count: ents.length };
  }, { row, tag, rowKey });
}

/**
 * KNOWN, DOCUMENTED GAP (not this slice's to fix): `testbed-world.ts`'s own
 * "SPECIMEN CAPACITY" note and the WP-T4 brief both say the apron is currently too
 * small for the full 119-id catalogue (measured 82/119 placed; the shortfall is
 * WP-T2's densification work, in flight concurrently with this slice). Rows late
 * in the flow-layout order (`barrierPresets`, `barrierKinds`, `stairs`) can come up
 * with ZERO placed entities on a given run once the apron fills. A station whose
 * row is empty must still capture something honest — the reserved, currently-empty
 * apron ground — rather than crash the whole tour. Falls back to the
 * `specimen_apron` POI's own (live, laid-out) position, same resolution path as
 * every other POI target.
 */
async function resolveSpecimenRowOrApronFallback(
  page: Page, row: string, tag: string, rowKey: string, apronPoiId: string,
): Promise<{ target: ResolvedTarget; emptyRow: boolean } | null> {
  const hit = await resolveSpecimenRowTarget(page, row, tag, rowKey);
  if (hit) return { target: hit, emptyRow: false };
  const apron = await resolvePoiTarget(page, apronPoiId);
  return apron ? { target: apron, emptyRow: true } : null;
}

async function resolveTarget(
  page: Page, station: TestbedStation,
): Promise<{ target: ResolvedTarget; emptyRow: boolean } | null> {
  if ('poi' in station.target) {
    const t = await resolvePoiTarget(page, station.target.poi);
    return t ? { target: t, emptyRow: false } : null;
  }
  if ('entityKind' in station.target) {
    // NO FALLBACK, deliberately: an entity-kind station names a specific in-situ
    // context (a mill on its millrace). If the world stopped producing one, framing
    // some nearby POI instead would hand back a plausible-looking capture of the
    // wrong thing — which is exactly how the mill went unphotographed for a round.
    // Better to fail the tour by name.
    const t = await resolveEntityKindTarget(page, station.target.entityKind, station.target.ofPoi);
    return t ? { target: t, emptyRow: false } : null;
  }
  return resolveSpecimenRowOrApronFallback(
    page, station.target.specimenRow, SPECIMEN_TAG, SPECIMEN_ROW, SPECIMEN_APRON_POI_ID,
  );
}

// ─── Boot / navigate ─────────────────────────────────────────────────────────────

async function bootTestbedAt(page: Page, hour: number): Promise<void> {
  const url = `${URL}/?world=testbed&solarhour=${hour}`;
  log(`navigating → ${url}`);
  await page.goto(url, { waitUntil: 'load' });

  // THE ART-SETTLE RULE: wait for the real "fully displayed" signal, no earlier.
  // `performance.mark('sg-boot:art-settled')` fires once `holdLoadingUntilArtSettled`
  // resolves (`src/game/boot-sequence.ts:189-193`) — see CLAUDE.md.
  await page.waitForFunction(
    () => performance.getEntriesByName('sg-boot:art-settled').length > 0,
    undefined,
    { timeout: ART_SETTLE_TIMEOUT_MS, polling: 250 },
  );
  log('art-settled — world fully displayed');

  // Sim rate 0 through the REAL command path — the same meta verb the pause menu
  // uses (`set_time_rate`, `tier:'meta'`, `src/sim/command/registry.ts:460-461`),
  // routed via the public `GameBus` the game itself is driven through
  // (`window.__bus`, `src/dev/expose.ts`). Never poke `TimeController`/scheduler
  // internals directly.
  await page.evaluate((playerId) => {
    (window as unknown as { __bus: { emit: (c: unknown) => void } }).__bus.emit({
      verb: 'set_time_rate', source: playerId, target: { kind: 'none' }, params: { rate: 0 },
    });
  }, PLAYER_SPIRIT_ID);

  // Verify the pause actually took, through the SAME public facade (`GameBus.query`
  // is a public field, unlike `Game`'s private `query` — this is not reaching past
  // an internal boundary, it's the bus's own read side).
  const rate = await page.evaluate(
    () => (window as unknown as { __bus: { query: { timeline: () => { rate: number } } } })
      .__bus.query.timeline().rate,
  );
  if (rate !== 0) throw new Error(`set_time_rate(0) did not take — live rate reads ${rate}`);
  log('sim rate confirmed 0 (paused)');
}

// ─── Frame + capture one station ─────────────────────────────────────────────────

async function captureStation(
  page: Page, station: TestbedStation, settledAtMs: number,
): Promise<CaptureResult> {
  const resolved = await resolveTarget(page, station);
  if (!resolved) {
    const t = station.target;
    const what = 'poi' in t ? `poi '${t.poi}'`
      : 'entityKind' in t ? `the '${t.entityKind}' entity owned by poi '${t.ofPoi}' (the world produced none)`
        : `specimenRow '${t.specimenRow}'`;
    throw new Error(`station '${station.id}': could not resolve ${what} in the live world`);
  }
  const { target, emptyRow } = resolved;
  if (emptyRow) {
    log(`  NOTE station '${station.id}': row has 0 live specimens right now (known WP-T2 apron-capacity gap) — framing the reserved apron ground instead`);
  }

  const zoom = station.zoom ?? 1;
  const before = await page.evaluate(() => {
    const c = (window as unknown as { __game: { state: { camera: { x: number; y: number; zoom: number } } } }).__game.state.camera;
    return { x: c.x, y: c.y, zoom: c.zoom };
  });

  // The instant camera path (`__debug.focusXY`), NOT `Game.flyTo` — flyTo is
  // frozen while the game is paused (CLAUDE.md gotcha), and we just paused it.
  // `focusXY` routes through `focusCameraOnTile` → the iso `worldToScreen`
  // projection, so it self-handles the "camera pans in iso-screen space" gotcha.
  await page.evaluate(
    ({ x, y, zoom }) => (window as unknown as { __debug: { focusXY: (x: number, y: number, z: number) => void } })
      .__debug.focusXY(x, y, zoom),
    { x: target.x, y: target.y, zoom },
  );

  const after = await page.evaluate(() => {
    const c = (window as unknown as { __game: { state: { camera: { x: number; y: number; zoom: number } } } }).__game.state.camera;
    return { x: c.x, y: c.y, zoom: c.zoom };
  });
  if (!Number.isFinite(after.x) || !Number.isFinite(after.y) || !Number.isFinite(after.zoom)) {
    throw new Error(`station '${station.id}': camera went non-finite after focusXY (${JSON.stringify(after)})`);
  }
  if (Math.abs(after.zoom - zoom) > 1e-6) {
    throw new Error(`station '${station.id}': requested zoom ${zoom}, camera reads ${after.zoom} — focusXY did not apply`);
  }
  const moved = after.x !== before.x || after.y !== before.y || after.zoom !== before.zoom;
  if (!moved) {
    log(`  WARNING station '${station.id}': camera position unchanged by focusXY (target may equal current view)`);
  }

  // Settle: two rAFs (guarantee at least one real re-render past the camera move)
  // plus a short wall-clock pad — headless Chrome's frame submission can lag a
  // rAF callback firing.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.waitForTimeout(300);

  const captureAtMs = await page.evaluate(() => performance.now());
  const name = `testbed-${station.id}`;
  const path = await page.evaluate(
    (n) => (window as unknown as { __debug: { grabFile: (n: string) => Promise<string> } }).__debug.grabFile(n),
    name,
  );

  const buf = readFileSync(path);
  const bytes = statSync(path).size;
  const distinctPixels = distinctPixelProbe(buf);

  return {
    id: station.id, path, bytes, distinctPixels,
    capturedAfterSettle: captureAtMs >= settledAtMs, emptyRow,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ channel: 'chrome', headless: !HEADED });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => console.error('[testbed-tour] PAGE ERROR:', e.message));

  // Group stations by their solar hour (default DEFAULT_HOUR), preserving each
  // group's relative station order, so each distinct hour needs exactly one
  // navigation + one art-settle wait.
  const byHour = new Map<number, TestbedStation[]>();
  for (const s of TESTBED_STATIONS) {
    const h = s.hour ?? DEFAULT_HOUR;
    (byHour.get(h) ?? byHour.set(h, []).get(h)!).push(s);
  }

  const results: CaptureResult[] = [];
  try {
    for (const [hour, stations] of byHour) {
      await bootTestbedAt(page, hour);
      const settledAtMs = await page.evaluate(
        () => performance.getEntriesByName('sg-boot:art-settled')[0]?.startTime ?? 0,
      );
      for (const station of stations) {
        log(`station '${station.id}' (hour ${hour})…`);
        const r = await captureStation(page, station, settledAtMs);
        log(`  → ${r.path} (${(r.bytes / 1024).toFixed(1)} KB, ${r.distinctPixels >= 2 ? 'non-uniform' : 'UNIFORM'})`);
        results.push(r);
      }
    }
  } finally {
    await browser.close();
  }

  // ── Acceptance checks — fail loudly, never write a silently-broken set. ──────
  const problems: string[] = [];
  if (results.length !== TESTBED_STATIONS.length) {
    problems.push(`captured ${results.length} stations, expected ${TESTBED_STATIONS.length}`);
  }
  for (const r of results) {
    if (r.bytes <= MIN_CAPTURE_BYTES) problems.push(`'${r.id}': ${r.bytes} bytes ≤ ${MIN_CAPTURE_BYTES} minimum`);
    if (r.distinctPixels < 2) problems.push(`'${r.id}': uniform image (only ${r.distinctPixels} distinct pixel value)`);
    if (!r.capturedAfterSettle) problems.push(`'${r.id}': captured before the art-settled mark`);
  }
  const ids = new Set(results.map((r) => r.id));
  for (const s of TESTBED_STATIONS) if (!ids.has(s.id)) problems.push(`station '${s.id}' never captured`);

  const emptyRows = results.filter((r) => r.emptyRow).map((r) => r.id);
  if (problems.length > 0) {
    console.error(`[testbed-tour] FAILED — ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
  } else {
    log(`all ${results.length} stations captured, non-empty, non-uniform, post-settle. Reminder: this is presence + human review only — it is never evidence a siting fix works.`);
    if (emptyRows.length > 0) {
      log(`NOTE: ${emptyRows.length} specimen-row station(s) framed bare apron ground (0 live specimens for that row right now — known WP-T2 apron-capacity gap, not a tour bug): ${emptyRows.join(', ')}`);
    }
  }

  // Build the gallery index so `.dev-grabs/index.html` shows the set.
  execFileSync('npx', ['tsx', 'scripts/dev-gallery.ts'], { stdio: 'inherit' });
}

main().catch((err) => {
  console.error('[testbed-tour] FATAL:', err);
  process.exitCode = 1;
});
