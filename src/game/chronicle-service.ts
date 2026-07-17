/**
 * chronicle-service.ts — M1 "the chronicler's voice".
 *
 * Runs OFF the sim tick (async, like `LlmBackfillService`/`FateBrainService`),
 * so src/sim/ stays Math.random-free and replay-safe. Produces ONE annalist
 * entry per completed game day, on the FAST/chat tier (same tier + client as
 * `LlmBackfillService` — cheapest atmosphere in the game).
 *
 * ⚠ STRICTLY READ-ONLY over the event log: this service only ever calls
 * `EventLog.range()` (a pure filter) and reads calendar/world state to build a
 * prompt. It never calls `EventLog.append`, never touches `state-writeback`,
 * never mutates the world. Its output (`ChronicleEntry.text`) is display text
 * only, surfaced via the divine inbox — see `game-query.ts`'s `chronicleLatest`
 * dep. Guard: `tests/unit/chronicle-service.test.ts` asserts the log's length
 * is unchanged after a generation cycle.
 *
 * Cadence (TRUE 1:1 REALTIME): `checkAndGenerate()` is cheap to call every
 * frame — it's an integer day-index comparison. It only does real work once a
 * full game day has elapsed since the last entry, and caps at one pending
 * generation at a time (`inFlight`). Under fast-forward (rate > 1) it narrates
 * ONLY the most recently completed day — days skipped over in between are
 * silently dropped, never batched, so a big time-skip never floods the ring or
 * spams the LLM with a backlog.
 *
 * The RING lives on `state.chronicle` (`@/core/chronicle-store`) and rides the
 * snapshot — the annals survive save/load (the boot loading screen reads them
 * while the art settles) and scrub with the timeline. The CURSOR stays
 * in-memory: on construction it anchors to "today" (the day containing the
 * current tick), so a loaded save/scrub-commit narrates forward from now
 * rather than replaying the whole history in one entry. This mirrors
 * `FateTrigger`'s own throttle state (also unpersisted, reset-on-load,
 * documented there as harmless) — cheap because there is nothing to replay:
 * the next entry simply waits for the next day boundary.
 */
import type { GameState } from '@/core/state';
import type { LLMClient } from '@/llm/llm-client';
import type { SkipSummary } from '@/sim/time-skip';
import type { EraArcDigest } from '@/sim/fate/arc-era';
import { TICKS_PER_DAY, SOLAR_START_HOUR, dayIndexForTick, formatCalendarTick } from '@/core/calendar';
import {
  buildChroniclePrompt, renderOfflineAnnal, type ChronicleWindow,
  buildEraChroniclePrompt, renderOfflineEraAnnal, type EraChronicleWindow,
} from '@/llm/chronicle-prompt-builder';
import type { ChronicleEntry } from '@/core/chronicle-store';

// Re-exported for existing consumers; the definitions moved to the store when
// the ring became snapshot state.
export { CHRONICLE_RING_CAP, type ChronicleEntry } from '@/core/chronicle-store';

export interface ChronicleServiceDeps {
  state: GameState;
  /** The FAST/chat-tier client — same tier + client `LlmBackfillService` uses.
   *  Omit or pass `null` to run the deterministic offline annal unconditionally
   *  (e.g. tests, or a deliberately LLM-less mode). */
  client?: LLMClient | null;
}

/** `(SOLAR_START_HOUR / 24) * TICKS_PER_DAY` — exact integer because
 *  `TICKS_PER_DAY` is a multiple of 24 (see `core/calendar.ts`). */
const SOLAR_OFFSET_TICKS = (SOLAR_START_HOUR / 24) * TICKS_PER_DAY;

/** Inverse of `dayIndexForTick`: the first tick of calendar day `dayIndex`. */
function dayBoundaryTick(dayIndex: number): number {
  return dayIndex * TICKS_PER_DAY - SOLAR_OFFSET_TICKS;
}

export class ChronicleService {
  private client: LLMClient | null;
  /** The last calendar day index a chronicle entry was produced for (-1 = none
   *  yet). Transient — see class doc for why this deliberately resets on load. */
  private lastChronicledDay: number;
  private inFlight = false;

  constructor(private readonly deps: ChronicleServiceDeps) {
    this.client = deps.client ?? null;
    // Anchor to "today" so a loaded save/scrub doesn't try to backfill history.
    // A restored ring may already carry today's entry — never re-narrate it.
    this.lastChronicledDay = Math.max(
      dayIndexForTick(deps.state.clock.now()) - 1,
      deps.state.chronicle?.latest()?.dayIndex ?? -1,
    );
  }

