import { describe, expect, test } from 'vitest';
import { SpatialGrid } from './SpatialGrid';

const query = (grid: SpatialGrid, x: number, y: number, z: number, r: number) => {
  const found: number[] = [];
  grid.queryVisit({ x, y, z }, r, (id) => found.push(id));
  return found;
};

describe('SpatialGrid between a removal and the next rebuild', () => {
  // p616 S1: the swap-remove moves the last slot's member into the freed slot, while the cells
  // still hold the old slots, so the moved member is found only in the removed member's cell
  test.fails('still finds a member whose slot a removal moved', () => {
    const grid = new SpatialGrid({ cellSize: 10, maxMembers: 4 });
    grid.addMember(1, 5, 5, 5, 1); // slot 0, cell (0, 0, 0)
    grid.addMember(2, 105, 5, 5, 1); // slot 1, cell (10, 0, 0)
    grid.rebuild();

    grid.removeMember(1); // entity 2 moves into slot 0

    expect(query(grid, 105, 5, 5, 1)).toEqual([2]);
  });
});
