// tests/unit/occupancy-grid.test.ts
import { describe, it, expect } from 'vitest';
import { OccupancyGrid, buildingSolidCells } from '@/world/occupancy-grid';

describe('OccupancyGrid', () => {
  it('claims and reports single cells with their kind', () => {
    const g = new OccupancyGrid();
    expect(g.isFree(2, 3)).toBe(true);
    g.claim(2, 3, 'road');
    expect(g.isFree(2, 3)).toBe(false);
    expect(g.has(2, 3)).toBe(true);
    expect(g.at(2, 3)).toBe('road');
    expect(g.is(2, 3, 'road')).toBe(true);
    expect(g.is(2, 3, 'building')).toBe(false);
  });

  it('claimRect fills the whole rectangle', () => {
    const g = new OccupancyGrid();
    g.claimRect(0, 0, 2, 3, 'civic');
    expect(g.size).toBe(6);
    for (let y = 0; y < 3; y++) for (let x = 0; x < 2; x++) expect(g.is(x, y, 'civic')).toBe(true);
    expect(g.isFree(2, 0)).toBe(true); // just outside
  });

  it('isFreeRect is true only when every cell is free', () => {
    const g = new OccupancyGrid();
    expect(g.isFreeRect(0, 0, 3, 3)).toBe(true);
    g.claim(1, 1, 'building');
    expect(g.isFreeRect(0, 0, 3, 3)).toBe(false);
    expect(g.isFreeRect(2, 2, 2, 2)).toBe(true); // misses the claimed cell
  });

  it('claimCells ingests pre-formatted "x,y" keys', () => {
    const g = new OccupancyGrid();
    g.claimCells(['5,5', '6,5'], 'barrier');
    expect(g.is(5, 5, 'barrier')).toBe(true);
    expect(g.is(6, 5, 'barrier')).toBe(true);
  });

  it('last claim wins (upgrade a reserved cell to road)', () => {
    const g = new OccupancyGrid();
    g.claim(4, 4, 'civic');
    g.claim(4, 4, 'road');
    expect(g.at(4, 4)).toBe('road');
    expect(g.size).toBe(1);
  });
});

describe('buildingSolidCells', () => {
  it('offsets blocked cells to absolute coords and drops door cells', () => {
    // 2x2 blocked, the south door at "0,1" is passable.
    const collision = { blocked: ['0,0', '1,0', '0,1', '1,1'], doorCells: ['0,1'] };
    const cells = buildingSolidCells(collision, 10, 20);
    expect(new Set(cells)).toEqual(new Set(['10,20', '11,20', '11,21']));
    expect(cells).not.toContain('10,21'); // the door
  });

  it('handles negative-free origins and multi-digit coords', () => {
    const cells = buildingSolidCells({ blocked: ['0,0', '12,3'], doorCells: [] }, 100, 200);
    expect(new Set(cells)).toEqual(new Set(['100,200', '112,203']));
  });
});
