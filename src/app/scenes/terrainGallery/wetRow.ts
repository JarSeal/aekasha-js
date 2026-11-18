// The terrain gallery's Wet/dry row (p307 Phase 2): a 12 m block per texture set category, each
// the terrain material with `wet` over one set of the category, and a beach block (sand on the
// flat, rocks on the ramp by a slope rule, height-blended) whose blended response is S4's "a
// beach blends sand's response with rock's"; 3 × 3 left of the Splatting row. Every block is the
// library's generated block (its 35° ramp), so a set's response is judged on the flat and on a
// slope. The wetness and the puddle level are the surface conditions' (the scene's JSON starts
// them `MANUAL`, so nothing dries them); the tab's sliders and steps set them, and switch the
// row's quality (`FULL`, `SIMPLE`) and its view (`WETNESS`, `TAPS`). Phase 3: every block has puddles
// (filling by its set's `puddleResponse`, in `macroNoise` patches) and rain ripples where water
// stands (the `rippleAtlas`, while the tab's rain is over 0), and the grass block a regional
// wetness along its left edge (a riverbank: its `_wetness` vertex attribute). Phase 4: two steep
// pieces with rain streaks (structure materials, `wet.streaks`), a concrete wall on the concrete
// block and a cliff boulder on the cliff block (rounded, so the streaks' axis switch and its
// overhang show). Phase 4 section 2: the beach's shoreline along the surface conditions' water
// level, its waves washing up, and a still water plane over the beach at the level (hidden
// without one), which follows it on the scene's looper. Phase 5: snow over every block and both
// pieces by the surface conditions' snow cover (the toolkit's `snow01`, the code route's default),
// slush above 0 °C. Code route materials (`createTerrainMaterial`) with a `LOW` tier whose wet is
// `SIMPLE` (without the puddles and the ripples: a tier's variant shares the material's inputs,
// which a variant without them would refuse): the quality (the tier) and the view are variants of
// a block's or a piece's material.
import * as THREE from 'three/webgpu';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  createMeshEntity,
  createSceneMainLooper,
  existsOrThrow,
  getECSWorld,
  getEntityIdByAppId,
  getGeometry,
  getMaterial,
  getMaterialVariant,
  getMeshByAppId,
  saveBufferGeometry,
  setMeshMaterial,
} from 'aekasha';
import {
  createStructureMaterial,
  createTerrainMaterial,
  type TerrainMaterialConfig,
} from 'aekasha/toolkit/terrain';
import { getSurfaceConditions } from 'aekasha/surface';
import { BLOCK_GAP, BLOCK_PITCH, BLOCK_SIZE, getBlockGeometry, NO_SHADOWS } from './galleryBlocks';
import { SPLATTING_ROW_BOUNDS } from './splattingRow';

/** A block of the row: a texture set category, or the blended beach */
export type WetKey =
  | 'SAND'
  | 'MUD'
  | 'ROCKS'
  | 'CLIFF'
  | 'SNOW'
  | 'ICE'
  | 'GRASS'
  | 'CONCRETE'
  | 'BEACH';

/** A block of the row: its key, its sets, where it stands and its terrain's seed */
export type WetBlock = {
  key: WetKey;
  title: string;
  sets: readonly string[];
  x: number;
  z: number;
  seed: number;
};

/** The row's quality (`wet.quality`) and view, which the tab switches */
export type WetRowView = { quality: 'FULL' | 'SIMPLE'; debugView: 'NONE' | 'WETNESS' | 'TAPS' };

/** Each block's sets: a set of each category (its showcase where the library has one), the beach's
 * two */
const BLOCK_SETS: Record<WetKey, readonly string[]> = {
  SAND: ['sand02'],
  MUD: ['mud02'],
  ROCKS: ['rocks01'],
  CLIFF: ['cliffs01'],
  SNOW: ['snow01'],
  ICE: ['ice01'],
  GRASS: ['grass01'],
  CONCRETE: ['concrete02'],
  BEACH: ['sand02', 'rocks01'],
};

/** Rows from the back (−z), left to right */
const GRID: readonly (readonly WetKey[])[] = [
  ['SAND', 'MUD', 'ROCKS'],
  ['CLIFF', 'SNOW', 'ICE'],
  ['GRASS', 'CONCRETE', 'BEACH'],
];
/** The right column's centre: two gaps left of the Splatting row */
const RIGHT_X = SPLATTING_ROW_BOUNDS.minX - 2 * BLOCK_GAP - BLOCK_SIZE / 2;
/** Each block's seed: this plus its index, apart from the other rows' */
const SEED_BASE = 307;
/** The beach's rocks: on slopes past this, degrees (the ramp is 35°, the flat's noise under 10°) */
const BEACH_ROCK_SLOPE = 22;
/** The puddle patches' macro tile, metres: a patch is a fifth of it, about two across a block */
const PUDDLE_PATCH_SCALE = 30;
/** The block with a regional wetness, and its band: fully wet up to the first distance from the
 * left edge, metres, dry past the second */
