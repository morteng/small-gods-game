import type { EntityId } from '@/core/types';

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
  ai?: { policy: string; cooldowns: Record<string, number> };
}
