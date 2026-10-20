import { describe, expect, test } from 'vitest';
import { SpatialGrid } from './SpatialGrid';

const query = (grid: SpatialGrid, x: number, y: number, z: number, r: number) => {
  const found: number[] = [];
  grid.queryVisit({ x, y, z }, r, (id) => {
    found.push(id);
  });
  return found.sort((a, b) => a - b);
};

describe('SpatialGrid between a removal and the next rebuild', () => {
  // p616 S1: the swap-remove moves the last slot's member into the freed slot; the cells follow it
  test('still finds a member whose slot a removal moved', () => {
    const grid = new SpatialGrid({ cellSize: 10, maxMembers: 4 });
    grid.addMember(1, 5, 5, 5, 1); // slot 0, cell (0, 0, 0)
    grid.addMember(2, 105, 5, 5, 1); // slot 1, cell (10, 0, 0)
    grid.rebuild();

    grid.removeMember(1); // entity 2 moves into slot 0

    expect(query(grid, 105, 5, 5, 1)).toEqual([2]);
    expect(query(grid, 5, 5, 5, 1)).toEqual([]);
  });

  test('removes the last slot without touching the others', () => {
    const grid = new SpatialGrid({ cellSize: 10, maxMembers: 4 });
    grid.addMember(1, 5, 5, 5, 1);
    grid.addMember(2, 105, 5, 5, 1);
    grid.rebuild();

    grid.removeMember(2);

    expect(query(grid, 5, 5, 5, 1)).toEqual([1]);
    expect(query(grid, 105, 5, 5, 1)).toEqual([]);
  });

  test('keeps the moved member when both share a cell', () => {
    const grid = new SpatialGrid({ cellSize: 10, maxMembers: 4 });
    grid.addMember(1, 2, 2, 2, 1); // slot 0
    grid.addMember(2, 5, 5, 5, 1); // slot 1, same cell
    grid.rebuild();

    grid.removeMember(1);

    expect(query(grid, 5, 5, 5, 1)).toEqual([2]);
  });

  test('stays exact over several removals', () => {
    const grid = new SpatialGrid({ cellSize: 10, maxMembers: 8 });
    for (let i = 0; i < 6; i++) grid.addMember(i, i * 100 + 5, 5, 5, 1);
    grid.rebuild();

    grid.removeMember(0); // 5 → slot 0
    grid.removeMember(2); // 4 → slot 2
    grid.removeMember(5); // 4 → slot 0

    expect(grid.memberCount).toBe(3);
    for (let i = 0; i < 6; i++) {
      expect(query(grid, i * 100 + 5, 5, 5, 1)).toEqual([1, 3, 4].includes(i) ? [i] : []);
    }
  });

  test('a member added into a freed slot is found only after the rebuild, never at the old cell', () => {
    const grid = new SpatialGrid({ cellSize: 10, maxMembers: 4 });
    grid.addMember(1, 5, 5, 5, 1);
    grid.addMember(2, 105, 5, 5, 1);
    grid.rebuild();

    grid.removeMember(2); // slot 1 freed
    grid.addMember(3, 205, 5, 5, 1); // slot 1 again

    expect(query(grid, 105, 5, 5, 1)).toEqual([]);
    expect(query(grid, 205, 5, 5, 1)).toEqual([]);
    grid.rebuild();
    expect(query(grid, 205, 5, 5, 1)).toEqual([3]);
  });

  test('moves an oversized member and keeps the cells of the others', () => {
    const grid = new SpatialGrid({ cellSize: 10, maxMembers: 4 });
    grid.addMember(1, 5, 5, 5, 1); // slot 0
    grid.addMember(2, 105, 5, 5, 1); // slot 1
    grid.addMember(3, 505, 5, 5, 100); // slot 2, oversized
    grid.rebuild();

    grid.removeMember(1); // 3 → slot 0

    expect(query(grid, 105, 5, 5, 1)).toEqual([2, 3]);
    expect(query(grid, 5, 5, 5, 1)).toEqual([3]);
    expect(grid.getStats().oversizedCount).toBe(1);
  });
});

