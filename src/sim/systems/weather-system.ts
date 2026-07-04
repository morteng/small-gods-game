// src/sim/systems/weather-system.ts
//
// Water W-G — the sim's deterministic weather tick.
//
// Steps the injected water/atmosphere stepper on the FIXED sim-tick interval (so the
// fields are a pure function of tick count + logged divine actions, not wall-clock),
// then polls the flood watch and writes any place-level flood edges into the canonical
// event log. Because it runs in the sim on a deterministic clock and emits through the
// event log, scrub / commit / replay reproduce the same floods — and a flood can drive
// a Fate beat without the timeline diverging (the whole point of W-G).
//
// Layering: depends only on the sim-side `WeatherStepper` contract and the neutral
// `FloodWatch` — never on the render layer that owns the concrete stepper.

import type { System, SystemContext } from '@/core/scheduler';
import type { WeatherStepper } from '@/sim/water/weather-stepper';
import type { FloodWatch } from '@/world/flood-watch';
import type { CausalSiteStore } from '@/world/causal-site';
import { seedFloodBelief, seedSiteBelief } from '@/sim/divine-actions';
import { forEachNpc, npcProps, rememberEvent } from '@/world/npc-helpers';

/** Whose flood-power gets the credit when waters rise (the protagonist god). */
const ATTRIBUTION_SPIRIT = 'player';

/** 1 Hz — weather/water is slow; a per-second tick is plenty and keeps cost trivial. */
const WEATHER_HZ = 1;

export class WeatherSystem implements System {
  readonly name = 'weather';
  readonly tickHz = WEATHER_HZ;

  /** Injected (game wires the render-side stepper + per-world watch); either may be
   *  null before a world is seeded, in which case the tick is a no-op. */
  constructor(
    private readonly getStepper: () => WeatherStepper | null,
    private readonly getWatch: () => FloodWatch | null,
    private readonly getSites: () => CausalSiteStore | null = () => null,
  ) {}

  tick(ctx: SystemContext): void {
    const stepper = this.getStepper();
    if (!stepper) return;
    // Step on the FIXED tick interval, NOT ctx.dt (which the scheduler varies with
    // frame pacing / catch-up). Each invocation == one 1/tickHz slice, so the fields
    // evolve identically regardless of frame rate — the determinism W-G needs.
    stepper.stepTick(1000 / this.tickHz);
    const floodM = stepper.floodOffsetM();

    const watch = this.getWatch();
    if (watch) {
      for (const ev of watch.poll(floodM)) {
        if (ev.type === 'flooded') {
          const appended = ctx.log.append({
            type: 'place_flooded', poiId: ev.placeId, name: ev.name,
            depthM: ev.depthM, coverage: ev.coverage,
          });
          // Your home going under water is about as memorable as a life gets —
          // stamp every resident's memory ring (WP-C).
          forEachNpc(ctx.world, (e) => {
            if (npcProps(e).homePoiId === ev.placeId) rememberEvent(npcProps(e), appended.id);
          });
          // Attribution at the act site: the waters rising at a settlement seed its
          // believers' `flood` belief domain — which unlocks (and reinforces) summon_storm.
          seedFloodBelief(ctx.world, ATTRIBUTION_SPIRIT, ev.placeId, ev.depthM);
        } else {
          ctx.log.append({ type: 'place_receded', poiId: ev.placeId, name: ev.name });
        }
      }
    }

    // W-I: floods on land the watch does NOT cover become CAUSAL SITES — ephemeral
    // places (e.g. a god-flooded plain). Born / faded edges go onto the same log so
    // Fate (W-I-b) can address them and belief (W-I-c) can be seeded at them.
    const sites = this.getSites();
    if (sites) {
      const { born, faded } = sites.update(floodM, ctx.now, ATTRIBUTION_SPIRIT);
      for (const s of born) {
        ctx.log.append({
          type: 'site_born', siteId: s.id, kind: s.kind, name: s.name,
          x: s.pos.x, y: s.pos.y, depthM: s.intensity * 2, cells: s.cells.length,
        });
        // W-I-c: NPCs near the new deluge credit the causing spirit (proximity belief).
        seedSiteBelief(ctx.world, s);
      }
      for (const s of faded) ctx.log.append({ type: 'site_faded', siteId: s.id, name: s.name });
    }
  }
}
