import type { EntityId } from '@/core/types';
import type { RivalPersonality } from '@/sim/rival-spirit';

export type SpiritId = string;

export type Manifestation =
  | { kind: 'avatar';     entityId: EntityId }
  | { kind: 'possessing'; npcEntityId: EntityId };

export interface Spirit {
  id: SpiritId;
  name: string;
  sigil: string;
  color: string;
  isPlayer: boolean;
  power: number;
  manifestation: Manifestation | null;
  /**
   * AI/behavioural profile. Present on rival (non-player) spirits so the
   * RivalSystem can drive them; rides along in snapshots via structuredClone, so
   * rival decision-state is replay-safe with no snapshot.ts change. `policy` doubles
   * as the rival strategy. Absent ⇒ not an autonomously-acting spirit.
   */
  ai?: {
    policy: string;                  // RivalStrategy for rivals
    cooldowns: Record<string, number>;
    personality?: RivalPersonality;
    settlements?: string[];          // claimed POI ids
    lastActionTick?: number;
    actionCooldown?: number;
  };
}
