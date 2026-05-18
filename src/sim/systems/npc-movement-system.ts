import type { System, SystemContext } from '@/core/scheduler';
import type { GameMap } from '@/core/types';
import { tickNpcMovementEntities } from '@/sim/npc-movement';

export class NpcMovementSystem implements System {
  readonly name = 'npc_movement';
  readonly tickHz = 60;
  private readonly intervalMs = 1000 / this.tickHz;

  constructor(private getMap: () => GameMap | null) {}

  tick(ctx: SystemContext): void {
    const map = this.getMap();
    if (!map) return;
    // Pass the canonical per-tick interval, NOT ctx.dt. The scheduler hands us
    // the accumulator (which can exceed `interval` when frame timing or rate
    // scaling spikes). Silent replay always advances by SIM_STEP_MS per tick;
    // using the fixed interval here keeps live and replay bit-identical.
    tickNpcMovementEntities(ctx.world, map, this.intervalMs, ctx.rng);
  }
}
