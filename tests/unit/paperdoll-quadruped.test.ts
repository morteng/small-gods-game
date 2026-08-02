import { describe, expect, it } from 'vitest';
import { bakeClip, sampleClip, type AnimTemplate } from '@/render/paperdoll/rig';
import {
  buildQuadrupedTemplate,
  drawQuadrupedCell,
  GOAT_PARAMS,
  GOAT_WEST,
  quadrupedMirrorName,
  QUADRUPED_CHIP_COLORS,
  QUADRUPED_CHIP_NAMES,
  SHEEP_CLIPS,
  SHEEP_PARAMS,
  SHEEP_WEST,
  type QuadrupedParams,
} from '@/render/paperdoll/quadruped';

const HEX6 = /^#[0-9a-f]{6}$/i;

const SPECIES: readonly [string, AnimTemplate][] = [
  ['sheep', SHEEP_WEST],
  ['goat', GOAT_WEST],
];

// ── 1. Template validity ─────────────────────────────────────────────────────
// Shared across every species so a third species is one array entry, per the
// A0 note. Each assertion here forecloses a specific class of rig bug:
//   - FK parent ordering: `chipWorldTransforms` resolves parents by walking
//     the template array once, so a forward/self/out-of-range parent ref
//     silently reads a stale (identity) world transform for an ancestor.
//   - rect-in-cell: an out-of-bounds rect slices past the raster buffer.
//   - pivot-in-rect: a pivot outside its own rect makes rotation swing the
//     chip's pixels away from their own joint (the "orbiting limb" bug).
//   - name/color parity: `QUADRUPED_CHIP_NAMES`/`QUADRUPED_CHIP_COLORS` are
//     the public vocabulary the studio's bone overlay and any external clip
//     author key on; a mismatch silently drops or mis-colors a bone.
describe.each(SPECIES)('%s template validity', (_species, template) => {
  it('chip 0 is the root (parent -1)', () => {
    expect(template.chips[0].parent).toBe(-1);
  });

  it('every non-root chip has an in-range parent index appearing EARLIER in the array', () => {
    template.chips.forEach((ch, i) => {
      if (i === 0) return;
      expect(ch.parent).toBeGreaterThanOrEqual(0);
      expect(ch.parent).toBeLessThan(i); // strictly earlier ⇒ FK walk resolves parents first
    });
  });

  it('every chip rect lies fully within the cell, with positive extent', () => {
    for (const ch of template.chips) {
      expect(ch.rect.w).toBeGreaterThan(0);
      expect(ch.rect.h).toBeGreaterThan(0);
      expect(ch.rect.x).toBeGreaterThanOrEqual(0);
      expect(ch.rect.y).toBeGreaterThanOrEqual(0);
      expect(ch.rect.x + ch.rect.w).toBeLessThanOrEqual(template.cell);
      expect(ch.rect.y + ch.rect.h).toBeLessThanOrEqual(template.cell);
    }
  });

  it("every chip's pivot lies inside (or on the boundary of) its own rect", () => {
    // 1px slack matches the established convention (paperdoll-west.test.ts):
    // a joint authored a hair past its own rect edge is a normal seam
    // placement, not a rig defect — the defect this guards against is a
    // pivot many pixels from its chip (an orbiting-limb bug), not a rounding
    // sliver.
    const SLACK = 1;
    for (const ch of template.chips) {
      const [px, py] = ch.pivot;
      expect(px).toBeGreaterThanOrEqual(ch.rect.x - SLACK);
      expect(px).toBeLessThanOrEqual(ch.rect.x + ch.rect.w + SLACK);
      expect(py).toBeGreaterThanOrEqual(ch.rect.y - SLACK);
      expect(py).toBeLessThanOrEqual(ch.rect.y + ch.rect.h + SLACK);
    }
  });

  it('chip names are unique and equal QUADRUPED_CHIP_NAMES', () => {
    const names = template.chips.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length); // no dupes
    expect(names).toEqual([...QUADRUPED_CHIP_NAMES]);
  });
});

describe('QUADRUPED_CHIP_COLORS', () => {
  it('has one entry per chip and every entry is a valid #rrggbb', () => {
    expect(QUADRUPED_CHIP_COLORS).toHaveLength(QUADRUPED_CHIP_NAMES.length);
    for (const c of QUADRUPED_CHIP_COLORS) expect(c).toMatch(HEX6);
  });
});

