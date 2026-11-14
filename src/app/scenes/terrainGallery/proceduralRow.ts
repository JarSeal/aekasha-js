// The terrain gallery's Procedural row (p304 Phase 6): the toolkit's ten surface generators, a
// block each, right of the library. Each block shows its generator baked (`bakeSurfaceGenerator`,
// the row's packing and size), live in the material (`createLiveSurface`, its normal a bump from
// the height, or with a bake's taps for the normal and the AO) or, for comparison, an imported
// library set of its category. A mode is a mesh of its own on the block (made the first time it's
// shown, hidden otherwise), so switching compiles each material once and frees none.
//
// A generator's values (its params and seed) are the block's: a change of a number or a colour sets
// the bake's and the live surfaces' uniforms and rebakes (the baker renders one bake a frame); a
// static param or a toggle builds the graphs again (a new bake, the old one disposed once the new
// one shows). The scene's tab (`_dbg__terrainGalleryProcedural.ts`) drives all of it.
import type * as THREE from 'three/webgpu';
import {
  createMaterial,
  createMeshEntity,
  existsOrThrow,
  getMaterial,
  getMeshByAppId,
  lerror,
} from 'aekasha';
import type { TextureSetPacking } from 'aekasha/texturesets';
import {
  bakeSurfaceGenerator,
  cliffStrata,
  concretePores,
  createLiveSurface,
  grassGround,
  iceSheet,
  mudCracked,
  mudSmooth,
  rockyGround,
  sandFlat,
  sandRipples,
  snowDrift,
  type BakedSurface,
  type LiveSurface,
  type SurfaceGenerator,
} from 'aekasha/toolkit/terrain';
import {
  getSurfaceTileUv,
  shadeBakedSurface,
  shadeLiveSurface,
  type SurfaceTiling,
} from '../../shared/surfaceShading';
import {
  BLOCK_GAP,
  BLOCK_PITCH,
  BLOCK_SIZE,
  GALLERY_MATERIAL_ID,
  getBlockGeometry,
  getBlockGeometryId,
  getSurfaceOverrides,
  getWallGeometry,
  getWallPosition,
  NO_SHADOWS,
} from './galleryBlocks';

/** What a block of the row shows: an imported library set of the generator's category, the
 * generator's bake, or the generator live (its normal a bump, or with a bake's taps). */
export const PROCEDURAL_MODES = ['IMPORTED', 'BAKED', 'LIVE', 'LIVE_TAPS'] as const;
/** One of {@link PROCEDURAL_MODES} */
export type ProceduralMode = (typeof PROCEDURAL_MODES)[number];
type LiveMode = 'LIVE' | 'LIVE_TAPS';

/** The bake sizes the tab offers, texels a side */
export const PROCEDURAL_BAKE_SIZES = [256, 512, 1024, 2048] as const;

/** A generator's values: what a procedural set's JSON would name */
export type ProceduralValues = { seed: number; params: Record<string, number | string | boolean> };

/** A block of the row: its generator, the library set its Imported mode shows, where it stands */
export type ProceduralBlock = {
  generator: SurfaceGenerator;
  importedSetId: string;
  /** The block's centre on the ground */
  x: number;
  z: number;
  /** Whether it has a wall (the strata, made for vertical faces) */
  hasWall: boolean;
  /** Its terrain's geometry id (its seed's) */
  geometryId: string;
  /** Its geometry's seed */
  seed: number;
};

/** Rows from the back (−z), two generators a row, each with its category's library set */
const ROWS: [SurfaceGenerator, string][][] = (
  [
    [
      [sandRipples, 'sand02'],
      [sandFlat, 'sand01'],
    ],
    [
      [mudCracked, 'mud01'],
      [mudSmooth, 'mud02'],
    ],
    [
      [rockyGround, 'rocks01'],
      [cliffStrata, 'cliffs01'],
    ],
    [
      [snowDrift, 'snow02'],
      [iceSheet, 'ice01'],
    ],
    [
      [grassGround, 'grass01'],
      [concretePores, 'concrete01'],
    ],
  ] as unknown[][][]
).map((row) => row as [SurfaceGenerator, string][]);

