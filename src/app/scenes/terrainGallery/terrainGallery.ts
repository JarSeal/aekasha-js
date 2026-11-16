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
import { ANTI_TILING_ROW_BOUNDS, createAntiTilingRow } from './antiTilingRow';
import { createSplattingRow, SPLATTING_ROW_BOUNDS } from './splattingRow';
import { createRulesRow, RULES_ROW_BOUNDS } from './rulesRow';
import { CLIFFS_ROW_BOUNDS, createCliffsRow } from './cliffsRow';
import {
  createProceduralRowAsync,
  PROCEDURAL_ROW_DEPTH,
  PROCEDURAL_ROW_EDGE_X,
} from './proceduralRow';

/**
 * The terrain gallery (p303 D8): the toolkit's 16 texture sets, one isolated generated block each,
 * drawn by the toolkit's terrain material (p305, its JSON route `terrain`) in the set's default
 * packing, and right of them the Procedural row (p304 Phase 6), the toolkit's ten surface
 * generators. Where p305 adds a row per technique, p307 the wet controls and p310 its camera
 * presets and measurements.
 *
 * - **The library:** 4 × 4 blocks of 12 × 12 m with 4 m gaps over a dark ground, a row per pair of
 *   categories from the back (−z): sand and mud, rocks and cliffs, snow and ice, grass and
 *   concrete (`GALLERY_BLOCKS`, the debug tab's list).
 * - **A block** (`galleryBlocks.ts`): `generateTerrain` at 48 segments, gentle 0.4 m noise, a seed
 *   of its own, and its back edge (−z) raised into a 35° ramp, so the normals' orientation and the
 *   sun on a slope can be judged; the terrain material tiles it at the world's `(x, −z)` over the
 *   set's `physicalSize`.
 * - **The cliffs' walls:** a 6 m wall on the left of each `cliffs*` block, tiled at its UVs in
 *   metres (`uv: "MESH_UV"`).
 * - **The Anti-tiling row** (`antiTilingRow.ts`, p305 Phase 2): three flat 48 × 48 m blocks of
 *   `grass01` 8 m behind the library and the Procedural row, `NONE`, `DUAL_SCALE` and `HEX` from the left, the macro
 *   variation (`macroNoise`, which the scene lists) on; the tab switches the macro and tunes the
 *   modes' and the macro's uniforms.
 * - **The Splatting row** (`splattingRow.ts`, p305 Phase 3): six 24 × 24 m generated blocks left of
 *   the library, several sets each blended by weights painted in code: the vertex colour and the
 *   splat map, each `LINEAR` beside `HEIGHT`, `RGB_AO` with the vertex AO, and 9 layers with two
 *   splat maps; code route materials with storage `AUTO`, which makes the splat blocks `ARRAY` (the
 *   scene's `textureSetArrays` lists their two set arrays); the tab tunes the height blend and the
 *   vertex AO.
 * - **The Rules row** (`rulesRow.ts`, p305 Phase 4): two 64 × 64 m blocks in front of the library on
 *   one generated terrain with a cliff band, their layers laid by procedural rules (grass, rocks by
 *   slope, snow by height and facing, cliffs on steep faces): the rules alone, and a splat map's
 *   sandy path and mud under the same rules (its 6 sets a set array the scene lists); the cliffs'
 *   layer is slope-gated `TRIPLANAR` (p305 Phase 5); the tab tunes the rules.
 * - **The Cliffs row** (`cliffsRow.ts`, p305 Phase 5): four 40 × 40 m blocks in front of the Rules
 *   row on one generated mesa (its face about 48° on one side, 85° on the other), `cliffs01` in
 *   each projection: `PLANAR`, `BIPLANAR`, `TRIPLANAR` and slope-gated `TRIPLANAR`; the tab
 *   switches the normal blend and the gated block's mode and tunes the sharpness and the gate.
 * - **The Procedural row** (`proceduralRow.ts`): five rows of two blocks 8 m right of the library,
 *   a generator each (`PROCEDURAL_BLOCKS`: sand, mud, rocks and strata, snow and ice, grass and
 *   concrete from the back), baked during the load (`bakeSurfaceGenerator`, 1024² `LITE`: the
 *   loader counts the ten bakes). The tab switches the row between an imported set of each
 *   category, the bake and the generator live in the material.
 * - **The light:** the scene's own DAY_NIGHT sky box standing at 10:00 (`terrainGallerySky`); its
 *   sun and sky are the only lights. No shadows for now (`NO_SHADOWS`).
 *
 * The scene lists the 16 sets (`textureSets`), so their default packing's textures load with it;
 * each block's mesh is a variant of `terrain` naming its set (`matOverrides.inputs.layer0`). The
 * debug env adds the scene's tab (`_dbg__terrainGallery.ts`): the library's material (the terrain
 * material's JSON or code route, or the baseline `textureSetSurface`, which look the same), the set
 * list flying the camera, the packing of the sets that ship every packing, a 1 m checker over the
 * blocks, and the Procedural row's controls (its mode, bake size, each generator's params, its
 * export and the GPU measurement).
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
  // The ground under the library (centred on x = 0), the Procedural row right of it, the
  // Splatting row left of it, the Anti-tiling row behind it, the Rules row in front and the Cliffs
  // row in front of that
  const left = Math.min(
    -(ROWS[0].length * BLOCK_PITCH) / 2 - BLOCK_GAP / 2,
    ANTI_TILING_ROW_BOUNDS.minX - BLOCK_GAP,
    SPLATTING_ROW_BOUNDS.minX - BLOCK_GAP,
    CLIFFS_ROW_BOUNDS.minX - BLOCK_GAP
  );
  const right =
    Math.max(PROCEDURAL_ROW_EDGE_X, ANTI_TILING_ROW_BOUNDS.maxX, CLIFFS_ROW_BOUNDS.maxX) +
    BLOCK_GAP;
  const front = Math.max(
    (Math.max(ROWS.length * BLOCK_PITCH, PROCEDURAL_ROW_DEPTH + BLOCK_GAP) + BLOCK_GAP) / 2,
    SPLATTING_ROW_BOUNDS.maxZ + BLOCK_GAP,
    RULES_ROW_BOUNDS.maxZ + BLOCK_GAP,
    CLIFFS_ROW_BOUNDS.maxZ + BLOCK_GAP
  );
  const back = ANTI_TILING_ROW_BOUNDS.minZ - BLOCK_GAP;
  createMeshEntity(
    {
      geo: {
        id: 'terrainGalleryGround',
        type: 'BOX',
        params: { width: right - left, height: 0.2, depth: front - back },
      },
      mat: {
        id: 'terrainGalleryGround',
        type: 'STANDARD',
        params: { color: '#2e2f31', roughness: 0.95 },
      },
      position: { x: (left + right) / 2, y: GROUND_Y - 0.1, z: (front + back) / 2 },
      ...NO_SHADOWS,
    },
    { appId: 'terrainGallery_ground', debugData: { name: 'Gallery ground' } }
  );
  GALLERY_BLOCKS.forEach((block, i) => createBlock(block, SEED_BASE + i));
  createAntiTilingRow();
  createSplattingRow();
  createRulesRow();
  createCliffsRow();
  await createProceduralRowAsync(addGalleryExitCleanup);

  // Debug env only: a dynamic import, so the tab's code isn't in a production build. It applies
  // its saved packing and checker once the blocks exist.
  if (IS_DEBUG_ENV) {
    const { createTerrainGalleryTab } = await import('./_dbg__terrainGallery');
    createTerrainGalleryTab();
  }
};
