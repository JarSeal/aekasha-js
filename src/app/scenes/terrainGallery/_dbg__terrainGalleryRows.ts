// The terrain gallery's rows as data (p310 Phase 1): each row's letter (the plan's §2.1 table),
// title, extent and blocks, which the tab's Rows list, the signposts, the camera presets and the
// measurement read, so a row added later is one entry here. The signposts are one world anchor
// layer over the canvas, an anchor per row at its front edge (+z, the side the overview faces).
import { getECSWorld } from 'aekasha';
import { createWorldAnchorLayer, getHUDRootCMP, type WorldAnchorLayer } from 'aekasha/ui';
import { registerWorldAnchorSync, unregisterWorldAnchorSync } from 'aekasha/toolkit/ecs';
import { getBoundsPose, type GalleryCameraPose } from './_dbg__terrainGalleryCamera';
import { BLOCK_SIZE } from './galleryBlocks';
import {
  ANTI_TILING_BLOCK_SIZE,
  ANTI_TILING_BLOCKS,
  ANTI_TILING_ROW_BOUNDS,
} from './antiTilingRow';
import {
  SPLATTING_BLOCK_SIZE,
  SPLATTING_BLOCK_Y,
  SPLATTING_BLOCKS,
  SPLATTING_ROW_BOUNDS,
} from './splattingRow';
import { getRulesTerrain, RULES_BLOCK_SIZE, RULES_BLOCKS, RULES_ROW_BOUNDS } from './rulesRow';
import { CLIFFS_BLOCK_SIZE, CLIFFS_BLOCK_Y, CLIFFS_BLOCKS, CLIFFS_ROW_BOUNDS } from './cliffsRow';
import { COLOR_MAP_BLOCKS, COLOR_MAP_ROW_BOUNDS } from './colorMapRow';
import { STRUCTURES_PIECES, STRUCTURES_ROW_BOUNDS } from './structuresRow';
import { WET_BLOCKS, WET_ROW_BOUNDS } from './wetRow';
import { LEAF_BLOCK, SCATTER_BLOCK, SCATTER_ROW_BOUNDS } from './scatterRow';
import { DECALS_ROW_BOUNDS } from './decalsRow';
import {
  DECALS_BENCH_BLOCK,
  DECALS_BENCH_BOUNDS,
  DECALS_STAGE_BLOCKS,
  DECALS_STAGE_BOUNDS,
} from './decalsStage';
import { PROCEDURAL_BLOCKS, PROCEDURAL_ROW_DEPTH, PROCEDURAL_ROW_EDGE_X } from './proceduralRow';
import { LIVE_BLOCK, LIVE_BLOCK_BOUNDS, LIVE_BLOCK_SIZE } from './liveBlock';
import { PATCH_BLOCK_IDS, PATCH_BLOCK_SIZE, PATCH_BOUNDS } from './patchRow';
import { GALLERY_BLOCKS } from './terrainGallery';

/** A block of a row: its key in the row, its label, its centre (`y` its ground) and its side */
export type GalleryRowBlock = {
  key: string;
  label: string;
  x: number;
  y: number;
  z: number;
  size: number;
};

/** A row's extent on the ground */
export type GalleryBounds = { minX: number; maxX: number; minZ: number; maxZ: number };

/** A row of the gallery: what it shows and where */
export type GalleryRow = {
  /** The list's key */
  id: string;
  /** The plan's §2.1 letter (`—` for none) */
  letter: string;
  title: string;
  /** What it shows, one line */
  shows: string;
  bounds: GalleryBounds;
  /** The height its blocks stand at (a signpost's foot) */
  getY: () => number;
  /** Its blocks, read when asked (the Rules row's lift is its load's) */
  getBlocks: () => GalleryRowBlock[];
};

/** The gallery's ground top, where the rows on it stand (`GROUND_TOP_Y` of the row modules) */
const GROUND_TOP_Y = -0.6;
/** How far above a row's ground its signpost stands, metres */
const SIGNPOST_HEIGHT = 2;
/** The decal stage's flat blocks' side, metres (`decalsStage.ts`' own) */
const DECALS_STAGE_BLOCK_SIZE = 12;
/** The Structures row's pieces' nominal side, metres (a wall segment, the bunker, a pillar) */
const STRUCTURES_PIECE_SIZE = 12;

const boundsOf = (blocks: readonly { x: number; z: number; size: number }[]): GalleryBounds => ({
  minX: Math.min(...blocks.map((block) => block.x - block.size / 2)),
  maxX: Math.max(...blocks.map((block) => block.x + block.size / 2)),
  minZ: Math.min(...blocks.map((block) => block.z - block.size / 2)),
  maxZ: Math.max(...blocks.map((block) => block.z + block.size / 2)),
});

/** The Procedural row's extent: two columns of library blocks left of its edge */
const PROCEDURAL_BOUNDS = boundsOf(
  PROCEDURAL_BLOCKS.map(({ x, z }) => ({ x, z, size: BLOCK_SIZE }))
);