describe('SpatialGrid', () => {
  test('finds the members whose cells a query reaches, after a rebuild', () => {
    const grid = new SpatialGrid({ cellSize: 10, maxMembers: 4 });
    grid.addMember(1, 5, 5, 5, 1);
    grid.addMember(2, 15, 5, 5, 1); // the next cell
    grid.addMember(3, 505, 5, 5, 1); // far away

    expect(query(grid, 5, 5, 5, 1)).toEqual([]);
    grid.rebuild();
    expect(query(grid, 5, 5, 5, 1)).toEqual([1]);
    // Candidates, not exact hits: a query reaching the next cell returns its member
    expect(query(grid, 9, 5, 5, 1)).toEqual([1, 2]);
    expect(query(grid, 505, 5, 5, 1)).toEqual([3]);
  });

  test('expands a query by the largest member radius', () => {
    const grid = new SpatialGrid({ cellSize: 10, maxMembers: 4 });
    grid.addMember(1, 5, 5, 5, 1);
    grid.addMember(2, 45, 5, 5, 15); // in a cell 4 away, reaching 3 cells
    grid.rebuild();

    expect(grid.getStats().maxIndexedRadius).toBe(15);
    expect(query(grid, 5, 5, 5, 1)).toEqual([1]);
    expect(query(grid, 30, 5, 5, 1)).toEqual([2]);
  });

  test('sees a moved member at its new cell after the rebuild', () => {
    const grid = new SpatialGrid({ cellSize: 10, maxMembers: 4 });
    grid.addMember(1, 5, 5, 5, 1);
    grid.rebuild();

    grid.updatePosition(1, 205, 5, 5);
    expect(query(grid, 5, 5, 5, 1)).toEqual([1]);
    grid.rebuild();
    expect(query(grid, 5, 5, 5, 1)).toEqual([]);
    expect(query(grid, 205, 5, 5, 1)).toEqual([1]);
  });

  test('adding a member twice updates it', () => {
    const grid = new SpatialGrid({ cellSize: 10, maxMembers: 1 });
    grid.addMember(1, 5, 5, 5, 1);
    grid.addMember(1, 105, 5, 5, 2);
    grid.rebuild();

    expect(grid.memberCount).toBe(1);
    expect(grid.getRadius(1)).toBe(2);
    expect(query(grid, 105, 5, 5, 1)).toEqual([1]);
  });

  test('puts a member past the radius threshold in the oversized tier, which every query returns', () => {
    const grid = new SpatialGrid({ cellSize: 10, maxMembers: 4 });
    grid.addMember(1, 5, 5, 5, 1);
    grid.addMember(2, 1005, 5, 5, 25); // over cellSize × 2
    // Found before any rebuild
    expect(query(grid, 5, 5, 5, 1)).toEqual([2]);
    grid.rebuild();

    expect(grid.getStats()).toMatchObject({ oversizedCount: 1, maxIndexedRadius: 1 });
    expect(query(grid, 5, 5, 5, 1)).toEqual([1, 2]);
    expect(query(grid, -5000, 5, 5, 1)).toEqual([2]);

    grid.updateRadius(2, 5); // back into the cells
    grid.rebuild();
    expect(grid.getStats().oversizedCount).toBe(0);
    expect(query(grid, -5000, 5, 5, 1)).toEqual([]);
    expect(query(grid, 1005, 5, 5, 1)).toEqual([2]);
  });

  test('takes the oversized threshold from its multiplier', () => {
    const grid = new SpatialGrid({ cellSize: 10, maxMembers: 2, oversizedRadiusMultiplier: 1 });
    grid.addMember(1, 5, 5, 5, 11);

    expect(grid.getStats().oversizedCount).toBe(1);
  });

  test('throws past its capacity, and a removal frees a slot', () => {
    const grid = new SpatialGrid({ cellSize: 10, maxMembers: 2 });
    grid.addMember(1, 5, 5, 5, 1);
    grid.addMember(2, 15, 5, 5, 1);

    expect(() => grid.addMember(3, 25, 5, 5, 1)).toThrow(/capacity \(2\)/);
    grid.removeMember(1);
    grid.addMember(3, 25, 5, 5, 1);
    expect(grid.memberCount).toBe(2);
  });

  test('queryInto counts every candidate and writes the ones that fit', () => {
    const grid = new SpatialGrid({ cellSize: 10, maxMembers: 4 });
    for (let i = 0; i < 3; i++) grid.addMember(i, 5, 5, 5, 1);
    grid.rebuild();

    const out = new Uint32Array(2);
    expect(grid.queryInto({ x: 5, y: 5, z: 5 }, 1, out)).toBe(3);
    expect([0, 1, 2]).toEqual(expect.arrayContaining(Array.from(out)));
  });

  test('an AABB query reaches the cells its box covers', () => {
    const grid = new SpatialGrid({ cellSize: 10, maxMembers: 4 });
    grid.addMember(1, 5, 5, 5, 1);
    grid.addMember(2, 55, 5, 5, 1);
    grid.addMember(3, 105, 5, 5, 1);
    grid.rebuild();

    const out = new Uint32Array(4);
    const count = grid.queryAABBInto({ x: 0, y: 0, z: 0 }, { x: 60, y: 10, z: 10 }, out);
    expect(Array.from(out.subarray(0, count)).sort()).toEqual([1, 2]);
  });

  test('memberAt walks every member', () => {
    const grid = new SpatialGrid({ cellSize: 10, maxMembers: 4 });
    for (const id of [7, 8, 9]) grid.addMember(id, 5, 5, 5, 1);
    grid.removeMember(7);

    const members = Array.from({ length: grid.memberCount }, (_, i) => grid.memberAt(i));
    expect(members.sort()).toEqual([8, 9]);
  });
});
