// The terrain gallery's Decals stage (p309 Phase 2): the toolkit's decal materials on quads, in
// front of the Decals row's panels. Two flat 12 m blocks side by side, each the terrain material
// over mud02 with wet (puddles, rain ripples), and a concrete wall behind each (a structure
// material with rain streaks): the left block's decals are `BLEND` (`decalsGround_blend`,
// `decalsStructure_blend`), the right one's the same decals `CUTOUT`. Each ground cell lies on its
// block at its `physicalSize`: two tyre tracks of four tiles (the cell's `tileAlong: 'U'`) running
// over the asphalt damage, the other cells in two rows; each structure cell on its wall. The quads
// are exactly coplanar with the block's top and the wall's face (the hardest case for the polygon
// offset), UV'd into their cell (`remapUVsToAtlasCell`) with a second UV set 0..1 over the decal
// (the edge fade), drawn after the terrain (`renderOrder` 10). No shadows (the gallery's).
import * as THREE from 'three/webgpu';
import {
  createMeshEntity,
  getAtlasCell,
  getGeometry,
  remapUVsToAtlasCell,
  saveBufferGeometry,
} from 'aekasha';
import { createStructureMaterial, createTerrainMaterial } from 'aekasha/toolkit/terrain';
import { BLOCK_GAP, BLOCK_PITCH, BLOCK_SIZE, NO_SHADOWS } from './galleryBlocks';
import { DECALS_ROW_BOUNDS } from './decalsRow';

/** The decals' render order: after the terrain (0), before other transparents (p309's bands) */
export const DECAL_RENDER_ORDER = 10;

/** A block of the stage: the decals' mode, and its centre on the ground */
export type DecalsStageBlock = { mode: 'BLEND' | 'CUTOUT'; title: string; x: number; z: number };

/** The wall behind each block: as long as the block, from the gallery's ground to 4 m up */
export const DECALS_STAGE_WALL = { length: BLOCK_SIZE, height: 4.6, thickness: 1, baseY: -0.6 };
const STAGE_MIN_X = DECALS_ROW_BOUNDS.minX;
/** The walls' back, two gaps in front of the panels (+z) */
const STAGE_MIN_Z = DECALS_ROW_BOUNDS.maxZ + 2 * BLOCK_GAP;
const BLOCK_Z = STAGE_MIN_Z + DECALS_STAGE_WALL.thickness + BLOCK_SIZE / 2;

/** The blocks, `BLEND` on the left */
export const DECALS_STAGE_BLOCKS: readonly DecalsStageBlock[] = [
  { mode: 'BLEND', title: 'BLEND', x: STAGE_MIN_X + BLOCK_SIZE / 2, z: BLOCK_Z },
  { mode: 'CUTOUT', title: 'CUTOUT', x: STAGE_MIN_X + BLOCK_SIZE / 2 + BLOCK_PITCH, z: BLOCK_Z },
];

/**
 * The bake bench's block, right of the `CUTOUT` one (p309 Phase 5: the tab's procedural decals, a
 * decal baked from a generator shown on it; made by the tab, `_dbg__terrainGalleryDecalBakes.ts`)
 */
export const DECALS_BENCH_BLOCK = {
  x: STAGE_MIN_X + BLOCK_SIZE / 2 + 2 * BLOCK_PITCH,
  z: BLOCK_Z,
} as const;

/** The bench's extent on the ground (with its wall), for the gallery's ground */
export const DECALS_BENCH_BOUNDS = {
  minX: DECALS_BENCH_BLOCK.x - BLOCK_SIZE / 2,
  maxX: DECALS_BENCH_BLOCK.x + BLOCK_SIZE / 2,
  minZ: STAGE_MIN_Z,
  maxZ: BLOCK_Z + BLOCK_SIZE / 2,
};

/** The stage's extent on the ground, for the gallery's ground */
export const DECALS_STAGE_BOUNDS = {
  minX: STAGE_MIN_X,
  maxX: STAGE_MIN_X + BLOCK_PITCH + BLOCK_SIZE,
  minZ: STAGE_MIN_Z,
  maxZ: BLOCK_Z + BLOCK_SIZE / 2,
};