// ── 2. Mirror-name symmetry ──────────────────────────────────────────────────
// `quadrupedMirrorName` is the seam a facing-agnostic clip mapper will hang
// off of; an asymmetric or dangling mapping there would silently misdirect a
// mirrored limb. This forecloses that class before that mapper exists.
describe('quadrupedMirrorName', () => {
  const names = new Set<string>(QUADRUPED_CHIP_NAMES);
  const unpaired = ['body', 'neck', 'head', 'ear', 'tail'];

  it('is an involution on paired names: f(f(n)) === n', () => {
    for (const n of QUADRUPED_CHIP_NAMES) {
      const m = quadrupedMirrorName(n);
      if (m === null) continue;
      expect(quadrupedMirrorName(m)).toBe(n);
    }
  });

  it('maps Near<->Far and never confuses the two', () => {
    for (const n of QUADRUPED_CHIP_NAMES) {
      const m = quadrupedMirrorName(n);
      if (m === null) continue;
      if (n.includes('Near')) {
        expect(m.includes('Far')).toBe(true);
        expect(m.includes('Near')).toBe(false);
      } else if (n.includes('Far')) {
        expect(m.includes('Near')).toBe(true);
        expect(m.includes('Far')).toBe(false);
      }
    }
  });

  it('returns null for every unpaired chip (body/neck/head/ear/tail)', () => {
    for (const n of unpaired) expect(quadrupedMirrorName(n)).toBeNull();
  });

  it('every mirror name it returns actually exists in the template vocabulary', () => {
    for (const n of QUADRUPED_CHIP_NAMES) {
      const m = quadrupedMirrorName(n);
      if (m === null) continue;
      expect(names.has(m)).toBe(true);
    }
  });
});

// ── 3. Deterministic clip sampling ───────────────────────────────────────────
// `src/sim/` isn't the only place determinism matters — a paper-doll pose
// player that isn't pure would desync frame caches keyed on (template,
// wardrobe, quantized pose), and Math.random anywhere in the art path would
// break the `ART_RECIPE_VERSION` golden-hash contract used elsewhere.
describe('deterministic clip sampling', () => {
  it('sampleClip is pure: repeated calls at a fixed t return identical poses', () => {
    const clip = SHEEP_CLIPS[0];
    const a = sampleClip(SHEEP_WEST, clip, 0.37);
    const b = sampleClip(SHEEP_WEST, clip, 0.37);
    expect(a).toEqual(b);
  });

  it('sampleClip does not mutate the clip or the template', () => {
    const clip = SHEEP_CLIPS[0];
    const clipBefore = structuredClone(clip);
    const templateBefore = structuredClone(SHEEP_WEST);
    sampleClip(SHEEP_WEST, clip, 0.5);
    expect(clip).toEqual(clipBefore);
    expect(SHEEP_WEST).toEqual(templateBefore);
  });

  it('drawQuadrupedCell is Math.random-free: two calls produce byte-identical rasters', () => {
    const a = drawQuadrupedCell(SHEEP_PARAMS);
    const b = drawQuadrupedCell(SHEEP_PARAMS);
    expect(a.w).toBe(b.w);
    expect(a.h).toBe(b.h);
    expect(Buffer.from(a.data)).toEqual(Buffer.from(b.data));
  });
});

// ── 4. Species parameterization ──────────────────────────────────────────────
// The whole point of the params/builder split is that a species is DATA, not
// code. These assertions catch the builder silently special-casing a species
// (e.g. an `if (p.species === 'sheep')`) rather than deriving everything from
// `QuadrupedParams`.
describe('species parameterization', () => {
  it('buildQuadrupedTemplate(SHEEP_PARAMS) deep-equals the exported SHEEP_WEST', () => {
    expect(buildQuadrupedTemplate(SHEEP_PARAMS)).toEqual(SHEEP_WEST);
  });

  it('sheep and goat templates share chip names, parent topology and z-order', () => {
    const names = (t: AnimTemplate) => t.chips.map((c) => c.name);
    const parents = (t: AnimTemplate) => t.chips.map((c) => c.parent);
    const zOrder = (t: AnimTemplate) => t.chips.map((c) => c.z);
    expect(names(GOAT_WEST)).toEqual(names(SHEEP_WEST));
    expect(parents(GOAT_WEST)).toEqual(parents(SHEEP_WEST));
    expect(zOrder(GOAT_WEST)).toEqual(zOrder(SHEEP_WEST));
    // Different species must not coincidentally produce the SAME geometry —
    // otherwise this whole suite could pass against a builder that ignores
    // its params entirely.
    expect(GOAT_WEST.chips.map((c) => c.rect)).not.toEqual(SHEEP_WEST.chips.map((c) => c.rect));
  });

  it('changing only leg geometry changes leg rects but leaves every non-leg chip untouched', () => {
    const modified: QuadrupedParams = structuredClone(SHEEP_PARAMS);
    modified.legs = {
      ...modified.legs,
      laneX: modified.legs.laneX.map((x) => x + 2) as unknown as QuadrupedParams['legs']['laneX'],
      width: modified.legs.width + 1,
    };
    const base = buildQuadrupedTemplate(SHEEP_PARAMS);
    const changed = buildQuadrupedTemplate(modified);

    const isLeg = (name: string) => name.startsWith('leg');
    for (const ch of base.chips) {
      const other = changed.chips.find((c) => c.name === ch.name)!;
      if (isLeg(ch.name)) {
        // At least the rect must differ for a leg chip (lane shifted, wider).
        expect(other.rect).not.toEqual(ch.rect);
      } else {
        expect(other).toEqual(ch);
      }
    }
    // Topology (names/parents/z) is untouched by a params tweak that only
    // moves numbers, not structure.
    expect(changed.chips.map((c) => c.name)).toEqual(base.chips.map((c) => c.name));
    expect(changed.chips.map((c) => c.parent)).toEqual(base.chips.map((c) => c.parent));
    expect(changed.chips.map((c) => c.z)).toEqual(base.chips.map((c) => c.z));
  });
});