/** Twice the blocks' gap between the library and the row, metres */
const ROW_GAP = BLOCK_GAP * 2;
/** The library's right edge (its four columns are centred on x = 0) */
const LIBRARY_EDGE_X = BLOCK_PITCH * 1.5 + BLOCK_SIZE / 2;
/** The row's first column's centre */
const FIRST_COLUMN_X = LIBRARY_EDGE_X + ROW_GAP + BLOCK_SIZE / 2;
/** The row's right edge: where the gallery's ground ends */
export const PROCEDURAL_ROW_EDGE_X = FIRST_COLUMN_X + BLOCK_PITCH + BLOCK_SIZE / 2;
/** The row's depth (its five rows), metres */
export const PROCEDURAL_ROW_DEPTH = (ROWS.length - 1) * BLOCK_PITCH + BLOCK_SIZE;
/** Each block's seed: this plus its index, apart from the library's (303…) */
const SEED_BASE = 404;

/** The ten blocks, by row from the back and left to right */
export const PROCEDURAL_BLOCKS: readonly ProceduralBlock[] = ROWS.flatMap((pairs, row) =>
  pairs.map(([generator, importedSetId], col) => {
    const seed = SEED_BASE + row * pairs.length + col;
    return {
      generator,
      importedSetId,
      x: FIRST_COLUMN_X + col * BLOCK_PITCH,
      z: (row - (ROWS.length - 1) / 2) * BLOCK_PITCH,
      hasWall: generator.id === 'cliffStrata',
      geometryId: getBlockGeometryId(seed),
      seed,
    };
  })
);

/** The row's bake settings: every block's bake has them */
export type ProceduralBakeSettings = { packing: TextureSetPacking; size: number };
/** What the row bakes at its load */
export const DEFAULT_PROCEDURAL_BAKE: Readonly<ProceduralBakeSettings> = {
  packing: 'LITE',
  size: 1024,
};

/** A block's state on this visit */
type RowBlock = {
  def: ProceduralBlock;
  values: ProceduralValues;
  baked?: BakedSurface;
  /** The live surfaces of the modes shown so far (the ground's, and the wall's) */
  live: Partial<Record<LiveMode, LiveSurface[]>>;
  /** The mode it shows */
  mode: ProceduralMode;
  /** Its bakes so far: each gets an id of its own */
  bakeCount: number;
  /** The latest rebuild: an older one that finishes later is dropped */
  request: number;
};

/** This visit's: false once the scene is left, so an await that ends later does nothing */
let visit = { isCurrent: false };
const blocks = new Map<string, RowBlock>();
const bakeSettings: ProceduralBakeSettings = { ...DEFAULT_PROCEDURAL_BAKE };
let rowMode: ProceduralMode = 'BAKED';

/** A mode's mesh entity's app id on a block (its wall's with `isWall`) */
export const getProceduralAppId = (generatorId: string, mode: ProceduralMode, isWall = false) =>
  `terrainGallery_proc_${generatorId}_${mode}${isWall ? '_wall' : ''}`;

const getDefaultValues = (generator: SurfaceGenerator): ProceduralValues => ({
  seed: 7,
  params: Object.fromEntries(
    Object.entries(generator.params).map(([name, spec]) => [name, spec.default])
  ),
});

/** Whether a param is fixed when a graph is built (a toggle, a static number) */
const isStaticParam = (generator: SurfaceGenerator, name: string) => {
  const spec = generator.params[name];
  return spec?.type === 'boolean' || (spec?.type !== 'color' && Boolean(spec?.isStatic));
};

const bakeBlockAsync = (block: RowBlock) =>
  bakeSurfaceGenerator({
    id: `terrainGallery_proc_${block.def.generator.id}_${block.bakeCount++}`,
    generator: block.def.generator,
    packing: bakeSettings.packing,
    size: bakeSettings.size,
    seed: block.values.seed,
    params: block.values.params as never,
    anisotropy: 'MAX',
  });

/** A mode's material on a block, registered (the scene's) and empty until it's shaded */
const getModeMaterial = (generatorId: string, mode: ProceduralMode, isWall: boolean) =>
  createMaterial({
    id: `${getProceduralAppId(generatorId, mode, isWall)}_mat`,
    type: 'STANDARDNODEMATERIAL',
    params: {},
  }) as THREE.MeshStandardNodeMaterial;

/** Builds a live mode's surfaces from the block's values and shades its materials with them */
const shadeLive = (block: RowBlock, mode: LiveMode) => {
  const { generator, hasWall } = block.def;
  const tilings: SurfaceTiling[] = hasWall ? ['WORLD_XZ', 'UV'] : ['WORLD_XZ'];
  block.live[mode] = tilings.map((tiling) => {
    const live = createLiveSurface(generator, {
      uv: getSurfaceTileUv(generator.physicalSize, tiling),
      seed: block.values.seed,
      params: block.values.params as never,
      normal: mode === 'LIVE_TAPS' ? 'TAPS' : 'NONE',
      ao: mode === 'LIVE_TAPS' ? 'CAVITY' : 'NONE',
    });
    shadeLiveSurface(getModeMaterial(generator.id, mode, tiling === 'UV'), live);
    return live;
  });
};

