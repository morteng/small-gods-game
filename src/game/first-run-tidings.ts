// src/game/first-run-tidings.ts
//
// First-run guidance, ported from the DOM `STEPS` array in the retiring
// `src/ui/tutorial.ts` (P6's job to delete — see that module's own doc note;
// this port is content, not chrome) into ordinary `tiding`-kind divine-inbox
// items (UI v3 P5b). The existing, event-log-derived, no-stored-item-state
// inbox (`Game.hudSim`/`game-query.ts`'s `divineInbox`) IS the onboarding
// surface now, rather than a bespoke DOM modal nobody auto-shows.
//
// Gated by the caller on `settings.firstRunSeen` (already in
// `services/settings-store.ts`); `Game` flips that flag once
// `FIRST_RUN_TIDING_HORIZON_TICKS` of sim time has elapsed (see `game.ts`'s
// `hudSim()`) — "delivered" means "made available for the window", the same
// honest best-effort every other auto-expiring tiding already settles for
// (nobody guarantees the player actually opened the inbox tray).
//
// Pure + deterministic, no RNG: there is genuinely nothing random to seed.

import type { InboxItem } from '@/game/game-query';
import { TICKS_PER_HOUR } from '@/core/calendar';

/** How long these stay available to a fresh world before falling out of the
 *  inbox on their own — the SAME "auto-expire, no stored per-item state"
 *  contract every other tiding generator in `game-query.ts` follows. One
 *  in-fiction hour, which under 1:1 realtime (CLAUDE.md) is one real hour: a
 *  generous window for a first session without lingering forever. */
export const FIRST_RUN_TIDING_HORIZON_TICKS = TICKS_PER_HOUR;

interface FirstRunStep {
  id: string;
  title: string;
  detail: string;
}

/**
 * Ported from `tutorial.ts`'s `STEPS` — content only, re-authored (Phase 2 of the
 * "New Game" epic) as the player's ORIGIN STORY: the player does not start as a
 * formed god but "Boltzmanns into existence" because one primitive mind half-
 * believes in a simple spirit (here, a spirit of the running water). The player's
 * DOMAIN and VOCABULARY are defined by the believer, not chosen — which is the
 * game's own divine-inbox law ("a god's vocabulary = what its believers think it
 * can do"). The dev-mode step (backquote → debug HUD) is deliberately DROPPED: the
 * shipped game stays clean of dev overlays (CLAUDE.md, dev-tools-in-studios-not-game),
 * so onboarding a new player toward a debug toggle would contradict that rule.
 */
const STEPS: readonly FirstRunStep[] = [
  { id: 'welcome', title: 'Into existence', detail: 'You are not a born god. Somewhere, a mind half-believes in a spirit of the running water, and that faint belief is what lets you be. Belief made you; belief sustains you.' },
  { id: 'domain', title: 'What they believe, you become', detail: 'Your power is not chosen. It is reflected: whatever your believers think you can do is the vocabulary you can actually speak. One sincere mind is enough to give you shape.' },
  { id: 'time', title: 'Time controls', detail: 'Press T to open the time bar. 1, 2, 4, 8 change speed; Space pauses.' },
  { id: 'npc-interact', title: 'Find your first mind', detail: 'Click a soul to see them. Whisper, omen and the other divine actions reach them from there. Someone near the water is already half-listening.' },
  { id: 'right-click', title: 'The wider hand', detail: 'Right-click a tile to act on the place itself: a pool, a bank, a bend in the stream. Not every miracle needs a soul to hold it.' },
  { id: 'ready', title: 'You are ready', detail: 'Your first belief is your creation. Nurture it and it becomes a congregation. Good luck, young spirit.' },
];

/**
 * The first-run sequence as inbox items, or `[]` once `now` has moved past
 * `FIRST_RUN_TIDING_HORIZON_TICKS` (the caller need not check the horizon
 * itself before calling this). Deterministic ids (`firstrun:<step>`) and a
 * fixed descending salience — comfortably inside the ordinary "tiding" band
 * (`salience.ts`'s `tiding` case: `0.1 + …`, capped `0.35`) so guidance can
 * never outrank a real prayer or threat, only sort sensibly against itself
 * (WELCOME first, without needing Fate's surfacing machinery).
 */
export function firstRunTidings(now: number): InboxItem[] {
  if (now >= FIRST_RUN_TIDING_HORIZON_TICKS) return [];
  return STEPS.map((step, i): InboxItem => ({
    id: `firstrun:${step.id}`,
    kind: 'tiding',
    title: step.title,
    detail: step.detail,
    salience: 0.14 - i * 0.01,
    surfaced: false,
    target: { kind: 'none' },
  }));
}
