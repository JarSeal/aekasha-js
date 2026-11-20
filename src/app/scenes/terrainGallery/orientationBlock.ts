// The terrain gallery's Orientation block (p310 §2.1, p306 Phase 5's check): `terrainBlockTest`'s
// orientation block (the shared `src/app/terrainBlocks/terrainBlockTestBlender/`, which the scene
// lists), the terrain add-on's export with its corner markers, at its grid place (−3, 3: left of
// the Rules row, behind the Scatter row). Its splat map twin (`terrainBlockTestBlenderSplatMap`,
// the same GLB) would stand on the Rules row, so the gallery spawns the vertex colour block alone
// and the tab draws it with the twin's material (`terrainBlockTestBlenderSplat`, which the scene
// lists): the markers must land on the same corners from the vertex colours and from the UVs.
import { getMaterial, getMeshByAppId, setMeshMaterial } from 'aekasha';
import { spawnTerrainBlock } from 'aekasha/terrain';

/** The block's id, and its twin's material (the splat map's) */
export const ORIENTATION_BLOCK_ID = 'terrainBlockTestBlender';
const VERTEX_MATERIAL_ID = 'terrainBlockTestBlenderVertex';
const SPLAT_MATERIAL_ID = 'terrainBlockTestBlenderSplat';
/** Its centre and side (its JSON's grid: 32 m at (−3, 3)) */
export const ORIENTATION_BLOCK = { x: -96, z: 96, size: 32 } as const;
/** Its extent on the ground */
export const ORIENTATION_BOUNDS = {
  minX: ORIENTATION_BLOCK.x - ORIENTATION_BLOCK.size / 2,
  maxX: ORIENTATION_BLOCK.x + ORIENTATION_BLOCK.size / 2,
  minZ: ORIENTATION_BLOCK.z - ORIENTATION_BLOCK.size / 2,
  maxZ: ORIENTATION_BLOCK.z + ORIENTATION_BLOCK.size / 2,
};

/** Where the block's layer weights come from: its vertex colours, or its splat map at its UVs */
export type OrientationSource = 'VERTEX_COLOR' | 'SPLAT_MAP';

/** The block's mesh entity's app id (`spawnTerrainBlock`'s default) */
export const ORIENTATION_APP_ID = `terrainBlock/${ORIENTATION_BLOCK_ID}`;

/** Spawns the block (the scene's load), drawn by its vertex colours */
export const createOrientationBlockAsync = async () => {
  await spawnTerrainBlock(ORIENTATION_BLOCK_ID);
};

/**
 * Draws the block by its vertex colours or by its twin's splat map (both loaded with the scene)
 * @param source where the layer weights come from
 */
export const setOrientationSource = (source: OrientationSource) => {
  const mesh = getMeshByAppId(ORIENTATION_APP_ID);
  const material = getMaterial(source === 'SPLAT_MAP' ? SPLAT_MATERIAL_ID : VERTEX_MATERIAL_ID);
  if (mesh && material) setMeshMaterial(mesh, material);
};
