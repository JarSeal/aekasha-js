// The terrain gallery's Cliffs row (p305 Phase 5): four 40 × 40 m blocks in front of the Rules
// row on one generated mesa (a 9 m plateau whose rim wanders around the block, its face from about
// 48° on one side to about 85° on the other, over gentle ground), each drawn by `cliffs01` with
// another projection: `PLANAR` (the faces stretch), `BIPLANAR`, `TRIPLANAR`, and `TRIPLANAR` with a
// slope gate (planar on gentle slopes, the projection in a branch on steep ones). Code route
// materials, one per block and setting (a normal blend, the gated block's mode, a debug view):
// the sharpness and the gate are uniforms the tab writes live.
import * as THREE from 'three/webgpu';
import {
  createMeshEntity,
  getGeometry,
  getMeshByAppId,
  saveBufferGeometry,
  setMeshMaterial,
} from 'aekasha';
import { generateTerrain } from 'aekasha/toolkit/geometry';
import { createTerrainMaterial, type TerrainProjection } from 'aekasha/toolkit/terrain';
import { BLOCK_GAP, NO_SHADOWS, setMaterialUniform, type GalleryDebugView } from './galleryBlocks';
import { RULES_ROW_BOUNDS } from './rulesRow';

/** A block's side, metres */
export const CLIFFS_BLOCK_SIZE = 40;
/** 0.25 m between vertices: a near-vertical face spans a few of them */
const SEGMENTS = 160;
const TERRAIN_SEED = 505;
/** The ground's noise peak, metres either way: slopes under 10° */
const NOISE_HEIGHT = 0.4;
const NOISE_OCTAVES = [
  { frequency: 1 / 9, amplitude: 1 },
  { frequency: 1 / 3, amplitude: 0.3 },
];
/** The mesa: its height, its rim's mean radius and the face's half-widths, steep to gentle */
const MESA_HEIGHT = 9;
const MESA_RADIUS = 9;
const FACE_HALF_WIDTH = { steep: 0.5, gentle: 5 };
/** The gallery's ground top (`terrainGallery.ts`' `GROUND_Y`) */
const GROUND_TOP_Y = -0.6;
/** The blocks' lift: the noise's lowest point on the ground */
export const CLIFFS_BLOCK_Y = GROUND_TOP_Y + NOISE_HEIGHT;

const GEOMETRY_ID = 'terrainGalleryCliffsBlock';
const SET_ID = 'cliffs01';

/** The row's blocks */
export const CLIFFS_KEYS = ['PLANAR', 'BIPLANAR', 'TRIPLANAR', 'GATED'] as const;
/** One of {@link CLIFFS_KEYS} */
export type CliffsKey = (typeof CLIFFS_KEYS)[number];

/** A block of the row: what it shows and where it stands */
export type CliffsBlock = {
  key: CliffsKey;
  title: string;
  description: string;
  x: number;
  z: number;
  geometryId: string;
};

const DESCRIPTIONS: Record<CliffsKey, [string, string]> = {
  PLANAR: ['Planar', 'The world’s (x, −z) alone: the faces stretch into streaks'],
  BIPLANAR: ['Biplanar', 'The two planes the surface faces most, chosen per pixel (Quilez)'],
  TRIPLANAR: ['Triplanar', 'All three planes, weighted by the facing'],
  GATED: ['Slope-gated', 'Planar under the gate’s first slope, projected past its second'],
};

/** Where the row stands: in front of the Rules row (+z), four blocks */
const ROW_NEAR_Z = RULES_ROW_BOUNDS.maxZ + 2 * BLOCK_GAP;
const ROW_Z = ROW_NEAR_Z + CLIFFS_BLOCK_SIZE / 2;
const PITCH = CLIFFS_BLOCK_SIZE + 2 * BLOCK_GAP;