// ── 5. Clip completeness ─────────────────────────────────────────────────────
// The bug class this forecloses: a typo'd chip name in a track/couple/plant
// key silently does nothing (sampleClip and the couple/plant lookups all
// findIndex-and-skip on a miss) — no error, just a limb that never moves.
describe('SHEEP_CLIPS completeness', () => {
  const chipNames = new Set(SHEEP_WEST.chips.map((c) => c.name));

  it('every clip has at least 2 frames', () => {
    for (const clip of SHEEP_CLIPS) expect(clip.frames).toBeGreaterThanOrEqual(2);
  });

  it('every track key names a chip that exists in the template', () => {
    for (const clip of SHEEP_CLIPS) {
      for (const key of Object.keys(clip.tracks)) {
        expect(chipNames.has(key), `${clip.name}: unknown track chip '${key}'`).toBe(true);
      }
    }
  });

  it('every couple.from/couple.to names a real chip', () => {
    for (const clip of SHEEP_CLIPS) {
      for (const c of clip.couple ?? []) {
        expect(chipNames.has(c.from), `${clip.name}: unknown couple.from '${c.from}'`).toBe(true);
        expect(chipNames.has(c.to), `${clip.name}: unknown couple.to '${c.to}'`).toBe(true);
      }
    }
  });

  it('every plant.chip names a real chip', () => {
    for (const clip of SHEEP_CLIPS) {
      for (const pl of clip.plant ?? []) {
        expect(chipNames.has(pl.chip), `${clip.name}: unknown plant.chip '${pl.chip}'`).toBe(true);
      }
    }
  });

  it('keyframe t values are within [0,1] and non-decreasing per track', () => {
    for (const clip of SHEEP_CLIPS) {
      for (const [key, track] of Object.entries(clip.tracks)) {
        for (const k of track) {
          expect(k.t, `${clip.name}.${key}`).toBeGreaterThanOrEqual(0);
          expect(k.t, `${clip.name}.${key}`).toBeLessThanOrEqual(1);
        }
        for (let i = 1; i < track.length; i++) {
          expect(track[i].t, `${clip.name}.${key}[${i}]`).toBeGreaterThanOrEqual(track[i - 1].t);
        }
      }
    }
  });

  it('clip names are unique', () => {
    const names = SHEEP_CLIPS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('covers the five required behaviours: walk, idle, graze, startle, death', () => {
    const names = new Set(SHEEP_CLIPS.map((c) => c.name));
    for (const required of ['walk', 'idle', 'graze', 'startle', 'death']) {
      expect(names.has(required), `missing required clip '${required}'`).toBe(true);
    }
  });
});

// ── 6. Bake smoke ─────────────────────────────────────────────────────────────
// Cheap end-to-end proof that every clip actually renders something, at low
// supersample so the suite stays fast — no pixel snapshotting, since the art
// is mid-tune.
describe('bakeClip smoke (sheep)', () => {
  const rest = drawQuadrupedCell(SHEEP_PARAMS);

  it.each(SHEEP_CLIPS.map((c) => [c.name, c] as const))('%s bakes clip.frames non-empty rasters at cell size', (_name, clip) => {
    const frames = bakeClip(SHEEP_WEST, [rest], clip, { supersample: 1 });
    expect(frames).toHaveLength(clip.frames);
    for (const f of frames) {
      expect(f.w).toBe(SHEEP_WEST.cell);
      expect(f.h).toBe(SHEEP_WEST.cell);
      let opaque = 0;
      for (let i = 3; i < f.data.length; i += 4) if (f.data[i] > 0) opaque++;
      expect(opaque, `${clip.name} frame has zero opaque pixels`).toBeGreaterThan(0);
    }
  });
});

// Same clip set replayed against the goat's own template + rest cell — the
// clip vocabulary is chip-name-keyed, not species-keyed, so a species-agnostic
// clip must bake cleanly on ANY template sharing that vocabulary.
describe('bakeClip smoke (goat, same clip set)', () => {
  const rest = drawQuadrupedCell(GOAT_PARAMS);

  it('walk bakes non-empty rasters against the goat template', () => {
    const walk = SHEEP_CLIPS.find((c) => c.name === 'walk')!;
    const frames = bakeClip(GOAT_WEST, [rest], walk, { supersample: 1 });
    expect(frames).toHaveLength(walk.frames);
    for (const f of frames) {
      let opaque = 0;
      for (let i = 3; i < f.data.length; i += 4) if (f.data[i] > 0) opaque++;
      expect(opaque).toBeGreaterThan(0);
    }
  });
});
