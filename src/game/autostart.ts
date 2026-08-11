// src/game/autostart.ts
//
// URL flags → an autostart descriptor (UI v3 §3.5).
//
// Lives in its own module rather than inside `main.ts` because `main.ts` runs its
// side effects at import time (it mounts the game), so the decision "does this URL
// skip the title?" would be untestable there. It is the one piece of the boot
// restructure that MUST not regress: every dev and automation entry point has to
// keep booting straight into a world exactly as it did before this epic.

import type { Autostart } from '@/game';

/**
 * Resolve a query string into an autostart descriptor, or null for "show the
 * title and generate nothing yet".
 *
 * The rule: `?genseed` / `?genome` are explicit "give me THIS world" asks;
 * `?bridge` means something out-of-process is about to drive this tab and should
 * not have to click through a menu first; `?autostart` is the plain opt-in for
 * anyone who wants the old straight-to-world behaviour. Only an unadorned visit —
 * a player opening the game — reaches the title screen.
 *
 * `devTools` mirrors the build-time `__DEV_TOOLS__` flag: a distribution build has
 * no genome worlds, so the flag is ignored there rather than silently honoured.
 */
export function resolveAutostart(search: string, devTools: boolean): Autostart | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    // An unparseable location is not a reason to strand the player on a title
    // screen with no explanation — fall back to the pre-epic behaviour.
    return { kind: 'auto' };
  }

  const genseed = Number(params.get('genseed'));
  if (Number.isFinite(genseed) && genseed > 0) return { kind: 'fresh', genSeed: genseed };

  const genome = devTools ? params.get('genome') : null;
  // A genome world is a throwaway terrain study: fresh, and never autosaved.
  if (genome) return { kind: 'fresh', genome, ephemeral: true };

  // `?world=testbed` — the DEV-ONLY integration testbed (`src/world/testbed/`). Same
  // shape as `?genome`: dev-gated, fresh, and never autosaved. It is deliberately NOT
  // routed through `resolvePlayableWorld` (the testbed is not a playable world and must
  // stay out of the New Game menu); `Game` resolves the marker by dynamic import so the
  // testbed chunk tree-shakes out of a distribution build. Any other `?world=` value is
  // ignored here rather than guessed at.
  if (devTools && params.get('world') === 'testbed') {
    return { kind: 'fresh', testbed: true, ephemeral: true };
  }

  if (params.has('bridge')) return { kind: 'auto' };
  if (params.has('autostart')) return { kind: 'auto' };

  return null;
}