export const REGIONAL_WET_KEY: WetKey = 'GRASS';
const REGIONAL_WET_BAND = [2, 5] as const;
/** The block with a shoreline, and its damp band above the water, metres */
export const SHORE_WET_KEY: WetKey = 'BEACH';
const SHORE_BAND = 1.5;
/** The water plane over the shore's block: its app id and look */
const WATER_APP_ID = 'terrainGallery_wetWater';
const WATER_COLOR = '#1f4d5c';
const WATER_OPACITY = 0.6;
/** The regional wetness's vertex attribute (the terrain material's default) */
const REGIONAL_WET_ATTRIBUTE = '_wetness';

/** A steep piece with rain streaks, standing on a block: its set (a structure material's) */
type WetPiece = { key: 'WALL' | 'BOULDER'; block: WetKey; set: string; title: string };

/** The streaked pieces: a wall on the concrete block, a boulder on the cliff block */
export const WET_PIECES: readonly WetPiece[] = [
  { key: 'WALL', block: 'CONCRETE', set: 'concrete02', title: 'a concrete wall' },
  { key: 'BOULDER', block: 'CLIFF', set: 'cliffs01', title: 'a cliff boulder' },
];
/** The wall's size, metres */
const WALL = { width: 8, height: 4, depth: 0.6 } as const;
/** The boulder's half extents, metres, and how much of its height is buried */
const BOULDER_RADII = [3, 2.4, 2] as const;
const BOULDER_BURIED = 0.35;
/** The pieces stand this far behind their block's centre (−z): in front of the ramp's foot */
const PIECE_Z = -1.5;
/** How far the wall sinks into the block's noise, metres */
const WALL_SINK = 0.3;

/** The row's nine blocks, by row from the back and left to right */
export const WET_BLOCKS: readonly WetBlock[] = GRID.flatMap((keys, row) =>
  keys.map((key, col) => ({
    key,
    title: key === 'BEACH' ? 'Beach (sand, rocks)' : `${key.toLowerCase()} (${BLOCK_SETS[key][0]})`,
    sets: BLOCK_SETS[key],
    x: RIGHT_X - (keys.length - 1 - col) * BLOCK_PITCH,
    z: (row - (GRID.length - 1) / 2) * BLOCK_PITCH,
    seed: SEED_BASE + row * keys.length + col,
  }))
);

/** The row's extent on the ground, metres */
export const WET_ROW_BOUNDS = {
  minX: RIGHT_X - (GRID[0].length - 1) * BLOCK_PITCH - BLOCK_SIZE / 2,
  maxX: RIGHT_X + BLOCK_SIZE / 2,
  minZ: -((GRID.length - 1) / 2) * BLOCK_PITCH - BLOCK_SIZE / 2,
  maxZ: ((GRID.length - 1) / 2) * BLOCK_PITCH + BLOCK_SIZE / 2,
};

/** A block's mesh entity's app id */
export const getWetAppId = (key: WetKey) => `terrainGallery_wet_${key}`;

/** The row's `SIMPLE` quality: the tier its materials switch to */
const SIMPLE_TIER = 'LOW';

/** A row material's wet with its `SIMPLE` tier: the same without what `FULL` alone takes */
const withSimpleTier = (wet: NonNullable<TerrainMaterialConfig['wet']>) => {
  const { puddles: _puddles, ripples: _ripples, ...simple } = wet;
  return { wet, quality: { [SIMPLE_TIER]: { wet: { ...simple, quality: 'SIMPLE' as const } } } };
};

/** A block's code route config: its sets, wet (`FULL`, puddles in patches, ripples, snow; the
 * grass block's regional wetness, the beach's shoreline) and its `SIMPLE` tier; the beach's rocks
 * by slope */