/** The four blocks, left to right */
export const CLIFFS_BLOCKS: readonly CliffsBlock[] = CLIFFS_KEYS.map((key, i) => ({
  key,
  title: DESCRIPTIONS[key][0],
  description: DESCRIPTIONS[key][1],
  x: (i - (CLIFFS_KEYS.length - 1) / 2) * PITCH,
  z: ROW_Z,
  geometryId: GEOMETRY_ID,
}));

/** The row's extent on the ground, for the gallery's ground */
export const CLIFFS_ROW_BOUNDS = {
  minX: CLIFFS_BLOCKS[0].x - CLIFFS_BLOCK_SIZE / 2,
  maxX: CLIFFS_BLOCKS[CLIFFS_BLOCKS.length - 1].x + CLIFFS_BLOCK_SIZE / 2,
  minZ: ROW_NEAR_Z,
  maxZ: ROW_NEAR_Z + CLIFFS_BLOCK_SIZE,
};

/** The normal blends the projecting blocks can show */
export const CLIFFS_NORMAL_BLENDS = ['WHITEOUT', 'UDN', 'RNM'] as const;
/** The gated block's projections */
export const CLIFFS_GATED_MODES = ['TRIPLANAR', 'BIPLANAR'] as const;

/** The row's settings: build-time ones (a material each) and the live uniforms */
export type CliffsValues = {
  normalBlend: (typeof CLIFFS_NORMAL_BLENDS)[number];
  gatedMode: (typeof CLIFFS_GATED_MODES)[number];
  /** `TRIPLANAR`'s exponent on the facing (the triplanar and gated blocks) */
  triplanarSharpness: number;
  /** `BIPLANAR`'s k */
  biplanarSharpness: number;
  /** The gate's slopes, degrees */
  gateFrom: number;
  gateTo: number;
};
/** The row's defaults */
export const DEFAULT_CLIFFS_VALUES: Readonly<CliffsValues> = {
  normalBlend: 'WHITEOUT',
  gatedMode: 'TRIPLANAR',
  triplanarSharpness: 4,
  biplanarSharpness: 8,
  gateFrom: 30,
  gateTo: 50,
};
const values: CliffsValues = { ...DEFAULT_CLIFFS_VALUES };
let debugView: GalleryDebugView = 'NONE';

/** The live values (the tab's fields bind them; {@link applyCliffsValues} after a change) */
export const getCliffsValues = () => values;

/** A block's mesh entity's app id */
export const getCliffsAppId = (key: CliffsKey) => `terrainGallery_cliffs_${key}`;

/** A block's projection at the row's build-time settings (its uniforms start at the defaults) */
const getProjection = (key: CliffsKey): TerrainProjection => {
  const { normalBlend } = values;
  if (key === 'PLANAR') return { mode: 'PLANAR' };
  if (key === 'GATED') {
    const gate: [number, number] = [DEFAULT_CLIFFS_VALUES.gateFrom, DEFAULT_CLIFFS_VALUES.gateTo];
    return { mode: values.gatedMode, slopeGate: gate, normalBlend };
  }
  return { mode: key, normalBlend };
};

/** The projection a block shows, for its list row */
export const getCliffsProjection = (key: CliffsKey) => getProjection(key);

/**
 * A block's material: the code route's, one per block, normal blend, gated mode and debug view (the
 * uniforms the row writes after)
 */
const getBlockMaterial = (key: CliffsKey) => {
  const projection = getProjection(key);
  const blend = projection.mode === 'PLANAR' ? '' : `_${values.normalBlend}`;
  const mode = key === 'GATED' ? `_${values.gatedMode}` : '';
  const view = debugView === 'NONE' ? '' : `_${debugView}`;
  return createTerrainMaterial({
    id: `terrainGalleryCliffs_${key}${mode}${blend}${view}`,
    layers: [{ set: SET_ID, projection }],
    ...(debugView === 'NONE' ? {} : { debugView }),
  });
};

