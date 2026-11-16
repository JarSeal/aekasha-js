// The terrain gallery's Anti-tiling row (p305 Phase 2): three flat 48 × 48 m blocks of `grass01`
// behind the library and the Procedural row, one per anti-tiling mode (`NONE`, `DUAL_SCALE`, `HEX`), each a variant of
// the terrain material's JSON route with the macro variation on or off (the toolkit's
// `macroNoise`, which the scene lists). A variant is the mode, the macro switch and the debug view
// (a define each, so a shader each, made the first time it's shown); the modes' and the macro's
// numbers are uniforms the tab sets live on whichever variant a block shows.
import * as THREE from 'three/webgpu';
import {
  createMeshEntity,
  existsOrThrow,
  getGeometry,
  getMaterial,
  getMaterialVariant,
  getMeshByAppId,
  saveBufferGeometry,
  setMeshMaterial,
  type MaterialVariantOverrides,
} from 'aekasha';
import {
  BLOCK_GAP,
  BLOCK_PITCH,
  BLOCK_SIZE,
  GALLERY_MATERIAL_ID,
  NO_SHADOWS,
  type GalleryDebugView,
} from './galleryBlocks';
import { PROCEDURAL_ROW_DEPTH } from './proceduralRow';

/** The modes, left to right */
export const ANTI_TILING_MODES = ['NONE', 'DUAL_SCALE', 'HEX'] as const;
/** One of {@link ANTI_TILING_MODES} */
export type AntiTilingMode = (typeof ANTI_TILING_MODES)[number];

/** A block's side, metres: large enough for the tiling's repetition to show */
export const ANTI_TILING_BLOCK_SIZE = 48;
/** From a block's centre to the next one's, metres */
const PITCH = ANTI_TILING_BLOCK_SIZE + BLOCK_GAP * 2;
/** The set every block shows: a grass, whose repetition shows from above */
export const ANTI_TILING_SET_ID = 'grass01';
const MACRO_TEXTURE_ID = 'macroNoise';
const GEOMETRY_ID = 'terrainGalleryAntiTilingBlock';
/**
 * The back edge of the library's four rows and of the Procedural row's five (both centred on
 * z = 0, the Procedural row deeper), metres
 */
const FRONT_ROWS_BACK_Z = -Math.max(1.5 * BLOCK_PITCH + BLOCK_SIZE / 2, PROCEDURAL_ROW_DEPTH / 2);
/** The row's centre line, behind both with twice the blocks' gap between */
const ROW_Z = FRONT_ROWS_BACK_Z - BLOCK_GAP * 2 - ANTI_TILING_BLOCK_SIZE / 2;

/** A block of the row: its mode and where it stands */
export type AntiTilingBlock = { mode: AntiTilingMode; x: number; z: number; geometryId: string };

/** The three blocks, left to right, centred on x = 0 */
export const ANTI_TILING_BLOCKS: readonly AntiTilingBlock[] = ANTI_TILING_MODES.map((mode, i) => ({
  mode,
  x: (i - 1) * PITCH,
  z: ROW_Z,
  geometryId: GEOMETRY_ID,
}));

/** The row's extent on the ground, for the gallery's ground: x from and to, z from and to */
export const ANTI_TILING_ROW_BOUNDS = {
  minX: -PITCH - ANTI_TILING_BLOCK_SIZE / 2,
  maxX: PITCH + ANTI_TILING_BLOCK_SIZE / 2,
  minZ: ROW_Z - ANTI_TILING_BLOCK_SIZE / 2,
  maxZ: ROW_Z + ANTI_TILING_BLOCK_SIZE / 2,
};

/**
 * The row's live values: the modes' and the macro's uniforms (D3, D7), the tab's. The defaults are
 * the define's but the macro's scale, a tile over 64 m so a 48 m block shows its variation.
 */
export type AntiTilingValues = {
  farScale: number;
  distanceFrom: number;
  distanceTo: number;
  hexContrast: number;
  hexRotation: number;
  macroScale: number;
  macroBrightness: number;
  macroHue: number;
  macroRoughness: number;
};
export const DEFAULT_ANTI_TILING_VALUES: Readonly<AntiTilingValues> = {
  farScale: 0.23,
  distanceFrom: 6,
  distanceTo: 40,
  hexContrast: 0.5,
  hexRotation: 1,
  macroScale: 64,
  macroBrightness: 0.2,
  macroHue: 8,
  macroRoughness: 0.15,
};

/** What the blocks show: the macro switch and the debug view (the tab's) */
type RowState = { isMacroOn: boolean; debugView: GalleryDebugView };
const rowState: RowState = { isMacroOn: true, debugView: 'NONE' };
const values: AntiTilingValues = { ...DEFAULT_ANTI_TILING_VALUES };

