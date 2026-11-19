// The terrain gallery's Packing row (p310 §2.1 row B): the three sets that ship every packing
// (sand01, grass01, cliffs01, a row each from the back) side by side in FULL, LITE and MINIMAL
// (left to right), on library blocks of one seed a set, so a column differs only by its packing;
// cliffs01 has the library's wall. Left of the Anti-tiling row, behind the Wet/dry row. The scene's
// load loads the other packings' textures (the scene's from then on).
import { createMeshEntity, existsOrThrow, getMaterial } from 'aekasha';
import { loadTextureSetAsync, type TextureSetPacking } from 'aekasha/texturesets';
import {
  BLOCK_PITCH,
  GALLERY_MATERIAL_ID,
  getBlockGeometry,
  getSurfaceOverrides,
  getWallGeometry,
  getWallPosition,
  NO_SHADOWS,
} from './galleryBlocks';

/** The packings, left to right */
export const PACKING_ROW_PACKINGS: readonly TextureSetPacking[] = ['FULL', 'LITE', 'MINIMAL'];
/** The sets, from the back (the sets that ship every packing, p303 D6) */
const SETS = ['sand01', 'grass01', 'cliffs01'];
/** Each set's seed: this plus its index (one shape a set, the same in each packing) */
const SEED_BASE = 310;
/** The row's back-left block's centre: left of the Anti-tiling row, behind the Wet/dry row */
const FIRST = { x: -136, z: -88 };

/** A block of the row: its set and packing, where it stands, its terrain's seed */
export type PackingBlock = {
  key: string;
  setId: string;
  packing: TextureSetPacking;
  x: number;
  z: number;
  hasWall: boolean;
  seed: number;
};

/** The nine blocks, by set from the back and packing left to right */
export const PACKING_BLOCKS: readonly PackingBlock[] = SETS.flatMap((setId, row) =>
  PACKING_ROW_PACKINGS.map((packing, col) => ({
    key: `${setId}_${packing}`,
    setId,
    packing,
    x: FIRST.x + col * BLOCK_PITCH,
    z: FIRST.z + row * BLOCK_PITCH,
    hasWall: setId.startsWith('cliffs'),
    seed: SEED_BASE + row,
  }))
);

/** The row's extent on the ground, for the gallery's ground */
export const PACKING_ROW_BOUNDS = {
  minX: FIRST.x - BLOCK_PITCH / 2,
  maxX: FIRST.x + (PACKING_ROW_PACKINGS.length - 0.5) * BLOCK_PITCH,
  minZ: FIRST.z - BLOCK_PITCH / 2,
  maxZ: FIRST.z + (SETS.length - 0.5) * BLOCK_PITCH,
};

/** A block's mesh entity's app id */
export const getPackingAppId = (key: string) => `terrainGallery_packing_${key}`;
/** A cliff block's wall's mesh entity's app id */
export const getPackingWallAppId = (key: string) => `terrainGallery_packing_${key}_wall`;

/**
 * Loads the packings the sets' default doesn't (the scene's from then on), then makes the nine
 * blocks in the gallery's terrain material, each its set in its packing (the tab swaps their
 * variants for its material, view and tier, as the library's)
 * @param isCurrent false once the scene was left during the loads: nothing is made then
 */
export const createPackingRowAsync = async (isCurrent: () => boolean) => {
  await Promise.all(
    SETS.flatMap((setId) =>
      PACKING_ROW_PACKINGS.map((packing) => loadTextureSetAsync(setId, { packing }))
    )
  );
  if (!isCurrent()) return;
  const mat = existsOrThrow(
    getMaterial(GALLERY_MATERIAL_ID),
    `The terrainGallery scene needs the "${GALLERY_MATERIAL_ID}" material.`
  );
  for (const block of PACKING_BLOCKS) {
    const name = `${block.setId} ${block.packing}`;
    createMeshEntity(
      {
        geo: getBlockGeometry(block.seed),
        mat,
        matOverrides: getSurfaceOverrides(block.setId, { packing: block.packing }),
        position: { x: block.x, z: block.z },
        ...NO_SHADOWS,
      },
      { appId: getPackingAppId(block.key), debugData: { name: `Packing: ${name}` } }
    );
    if (!block.hasWall) continue;
    createMeshEntity(
      {
        geo: getWallGeometry(),
        mat,
        matOverrides: getSurfaceOverrides(block.setId, { packing: block.packing, isWall: true }),
        position: getWallPosition(block),
        ...NO_SHADOWS,
      },
      {
        appId: getPackingWallAppId(block.key),
        debugData: { name: `Packing: ${name}, wall` },
      }
    );
  }
};
