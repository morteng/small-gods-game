import { describe, it, expect } from 'vitest';
import { vegetationItems } from '@/render/iso/iso-sprites';
import { createNullAtlas } from '@/render/iso/iso-atlas';
import { tryGetEntityKindDef } from '@/world/entity-kinds';
import type { Entity } from '@/core/types';
import type { DrawItem } from '@/render/iso/draw-list';

// No tree/npc sheets supplied → the emitter takes the drawn-fallback path,
// emitting poly/circle items (the data form of the old Canvas2D canopy/trunk).
function ic() {
  return { atlas: createNullAtlas(), originX: 0, originY: 0 };
}

function entity(kind: string): Entity {
  return { id: `${kind}-1`, kind, x: 2, y: 3 };
}

/** Colors of all filled shapes (poly/circle) in the item list. */
function fillColors(items: DrawItem[]): string[] {
  return items
    .filter((i): i is Extract<DrawItem, { t: 'poly' | 'circle' }> => i.t === 'poly' || i.t === 'circle')
    .map((i) => i.color);
}

describe('vegetationItems', () => {
  it('emits a canopy for a tree (no programmatic ground shadow)', () => {
    const items = vegetationItems(ic(), entity('english-oak'));
    // At least one filled shape (canopy); no ellipse/ground-shadow concept exists.
    expect(items.filter((i) => i.t === 'poly' || i.t === 'circle').length).toBeGreaterThanOrEqual(1);
  });

  it('paints the canopy in the entity kind fallback color', () => {
    const items = vegetationItems(ic(), entity('english-oak'));
    const expected = tryGetEntityKindDef('english-oak')!.sprite.fallbackColor;
    expect(fillColors(items)).toContain(expected);
  });

  it('emits a triangle canopy for triangle-shaped kinds', () => {
    const items = vegetationItems(ic(), entity('scots-pine'));
    // A triangle canopy is a 3-point poly.
    const triangles = items.filter(
      (i): i is Extract<DrawItem, { t: 'poly' }> => i.t === 'poly' && i.points.length === 3,
    );
    expect(triangles.length).toBeGreaterThanOrEqual(1);
  });

  it('emits a trunk for tall trees but not for ground cover', () => {
    const treeItems = vegetationItems(ic(), entity('english-oak'));
    expect(fillColors(treeItems)).toContain('#5a4030'); // TRUNK_COLOR

    const fernItems = vegetationItems(ic(), entity('fern'));
    expect(fillColors(fernItems)).not.toContain('#5a4030');
  });

  it('ignores non-vegetation entities (empty list)', () => {
    expect(vegetationItems(ic(), entity('cottage'))).toEqual([]);
    expect(vegetationItems(ic(), entity('driftwood'))).toEqual([]);
    expect(vegetationItems(ic(), entity('unknown_kind'))).toEqual([]);
  });

  it('draws rocks (vegetation-category so the render graph picks them up)', () => {
    expect(vegetationItems(ic(), entity('boulder')).length).toBeGreaterThan(0);
  });
});