/** The patch's blocks' centres, from its extent (3 × 3, by column then row as their ids) */
const getPatchBlocks = (): GalleryRowBlock[] =>
  PATCH_BLOCK_IDS.map((id, i) => ({
    key: id,
    label: id.replace('terrainGalleryPatch_', ''),
    x: PATCH_BOUNDS.minX + (Math.floor(i / 3) + 0.5) * PATCH_BLOCK_SIZE,
    y: 0,
    z: PATCH_BOUNDS.minZ + ((i % 3) + 0.5) * PATCH_BLOCK_SIZE,
    size: PATCH_BLOCK_SIZE,
  }));

/** The rows, by the plan's letter */
export const GALLERY_ROWS: readonly GalleryRow[] = [
  {
    id: 'library',
    letter: 'A',
    title: 'Library',
    shows: 'Every texture set alone, 12 m blocks',
    bounds: boundsOf(GALLERY_BLOCKS.map(({ x, z }) => ({ x, z, size: BLOCK_SIZE }))),
    getY: () => 0,
    getBlocks: () =>
      GALLERY_BLOCKS.map(({ setId, x, z }) => ({
        key: setId,
        label: setId,
        x,
        y: 0,
        z,
        size: BLOCK_SIZE,
      })),
  },
  {
    id: 'antiTiling',
    letter: 'C',
    title: 'Anti-tiling',
    shows: 'NONE, DUAL_SCALE and HEX on 48 m of grass01, the macro variation',
    bounds: ANTI_TILING_ROW_BOUNDS,
    getY: () => 0,
    getBlocks: () =>
      ANTI_TILING_BLOCKS.map(({ mode, x, z }) => ({
        key: mode,
        label: mode,
        x,
        y: 0,
        z,
        size: ANTI_TILING_BLOCK_SIZE,
      })),
  },
  {
    id: 'splatting',
    letter: 'D',
    title: 'Splatting',
    shows: 'Vertex colour and splat map, LINEAR against HEIGHT, RGB_AO, 9 layers',
    bounds: SPLATTING_ROW_BOUNDS,
    getY: () => SPLATTING_BLOCK_Y,
    getBlocks: () =>
      SPLATTING_BLOCKS.map(({ key, title, x, z }) => ({
        key,
        label: title,
        x,
        y: SPLATTING_BLOCK_Y,
        z,
        size: SPLATTING_BLOCK_SIZE,
      })),
  },
  {
    id: 'rules',
    letter: 'E',
    title: 'Rules',
    shows: 'Layers laid by procedural rules on 64 m blocks',
    bounds: RULES_ROW_BOUNDS,
    getY: () => getRulesTerrain().y,
    getBlocks: () =>
      RULES_BLOCKS.map(({ key, title, x, z }) => ({
        key,
        label: title,
        x,
        y: getRulesTerrain().y,
        z,
        size: RULES_BLOCK_SIZE,
      })),
  },
  {
    id: 'patch',
    letter: 'E',
    title: 'Blocks patch',
    shows: 'rulesTerrain blocks: the rules on the CPU against in the shader',
    bounds: PATCH_BOUNDS,
    getY: () => 0,
    getBlocks: getPatchBlocks,
  },
  {
    id: 'cliffs',
    letter: 'F',
    title: 'Cliffs',
    shows: 'PLANAR, BIPLANAR, TRIPLANAR and slope-gated on a mesa',
    bounds: CLIFFS_ROW_BOUNDS,
    getY: () => CLIFFS_BLOCK_Y,
    getBlocks: () =>
      CLIFFS_BLOCKS.map(({ key, title, x, z }) => ({
        key,
        label: title,
        x,
        y: CLIFFS_BLOCK_Y,
        z,
        size: CLIFFS_BLOCK_SIZE,
      })),
  },
  {
    id: 'procedural',
    letter: 'G',
    title: 'Procedural',
    shows: 'A block per surface generator: imported, baked or live',
    bounds: {
      ...PROCEDURAL_BOUNDS,
      maxX: PROCEDURAL_ROW_EDGE_X,
      maxZ: PROCEDURAL_BOUNDS.minZ + PROCEDURAL_ROW_DEPTH,
    },
    getY: () => 0,
    getBlocks: () =>
      PROCEDURAL_BLOCKS.map(({ generator, x, z }) => ({
        key: generator.id,
        label: generator.id,
        x,
        y: 0,
        z,
        size: BLOCK_SIZE,
      })),
  },
  {
    id: 'live',
    letter: 'G',
    title: 'Live block',
    shows: 'A procedural set run live in the terrain material, or baked',
    bounds: LIVE_BLOCK_BOUNDS,
    getY: () => GROUND_TOP_Y,
    getBlocks: () => [
      { key: 'live', label: 'Live block', ...LIVE_BLOCK, y: GROUND_TOP_Y, size: LIVE_BLOCK_SIZE },
    ],
  },
  {
    id: 'colorMap',
    letter: 'H',
    title: 'Colour map',
    shows: 'The 8 layers, DETAIL, far COLOR_MAP and far AVERAGE_COLOR',
    bounds: COLOR_MAP_ROW_BOUNDS,
    getY: () => getRulesTerrain().y,
    getBlocks: () =>
      COLOR_MAP_BLOCKS.map(({ key, title, x, z }) => ({
        key,
        label: title,
        x,
        y: getRulesTerrain().y,
        z,
        size: RULES_BLOCK_SIZE,
      })),
  },
  {
    id: 'structures',
    letter: 'I',
    title: 'Structures',
    shows: 'Structure materials in world and object space, worn by vertex colour',
    bounds: STRUCTURES_ROW_BOUNDS,
    getY: () => GROUND_TOP_Y,
    getBlocks: () =>
      STRUCTURES_PIECES.map(({ key, title, x, z }) => ({
        key,
        label: title,
        x,
        y: GROUND_TOP_Y,
        z,
        size: STRUCTURES_PIECE_SIZE,
      })),
  },
  {
    id: 'wet',
    letter: 'J',
    title: 'Wet/dry',
    shows: 'A set of each category and a beach under the surface conditions',
    bounds: WET_ROW_BOUNDS,
    getY: () => 0,
    getBlocks: () =>
      WET_BLOCKS.map(({ key, title, x, z }) => ({
        key,
        label: title,
        x,
        y: 0,
        z,
        size: BLOCK_SIZE,
      })),
  },
  {
    id: 'scatter',
    letter: 'K',
    title: 'Scatter',
    shows: 'Procedural against imported rocks, leaf cards',
    bounds: SCATTER_ROW_BOUNDS,
    getY: () => 0,
    getBlocks: () => [
      { key: 'rocks', label: 'Rocks', ...SCATTER_BLOCK, y: 0 },
      { key: 'leaves', label: 'Leaf litter', ...LEAF_BLOCK, y: 0 },
    ],
  },
  {
    id: 'decals',
    letter: 'L',
    title: 'Decals',
    shows: 'The atlases, BLEND and CUTOUT decals on the stage, the bake bench',
    bounds: {
      minX: Math.min(DECALS_ROW_BOUNDS.minX, DECALS_STAGE_BOUNDS.minX),
      maxX: Math.max(DECALS_ROW_BOUNDS.maxX, DECALS_STAGE_BOUNDS.maxX, DECALS_BENCH_BOUNDS.maxX),
      minZ: Math.min(DECALS_ROW_BOUNDS.minZ, DECALS_STAGE_BOUNDS.minZ),
      maxZ: Math.max(DECALS_ROW_BOUNDS.maxZ, DECALS_STAGE_BOUNDS.maxZ, DECALS_BENCH_BOUNDS.maxZ),
    },
    getY: () => 0,
    getBlocks: () => [
      ...DECALS_STAGE_BLOCKS.map(({ mode, title, x, z }) => ({
        key: mode,
        label: title,
        x,
        y: 0,
        z,
        size: DECALS_STAGE_BLOCK_SIZE,
      })),
      { key: 'bench', label: 'Bake bench', ...DECALS_BENCH_BLOCK, y: 0, size: BLOCK_SIZE },
    ],
  },
];

