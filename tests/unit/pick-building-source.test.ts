import { describe, it, expect } from 'vitest';
import { pickBuildingSource } from '@/render/iso/iso-building';

const C = {} as unknown as CanvasImageSource;
describe('pickBuildingSource (generated → parametric → flat)', () => {
  const has = () => C, none = () => null;
  it('prefers generated', () => expect(pickBuildingSource('auto', none, has, none)).toBe('generated'));
  it('falls to parametric', () => expect(pickBuildingSource('auto', none, none, has)).toBe('parametric'));
  it('falls to flat', () => expect(pickBuildingSource('auto', none, none, none)).toBe('flat'));
  it('fallback mode skips asset but allows generated', () => expect(pickBuildingSource('fallback', has, has, none)).toBe('generated'));
});