const getBlockConfig = (block: WetBlock): TerrainMaterialConfig => ({
  id: `terrainGalleryWet_${block.key}`,
  layers: block.sets.map((set) => ({ set })),
  ...(block.sets.length > 1
    ? {
        blend: {
          source: 'RULES',
          rules: [{ layer: 1, slope: { min: BEACH_ROCK_SLOPE, softness: 8 } }],
        },
      }
    : {}),
  ...withSimpleTier({
    puddles: { patches: { scale: PUDDLE_PATCH_SCALE } },
    ripples: {},
    snow: {},
    ...(block.key === REGIONAL_WET_KEY ? { regional: {} } : {}),
    ...(block.key === SHORE_WET_KEY ? { shoreline: { band: SHORE_BAND, runUp: {} } } : {}),
  }),
});

/** A piece's mesh entity's app id */
const getPieceAppId = (piece: WetPiece) => `terrainGallery_wetPiece_${piece.key}`;

/**
 * A block's material for the view: its code route material, or that material's variant with the
 * quality and the debug view (one shader per variant, made on first use)
 */
const getBlockMaterial = (block: WetBlock, view: WetRowView): THREE.Material => {
  const config = getBlockConfig(block);
  createTerrainMaterial(config);
  return getViewMaterial(config.id, view);
};

/** A piece's material for the view: its structure material (streaks and snow), or its variant */
const getPieceMaterial = (piece: WetPiece, view: WetRowView): THREE.Material => {
  const id = `terrainGalleryWet_${piece.key}`;
  createStructureMaterial(piece.set, { id, ...withSimpleTier({ streaks: {}, snow: {} }) });
  return getViewMaterial(id, view);
};

/**
 * A row material for the view: itself, or its variant with the quality (`SIMPLE` its tier) and
 * the debug view
 */
const getViewMaterial = (id: string, view: WetRowView): THREE.Material => {
  const base = existsOrThrow(getMaterial(id), `[terrainGallery] No material "${id}".`);
  if (view.quality === 'FULL' && view.debugView === 'NONE') return base;
  const terrain = base.userData.terrainDefine as object;
  return getMaterialVariant(id, {
    staticDefines: {
      terrain: {
        ...terrain,
        ...(view.quality === 'SIMPLE' ? { qualityLevel: SIMPLE_TIER } : {}),
        ...(view.debugView === 'NONE' ? {} : { debugView: view.debugView }),
      },
    },
  });
};

/**
 * Switches the row's blocks to the view's quality and debug view (a debug view needs the terrain
 * debug views loaded first: `loadTerrainDebugViewsAsync`)
 */
export const setWetRowView = (view: WetRowView) => {
  for (const block of WET_BLOCKS) {
    const mesh = getMeshByAppId(getWetAppId(block.key));
    if (mesh) setMeshMaterial(mesh, getBlockMaterial(block, view));
  }
  for (const piece of WET_PIECES) {
    const mesh = getMeshByAppId(getPieceAppId(piece));
    if (mesh) setMeshMaterial(mesh, getPieceMaterial(piece, view));
  }
};

/**
 * A block geometry with the regional wetness's band along its left edge (−x), once: the
 * geometry is the block's own (its seed's), kept across visits
 */
const withRegionalWetness = (geometry: THREE.BufferGeometry) => {
  if (geometry.getAttribute(REGIONAL_WET_ATTRIBUTE)) return geometry;
  const positions = geometry.getAttribute('position');
  const wetness = new Float32Array(positions.count);
  const [wet, dry] = REGIONAL_WET_BAND;
  for (let i = 0; i < positions.count; i++) {
    const fromEdge = positions.getX(i) + BLOCK_SIZE / 2;
    wetness[i] = 1 - THREE.MathUtils.smoothstep(fromEdge, wet, dry);
  }
  geometry.setAttribute(REGIONAL_WET_ATTRIBUTE, new THREE.BufferAttribute(wetness, 1));
  return geometry;
};

/** A geometry made once and kept across visits */
const getOrBuildGeometry = (id: string, build: () => THREE.BufferGeometry) =>
  getGeometry(id) ?? saveBufferGeometry(build(), { id });

/**
 * The boulder: a sphere of smooth normals bulged by a few sines of the direction, stretched to its
 * half extents
 */
const buildBoulderGeometry = () => {
  const sphere = new THREE.IcosahedronGeometry(1, 8);
  sphere.deleteAttribute('normal');
  sphere.deleteAttribute('uv');
  const geometry = mergeVertices(sphere);
  sphere.dispose();
  const positions = geometry.getAttribute('position');
  const dir = new THREE.Vector3();
  const [rx, ry, rz] = BOULDER_RADII;
  for (let i = 0; i < positions.count; i++) {
    dir.fromBufferAttribute(positions, i).normalize();
    const bulge =
      1 +
      0.12 *
        Math.sin(3.1 * dir.x + 1.3) *
        Math.sin(2.7 * dir.y + 0.4) *
        Math.sin(3.3 * dir.z + 2.1) +
      0.05 * Math.sin(7.3 * dir.x + 5.9 * dir.z + 0.7) +
      0.03 * Math.sin(11.1 * dir.y - 9.7 * dir.x);
    positions.setXYZ(i, dir.x * bulge * rx, dir.y * bulge * ry, dir.z * bulge * rz);
  }
  geometry.computeVertexNormals();
  return geometry;
};

