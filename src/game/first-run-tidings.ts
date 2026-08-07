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
// Pure + deterministic, no Math.random: the opening's per-run variety is seeded
// by `originProfileFor` (src/game/origin-profile.ts) from the world's substrate
// seed + identity — same seed ⇒ same opening, replay-safe.

import type { InboxItem } from '@/game/game-query';
import { TICKS_PER_HOUR } from '@/core/calendar';
import { DEFAULT_ORIGIN, type OriginProfile } from '@/game/origin-profile';

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
 * Compose the step list for a given ORIGIN PROFILE (per-run variety). Only the
 * steps that NAME the born-from place or the first mind vary with the profile;
 * the mechanical steps (time, the wider hand) and the closing wish are constant.
 *
 * SIM-TRUTH GUARD: the sim's only real domains are storm/flood (smite/
 * summon_storm). So only a water place dares gesture at "a spirit of the water",
 * and even that stays a half-belief — never a claimed storm. Forest/stone/bog/dry
 * or meadow places say "a spirit of that place" and promise no power the sim cannot
 * grant (see origin-profile.ts). The dev-mode step (backquote → debug HUD) is
 * deliberately DROPPED: the shipped game stays clean of dev overlays (CLAUDE.md,
 * dev-tools-in-studios-not-game).
 */
function buildSteps(origin: OriginProfile): FirstRunStep[] {
  const waterClause = origin.flavor === 'water' ? 'a spirit of the water' : 'a spirit of that place';
  return [
    {
      id: 'welcome', title: 'Into existence',
      detail: `You are not a born god. Somewhere ${origin.place}, a mind half-believes in ${waterClause}, and that faint belief is what lets you be. Belief made you; belief sustains you.`,
    },
    {
      id: 'domain', title: 'What they believe, you become',
      detail: 'Your power is not chosen. It is reflected: whatever your believers think you can do is the vocabulary you can actually speak. One sincere mind is enough to give you shape.',
    },
    { id: 'time', title: 'Time controls', detail: 'Press T to open the time bar. 1, 2, 4, 8 change speed; Space pauses.' },
    {
      id: 'npc-interact', title: 'Find your first mind',
      detail: `Click a soul to see them. Whisper, omen and the other divine actions reach them from there. ${origin.firstMind} is already half-listening.`,
    },
    { id: 'right-click', title: 'The wider hand', detail: 'Right-click a tile to act on the place itself: the ground, the water, the open land. Not every miracle needs a soul to hold it.' },
    { id: 'ready', title: 'You are ready', detail: 'Your first belief is your creation. Nurture it and it becomes a congregation. Good luck, young spirit.' },
  ];
}

/**
 * The first-run sequence as inbox items, or `[]` once `now` has moved past
 * `FIRST_RUN_TIDING_HORIZON_TICKS` (the caller need not check the horizon
 * itself before calling this). Deterministic ids (`firstrun:<step>`) and a
 * fixed descending salience — comfortably inside the ordinary "tiding" band
 * (`salience.ts`'s `tiding` case: `0.1 + …`, capped `0.35`) so guidance can
 * never outrank a real prayer or threat, only sort sensibly against itself
 * (WELCOME first, without needing Fate's surfacing machinery).
 */
export function firstRunTidings(now: number, origin: OriginProfile = DEFAULT_ORIGIN): InboxItem[] {
  if (now >= FIRST_RUN_TIDING_HORIZON_TICKS) return [];
  return buildSteps(origin).map((step, i): InboxItem => ({
    id: `firstrun:${step.id}`,
    kind: 'tiding',
    title: step.title,
    detail: step.detail,
    salience: 0.14 - i * 0.01,
    surfaced: false,
    target: { kind: 'none' },
  }));
}
