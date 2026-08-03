// src/sim/water/flood-attribution.ts
//
// Who gets the credit when the waters rise.
//
// `WeatherSystem` sees a flood as a FIELD EDGE — a place crossed its coverage
// threshold, a blob of wet land grew big enough to be a causal site. The field
// carries no memory of who made it wet, so before this module the system simply
// credited the player for every flood in the world. A rival's `summon_storm`
// therefore seeded the PLAYER's flood domain: the rival paid the power and the
// player's believers learned that the player commands the deluge.
//
// The caster is not lost, though — `summonStorm`/`summonStormAt` already write
// `{ type: 'summon_storm', spiritId, ... }` onto the canonical event log. So
// attribution is a LOOKUP over the recent log, not new state to carry:
//
//   - it needs no snapshot field (the log is already snapshotted + journalled),
//   - it replays identically (same log ⇒ same answer),
//   - and it cannot drift out of sync with what actually happened, because it
//     reads the record of the act rather than a parallel ledger of it.
//
// Everything here is pure and `Math.random`-free.

import type { AppendedEvent } from '@/core/events';
import type { SpiritId } from '@/core/spirit';
import { TICKS_PER_HOUR } from '@/core/calendar';

/**
 * How long a cast keeps its claim on the water it laid.
 *
 * A storm floods its cells the instant it is cast, but the EDGE the weather
 * tick reports can lag: `FloodWatch` fires `place_flooded` only once coverage
 * crosses its threshold, and a causal site is not born until its blob reaches
 * `MIN_SITE_CELLS`. Ten game minutes is far longer than either takes at the
 * 1 Hz weather tick, and far shorter than the hours a flood then persists — so
 * a god is credited for the flood it caused and never for the next one.
 *
 * Denominated in `TICKS_PER_HOUR` rather than a raw literal: at 1:1 realtime
 * this is a duration in the fiction, and it must move if the calendar does.
 */
export const FLOOD_CREDIT_WINDOW_TICKS = TICKS_PER_HOUR / 6;

/** What `CausalSiteStore` records as the cause of a flood nobody summoned.
 *  `seedSiteBelief` checks for exactly this and seeds no belief — a natural
 *  deluge has no hand behind it to credit. */
export const NATURAL_CAUSE = 'nature';

/** The `summon_storm` casts still inside the credit window, oldest first. Pass
 *  `log.recentSince(now - FLOOD_CREDIT_WINDOW_TICKS)` — the backward-scanning
 *  reader, so this stays O(window) on a log that grows all session. */
export interface StormCast {
  spiritId: SpiritId;
  /** Settlement cast (`summonStorm`). */
  poiId?: string;
  /** Area cast (`summonStormAt`) — centre + clamped radius. */
  x?: number;
  y?: number;
  radius?: number;
}

/** Narrow a recent-event slice down to the storm casts, in log order. */
export function stormCastsIn(recent: readonly AppendedEvent[]): StormCast[] {
  const casts: StormCast[] = [];
  for (const a of recent) {
    if (a.event.type !== 'summon_storm') continue;
    const e = a.event;
    casts.push({ spiritId: e.spiritId, poiId: e.poiId, x: e.x, y: e.y, radius: e.radius });
  }
  return casts;
}

/**
 * Who flooded `poiId` — the MOST RECENT cast that reached it, or null if the
 * waters rose on their own. Later casts win: if two gods flood the same place
 * inside one window, the settlement credits the one whose storm it just saw.
 *
 * An AREA cast counts if the POI's centre falls inside its disc, so a god who
 * drops a deluge over a town without naming it still gets the credit — the
 * believers cannot tell the two verbs apart, and neither should the fiction.
 * `poiPos` returns the POI centre in tiles (null ⇒ unknown POI, area casts then
 * simply cannot match it).
 */
export function creditForPlaceFlood(
  casts: readonly StormCast[],
  poiId: string,
  poiPos: (id: string) => { x: number; y: number } | null,
): SpiritId | null {
  let pos: { x: number; y: number } | null | undefined;
  for (let i = casts.length - 1; i >= 0; i--) {
    const c = casts[i];
    if (c.poiId === poiId) return c.spiritId;
    if (c.x === undefined || c.y === undefined || c.radius === undefined) continue;
    if (pos === undefined) pos = poiPos(poiId);   // resolved at most once, lazily
    if (pos && withinDisc(pos.x, pos.y, c.x, c.y, c.radius)) return c.spiritId;
  }
  return null;
}

/**
 * Who flooded the ground at `(x, y)` — the most recent AREA cast covering it,
 * else `NATURAL_CAUSE`. Causal sites are by definition the floods that fall
 * OUTSIDE any watched settlement, so a settlement-targeted cast is not a
 * candidate here; only a disc laid on open ground is.
 *
 * Returns the sentinel rather than null because this feeds `CausalSiteStore`'s
 * `cause`, which is a plain string on the persisted site.
 */
export function creditForSiteFlood(casts: readonly StormCast[], x: number, y: number): string {
  for (let i = casts.length - 1; i >= 0; i--) {
    const c = casts[i];
    if (c.x === undefined || c.y === undefined || c.radius === undefined) continue;
    if (withinDisc(x, y, c.x, c.y, c.radius)) return c.spiritId;
  }
  return NATURAL_CAUSE;
}

/** Inside the disc, with a one-tile skirt: `floodArea` wets a rasterised disc
 *  whose wet cells reach a shade past the ideal radius, and a site's centroid
 *  is the mean of those cells. Tighter than that and a god loses the credit for
 *  a puddle plainly inside its own storm. */
function withinDisc(x: number, y: number, cx: number, cy: number, radius: number): boolean {
  const dx = x - cx;
  const dy = y - cy;
  const r = radius + 1;
  return dx * dx + dy * dy <= r * r;
}