  setClient(client: LLMClient | null): void {
    this.client = client;
  }

  /** Bounded ring, oldest first (delegates to the snapshot-backed store). */
  entries(): readonly ChronicleEntry[] {
    return this.deps.state.chronicle?.entries() ?? [];
  }

  latest(): ChronicleEntry | null {
    return this.deps.state.chronicle?.latest() ?? null;
  }

  /** Cheap per-frame check (an integer comparison); only generates — async, off
   *  the sim tick — once a new day has fully completed and nothing is already
   *  in flight. Safe to call unconditionally every live frame. */
  checkAndGenerate(): Promise<void> {
    if (this.inFlight) return Promise.resolve();
    const now = this.deps.state.clock.now();
    // We're partway through the CURRENT day; the most recently FULLY completed
    // day is the one before it.
    const targetDay = dayIndexForTick(now) - 1;
    if (targetDay <= this.lastChronicledDay) return Promise.resolve();
    return this.generateFor(targetDay);
  }

  /**
   * F6 — era-authoring (the D2 skip loop's missing half). Called by the skip
   * flow right after `applySkip` + `settleArcsAcrossSkip`: authors ONE era
   * entry from the skip summary + the settled digests of the arcs that
   * spanned it. Async, off the sim tick, honest deterministic fallback when
   * no LLM is configured or the call fails — same discipline as the daily
   * annal. The sim is truth: every number in the entry comes from `summary`
   * and the digests; the LLM only words them.
   *
   * The cursor bumps SYNCHRONOUSLY (before any await) to the last completed
   * pre-arrival day, so the daily path never also narrates a mid-era day the
   * era entry already covers.
   */
  generateEra(summary: SkipSummary, arcs: EraArcDigest[]): Promise<void> {
    const eraDay = dayIndexForTick(summary.toTick) - 1;
    this.lastChronicledDay = Math.max(this.lastChronicledDay, eraDay);
    return this.generateEraEntry(summary, arcs, eraDay);
  }

  private async generateEraEntry(summary: SkipSummary, arcs: EraArcDigest[], eraDay: number): Promise<void> {
    const { state } = this.deps;
    // The POST-skip date: the annalist writes after the years have passed.
    const calendar = formatCalendarTick(summary.toTick);
    const window: EraChronicleWindow = { summary, arcs, calendar };

    let text: string;
    let offline: boolean;
    if (this.client) {
      try {
        const prompt = buildEraChroniclePrompt(window);
        const res = await this.client.generateNpcBackfill(prompt.system, prompt.user, { maxTokens: 300, temperature: 0.85 });
        text = res.content.trim();
        if (text.length === 0) throw new Error('empty era entry');   // boundary validation — never push a blank annal
        offline = false;
      } catch (err) {
        console.error('[chronicle] era generation failed; falling back to the offline era annal:', err);
        text = renderOfflineEraAnnal(window);
        offline = true;
      }
    } else {
      text = renderOfflineEraAnnal(window);
      offline = true;
    }

    state.chronicle?.push({
      dayIndex: eraDay, year: calendar.year, season: calendar.season, dayOfYear: calendar.dayOfYear,
      text, offline, era: true,
    });
  }

  private async generateFor(dayIndex: number): Promise<void> {
    this.inFlight = true;
    try {
      const { state } = this.deps;
      const tStart = dayBoundaryTick(dayIndex);
      const tEnd = dayBoundaryTick(dayIndex + 1);
      // READ-ONLY: `.range()` is a pure filter over already-appended events.
      const events = state.eventLog.range(tStart, tEnd);
      const calendar = formatCalendarTick(tStart);
      const window: ChronicleWindow = { events, calendar, world: state.world };

      let text: string;
      let offline: boolean;
      if (this.client) {
        try {
          const prompt = buildChroniclePrompt(window);
          const res = await this.client.generateNpcBackfill(prompt.system, prompt.user, { maxTokens: 220, temperature: 0.85 });
          text = res.content.trim();
          offline = false;
        } catch (err) {
          console.error('[chronicle] generation failed; falling back to the offline annal:', err);
          text = renderOfflineAnnal(window);
          offline = true;
        }
      } else {
        text = renderOfflineAnnal(window);
        offline = true;
      }

      state.chronicle?.push({
        dayIndex, year: calendar.year, season: calendar.season, dayOfYear: calendar.dayOfYear, text, offline,
      });
      // Monotonic (never lowered): a daily generation that was already in
      // flight when a skip's era entry bumped the cursor must not rewind it.
      this.lastChronicledDay = Math.max(this.lastChronicledDay, dayIndex);
    } finally {
      this.inFlight = false;
    }
  }
}
