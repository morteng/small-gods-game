import { describe, it, expect } from 'vitest';
import type { POI, Connection } from '@/core/types';
import { corridorCells } from '@/world/road-corridors';

const poi = (id: string, x: number, y: number): POI => ({ id, type: 'village', position: { x, y } });

describe('corridorCells', () => {
  it('is empty with no connections', () => {
    expect(corridorCells([poi('a', 0, 0)], undefined).size).toBe(0);
    expect(corridorCells([poi('a', 0, 0)], []).size).toBe(0);
  });

  it('reserves a band along the line between two connected POIs', () => {
    const pois = [poi('a', 0, 10), poi('b', 20, 10)];
    const conns: Connection[] = [{ from: 'a', to: 'b', type: 'road' }];
    const cells = corridorCells(pois, conns, { margin: 1, hubRadius: 3 });
    // A mid-span cell on the centre line is reserved...
    expect(cells.has('10,10')).toBe(true);
    expect(cells.has('10,9')).toBe(true); // and its margin
    expect(cells.has('10,11')).toBe(true);
    // ...but a cell well off the line is not.
    expect(cells.has('10,5')).toBe(false);
  });

  it('excludes a disc around each POI hub so settlements still build there', () => {
    const pois = [poi('a', 0, 10), poi('b', 20, 10)];
    const conns: Connection[] = [{ from: 'a', to: 'b', type: 'road' }];
    const cells = corridorCells(pois, conns, { margin: 1, hubRadius: 3 });
    expect(cells.has('0,10')).toBe(false);  // on hub a
    expect(cells.has('2,10')).toBe(false);  // within hubRadius of a
    expect(cells.has('20,10')).toBe(false); // on hub b
  });

  it('ignores rivers and walls (road-like connections only)', () => {
    const pois = [poi('a', 0, 10), poi('b', 20, 10)];
    const river: Connection[] = [{ from: 'a', to: 'b', type: 'river' }];
    expect(corridorCells(pois, river).size).toBe(0);
  });

  it('skips connections whose endpoints lack positions', () => {
    const pois = [poi('a', 0, 10)]; // 'b' missing
    const conns: Connection[] = [{ from: 'a', to: 'b', type: 'road' }];
    expect(corridorCells(pois, conns).size).toBe(0);
  });

  it('is deterministic', () => {
    const pois = [poi('a', 0, 0), poi('b', 12, 8)];
    const conns: Connection[] = [{ from: 'a', to: 'b', type: 'road' }];
    expect([...corridorCells(pois, conns)].sort()).toEqual([...corridorCells(pois, conns)].sort());
  });
});