/** The live values on a block's material (each sets those its material has) */
const writeValues = (material: THREE.Material, key: CliffsKey) => {
  const isBiplanar = key === 'BIPLANAR' || (key === 'GATED' && values.gatedMode === 'BIPLANAR');
  setMaterialUniform(
    material,
    'terrain_l0_projectionSharpness',
    isBiplanar ? values.biplanarSharpness : values.triplanarSharpness
  );
  const to = Math.max(values.gateTo, values.gateFrom + 0.5);
  setMaterialUniform(material, 'terrain_l0_slopeGate', new THREE.Vector2(values.gateFrom, to));
};

/** Each block's material at the row's settings, the live values written in */
const applyMaterials = () => {
  for (const { key } of CLIFFS_BLOCKS) {
    const mesh = getMeshByAppId(getCliffsAppId(key));
    if (!mesh) continue;
    const material = getBlockMaterial(key);
    writeValues(material, key);
    setMeshMaterial(mesh, material);
  }
};

/** Writes the live values into the blocks' materials (after a field's change) */
export const applyCliffsValues = () => {
  for (const { key } of CLIFFS_BLOCKS) {
    const mesh = getMeshByAppId(getCliffsAppId(key));
    if (mesh) writeValues(mesh.material as THREE.Material, key);
  }
};

/** Swaps the blocks to the materials of the build-time settings (a normal blend, a gated mode) */
export const applyCliffsSettings = () => applyMaterials();

/**
 * Shows the debug view on the blocks: each swaps to its view's material (made the first time),
 * the live values written in. The views must be loaded (`loadTerrainDebugViewsAsync`).
 */
export const setCliffsDebugView = (view: GalleryDebugView) => {
  debugView = view;
  applyMaterials();
};

const smoothstep = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** The mesa's rim at an angle: its radius wandering about the mean */
const getRimRadius = (angle: number) =>
  MESA_RADIUS + 1.5 * Math.sin(3 * angle) + 0.6 * Math.sin(7 * angle + 1);

/**
 * The face's half-width at an angle: steepest facing +x (about 85°), gentlest facing −x (about
 * 48°), the smoothstep's steepest slope `atan(1.5 · height / (2 · halfWidth))`
 */
const getFaceHalfWidth = (angle: number) =>
  FACE_HALF_WIDTH.steep +
  (FACE_HALF_WIDTH.gentle - FACE_HALF_WIDTH.steep) * (0.5 - 0.5 * Math.cos(angle));

/** The block's terrain: the gentle noise and the mesa on it */
const generateBlockTerrain = () =>
  generateTerrain({
    width: CLIFFS_BLOCK_SIZE,
    depth: CLIFFS_BLOCK_SIZE,
    widthSegments: SEGMENTS,
    depthSegments: SEGMENTS,
    maxHeight: NOISE_HEIGHT,
    noiseOctaves: NOISE_OCTAVES,
    seed: TERRAIN_SEED,
    heightModifier: (x, z, h) => {
      const angle = Math.atan2(z, x);
      const rim = getRimRadius(angle);
      const halfWidth = getFaceHalfWidth(angle);
      const r = Math.hypot(x, z);
      return h + MESA_HEIGHT * (1 - smoothstep(rim - halfWidth, rim + halfWidth, r));
    },
  });

/**
 * Creates the row (the scene's load): the terrain, then the four blocks with their materials at
 * the row's defaults (the tab applies its view)
 */
export const createCliffsRow = () => {
  debugView = 'NONE';
  Object.assign(values, DEFAULT_CLIFFS_VALUES);
  const registered = getGeometry(GEOMETRY_ID);
  const geometry =
    registered ?? saveBufferGeometry(generateBlockTerrain().geometry, { id: GEOMETRY_ID });
  for (const block of CLIFFS_BLOCKS) {
    const material = getBlockMaterial(block.key);
    writeValues(material, block.key);
    createMeshEntity(
      {
        geo: geometry,
        mat: material,
        position: { x: block.x, y: CLIFFS_BLOCK_Y, z: block.z },
        ...NO_SHADOWS,
      },
      { appId: getCliffsAppId(block.key), debugData: { name: `Cliffs: ${block.title}` } }
    );
  }
};
