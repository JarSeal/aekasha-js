import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import type { ImportedGeometryInfo } from '../../../kernel/assets/import/ImportTypes';
import { deriveColliderFromGeometry } from './MeshColliderGeometry';

/** An imported node's metadata: identity transform, no custom props. */
const nodeInfo = (nodeName: string) =>
  ({
    geometryId: `test/${nodeName}`,
    importId: 'test',
    nodeName,
    parentPath: [],
    transform: {
      position: { x: 0, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    },
    customProps: { raw: {} },
    isDracoCompressed: false,
  }) as unknown as ImportedGeometryInfo;

/** A terrain grid of `cols` × `rows` cells, lying in XZ. */
const grid = (cols: number, rows: number) =>
  new THREE.PlaneGeometry(10, 10, cols, rows).rotateX(-Math.PI / 2);

describe('deriveColliderFromGeometry', () => {
  it('reads a square grid into a HEIGHTFIELD', () => {
    const params = deriveColliderFromGeometry(
      { type: 'HEIGHTFIELD' },
      { geometry: grid(2, 2), info: nodeInfo('square') }
    );
    expect(params).toMatchObject({ type: 'HEIGHTFIELD', nrows: 2, ncols: 2 });
    expect(params?.type === 'HEIGHTFIELD' && params.heights?.length).toBe(9);
  });

  it('skips a HEIGHTFIELD whose vertex count makes no square grid (M3)', () => {
    // 3 × 2 vertices: no whole square root, and params without heights would throw in the backend
    expect(
      deriveColliderFromGeometry(
        { type: 'HEIGHTFIELD' },
        { geometry: grid(2, 1), info: nodeInfo('notSquare') }
      )
    ).toBeNull();
  });

  it('skips a HEIGHTFIELD whose given rows leave no whole number of columns (M3)', () => {
    expect(
      deriveColliderFromGeometry(
        { type: 'HEIGHTFIELD', nrows: 4 },
        { geometry: grid(2, 2), info: nodeInfo('badRows') }
      )
    ).toBeNull();
  });
});
