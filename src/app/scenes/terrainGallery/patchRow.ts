// The terrain gallery's Blocks patch (p306 Phase 3): 3 × 3 terrain blocks of 32 m behind the
// Anti-tiling row, past the ground's back edge (a block stands at y = 0 and its valleys go under
// the ground's top), each a `*.terrainBlock.json` (`patch/`) of the toolkit's `rulesTerrain`: one
// world-continuous noise, `HEIGHT_FN` normals, the rules laid into its vertex colours on the CPU
// and the horizon AO in their A, drawn by `terrainGalleryPatch` (`VERTEX_COLOR`, `RGB_AO`). The
// patch shows the seams (none: heights, normals, colours and AO agree on the shared edges), and
// its A/B the CPU rules against the shader's: the same blocks with the same rules (the blocks'
// JSON's, the one source) evaluated per pixel (`blend.source` `RULES`), so a difference is the
// vertex spacing's, never the math's.
import type * as THREE from 'three/webgpu';
import {
  decMaterialRef,
  existsOrThrow,
  getMaterial,
  getMaterialVariant,
  getMeshByAppId,
  incMaterialRef,
  lerror,
  setMeshMaterial,
} from 'aekasha';
import { getTerrainBlock, spawnTerrainBlock } from 'aekasha/terrain';
import type { GalleryDebugView } from './galleryBlocks';

/** The patch's material (its JSON), the vertex colour's */
export const PATCH_MATERIAL_ID = 'terrainGalleryPatch';
/** A block's side, metres */
export const PATCH_BLOCK_SIZE = 32;
/** The grid places: columns along x, rows along z (from the back) */
const GRID_XS = [-1, 0, 1];
const GRID_ZS = [-6, -5, -4];

/** The nine blocks' ids (`patch/<id>.terrainBlock.json`), by column then row */
export const PATCH_BLOCK_IDS: readonly string[] = GRID_XS.flatMap((_, col) =>
  GRID_ZS.map((__, row) => `terrainGalleryPatch_c${col}r${row}`)
);

/** The patch's extent on the ground */
export const PATCH_BOUNDS = {
  minX: GRID_XS[0] * PATCH_BLOCK_SIZE - PATCH_BLOCK_SIZE / 2,
  maxX: GRID_XS[2] * PATCH_BLOCK_SIZE + PATCH_BLOCK_SIZE / 2,
  minZ: GRID_ZS[0] * PATCH_BLOCK_SIZE - PATCH_BLOCK_SIZE / 2,
  maxZ: GRID_ZS[2] * PATCH_BLOCK_SIZE + PATCH_BLOCK_SIZE / 2,
};

/** Where the layers' weights come from: the vertex colours (CPU) or the shader's rules */
export type PatchRules = 'CPU' | 'SHADER';

/** The patch's view: the rules' source, the vertex AO, and the tab's debug view */
const state: { rules: PatchRules; isVertexAo: boolean; debugView: GalleryDebugView } = {
  rules: 'CPU',
  isVertexAo: true,
  debugView: 'NONE',
};

/** The patch's view (read only: set it with {@link setPatchView}) */
export const getPatchView = (): Readonly<typeof state> => state;

/** A block's mesh entity's app id (`spawnTerrainBlock`'s default) */
export const getPatchAppId = (id: string) => `terrainBlock/${id}`;

/** The blocks' params (the first block's): the rules the shader's variant evaluates */
const getPatchParams = () =>
  existsOrThrow(
    getTerrainBlock(PATCH_BLOCK_IDS[0]),
    `[terrainGallery] The scene doesn't list "${PATCH_BLOCK_IDS[0]}".`
  ).geometry;

/**
 * The material for the view: the patch's own (CPU, AO on, no debug view), else its variant over
 * its define: the AO off, the debug view, or the rules in the shader (`RULES` over the macro noise,
 * which the scene lists; no vertex AO, which needs the vertex colour)
 */
const getPatchMaterial = () => {
  const base = existsOrThrow(
    getMaterial(PATCH_MATERIAL_ID),
    `[terrainGallery] No material "${PATCH_MATERIAL_ID}".`
  );
  const { rules, isVertexAo, debugView } = state;
  if (rules === 'CPU' && isVertexAo && debugView === 'NONE') return base;
  const { ao: _ao, ...define } = base.userData.terrainDefine as Record<string, unknown>;
  const view = debugView === 'NONE' ? {} : { debugView };
  if (rules === 'CPU') {
    const ao = isVertexAo ? { ao: { vertex: true } } : {};
    return getMaterialVariant(PATCH_MATERIAL_ID, {
      staticDefines: { terrain: { ...define, ...ao, ...view } },
    });
  }
  const geometry = getPatchParams();
  const params = 'params' in geometry ? geometry.params : {};
  return getMaterialVariant(PATCH_MATERIAL_ID, {
    staticDefines: {
      terrain: { ...define, blend: { source: 'RULES', rules: params.rules }, ...view },
    },
    inputs: { macro: { texture: 'macroNoise' } },
  });
};

/**
 * Sets the patch's view (the given fields) and swaps its blocks to the material for it (made the
 * first time). The debug views must be loaded (`loadTerrainDebugViewsAsync`).
 */
export const setPatchView = (view: Partial<typeof state>) => {
  Object.assign(state, view);
  const material = getPatchMaterial() as THREE.Material;
  for (const id of PATCH_BLOCK_IDS) {
    const mesh = getMeshByAppId(getPatchAppId(id));
    if (mesh) setMeshMaterial(mesh, material);
  }
};

/**
 * Logs an error for a block whose geometry differs from the first's but for nothing: the nine
 * files are one patch, written alike (their grid places apart)
 */
const checkPatchBlocksAlike = () => {
  const first = JSON.stringify(getPatchParams());
  const unlike = PATCH_BLOCK_IDS.filter(
    (id) => JSON.stringify(getTerrainBlock(id)?.geometry) !== first
  );
  if (unlike.length) {
    lerror(
      `[terrainGallery] The patch's blocks ${unlike.join(', ')} differ from ${PATCH_BLOCK_IDS[0]} in their geometry (generator, params or seed): the patch is one terrain.`
    );
  }
};

/**
 * Spawns the patch's blocks (the scene's load), at the scene's defaults: the CPU rules with their
 * AO, no debug view (the tab applies its own). The patch's material takes a ref for the visit, so
 * it stays while every block shows a variant of it (the scene's exit gives it back).
 * @param isCurrent whether the scene is still the one loading (re-checked after each spawn)
 * @param addExitCleanup adds a function the scene's exit runs
 */
export const createPatchRowAsync = async (
  isCurrent: () => boolean,
  addExitCleanup: (cleanup: () => void) => void
) => {
  Object.assign(state, { rules: 'CPU', isVertexAo: true, debugView: 'NONE' });
  checkPatchBlocksAlike();
  incMaterialRef(PATCH_MATERIAL_ID);
  addExitCleanup(() => decMaterialRef(PATCH_MATERIAL_ID));
  for (const id of PATCH_BLOCK_IDS) {
    const block = await spawnTerrainBlock(id);
    if (!block || !isCurrent()) return;
  }
};
