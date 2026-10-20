import { describe, expect, test } from 'vitest';
import { SpatialGrid } from './SpatialGrid';

const query = (grid: SpatialGrid, x: number, y: number, z: number, r: number) => {
  const found: number[] = [];
  grid.queryVisit({ x, y, z }, r, (id) => found.push(id));
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
