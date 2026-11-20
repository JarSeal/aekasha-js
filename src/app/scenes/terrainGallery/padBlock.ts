// The terrain gallery's footprint pad (p310 §2.1 row L): a 16 m terrain block of wet mud02
// (`pad/terrainGalleryPad.terrainBlock.json`, which the scene lists) in front of the Decals stage,
// where the debug tab stamps footprints on a click (`_dbg__terrainGalleryPad.ts`): runtime decals
// lie on a terrain block's own grid, so the pad is a block, not a mesh made here.
import { spawnTerrainBlock, type TerrainBlock } from 'aekasha/terrain';

/** The pad's terrain block id */
export const PAD_BLOCK_ID = 'terrainGalleryPad';
/** Its side and centre (its JSON's grid: 16 m at (9, 2)) */
export const PAD_BLOCK = { x: 144, z: 32, size: 16 } as const;
/** Its extent on the ground */
export const PAD_BOUNDS = {
  minX: PAD_BLOCK.x - PAD_BLOCK.size / 2,
  maxX: PAD_BLOCK.x + PAD_BLOCK.size / 2,
  minZ: PAD_BLOCK.z - PAD_BLOCK.size / 2,
  maxZ: PAD_BLOCK.z + PAD_BLOCK.size / 2,
};

/** The pad as this visit spawned it, or null (not yet, or the scene left) */
let pad: TerrainBlock | null = null;

/** The pad's block, once the scene's load spawned it */
export const getPadBlock = () => pad;

/**
 * Spawns the pad (the scene's load)
 * @param isCurrent false once the scene was left during the spawn: the block isn't kept then
 */
export const createPadBlockAsync = async (isCurrent: () => boolean) => {
  pad = null;
  const block = await spawnTerrainBlock(PAD_BLOCK_ID);
  if (block && isCurrent()) pad = block;
};