/** The blocks' and the walls' materials: wet like the decals, so the two are judged together */
const GROUND_MATERIAL_ID = 'terrainGalleryDecals_ground';
const WALL_MATERIAL_ID = 'terrainGalleryDecals_wall';
const GROUND_SET = 'mud02';
const WALL_SET = 'concrete02';

/** The decal materials of a mode: the toolkit's, which the scene lists */
const getDecalMaterialIds = (mode: DecalsStageBlock['mode']) =>
  mode === 'BLEND'
    ? { ground: 'decalsGround_blend', structure: 'decalsStructure_blend' }
    : { ground: 'decalsGround_cutout', structure: 'decalsStructure_cutout' };

/** The four decal materials the stage draws (for the tab's offset and edge fade switches) */
export const DECALS_STAGE_MATERIAL_IDS = DECALS_STAGE_BLOCKS.flatMap(({ mode }) =>
  Object.values(getDecalMaterialIds(mode))
);

/**
 * A decal on the ground (`x`, `z` from its block's centre) or on the wall's face (`x` from its
 * centre, `y` the decal's centre's height); `tiles` repeats the cell along its length (u)
 */
type DecalPlacement = { cell: string; x: number; z?: number; y?: number; tiles?: number };

/** Two tyre tracks of four tiles, over the asphalt damage; the other cells in two rows */
const GROUND_DECALS: readonly DecalPlacement[] = [
  { cell: 'asphaltDamage', x: 1.5, z: -3.2 },
  { cell: 'tireTracks', x: -1.4, z: -4, tiles: 4 },
  { cell: 'tireTracks', x: -1.4, z: -2.4, tiles: 4 },
  ...['crack', 'mudSplatter', 'wetPatch', 'stain01', 'stain02', 'scorch'].map((cell, i) => ({
    cell,
    x: (i - 2.5) * 2.1,
    z: 1,
  })),
  ...[
    'footprintBoot',
    'footprintBare',
    'footprintPaw',
    'footprintSnowBoot',
    'leafPatch',
    'iceCrack',
  ].map((cell, i) => ({ cell, x: (i - 2.5) * 2.1, z: 3.8 })),
];

/** The leaks and the formwork marks along the wall's top, the cracks and stains below */
const WALL_DECALS: readonly DecalPlacement[] = [
  ...['leak01', 'leak02', 'leak03', 'formworkMarks'].map((cell, i) => ({
    cell,
    x: (i - 1.5) * 3,
    y: 3,
  })),
  ...['crack01', 'crack02', 'stain01', 'stain02'].map((cell, i) => ({
    cell,
    x: (i - 1.5) * 3,
    y: 1,
  })),
];

/**
 * A decal quad's geometry facing up (or `onWall`: +z, its v up the wall), `width` along x and
 * `depth` across, the cell's UVs 0..1 on each of its `tiles` along x (v toward −z: the cell's top
 * at the back) and the second UV set 0..1 over the whole decal; registered
 */
