import type { System, SystemContext } from '@/core/scheduler';
import type { GameMap } from '@/core/types';
import { tickNpcMovementEntities } from '@/sim/npc-movement';

export class NpcMovementSystem implements System {
  readonly name = 'npc_movement';
  readonly tickHz = 60;

  constructor(private getMap: () => GameMap | null) {}

  tick(ctx: SystemContext): void {
    const map = this.getMap();
    if (!map) return;
    tickNpcMovementEntities(ctx.world, map, ctx.dt);
  }
}
