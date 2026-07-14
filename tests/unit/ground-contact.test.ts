import { describe, it, expect } from 'vitest';
import { contactBlendFor, CONTACT_BASE, SNOW_TONE } from '@/render/ground-contact';
import { buildInstanceBatches } from '@/render/gpu/instance-batch';
import { packInstances, INSTANCE_FLOATS } from '@/render/gpu/instance-buffer';
import type { DrawItem } from '@/render/iso/draw-list';
import { natureBuryFrac } from '@/render/iso/iso-sprites';

const src = { width: 32, height: 48 } as unknown as CanvasImageSource;
type Contact = { r: number; g: number; b: number; strength: number; band: number };
const item = (contact?: Contact): DrawItem =>
  ({ t: 'image', src, dx: 0, dy: 0, dw: 32, dh: 48, contact } as DrawItem);

describe('contact blend — strength rises with the snow mask (drift banks against the base)', () => {
  it('a snowed rock blends HARDER and HIGHER than a bare one', () => {
    const bare = contactBlendFor('rock', 0);
    const snowed = contactBlendFor('rock', 1);
    expect(bare.strength).toBeCloseTo(CONTACT_BASE.rock, 6);
    expect(snowed.strength).toBeGreaterThan(bare.strength);   // banks harder
    expect(snowed.band).toBeGreaterThan(bare.band);           // climbs higher up the rock
    expect(snowed.strength).toBeLessThan(1);                  // the rock's form survives
  });

  it('the blend is monotonic in the snow amount (no contour line where snow starts)', () => {
    const s = [0, 0.25, 0.5, 0.75, 1].map((v) => contactBlendFor('rock', v).strength);
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThan(s[i - 1]);
  });

  it('ground cover blends softer than a rock but over more of its height', () => {
    expect(contactBlendFor('cover', 0).strength).toBeLessThan(contactBlendFor('rock', 0).strength);
    expect(contactBlendFor('cover', 0).band).toBeGreaterThan(contactBlendFor('rock', 0).band);
  });

  it('the snow tone matches the constant the lit shader mixes toward', () => {
    expect([...SNOW_TONE]).toEqual([0.94, 0.95, 0.97]);
  });
});

describe('contact blend — IDENTITY at strength 0', () => {
  it('an item with no contact packs zeros in the contact + ground slots', () => {
    const { batches } = buildInstanceBatches([item(undefined)]);
    const buf = packInstances(batches[0].instances);
    expect(buf).toHaveLength(INSTANCE_FLOATS);
    // contact strength, band, ground rgb — all zero ⇒ the shader takes the identity branch.
    expect(Array.from(buf.slice(11, 16))).toEqual([0, 0, 0, 0, 0]);
  });

  it('a contact-blended item is byte-identical to an unblended one EXCEPT in those slots', () => {
    // float32-exact fractions (powers of two) so the typed array round-trips cleanly.
    const plain = packInstances(buildInstanceBatches([item(undefined)]).batches[0].instances);
    const blend = packInstances(buildInstanceBatches([
      item({ r: 0.5, g: 0.25, b: 0.125, strength: 0.75, band: 0.25 }),
    ]).batches[0].instances);
    expect(Array.from(blend.slice(0, 11))).toEqual(Array.from(plain.slice(0, 11)));
    expect(Array.from(blend.slice(11, 16))).toEqual([0.75, 0.25, 0.5, 0.25, 0.125]);
  });
});

describe('rock bury — size-scaled sink', () => {
  it('a menhir buries deeper than a boulder, which buries deeper than a pebble', () => {
    const menhir = natureBuryFrac('standing_stone', 4, 4, 1);   // 3.0 m
    const boulder = natureBuryFrac('boulder', 4, 4, 1);         // 1.2 m
    const pebble = natureBuryFrac('pebbles', 4, 4, 1);          // 0.2 m
    // same (x,y) ⇒ same seeded jitter, so the ordering is the SIZE term alone
    expect(menhir).toBeGreaterThan(boulder);
    expect(boulder).toBeGreaterThan(pebble);
    expect(menhir).toBeLessThanOrEqual(0.4);   // the crop clamp
  });

  it('is deterministic per position, and a tree still never buries', () => {
    expect(natureBuryFrac('boulder', 12, 7, 1)).toBe(natureBuryFrac('boulder', 12, 7, 1));
    expect(natureBuryFrac('english-oak', 12, 7, 1)).toBe(0);
  });
});
