import type { System, SystemContext } from '@/core/scheduler';
import type { Entity } from '@/core/types';
import { queryNpcs, npcProps } from '@/world/npc-helpers';
import { birthNpc } from '@/world/npc-lifecycle';
import { ageInYears } from '@/sim/mortality';

export const FERTILE_MIN_AGE = 18;
export const FERTILE_MAX_AGE = 45;
/** Soft cap on living NPCs per POI; births stop once a POI reaches it. */
export const POP_CAP_PER_POI = 24;
/** Per-pair per-fire (≈ per-day) birth chance. Tunable baseline. */
export const BIRTH_RATE_PER_PAIR = 0.003;

/** 0.25 Hz → one fire per in-game day, matching MortalitySystem's cadence. */
export const BIRTH_TICK_HZ = 0.25;

export class BirthSystem implements System {
  readonly name = 'births';
  readonly tickHz = BIRTH_TICK_HZ;

  tick(ctx: SystemContext): void {
    // Group living NPCs by home POI (skip NPCs without a home — they can't pair).
    const byPoi = new Map<string, Entity[]>();
    for (const e of queryNpcs(ctx.world)) {
      const poi = npcProps(e).homePoiId;
      if (!poi) continue;
      (byPoi.get(poi) ?? byPoi.set(poi, []).get(poi)!).push(e);
    }

    // Iterate POIs in sorted key order so the cross-POI rng draw sequence is
    // self-contained (independent of KindIndex insertion order) — replay-stable.
    for (const poi of [...byPoi.keys()].sort()) {
      const residents = byPoi.get(poi)!;
      // Soft cap: a POI at or above the cap simply stops producing births.
      // It NEVER removes anyone — death is a separate, old-age-only event.
      if (residents.length >= POP_CAP_PER_POI) continue;
      let headroom = POP_CAP_PER_POI - residents.length;

      // Stable order so rng draws reproduce under replay.
      const fertile = residents
        .filter(e => {
          const age = ageInYears(npcProps(e).birthTick, ctx.now);
          return age >= FERTILE_MIN_AGE && age <= FERTILE_MAX_AGE;
        })
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

      for (let i = 0; i + 1 < fertile.length && headroom > 0; i += 2) {
        if (ctx.rng.next() < BIRTH_RATE_PER_PAIR) {
          birthNpc(ctx.world, [fertile[i], fertile[i + 1]], ctx.now, ctx.rng, ctx.log);
          headroom--;
        }
      }
    }
  }
}
