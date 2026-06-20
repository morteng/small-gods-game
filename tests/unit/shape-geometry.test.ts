import { describe, it, expect } from 'vitest';
import {
  parseColor, circleSegments, buildShapeVertices,
  SHAPE_VERTEX_FLOATS,
} from '@/render/gpu/shape-geometry';
import type { DrawItem } from '@/render/iso/draw-list';

const img: DrawItem = { t: 'image', src: {} as CanvasImageSource, dx: 0, dy: 0, dw: 8, dh: 8 };

describe('parseColor', () => {
  it('parses #rrggbb', () => {
    expect(parseColor('#8a8a8a')).toEqual([0x8a / 255, 0x8a / 255, 0x8a / 255, 1]);
  });
  it('parses #rgb shorthand', () => {
    expect(parseColor('#f00')).toEqual([1, 0, 0, 1]);
  });
  it('parses #rrggbbaa alpha', () => {
    const [, , , a] = parseColor('#00000080');
    expect(a).toBeCloseTo(0x80 / 255, 5);
  });
  it('parses rgb()/rgba()', () => {
    expect(parseColor('rgb(255, 0, 0)')).toEqual([1, 0, 0, 1]);
    expect(parseColor('rgba(0, 255, 0, 0.5)')).toEqual([0, 1, 0, 0.5]);
  });
  it('falls back to opaque black for unknown', () => {
    expect(parseColor('not-a-color')).toEqual([0, 0, 0, 1]);
  });
});

describe('circleSegments', () => {
  it('clamps to [8, 64]', () => {
    expect(circleSegments(0)).toBe(8);
    expect(circleSegments(1)).toBe(8);
    expect(circleSegments(1000)).toBe(64);
  });
  it('grows with radius', () => {
    expect(circleSegments(20)).toBe(30);
  });
});

describe('buildShapeVertices', () => {
  it('returns empty when there are no shapes', () => {
    const { vertices, vertexCount } = buildShapeVertices([img]);
    expect(vertexCount).toBe(0);
    expect(vertices.length).toBe(0);
  });

  it('triangulates a triangle poly into one triangle (3 verts)', () => {
    const poly: DrawItem = {
      t: 'poly', color: '#ff0000',
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }],
    };
    const { vertices, vertexCount } = buildShapeVertices([poly]);
    expect(vertexCount).toBe(3);
    // first vertex: x,y = (0,0); colour = red opaque
    expect(vertices[0]).toBe(0);
    expect(vertices[1]).toBe(0);
    expect(vertices[3]).toBe(1); // r
    expect(vertices[4]).toBe(0); // g
    expect(vertices[6]).toBe(1); // a
  });

  it('fan-triangulates an n-gon into (n-2) triangles', () => {
    const quad: DrawItem = {
      t: 'poly', color: '#000000',
      points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }],
    };
    const { vertexCount } = buildShapeVertices([quad]);
    expect(vertexCount).toBe(2 * 3); // 2 triangles
  });

  it('ignores degenerate polys (<3 points)', () => {
    const line: DrawItem = { t: 'poly', color: '#fff', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] };
    expect(buildShapeVertices([line]).vertexCount).toBe(0);
  });

  it('triangulates a circle into segments*3 verts', () => {
    const circle: DrawItem = { t: 'circle', cx: 50, cy: 50, r: 20, color: '#3a7a3a' };
    const segs = circleSegments(20);
    const { vertexCount } = buildShapeVertices([circle]);
    expect(vertexCount).toBe(segs * 3);
  });

  it('shares the image-pass depth encoding ((i+1)/(count+1))', () => {
    const poly: DrawItem = { t: 'poly', color: '#fff', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] };
    // poly is item index 1 of 3 ⇒ depth = (1+1)/(3+1) = 0.5
    const { vertices } = buildShapeVertices([img, poly, img]);
    expect(vertices[2]).toBeCloseTo(0.5, 6); // z of first vertex
  });

  it('emits vertices in WORLD px (the camera xform is applied by the shape VS)', () => {
    const poly: DrawItem = { t: 'poly', color: '#fff', points: [{ x: 1, y: 2 }, { x: 3, y: 2 }, { x: 1, y: 4 }] };
    const { vertices } = buildShapeVertices([poly]);
    expect(vertices[0]).toBe(1); // unchanged world x
    expect(vertices[1]).toBe(2); // unchanged world y
  });

  it('packs SHAPE_VERTEX_FLOATS floats per vertex', () => {
    const poly: DrawItem = { t: 'poly', color: '#fff', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] };
    const { vertices, vertexCount } = buildShapeVertices([poly]);
    expect(vertices.length).toBe(vertexCount * SHAPE_VERTEX_FLOATS);
  });
});