/** Shades the Baked mode's materials with the block's bake */
const shadeBaked = (block: RowBlock) => {
  if (!block.baked) return;
  const { generator, hasWall } = block.def;
  shadeBakedSurface(getModeMaterial(generator.id, 'BAKED', false), block.baked);
  if (hasWall) shadeBakedSurface(getModeMaterial(generator.id, 'BAKED', true), block.baked, 'UV');
};

/** A mode's meshes on a block (the ground's, and the wall's), made the first time it's shown */
const ensureModeMeshes = (block: RowBlock, mode: ProceduralMode) => {
  const { generator, importedSetId, hasWall } = block.def;
  if (getMeshByAppId(getProceduralAppId(generator.id, mode))) return;
  if (mode === 'BAKED') shadeBaked(block);
  else if (mode !== 'IMPORTED') shadeLive(block, mode);
  const setMaterial = existsOrThrow(
    getMaterial(GALLERY_MATERIAL_ID),
    `The terrainGallery scene needs the "${GALLERY_MATERIAL_ID}" material.`
  );
  for (const isWall of hasWall ? [false, true] : [false]) {
    createMeshEntity(
      {
        geo: isWall ? getWallGeometry() : getBlockGeometry(block.def.seed),
        ...(mode === 'IMPORTED'
          ? { mat: setMaterial, matOverrides: getSurfaceOverrides(importedSetId, { isWall }) }
          : { mat: getModeMaterial(generator.id, mode, isWall) }),
        position: isWall ? getWallPosition(block.def) : { x: block.def.x, z: block.def.z },
        ...NO_SHADOWS,
      },
      {
        appId: getProceduralAppId(generator.id, mode, isWall),
        debugData: {
          name: `${isWall ? 'Wall' : 'Block'}: ${generator.id} (${mode === 'IMPORTED' ? importedSetId : mode.toLowerCase()})`,
        },
      }
    );
  }
};

/** Shows one mode's meshes on a block and hides the others' (all of them with `isHidden`) */
const showBlock = (block: RowBlock, mode: ProceduralMode, isHidden = false) => {
  if (!isHidden) ensureModeMeshes(block, mode);
  block.mode = mode;
  for (const other of PROCEDURAL_MODES) {
    for (const isWall of [false, true]) {
      const mesh = getMeshByAppId(getProceduralAppId(block.def.generator.id, other, isWall));
      if (mesh) mesh.visible = !isHidden && other === mode;
    }
  }
};

/**
 * Bakes the block again from its values and the row's bake settings (a new bake under a new id),
 * shades the Baked mode with it and builds the live surfaces again, then disposes the bake it
 * replaced. The latest call per block wins; one that ends after the scene was left disposes its
 * bake.
 */
const rebuildBlockAsync = async (block: RowBlock) => {
  const request = ++block.request;
  const startedOn = visit;
  let next: BakedSurface;
  try {
    next = await bakeBlockAsync(block);
  } catch (error) {
    lerror(`[terrainGallery] The ${block.def.generator.id} bake failed:`, error);
    return;
  }
  if (!startedOn.isCurrent || request !== block.request) {
    next.bake.dispose();
    return;
  }
  const previous = block.baked;
  block.baked = next;
  if (getMeshByAppId(getProceduralAppId(block.def.generator.id, 'BAKED'))) shadeBaked(block);
  for (const mode of Object.keys(block.live) as LiveMode[]) shadeLive(block, mode);
  previous?.bake.dispose();
};

/** The row's block of a generator on this visit, or undefined */
const getRowBlock = (generatorId: string) => blocks.get(generatorId);

/**
 * A generator's values in effect on its block (the live object: the tab's fields bind to its
 * `params`), or undefined outside a visit
 */
export const getProceduralValues = (generatorId: string) => getRowBlock(generatorId)?.values;

/** A generator's bake on its block: its id (for its stats and export), slots and bytes */
export const getProceduralBake = (generatorId: string) => {
  const bake = getRowBlock(generatorId)?.baked?.bake;
  return bake && !bake.isDisposed()
    ? { id: bake.id, slots: Object.keys(bake.textures), memoryBytes: bake.memoryBytes }
    : undefined;
};

/** The row's bake settings in effect */
export const getProceduralBakeSettings = (): Readonly<ProceduralBakeSettings> => bakeSettings;

