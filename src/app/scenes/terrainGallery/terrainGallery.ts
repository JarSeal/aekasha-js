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
import { COLOR_MAP_ROW_BOUNDS, createColorMapRowAsync } from './colorMapRow';
import { createStructuresRow, STRUCTURES_ROW_BOUNDS } from './structuresRow';
import { createLiveBlock, LIVE_BLOCK_BOUNDS } from './liveBlock';
import { createPatchRowAsync } from './patchRow';
import { createWetRow, WET_ROW_BOUNDS } from './wetRow';
import { createScatterRowAsync, SCATTER_ROW_BOUNDS } from './scatterRow';
import { createDecalsRow, DECALS_ROW_BOUNDS } from './decalsRow';
import { createDecalsStage, DECALS_BENCH_BOUNDS, DECALS_STAGE_BOUNDS } from './decalsStage';
import { createPackingRowAsync, PACKING_ROW_BOUNDS } from './packingRow';
import { createPadBlockAsync, PAD_BOUNDS } from './padBlock';
import { createOrientationBlockAsync } from './orientationBlock';
import {
  createProceduralRowAsync,
  PROCEDURAL_ROW_DEPTH,
  PROCEDURAL_ROW_EDGE_X,
} from './proceduralRow';

/**
 * The terrain gallery (p303 D8): the toolkit's 16 texture sets, one isolated generated block each,
 * drawn by the toolkit's terrain material (p305, its JSON route `terrain`) in the set's default
 * packing, and right of them the Procedural row (p304 Phase 6), the toolkit's ten surface
 * generators. Where p305 adds a row per technique, p307 the Wet/dry row and p310 its camera
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
 * - **The Packing row** (`packingRow.ts`, p310 Phase 1): sand01, grass01 and cliffs01 (the sets
 *   that ship every packing) side by side in FULL, LITE and MINIMAL, a 3 × 3 grid of library
 *   blocks left of the Anti-tiling row; the scene's load loads their other packings.
 * - **The Anti-tiling row** (`antiTilingRow.ts`, p305 Phase 2): three flat 48 × 48 m blocks of
 *   `grass01` 8 m behind the library and the Procedural row, `NONE`, `DUAL_SCALE` and `HEX` from the left, the macro
 *   variation (`macroNoise`, which the scene lists) on; the tab switches the macro and tunes the
 *   modes' and the macro's uniforms.
 * - **The Splatting row** (`splattingRow.ts`, p305 Phase 3): six 24 × 24 m generated blocks left of
 *   the library, several sets each blended by weights painted in code: the vertex colour and the
 *   splat map, each `LINEAR` beside `HEIGHT`, `RGB_AO` with the vertex AO, and 9 layers with two
 *   splat maps; code route materials with storage `AUTO` and the gallery's quality table (p305
 *   Phase 6), whose tiers' sparse sampling makes every block `ARRAY` (the scene's
 *   `textureSetArrays` lists their set arrays); the tab tunes the height blend and the vertex AO.
 * - **The Rules row** (`rulesRow.ts`, p305 Phase 4): three 64 × 64 m blocks in front of the library
 *   on one generated terrain with a cliff band, their layers laid by procedural rules (grass, rocks
 *   by slope, snow by height and facing, cliffs on steep faces): the rules alone, a splat map's
 *   sandy path and mud under the same rules, and (p305 Phase 6, the tiers' terrain) that with
 *   grass02 patches, ice on the flat tops and the macro, 8 layers; the cliffs' layer is slope-gated
 *   `TRIPLANAR` (p305 Phase 5), each block has the toolkit's quality preset and so a set array the
 *   scene lists; the tab tunes the rules.
 * - **The Cliffs row** (`cliffsRow.ts`, p305 Phase 5): four 40 × 40 m blocks in front of the Rules
 *   row on one generated mesa (its face about 48° on one side, 85° on the other), `cliffs01` in
 *   each projection: `PLANAR`, `BIPLANAR`, `TRIPLANAR` and slope-gated `TRIPLANAR`; the tab
 *   switches the normal blend and the gated block's mode and tunes the sharpness and the gate.
 * - **The Colour map row** (`colorMapRow.ts`, p305 Phase 7): four 64 × 64 m blocks in front of the
 *   Cliffs row on the Rules row's terrain: its 8-layer material, then that with a `DETAIL` colour
 *   map, with the far `COLOR_MAP` surface and with the far `AVERAGE_COLOR` one; the two colour maps
 *   are baked during the load from the source material on each block's mesh
 *   (`bakeTerrainColorMap`); the tab tunes the fades and the band and bakes them again.
 * - **The Structures row** (`structuresRow.ts`, p305 Phase 7): structure materials
 *   (`createStructureMaterial`) in front of the Colour map row on pieces made in code: a wall of
 *   two segments in world space and a bunker's passage piece in object space, both worn by their
 *   vertex colour (clean, stained, grime, damage), and two pillars turning and rising in object
 *   space beside world space; the tab pauses them.
 * - **The Wet/dry row** (`wetRow.ts`, p307 Phase 2): 3 × 3 library blocks left of the Splatting
 *   row, a set of each category and a beach (sand, rocks on the ramp by slope), each the terrain
 *   material with `wet` over the surface conditions' wetness, which the scene's JSON holds
 *   (`MANUAL`, 0.6); the tab's slider and steps set it and switch the row's quality and the
 *   `WETNESS` view.
 * - **The Procedural row** (`proceduralRow.ts`): five rows of two blocks 8 m right of the library,
 *   a generator each (`PROCEDURAL_BLOCKS`: sand, mud, rocks and strata, snow and ice, grass and
 *   concrete from the back), baked during the load (`bakeSurfaceGenerator`, 1024² `LITE`: the
 *   loader counts the ten bakes). The tab switches the row between an imported set of each
 *   category, the bake and the generator live in the material.
 * - **The Live block** (`liveBlock.ts`, p305 Phase 8): a 48 × 48 m generated terrain right of the
 *   Procedural row, grass, rocks by slope and snow on the tops laid by rules and sand ripples in
 *   the hollows from the gallery's procedural set `terrainGalleryLiveDunes` (which the scene lists,
 *   so its load bakes it), run live in the terrain material or sampled baked; the quality preset's
 *   tiers put the imported sets in a set array and the procedural set beside it. The tab switches
 *   live and baked, tunes the generator's values and measures both.
 * - **The Blocks patch** (`patchRow.ts`, p306 Phase 3): 3 × 3 terrain blocks of 32 m behind the
 *   Anti-tiling row, past the ground's back edge (a block stands at y = 0, D1), each a
 *   `*.terrainBlock.json` (`patch/`, which the scene lists) of the toolkit's `rulesTerrain`: one
 *   world-continuous noise with `HEIGHT_FN` normals, the rules laid into the vertex colours on the
 *   CPU, the horizon AO in their A. No seams between the blocks; the tab switches its rules to the
 *   shader's (`RULES`, the same rules from the blocks' JSON) on the same blocks, and its AO.
 * - **The Scatter row** (`scatterRow.ts`, p308 Phase 4): one 24 m block in front of the Wet/dry
 *   row, rocks01 patches over sand02 split down the middle (the vertex colour), the toolkit's
 *   procedural pebbles, rocks and boulders (`generateRock`) on the left half's rock in the
 *   `rockScatter` material over rocks01 and its imported ones (Poly Haven's, `models/nature/`, which
 *   the scene lists) on the right half's in `rockScatter` at their own maps' UV, each placed by
 *   `terrainScatter` (`scatter/`, which the scene lists); right of it a 12 m grass02 and mud02 patch
 *   under the toolkit's leaf litter cards (`generateLeafCard`, the `leafLitter` material); the
 *   grounds, the rocks and the leaves wet alike. The tab switches
 *   the weather between dry and wet and flies the camera there.
 * - **The Decals row** (`decalsRow.ts`, p309 Phase 1): the toolkit's decal atlases
 *   (`decalsGround`, `decalsStructure`, which the scene lists) on flat panels right of the Live
 *   block, a row per atlas, a panel per view (the albedo over a ground colour, the opacity, the
 *   normal and roughness, the puddle mask), unlit, each cell outlined and named; the tab flies the
 *   camera there. In front of it the Decals stage (`decalsStage.ts`, p309 Phase 2): two flat 12 m
 *   mud02 blocks with a concrete wall behind each, every cell of both atlases on them as a decal
 *   quad in the toolkit's decal materials, `BLEND` on the left and `CUTOUT` on the right, wet with
 *   the ground; the tab sets the weather, flies the camera to 1, 50 and 200 m and switches the
 *   polygon offset and the edge fade off for comparison. Right of the stage the bake bench (p309
 *   Phase 5, made by the tab with its first bake, `_dbg__terrainGalleryDecalBakes.ts`): a generated
 *   cell baked from its generator, as decals on a third block and wall and on panels of the views
 *   beside the atlas's copy; the tab sets its seed and params, copies its data and exports it. In
 *   front of the stage the footprint pad (`padBlock.ts`, p310 Phase 1): a 16 m terrain block of wet
 *   mud02 the tab stamps footprints on where it's clicked.
 * - **The Orientation block** (`orientationBlock.ts`, p310 Phase 1): `terrainBlockTest`'s
 *   orientation block (p306 Phase 5, the shared `src/app/terrainBlocks/terrainBlockTestBlender/`)
 *   at its grid place left of the Rules row; the tab draws it by its vertex colours or by its
 *   splat map twin's material, whose corner markers must agree.
 * - **The light:** the scene's own DAY_NIGHT sky box standing at 10:00 (`terrainGallerySky`); its
 *   sun and sky are the only lights. No shadows for now (`NO_SHADOWS`).
 *
 * The scene lists the 16 sets (`textureSets`), so their default packing's textures load with it;
 * each block's mesh is a variant of `terrain` naming its set (`matOverrides.inputs.layer0`). The
 * debug env adds the scene's tab (`_dbg__terrainGallery.ts`): the library's material (the terrain
 * material's JSON or code route, or the baseline `textureSetSurface`, which look the same), the set
 * list flying the camera, the packing of the sets that ship every packing, a 1 m checker over the
 * blocks, the quality tier (p305 Phase 6: the library, the Splatting and the Rules rows), and the
 * Procedural row's controls (its mode, bake size, each generator's params, its export and the GPU
 * measurement). p310 adds the rows' signposts and the Rows list (`_dbg__terrainGalleryRows.ts`, the
 * rows as data with the plan's letters), the camera presets per game type
 * (`_dbg__terrainGalleryPresets.ts`), the measurement mode (`_dbg__terrainGalleryMeasure.ts`: solo,
 * a block or a row at each quality tier, the table copied), the time of day, the footprint pad's
 * and the Orientation block's sections.
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
  const visit = { isCurrent: true };
  registerOnSceneExit(TERRAIN_GALLERY_SCENE_ID, () => {
    visit.isCurrent = false;
    for (const cleanup of exitCleanups.splice(0)) cleanup();
  });
  // The ground under the library (centred on x = 0), the Procedural row right of it, the
  // Splatting row left of it and the Wet/dry row left of that, the Anti-tiling row behind it, the Rules row in front, the Cliffs
  // row in front of that, the Colour map row in front of that and the Structures row in front of
  // that
  const left = Math.min(
    -(ROWS[0].length * BLOCK_PITCH) / 2 - BLOCK_GAP / 2,
    ANTI_TILING_ROW_BOUNDS.minX - BLOCK_GAP,
    SPLATTING_ROW_BOUNDS.minX - BLOCK_GAP,
    WET_ROW_BOUNDS.minX - BLOCK_GAP,
    PACKING_ROW_BOUNDS.minX - BLOCK_GAP,
    SCATTER_ROW_BOUNDS.minX - BLOCK_GAP,
    CLIFFS_ROW_BOUNDS.minX - BLOCK_GAP,
    COLOR_MAP_ROW_BOUNDS.minX - BLOCK_GAP,
    STRUCTURES_ROW_BOUNDS.minX - BLOCK_GAP
  );
  const right =
    Math.max(
      PROCEDURAL_ROW_EDGE_X,
      LIVE_BLOCK_BOUNDS.maxX,
      DECALS_ROW_BOUNDS.maxX,
      DECALS_STAGE_BOUNDS.maxX,
      DECALS_BENCH_BOUNDS.maxX,
      PAD_BOUNDS.maxX,
      ANTI_TILING_ROW_BOUNDS.maxX,
      CLIFFS_ROW_BOUNDS.maxX,
      COLOR_MAP_ROW_BOUNDS.maxX,
      STRUCTURES_ROW_BOUNDS.maxX
    ) + BLOCK_GAP;
  const front = Math.max(
    (Math.max(ROWS.length * BLOCK_PITCH, PROCEDURAL_ROW_DEPTH + BLOCK_GAP) + BLOCK_GAP) / 2,
    SPLATTING_ROW_BOUNDS.maxZ + BLOCK_GAP,
    SCATTER_ROW_BOUNDS.maxZ + BLOCK_GAP,
    DECALS_STAGE_BOUNDS.maxZ + BLOCK_GAP,
    PAD_BOUNDS.maxZ + BLOCK_GAP,
    RULES_ROW_BOUNDS.maxZ + BLOCK_GAP,
    CLIFFS_ROW_BOUNDS.maxZ + BLOCK_GAP,
    COLOR_MAP_ROW_BOUNDS.maxZ + BLOCK_GAP,
    STRUCTURES_ROW_BOUNDS.maxZ + BLOCK_GAP
  );
  const back = Math.min(ANTI_TILING_ROW_BOUNDS.minZ, PACKING_ROW_BOUNDS.minZ) - BLOCK_GAP;
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
  await createPackingRowAsync(() => visit.isCurrent);
  if (!visit.isCurrent) return;
  createAntiTilingRow();
  createSplattingRow();
  createWetRow(TERRAIN_GALLERY_SCENE_ID);
  createRulesRow();
  createCliffsRow();
  await createColorMapRowAsync();
  createStructuresRow(TERRAIN_GALLERY_SCENE_ID);
  await createProceduralRowAsync(addGalleryExitCleanup);
  createLiveBlock();
  createDecalsRow();
  createDecalsStage();
  await createScatterRowAsync(() => visit.isCurrent);
  if (!visit.isCurrent) return;
  // Past the ground's back edge (the ground's extent leaves it out): its blocks stand on their own
  await createPatchRowAsync(() => visit.isCurrent, addGalleryExitCleanup);
  if (!visit.isCurrent) return;
  await createPadBlockAsync(() => visit.isCurrent);
  if (!visit.isCurrent) return;
  await createOrientationBlockAsync();
  if (!visit.isCurrent) return;

  // Debug env only: a dynamic import, so the tab's code isn't in a production build. It applies
  // its saved packing and checker once the blocks exist.
  if (IS_DEBUG_ENV) {
    const { createTerrainGalleryTab } = await import('./_dbg__terrainGallery');
    createTerrainGalleryTab();
  }
};