/** A row by its list key */
export const getGalleryRow = (id: string) => GALLERY_ROWS.find((row) => row.id === id);

/** A row's overview: in front of it and above, the whole row in view */
export const getRowPose = (row: GalleryRow): GalleryCameraPose => {
  const { minX, maxX, minZ, maxZ } = row.bounds;
  return getBoundsPose(minX, maxX, minZ, maxZ);
};

/** The signposts' layer while shown (none: hidden, or not made on this visit) */
let signposts: WorldAnchorLayer | null = null;

/**
 * Shows the signposts (an anchor per row, its letter and title at the middle of its front edge)
 * or removes them; the scene's exit removes them too (`hideGallerySignposts`)
 * @param isShown whether to show them
 */
export const setGallerySignposts = (isShown: boolean) => {
  if (!isShown) {
    hideGallerySignposts();
    return;
  }
  if (signposts) return;
  const layer = createWorldAnchorLayer({ class: 'terrainGallerySignposts' });
  getHUDRootCMP().add(layer.cmp);
  for (const row of GALLERY_ROWS) {
    const { minX, maxX, maxZ } = row.bounds;
    layer.addAnchor({
      content: `${row.letter} · ${row.title}`,
      align: 'above',
      position: { x: (minX + maxX) / 2, y: row.getY() + SIGNPOST_HEIGHT, z: maxZ },
    });
  }
  registerWorldAnchorSync(getECSWorld(), { layer });
  signposts = layer;
};

/** Removes the signposts and their sync, if shown */
export const hideGallerySignposts = () => {
  if (!signposts) return;
  unregisterWorldAnchorSync(getECSWorld());
  signposts.cmp.remove();
  signposts = null;
};