/** A block's mesh entity's app id */
export const getAntiTilingAppId = (mode: AntiTilingMode) => `terrainGallery_antiTiling_${mode}`;

/** The live values (the tab's fields bind them; {@link applyAntiTilingValues} after a change) */
export const getAntiTilingValues = () => values;
/** Whether the blocks show the macro variation */
export const isAntiTilingMacroOn = () => rowState.isMacroOn;

/** A flat block, its normal up, shared by the three */
const getBlockGeometry = () =>
  getGeometry(GEOMETRY_ID) ??
  saveBufferGeometry(
    new THREE.PlaneGeometry(ANTI_TILING_BLOCK_SIZE, ANTI_TILING_BLOCK_SIZE).rotateX(-Math.PI / 2),
    { id: GEOMETRY_ID }
  );

/** A mode's variant of the gallery's terrain material: its define and its inputs */
const getOverrides = (mode: AntiTilingMode, state: RowState): MaterialVariantOverrides => ({
  inputs: {
    layer0: { textureSet: ANTI_TILING_SET_ID },
    ...(state.isMacroOn ? { macro: { texture: MACRO_TEXTURE_ID } } : {}),
  },
  staticDefines: {
    terrain: {
      layers: [{}],
      antiTiling: { mode },
      ...(state.isMacroOn ? { macro: { scale: DEFAULT_ANTI_TILING_VALUES.macroScale } } : {}),
      ...(state.debugView === 'NONE' ? {} : { debugView: state.debugView }),
    },
  },
});

/** A uniform of a material's `userData.uniforms`, set when the material has it */
const setUniform = (material: THREE.Material, key: string, value: number | THREE.Vector2) => {
  const uniform = (material.userData.uniforms as Record<string, { value: unknown }> | undefined)?.[
    key
  ];
  if (!uniform) return;
  if (value instanceof THREE.Vector2) (uniform.value as THREE.Vector2).copy(value);
  else uniform.value = value;
};

const distance = new THREE.Vector2();

/** The live values on a block's material: the uniforms its mode and macro have */
const writeValues = (material: THREE.Material) => {
  setUniform(material, 'terrain_l0_farScale', values.farScale);
  setUniform(
    material,
    'terrain_l0_antiTilingDistance',
    distance.set(values.distanceFrom, values.distanceTo)
  );
  setUniform(material, 'terrain_l0_hexContrast', values.hexContrast);
  setUniform(material, 'terrain_l0_hexRotation', values.hexRotation);
  setUniform(material, 'terrain_macroScale', values.macroScale);
  setUniform(material, 'terrain_macroBrightness', values.macroBrightness);
  setUniform(material, 'terrain_macroHue', values.macroHue);
  setUniform(material, 'terrain_macroRoughness', values.macroRoughness);
};

const getBlockMaterial = (mode: AntiTilingMode) =>
  getMaterialVariant(GALLERY_MATERIAL_ID, getOverrides(mode, rowState));

/** Writes the live values into every block's material (after a field's change) */
export const applyAntiTilingValues = () => {
  for (const { mode } of ANTI_TILING_BLOCKS) {
    const mesh = getMeshByAppId(getAntiTilingAppId(mode));
    if (mesh) writeValues(mesh.material as THREE.Material);
  }
};

/**
 * Shows the macro variation on or off and the debug view on the blocks: each block swaps to its
 * variant (made the first time it's asked for), the live values written in. The debug views must
 * be loaded (`loadTerrainDebugViewsAsync`) for a view to show.
 */
export const setAntiTilingRowState = (state: Partial<RowState>) => {
  Object.assign(rowState, state);
  for (const { mode } of ANTI_TILING_BLOCKS) {
    const mesh = getMeshByAppId(getAntiTilingAppId(mode));
    if (!mesh) continue;
    const material = getBlockMaterial(mode);
    writeValues(material);
    setMeshMaterial(mesh, material);
  }
};

/**
 * Creates the row's three blocks (the scene's load): each with its mode's variant, the macro on,
 * the values and the debug view the scene's defaults (the tab applies its saved ones)
 */
export const createAntiTilingRow = () => {
  rowState.isMacroOn = true;
  rowState.debugView = 'NONE';
  Object.assign(values, DEFAULT_ANTI_TILING_VALUES);
  existsOrThrow(
    getMaterial(GALLERY_MATERIAL_ID),
    `The terrainGallery scene needs the "${GALLERY_MATERIAL_ID}" material.`
  );
  const geo = getBlockGeometry();
  for (const block of ANTI_TILING_BLOCKS) {
    const material = getBlockMaterial(block.mode);
    writeValues(material);
    createMeshEntity(
      { geo, mat: material, position: { x: block.x, z: block.z }, ...NO_SHADOWS },
      {
        appId: getAntiTilingAppId(block.mode),
        debugData: { name: `Anti-tiling: ${block.mode}` },
      }
    );
  }
};