export const getDecalQuadGeometry = (
  width: number,
  depth: number,
  tiles: number,
  onWall: boolean
) => {
  const id = `terrainGallery_decalQuad_${width}x${depth}x${tiles}${onWall ? '_wall' : ''}`;
  const registered = getGeometry(id);
  if (registered) return registered;
  const positions: number[] = [];
  const uvs: number[] = [];
  const decalUvs: number[] = [];
  const indices: number[] = [];
  const tileWidth = width / tiles;
  for (let tile = 0; tile < tiles; tile++) {
    const base = tile * 4;
    // The tile's corners: left-front, right-front, left-back, right-back
    for (const [u, v] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      positions.push(-width / 2 + (tile + u) * tileWidth, 0, depth / 2 - v * depth);
      uvs.push(u, v);
      decalUvs.push((tile + u) / tiles, v);
    }
    indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('uv1', new THREE.Float32BufferAttribute(decalUvs, 2));
  geometry.setIndex(indices);
  if (onWall) geometry.rotateX(Math.PI / 2);
  geometry.computeVertexNormals();
  return saveBufferGeometry(geometry, { id });
};

/** A cell's size in metres: its `data.physicalSize` */
const getCellSize = (atlasId: string, cellId: string) => {
  const cell = getAtlasCell(atlasId, cellId);
  const size = (cell?.data as { physicalSize?: [number, number] } | undefined)?.physicalSize;
  if (!size) {
    throw new Error(`[terrainGallery] Atlas "${atlasId}" has no cell "${cellId}" with a size.`);
  }
  return size;
};

const createDecal = (
  atlasId: string,
  placement: DecalPlacement,
  index: number,
  block: DecalsStageBlock,
  onWall: boolean
) => {
  const [width, depth] = getCellSize(atlasId, placement.cell);
  const tiles = placement.tiles ?? 1;
  const quad = getDecalQuadGeometry(width * tiles, depth, tiles, onWall);
  const materialIds = getDecalMaterialIds(block.mode);
  const position = onWall
    ? { x: block.x + placement.x, y: placement.y ?? 0, z: block.z - BLOCK_SIZE / 2 }
    : { x: block.x + placement.x, y: 0, z: block.z + (placement.z ?? 0) };
  const key = `${block.mode}_${atlasId}_${index}_${placement.cell}`;
  createMeshEntity(
    {
      geo: remapUVsToAtlasCell(quad, atlasId, placement.cell),
      mat: onWall ? materialIds.structure : materialIds.ground,
      position,
      renderOrder: DECAL_RENDER_ORDER,
      ...NO_SHADOWS,
    },
    {
      appId: `terrainGallery_decal_${key}`,
      debugData: { name: `Decal (${block.title}): ${atlasId} ${placement.cell}` },
    }
  );
};

/** The blocks' flat ground, its top at y = 0 */
const getGroundGeometry = () => {
  const id = 'terrainGallery_decalsGround';
  return (
    getGeometry(id) ??
    saveBufferGeometry(
      new THREE.PlaneGeometry(BLOCK_SIZE, BLOCK_SIZE, 12, 12).rotateX(-Math.PI / 2),
      { id }
    )
  );
};

const getWallGeometry = () => {
  const id = 'terrainGallery_decalsWall';
  return (
    getGeometry(id) ??
    saveBufferGeometry(
      new THREE.BoxGeometry(
        DECALS_STAGE_WALL.length,
        DECALS_STAGE_WALL.height,
        DECALS_STAGE_WALL.thickness
      ),
      { id }
    )
  );
};

/** The ground's and the wall's materials (an id registered already returns its material) */
export const createDecalsSurfaceMaterials = () => ({
  ground: createTerrainMaterial({
    id: GROUND_MATERIAL_ID,
    layers: [{ set: GROUND_SET }],
    wet: { puddles: {}, ripples: {} },
  }),
  wall: createStructureMaterial(WALL_SET, { id: WALL_MATERIAL_ID, wet: { streaks: {} } }),
});

/**
 * A stage block's flat ground (its top at y = 0) and its wall behind it (−z), wet like the decals;
 * `key` names their entities (`terrainGallery_decalsBlock_<key>`, `…Wall_<key>`)
 */
export const createDecalsStageSurface = (
  block: { x: number; z: number; title: string },
  key: string
) => {
  const materials = createDecalsSurfaceMaterials();
  createMeshEntity(
    {
      geo: getGroundGeometry(),
      mat: materials.ground,
      position: { x: block.x, y: 0, z: block.z },
      ...NO_SHADOWS,
    },
    {
      appId: `terrainGallery_decalsBlock_${key}`,
      debugData: { name: `Decals block: ${block.title}` },
    }
  );
  createMeshEntity(
    {
      geo: getWallGeometry(),
      mat: materials.wall,
      position: {
        x: block.x,
        y: DECALS_STAGE_WALL.baseY + DECALS_STAGE_WALL.height / 2,
        z: block.z - BLOCK_SIZE / 2 - DECALS_STAGE_WALL.thickness / 2,
      },
      ...NO_SHADOWS,
    },
    {
      appId: `terrainGallery_decalsWall_${key}`,
      debugData: { name: `Decals wall: ${block.title}` },
    }
  );
};

/** Creates the stage's blocks, walls and decals; the scene lists the decal materials and atlases */
export const createDecalsStage = () => {
  for (const block of DECALS_STAGE_BLOCKS) {
    createDecalsStageSurface(block, block.mode);
    GROUND_DECALS.forEach((placement, i) =>
      createDecal('decalsGround', placement, i, block, false)
    );
    WALL_DECALS.forEach((placement, i) =>
      createDecal('decalsStructure', placement, i, block, true)
    );
  }
};
