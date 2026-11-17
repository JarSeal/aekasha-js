// A terrain block's collider (p306 D2): loaded by `spawnTerrainBlock` with the first block that has
// one, so the terrain feature's own code imports no physics, and an app without `physics()` (a
// block with `collider: { type: 'NONE' }`) loads none. The second feature → feature runtime import
// after character → physics; physics never imports terrain.
import type * as THREE from 'three/webgpu';
import { parseCustomProps } from '../../kernel/assets/import/CustomProps';
import type { ImportedGeometryInfo } from '../../kernel/assets/import/ImportTypes';
import { deriveColliderFromGeometry } from '../physics/import/MeshColliderGeometry';
import { createPhysicsEntity } from '../physics/PhysicsEntity';
import type { ColliderParams } from '../physics/types/PhysicsColliderTypes';
import type { TerrainBlockDef } from './TerrainBlockSchema';
import type { TerrainGeneratorResult } from './TerrainGenerators';

// The block's mesh is placed by its grid, not its node: the collider reads the node's geometry as
// the mesh draws it
const IDENTITY_TRANSFORM: ImportedGeometryInfo['transform'] = {
  position: { x: 0, y: 0, z: 0 },
  quaternion: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
};

/**
 * What the derivation reads the shape from: an imported node's manifest entry with the identity
 * transform, or a stand-in entry for a generated geometry (named after the block and its
 * generator in the derivation's messages; its `aekBlockSize` makes an off-centre grid warn, as an
 * imported block's custom prop does).
 */
const toColliderSource = (
  block: TerrainBlockDef,
  geometry: THREE.BufferGeometry,
  info: ImportedGeometryInfo | undefined
) => ({
  geometry,
  info: info
    ? { ...info, transform: IDENTITY_TRANSFORM }
    : {
        geometryId: String(geometry.userData.id ?? ''),
        importId: `terrainBlock:${block.id}`,
        nodeName: 'generator' in block.geometry ? block.geometry.generator : block.id,
        parentPath: [],
        transform: IDENTITY_TRANSFORM,
        customProps: parseCustomProps({ aekBlockSize: block.grid.size }),
        isDracoCompressed: false,
      },
});

/**
 * Makes a terrain block's collider on its mesh entity, a `FIXED` body: a generator's heightfield
 * as it gave it, else the shape read from the geometry (a `HEIGHTFIELD` of `resolution - 1` cells
 * per side, or a `TRIMESH`).
 * @internal
 * @returns the physics entity's id (the mesh entity's), or undefined when the geometry gave no
 * shape (logged by the derivation: not a regular grid)
 */
export const createTerrainBlockColliderAsync = async ({
  block,
  geometry,
  info,
  heightfield,
  meshEntityId,
}: {
  block: TerrainBlockDef;
  geometry: THREE.BufferGeometry;
  /** An imported block's node */
  info?: ImportedGeometryInfo;
  /** A generated block's heightfield, when its generator gave one */
  heightfield?: TerrainGeneratorResult['heightfield'];
  meshEntityId: number;
}): Promise<number | undefined> => {
  const { type, friction, restitution } = block.collider;
  const cells = block.grid.resolution - 1;
  const shape: ColliderParams | null =
    type === 'HEIGHTFIELD' && heightfield
      ? heightfield
      : deriveColliderFromGeometry(
          type === 'HEIGHTFIELD' ? { type, ncols: cells, nrows: cells } : { type: 'TRIMESH' },
          toColliderSource(block, geometry, info)
        );
  if (!shape) return undefined;
  return createPhysicsEntity({
    colliders: {
      ...shape,
      ...(friction !== undefined ? { friction } : {}),
      ...(restitution !== undefined ? { restitution } : {}),
    },
    body: { rigidType: 'FIXED' },
    target: meshEntityId,
  });
};
