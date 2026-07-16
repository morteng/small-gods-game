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
 * Cursor/ring are in-memory only — NOT part of `GameState` / the snapshot
 * `SystemStateRegistry`. On construction the cursor anchors to "today" (the
 * day containing the current tick), so a loaded save/scrub-commit narrates
 * forward from now rather than replaying the whole history in one entry. This
 * mirrors `FateTrigger`'s own throttle state (also unpersisted, reset-on-load,
 * documented there as harmless) — cheap because there is nothing to replay:
 * the next entry simply waits for the next day boundary.
 */
import type { GameState } from '@/core/state';
import type { LLMClient } from '@/llm/llm-client';
import { TICKS_PER_DAY, SOLAR_START_HOUR, dayIndexForTick, formatCalendarTick, type Season } from '@/core/calendar';
import { buildChroniclePrompt, renderOfflineAnnal, type ChronicleWindow } from '@/llm/chronicle-prompt-builder';

/** Bounded ring of recent entries — exposed via `entries()`/`latest()` for the
 *  inbox seam (and any future dev/studio view) without growing unbounded. */
export const CHRONICLE_RING_CAP = 30;

export interface ChronicleEntry {
  /** The 0-based calendar day index this entry covers (see `core/calendar.ts`). */
  dayIndex: number;
  year: number;
  season: Season;
  dayOfYear: number;
  text: string;
  /** True when produced by the deterministic offline template — either no LLM
   *  client was configured, or the LLM call failed and this is the honest
   *  fallback (never a silent swallow). */
  offline: boolean;
}

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
  private ring: ChronicleEntry[] = [];

  constructor(private readonly deps: ChronicleServiceDeps) {
    this.client = deps.client ?? null;
    // Anchor to "today" so a loaded save/scrub doesn't try to backfill history.
    this.lastChronicledDay = dayIndexForTick(deps.state.clock.now()) - 1;
  }

  setClient(client: LLMClient | null): void {
    this.client = client;
  }

  /** Bounded ring, oldest first. */
  entries(): readonly ChronicleEntry[] {
    return this.ring;
  }

  latest(): ChronicleEntry | null {
    return this.ring.length ? this.ring[this.ring.length - 1] : null;
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

      this.ring.push({
        dayIndex, year: calendar.year, season: calendar.season, dayOfYear: calendar.dayOfYear, text, offline,
      });
      if (this.ring.length > CHRONICLE_RING_CAP) this.ring.shift();
      this.lastChronicledDay = dayIndex;
    } finally {
      this.inFlight = false;
    }
  }
}
