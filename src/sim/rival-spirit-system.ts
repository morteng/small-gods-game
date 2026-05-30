import type { SpiritId } from '@/core/spirit';
import type { Entity } from '@/core/types';
import type { RivalSpirit, RivalAction, RivalStrategy } from './rival-spirit';
import { decideRivalAction, applyRivalAction, generateRivalSpirits } from './rival-spirit';
import { npcProps } from '@/world/npc-helpers';
import type { EventLog } from '@/core/events';

export interface RivalSystemOptions {
  world: { query: (opts: { kind: string }) => Entity[] };
  rivals: RivalSpirit[];
  playerSpiritId: string;
  eventLog: EventLog;
  getCurrentTick: () => number;
  getNpc: (id: string) => Entity | undefined;
  updateNpc: (id: string, updates: { properties: Record<string, unknown> }) => void;
  getRng: () => () => number;
}

export class RivalSpiritSystem {
  private rivals: RivalSpirit[];
  private playerSpiritId: string;
  private eventLog: EventLog;
  private getCurrentTick: () => number;
  private getNpc: (id: string) => Entity | undefined;
  private updateNpc: (id: string, updates: { properties: Record<string, unknown> }) => void;
  private getRng: () => () => number;
  private actionLog: RivalAction[] = [];

  constructor(opts: RivalSystemOptions) {
    this.rivals = opts.rivals;
    this.playerSpiritId = opts.playerSpiritId;
    this.eventLog = opts.eventLog;
    this.getCurrentTick = opts.getCurrentTick;
    this.getNpc = opts.getNpc;
    this.updateNpc = opts.updateNpc;
    this.getRng = opts.getRng;
  }

  tick(_dt: number): void {
    const currentTick = this.getCurrentTick();
    const rng = this.getRng();
    const playerPower = 10; // Simplified
    for (const rival of this.rivals) {
      const context = {
        playerPower,
        playerFollowersInSettlement: {} as Record<string, number>,
        rivalFollowersInSettlement: {} as Record<string, number>,
        npcBeliefs: new Map(),
      };
      const action = decideRivalAction(rival, currentTick, context, rng);
      if (action) {
        this.executeRivalAction(rival, action);
      }
    }
  }

  getRivals(): RivalSpirit[] { return [...this.rivals]; }

  private executeRivalAction(rival: RivalSpirit, action: RivalAction): void {
    if (rival.power < action.powerCost) return;
    rival.power -= action.powerCost;
    applyRivalAction(action, 
      (id) => {
        const npc = this.getNpc(id);
        return npc ? { properties: npc.properties as Record<string, unknown> } : undefined;
      },
      (id, updates) => this.updateNpc(id, updates),
    );
    this.actionLog.push(action);
  }
}

export function createRivalSpiritSystem(opts: RivalSystemOptions): RivalSpiritSystem {
  return new RivalSpiritSystem(opts);
}

export function initializeRivals(worldSeed: number, settlementIds: string[], count: number = 3): RivalSpirit[] {
  return generateRivalSpirits(worldSeed, settlementIds, count);
}
