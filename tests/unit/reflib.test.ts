import { describe, it, expect } from 'vitest';
import { pickRefSlug } from '@/studio/reflib';

describe('pickRefSlug — subject kind → reference-library slug', () => {
  const slugs = ['tavern', 'tavern-target', 'tavern-target-gemini', 'parish-church', 'parish-church-classic', 'watermill-wheel', 'bridge-stone-arch'];

  it('prefers an exact match over any prefixed sibling', () => {
    expect(pickRefSlug(slugs, 'tavern')).toBe('tavern');
    expect(pickRefSlug(slugs, 'parish-church')).toBe('parish-church');
    expect(pickRefSlug(slugs, 'bridge-stone-arch')).toBe('bridge-stone-arch');
  });

  it('falls back to the shortest kind-prefixed slug when there is no exact match', () => {
    expect(pickRefSlug(slugs, 'watermill')).toBe('watermill-wheel');
  });

  it('returns null when nothing matches', () => {
    expect(pickRefSlug(slugs, 'cottage')).toBeNull();
    expect(pickRefSlug([], 'tavern')).toBeNull();
  });

  it('does not cross-match a kind to an unrelated slug', () => {
    // `mill` must NOT match `watermill-wheel` (prefix is `watermill-`, not `mill-`).
    expect(pickRefSlug(slugs, 'mill')).toBeNull();
  });
});
