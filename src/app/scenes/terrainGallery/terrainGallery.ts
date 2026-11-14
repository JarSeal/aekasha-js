import {
  createMeshEntity,
  existsOrThrow,
  getMaterial,
  IS_DEBUG_ENV,
  registerOnSceneExit,
} from 'aekasha';
import {
  BLOCK_GAP,
  BLOCK_PITCH,
  GALLERY_MATERIAL_ID,
  getBlockGeometry,
  getBlockGeometryId,
  getSurfaceOverrides,
  getWallGeometry,
  getWallPosition,
  NO_SHADOWS,
} from './galleryBlocks';
import {
  createProceduralRowAsync,
  PROCEDURAL_ROW_DEPTH,
  PROCEDURAL_ROW_EDGE_X,
} from './proceduralRow';

/**
 * The terrain gallery (p303 D8): the toolkit's 16 texture sets, one isolated generated block each,
 * drawn by the toolkit's baseline material `textureSetSurface` in the set's default packing, and
 * right of them the Procedural row (p304 Phase 6), the toolkit's ten surface generators. The place
 * p305 compares its techniques against, p307 adds the wet controls to and p310 its camera presets
 * and measurements.
 *
 * - **The library:** 4 × 4 blocks of 12 × 12 m with 4 m gaps over a dark ground, a row per pair of
 *   categories from the back (−z): sand and mud, rocks and cliffs, snow and ice, grass and
 *   concrete (`GALLERY_BLOCKS`, the debug tab's list).
 * - **A block** (`galleryBlocks.ts`): `generateTerrain` at 48 segments, gentle 0.4 m noise, a seed
 *   of its own, and its back edge (−z) raised into a 35° ramp, so the normals' orientation and the
 *   sun on a slope can be judged; `textureSetSurface` tiles it at the world's `(x, −z)` over the
 *   set's `physicalSize`.
 * - **The cliffs' walls:** a 6 m wall on the left of each `cliffs*` block, tiled at its UVs in
 *   metres (`tiling: "UV"`).
 * - **The Procedural row** (`proceduralRow.ts`): five rows of two blocks 8 m right of the library,
 *   a generator each (`PROCEDURAL_BLOCKS`: sand, mud, rocks and strata, snow and ice, grass and
 *   concrete from the back), baked during the load (`bakeSurfaceGenerator`, 1024² `LITE`: the
 *   loader counts the ten bakes). The tab switches the row between an imported set of each
 *   category, the bake and the generator live in the material.
 * - **The light:** the scene's own DAY_NIGHT sky box standing at 10:00 (`terrainGallerySky`); its
 *   sun and sky are the only lights. No shadows for now (`NO_SHADOWS`).
 *
 * The scene lists the 16 sets (`textureSets`), so their default packing's textures load with it;
 * each block's mesh is a variant of `textureSetSurface` naming its set (`matOverrides.inputs`). The
 * debug env adds the scene's tab (`_dbg__terrainGallery.ts`): the set list flying the camera, the
 * packing of the sets that ship every packing, a 1 m checker over the blocks, and the Procedural
 * row's controls (its mode, bake size, each generator's params, its export and the GPU
 * measurement).
 */

export const TERRAIN_GALLERY_SCENE_ID = 'terrainGallery';
/** The scene's camera (`terrainGalleryCamera.camera.json`), which the tab flies */
export const TERRAIN_GALLERY_CAMERA_APP_ID = 'terrainGalleryCamera';
/** The sets that ship `FULL` and `MINIMAL` besides `LITE` (p303 D6), for the packing selector */
export const ALL_PACKING_SETS: readonly string[] = ['sand01', 'grass01', 'cliffs01'];

/** A block of the library: its set and where it stands */
export type GalleryBlock = {
  setId: string;
  /** The block's centre on the ground (its mesh's position) */
  x: number;
  z: number;
  /** Whether it has a wall (the `cliffs*` sets) */
  hasWall: boolean;
  /** Its terrain's geometry id (its seed's) */
  geometryId: string;
};

/** Rows from the back (−z), the sets of a row left to right */
const ROWS = [
  ['sand01', 'sand02', 'mud01', 'mud02'],
  ['rocks01', 'rocks02', 'cliffs01', 'cliffs02'],
  ['snow01', 'snow02', 'ice01', 'ice02'],
  ['grass01', 'grass02', 'concrete01', 'concrete02'],
];