/** A piece's geometry, its origin at its centre */
const getPieceGeometry = (piece: WetPiece) =>
  piece.key === 'WALL'
    ? getOrBuildGeometry(
        'terrainGalleryWetWall',
        () => new THREE.BoxGeometry(WALL.width, WALL.height, WALL.depth)
      )
    : getOrBuildGeometry('terrainGalleryWetBoulder', buildBoulderGeometry);

/** A piece's centre over its block's: the wall's foot sunk into the noise, the boulder buried */
const getPieceY = (piece: WetPiece) =>
  piece.key === 'WALL' ? WALL.height / 2 - WALL_SINK : BOULDER_RADII[1] * (1 - 2 * BOULDER_BURIED);

/** The block with the shoreline, which the water covers */
const getShoreBlock = () =>
  existsOrThrow(
    WET_BLOCKS.find((block) => block.key === SHORE_WET_KEY),
    `[terrainGallery] No wet block "${SHORE_WET_KEY}".`
  );

/**
 * The water plane over the shore's block: at the surface conditions' water level, hidden without
 * one, following it on the scene's looper (gone with the scene)
 */
const createWater = (sceneId: string) => {
  const block = getShoreBlock();
  createMeshEntity(
    {
      geo: getOrBuildGeometry('terrainGalleryWetWater', () =>
        new THREE.PlaneGeometry(BLOCK_SIZE, BLOCK_SIZE).rotateX(-Math.PI / 2)
      ),
      mat: {
        id: 'terrainGalleryWetWater',
        type: 'STANDARD',
        params: {
          color: WATER_COLOR,
          roughness: 0.05,
          transparent: true,
          opacity: WATER_OPACITY,
          depthWrite: false,
        },
      },
      position: { x: block.x, z: block.z },
      ...NO_SHADOWS,
    },
    { appId: WATER_APP_ID, debugData: { name: 'Wet/dry: water' } }
  );
  const world = getECSWorld();
  const id = getEntityIdByAppId(WATER_APP_ID, world);
  const mesh = getMeshByAppId(WATER_APP_ID);
  const pose = { pos: { x: block.x, y: 0, z: block.z } };
  let shown: number | null | undefined;
  createSceneMainLooper(() => {
    const level = getSurfaceConditions()?.waterLevel ?? null;
    if (level === shown) return;
    shown = level;
    if (mesh) mesh.visible = level !== null;
    if (level === null || id === undefined) return;
    pose.pos.y = level;
    world.setTransform(id, pose);
  }, sceneId);
};

/**
 * Creates the row's blocks, each on the library's generated block with its own seed, the streaked
 * pieces on theirs and the water over the shore
 * @param sceneId the gallery's scene id (the water's looper's)
 */
export const createWetRow = (sceneId: string) => {
  for (const block of WET_BLOCKS) {
    const geometry = getBlockGeometry(block.seed);
    createMeshEntity(
      {
        geo: block.key === REGIONAL_WET_KEY ? withRegionalWetness(geometry) : geometry,
        mat: getBlockMaterial(block, { quality: 'FULL', debugView: 'NONE' }),
        position: { x: block.x, z: block.z },
        ...NO_SHADOWS,
      },
      { appId: getWetAppId(block.key), debugData: { name: `Wet/dry: ${block.title}` } }
    );
  }
  for (const piece of WET_PIECES) {
    const block = existsOrThrow(
      WET_BLOCKS.find((candidate) => candidate.key === piece.block),
      `[terrainGallery] No wet block "${piece.block}".`
    );
    createMeshEntity(
      {
        geo: getPieceGeometry(piece),
        mat: getPieceMaterial(piece, { quality: 'FULL', debugView: 'NONE' }),
        position: { x: block.x, y: getPieceY(piece), z: block.z + PIECE_Z },
        ...NO_SHADOWS,
      },
      { appId: getPieceAppId(piece), debugData: { name: `Wet/dry: ${piece.title}` } }
    );
  }
  createWater(sceneId);
};
