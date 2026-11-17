import { describe, expect, it } from 'vitest';
import {
  type ExportedBlock,
  checkHeightfield,
  checkSharedEdges,
  checkUvs,
  checkWorkflowBlock,
} from './terrainBlockChecks';

type BlockOptions = {
  id?: string;
  size?: number;
  resolution?: number;
  gridX?: number;
  gridZ?: number;
  /** The height at the engine's local x, z */
  height?: (x: number, z: number) => number;
  /** The colour at a row (along +z) and column (along +x) */
  color?: (row: number, col: number) => [number, number, number, number];
};

/** A block as the add-on exports it: vertex `row · res + col`, each cell split along the
 * heightfield's diagonal, D1's custom props */
const makeBlock = ({
  id = 'block',
  size = 8,
  resolution = 5,
  gridX = 0,
  gridZ = 0,
  height = () => 0,
  color = () => [0, 0, 0, 1],
}: BlockOptions = {}): ExportedBlock => {
  const count = resolution * resolution;
  const positions = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const colors = new Float32Array(count * 4);
  const normals = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / resolution);
    const col = i % resolution;
    const x = (col / (resolution - 1) - 0.5) * size;
    const z = (row / (resolution - 1) - 0.5) * size;
    positions.set([x, height(x + gridX * size, z + gridZ * size), z], i * 3);
    uvs.set([col / (resolution - 1), row / (resolution - 1)], i * 2);
    colors.set(color(row, col), i * 4);
    normals.set([0, 1, 0], i * 3);
  }
  const indices: number[] = [];
  for (let row = 0; row < resolution - 1; row++) {
    for (let col = 0; col < resolution - 1; col++) {
      const a = row * resolution + col;
      indices.push(a, a + resolution, a + 1, a + 1, a + resolution, a + resolution + 1);
    }
  }
  return {
    id,
    size,
    resolution,
    gridX,
    gridZ,
    layout: 'RGB_AO',
    nodeName: id,
    extras: {
      colliderType: 'HEIGHTFIELD',
      nCols: resolution - 1,
      nRows: resolution - 1,
      isPhysObj: 1,
      keepMesh: 1,
      rigidType: 'FIXED',
      aekBlockSize: size,
      aekBlockRes: resolution,
      aekGridX: gridX,
      aekGridZ: gridZ,
    },
    positions,
    normals,
    uvs,
    colors,
    indices: Uint32Array.from(indices),
  };
};

/** A spike at the engine's +x, -z corner's neighbour */
const spike = (x: number, z: number) => (x === 2 && z === -2 ? 3 : 0);

describe('checkHeightfield', () => {
  it('passes a block whose collider the import reads where its vertices are', () => {
    expect(checkHeightfield(makeBlock({ height: spike }))).toEqual([]);
  });

  it('fails custom props of another grid, and a vertex moved off its grid point', () => {
    const block = makeBlock({ height: spike });
    block.extras.nCols = 3;
    expect(checkHeightfield(block).join(' ')).toContain('3 × 4 cells, not 4 × 4');
    const moved = makeBlock();
    moved.positions[6 * 3] += 0.5;
    expect(checkHeightfield(moved).join(' ')).toContain('not a regular grid');
  });

  it('fails a block without a visible fixed body', () => {
    const block = makeBlock();
    delete block.extras.keepMesh;
    expect(checkHeightfield(block).join(' ')).toContain('not a visible fixed body');
  });
});

describe('checkUvs', () => {
  it('passes the top-down projection and fails a flipped V', () => {
    const block = makeBlock();
    expect(checkUvs(block)).toEqual([]);
    for (let i = 1; i < block.uvs.length; i += 2) block.uvs[i] = 1 - block.uvs[i];
    expect(checkUvs(block)).toHaveLength(1);
  });
});

describe('checkWorkflowBlock', () => {
  const expected = { id: 'block', bump: { x: 2, z: -2, height: 3, radius: 1 }, markerVertices: 2 };
  const markers = (row: number, col: number): [number, number, number, number] => [
    row < 2 && col < 2 ? 1 : 0,
    row < 2 && col > 2 ? 1 : 0,
    0,
    row === 1 && col === 3 ? 0.5 : 1,
  ];

  it('passes the markers in their corners, the bump in its place and some AO', () => {
    const { problems, ao } = checkWorkflowBlock(
      makeBlock({ height: spike, color: markers }),
      expected
    );
    expect(problems).toEqual([]);
    expect(ao).toEqual({ min: 0.5, flat: 1 });
  });

  it('fails markers mirrored in x, and a bump in another corner', () => {
    const mirrored = (row: number, col: number) => markers(row, 4 - col);
    const block = makeBlock({ height: (x, z) => spike(x, -z), color: mirrored });
    const problems = checkWorkflowBlock(block, expected).problems.join(' ');
    expect(problems).toContain("the bump's peak is at x 2, z 2");
    expect(problems).toContain("8 vertices' splat off the corner markers");
  });
});

describe('checkSharedEdges', () => {
  const height = (x: number, z: number) => Math.sin(x) + z / 4;

  it('passes neighbours sharing an edge exactly', () => {
    const west = makeBlock({ id: 'west', height });
    const east = makeBlock({ id: 'east', gridX: 1, height });
    expect(checkSharedEdges([west, east])).toEqual({ problems: [], shared: 5, normalGap: 0 });
  });

  it('fails an edge height off by a little', () => {
    const west = makeBlock({ id: 'west', height });
    const east = makeBlock({ id: 'east', gridX: 1, height });
    east.positions[2 * 5 * 3 + 1] += 1e-6;
    expect(checkSharedEdges([west, east]).problems[0]).toMatch(
      /^east vertex 10 and west vertex 14/
    );
  });
});
