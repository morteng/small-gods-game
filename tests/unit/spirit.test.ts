import { describe, it, expect } from 'vitest';
import type { Spirit, Manifestation } from '@/core/spirit';

describe('Spirit shape', () => {
  it('a minimal spirit has identity + power and no manifestation', () => {
    const s: Spirit = {
      id: 'player',
      name: 'Fooob',
      sigil: '⊙',
      color: '#ffd700',
      isPlayer: true,
      power: 3,
      manifestation: null,
    };
    expect(s.manifestation).toBeNull();
  });

  it('avatar manifestation references an entity id', () => {
    const m: Manifestation = { kind: 'avatar', entityId: 'avatar-1' };
    expect(m.kind).toBe('avatar');
  });

  it('possessing manifestation references an npc entity id', () => {
    const m: Manifestation = { kind: 'possessing', npcEntityId: 'npc-3' };
    expect(m.kind).toBe('possessing');
  });
});