const GROUND_Y = -0.6;
/** Each block's seed: this plus its index, so no two blocks share their noise */
const SEED_BASE = 303;

/** The 16 library blocks, by row from the back and left to right */
export const GALLERY_BLOCKS: readonly GalleryBlock[] = ROWS.flatMap((sets, row) =>
  sets.map((setId, col) => ({
    setId,
    x: (col - (sets.length - 1) / 2) * BLOCK_PITCH,
    z: (row - (ROWS.length - 1) / 2) * BLOCK_PITCH,
    hasWall: setId.startsWith('cliffs'),
    geometryId: getBlockGeometryId(SEED_BASE + row * sets.length + col),
  }))
);

/** A library block's mesh entity's app id */
export const getBlockAppId = (setId: string) => `terrainGallery_${setId}`;
/** A cliff block's wall's mesh entity's app id */
export const getWallAppId = (setId: string) => `terrainGallery_${setId}_wall`;

/** This visit's cleanups: the scene has one exit function (`registerOnSceneExit`), which runs
 * them */
const exitCleanups: (() => void)[] = [];

/**
 * Adds a function the scene's exit runs (the row's and the tab's: `registerOnSceneExit` keeps one
 * function per scene, so they share the scene's)
 */
export const addGalleryExitCleanup = (cleanup: () => void) => {
  exitCleanups.push(cleanup);
};

const createBlock = (block: GalleryBlock, seed: number) => {
  const mat = existsOrThrow(
    getMaterial(GALLERY_MATERIAL_ID),
    `The terrainGallery scene needs the "${GALLERY_MATERIAL_ID}" material.`
  );
  createMeshEntity(
    {
      geo: getBlockGeometry(seed),
      mat,
      matOverrides: getSurfaceOverrides(block.setId),
      position: { x: block.x, z: block.z },
      ...NO_SHADOWS,
    },
    { appId: getBlockAppId(block.setId), debugData: { name: `Block: ${block.setId}` } }
  );
  if (!block.hasWall) return;
  createMeshEntity(
    {
      geo: getWallGeometry(),
      mat,
      matOverrides: getSurfaceOverrides(block.setId, { isWall: true }),
      position: getWallPosition(block),
      ...NO_SHADOWS,
    },
    {
      appId: getWallAppId(block.setId),
      debugData: { name: `Wall: ${block.setId}` },
    }
  );
};

export const scene = async () => {
  exitCleanups.length = 0;
  registerOnSceneExit(TERRAIN_GALLERY_SCENE_ID, () => {
    for (const cleanup of exitCleanups.splice(0)) cleanup();
  });
  // The ground under the library (centred on x = 0) and the Procedural row right of it
  const left = -(ROWS[0].length * BLOCK_PITCH) / 2 - BLOCK_GAP / 2;
  const right = PROCEDURAL_ROW_EDGE_X + BLOCK_GAP;
  const depth = Math.max(ROWS.length * BLOCK_PITCH, PROCEDURAL_ROW_DEPTH + BLOCK_GAP) + BLOCK_GAP;
  createMeshEntity(
    {
      geo: {
        id: 'terrainGalleryGround',
        type: 'BOX',
        params: { width: right - left, height: 0.2, depth },
      },
      mat: {
        id: 'terrainGalleryGround',
        type: 'STANDARD',
        params: { color: '#2e2f31', roughness: 0.95 },
      },
      position: { x: (left + right) / 2, y: GROUND_Y - 0.1 },
      ...NO_SHADOWS,
    },
    { appId: 'terrainGallery_ground', debugData: { name: 'Gallery ground' } }
  );
  GALLERY_BLOCKS.forEach((block, i) => createBlock(block, SEED_BASE + i));
  await createProceduralRowAsync(addGalleryExitCleanup);

  // Debug env only: a dynamic import, so the tab's code isn't in a production build. It applies
  // its saved packing and checker once the blocks exist.
  if (IS_DEBUG_ENV) {
    const { createTerrainGalleryTab } = await import('./_dbg__terrainGallery');
    createTerrainGalleryTab();
  }
};