/** The mode the row shows */
export const getProceduralMode = () => rowMode;

/**
 * Applies a generator's values after a change (the tab's fields wrote them into
 * `getProceduralValues(id)`): a number's or a colour's goes to the bake's and the live surfaces'
 * uniforms and the bake renders again; with `isRebuild` (a static param or a toggle changed) the
 * graphs are built again.
 * @param generatorId which block: its generator's id (`PROCEDURAL_BLOCKS`)
 * @param isRebuild build the graphs again (see `isProceduralParamStatic`)
 */
export const applyProceduralValues = (generatorId: string, isRebuild = false) => {
  const block = getRowBlock(generatorId);
  if (!block) return;
  if (isRebuild) {
    void rebuildBlockAsync(block);
    return;
  }
  try {
    const surfaces = [block.baked, ...Object.values(block.live).flat()];
    for (const surface of surfaces) {
      surface?.setParams(block.values.params as never);
      surface?.setSeed(block.values.seed);
    }
  } catch (error) {
    lerror(`[terrainGallery] ${generatorId}:`, error);
    return;
  }
  block.baked?.bake
    .rebake()
    .catch((error: unknown) => lerror(`[terrainGallery] The ${generatorId} rebake failed:`, error));
};

/** Whether changing a generator's param means building its graphs again */
export const isProceduralParamStatic = (generatorId: string, name: string) => {
  const block = getRowBlock(generatorId);
  return block ? isStaticParam(block.def.generator, name) : false;
};

/** Puts a generator's values back to its defaults and builds its block again */
export const resetProceduralValues = (generatorId: string) => {
  const block = getRowBlock(generatorId);
  if (!block) return;
  const defaults = getDefaultValues(block.def.generator);
  block.values.seed = defaults.seed;
  // In place: the tab's fields are bound to the object
  Object.assign(block.values.params, defaults.params);
  void rebuildBlockAsync(block);
};

/**
 * Shows a mode on every block of the row (its meshes made on the first use: a live mode compiles
 * its ten graphs then).
 * @param mode what the blocks show
 */
export const setProceduralMode = (mode: ProceduralMode) => {
  rowMode = mode;
  for (const block of blocks.values()) showBlock(block, mode);
};

/**
 * Shows a mode on one block, the row's mode on it again with `null`, or nothing with `'HIDDEN'`
 * (the tab's measurement, which shows a block alone in each mode in turn).
 * @param generatorId which block: its generator's id (`PROCEDURAL_BLOCKS`)
 * @param mode the mode, `'HIDDEN'`, or null for the row's
 */
export const setProceduralBlockMode = (
  generatorId: string,
  mode: ProceduralMode | 'HIDDEN' | null
) => {
  const block = getRowBlock(generatorId);
  if (!block) return;
  if (mode === 'HIDDEN') showBlock(block, block.mode, true);
  else showBlock(block, mode ?? rowMode);
};

/**
 * Changes the row's bake settings and bakes every block again in them.
 * @param settings the packing and / or the size (texels a side)
 * @returns once every block shows its new bake (or was dropped for a later call)
 */
export const setProceduralBakeAsync = async (settings: Partial<ProceduralBakeSettings>) => {
  Object.assign(bakeSettings, settings);
  await Promise.all([...blocks.values()].map(rebuildBlockAsync));
};

/**
 * Builds the row during the scene's load: every block's bake (in the default settings, rendered
 * inside the load) and its Baked mode's meshes. A bake that fails is logged and leaves its block
 * out.
 * @param onExit registers the visit's cleanup (the scene's exit)
 */
export const createProceduralRowAsync = async (onExit: (cleanup: () => void) => void) => {
  const thisVisit = { isCurrent: true };
  visit = thisVisit;
  blocks.clear();
  Object.assign(bakeSettings, DEFAULT_PROCEDURAL_BAKE);
  rowMode = 'BAKED';
  onExit(() => {
    thisVisit.isCurrent = false;
    blocks.clear();
  });
  await Promise.all(
    PROCEDURAL_BLOCKS.map(async (def) => {
      const block: RowBlock = {
        def,
        values: getDefaultValues(def.generator),
        live: {},
        mode: 'BAKED',
        bakeCount: 0,
        request: 0,
      };
      try {
        block.baked = await bakeBlockAsync(block);
      } catch (error) {
        lerror(`[terrainGallery] The ${def.generator.id} bake failed:`, error);
        return;
      }
      if (!thisVisit.isCurrent) return;
      blocks.set(def.generator.id, block);
      showBlock(block, 'BAKED');
    })
  );
};
