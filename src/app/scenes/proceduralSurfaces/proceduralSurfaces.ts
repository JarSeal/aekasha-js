import * as THREE from 'three/webgpu';
import { vec2, vec4 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import {
  bakeTexture,
  cameraLookAtPoint,
  createCameraEntity,
  createMaterial,
  createMeshEntity,
  getECSWorld,
  getEntityIdByAppId,
  getGeometry,
  getMaterial,
  getRenderer,
  lerror,
  registerOnSceneExit,
  saveBufferGeometry,
  type BakedTexture,
} from 'aekasha';
import { loadDebugModuleAsync } from 'aekasha/debug';
import {
  getTextureSet,
  getTextureSetPackingTextures,
  loadTextureSetAsync,
  type TextureSetPacking,
} from 'aekasha/texturesets';
import { generateTerrain } from 'aekasha/toolkit/geometry';
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
import { getBackendName, getErrorMessage } from '../../shared/verifyHarness';
import {
  checkLiveSurface,
  checkPeriodicity,
  checkSurfaceSlot,
  compareImages,
  type ImageComparison,
  type LiveCheck,
  type PeriodicityCheck,
  type SlotCheck,
} from './surfaceChecks';
import { shadeBakedSurface, shadeLiveSurface } from '../../shared/surfaceShading';

/**
 * The procedural surfaces verification scene (p304 Phase 4's exit): the toolkit's ten surface
 * generators (`aekasha/toolkit/terrain`), each baked by `bakeSurfaceGenerator` (512², `LITE` until
 * the tab picks another packing) and drawn on a generated 6 × 6 m block with a 35° ramp at its back
 * (−z), tiled in world space over the generator's `physicalSize` (`shared/surfaceShading.ts`). Two
 * rows of five from the back, in `GENERATORS`' order. The DAY_NIGHT sky stands at 10:00.
 *
 * During the load each generator is checked (`surfaceChecks.ts`), a failure logged as an error so
 * the scene runner (`yarn verify:scenes --only proceduralSurfaces`, `--webgl` for SwiftShader)
 * fails on it: its `LITE` bake (the shown one) and a 256² bake of `FULL` and of `MINIMAL` are read
 * back, each slot written as p303 D2 packs it with no seam across its wrap; and a 256² bake of the
 * difference between its `LITE` slots at uv and a whole number of tiles away (`buildPacking` twice)
 * shows it repeats.
 *
 * In front, the JSON path (section 3): the procedural texture sets the scene lists
 * (`JSON_SETS`), baked by the `textureSets()` feature with the load, drawn by the toolkit's
 * `textureSetSurface` through `{ textureSet }`; each slot is read back, checked as above and
 * compared byte for byte with a `bakeSurfaceGenerator` of the same generator and values, and
 * `loadTextureSetAsync` must return the load's textures rather than bake again.
 *
 * The live mode (section 4, `createLiveSurface`): each generator's live surface over one tile is
 * baked 256² and read back (written, not the same a whole tile away, the opt-in taps' normal and
 * AO), and next to each JSON set's block its generator runs live in the block's material with the
 * set's values (`LIVE_BLOCKS`: the ripples bumped from the height, the cracks with the taps), so
 * the live graph compiles in a material on either backend and stands beside its bake. The tab's
 * "Surface" switch draws the ten blocks live instead (`setShownLive`).
 * `window.__proceduralSurfaces` holds the results; the debug env's "Procedural surfaces" tab
 * (`_dbg__proceduralSurfaces.ts`) switches the shown packing and shows them.
 */

export const PROCEDURAL_SURFACES_SCENE_ID = 'proceduralSurfaces';

/** The generators, rows from the back, left to right. */
export const GENERATORS = [
  sandRipples,
  sandFlat,
  mudCracked,
  mudSmooth,
  rockyGround,
  cliffStrata,
  snowDrift,
  iceSheet,
  grassGround,
  concretePores,
] as unknown as SurfaceGenerator[];

/** The procedural texture sets the scene's JSON lists (p304 D3's JSON path), in front. */
export const JSON_SETS = ['p304ProcRipples', 'p304ProcCracks'] as const;
/** The live blocks, outside the JSON sets' in the front row: each set's generator run live with
 * the set's values, with or without a bake's taps for its normal and AO. */
const LIVE_BLOCKS = [
  { setId: 'p304ProcRipples', x: -1.5, hasTaps: false },
  { setId: 'p304ProcCracks', x: 1.5, hasTaps: true },
] as const;
/** The toolkit's baseline set material, which draws the JSON sets through `{ textureSet }`. */
const SET_MATERIAL_ID = 'textureSetSurface';

/** The packings, in the tab's order. */
export const PACKINGS: readonly TextureSetPacking[] = ['LITE', 'FULL', 'MINIMAL'];
/** Every bake's seed. */
const SEED = 7;
/** The shown bakes' size; the check bakes'. */
const SHOWN_SIZE = 512;
const CHECK_SIZE = 256;
/** The periodicity check's shift, in whole tiles. */
const PERIOD_SHIFT = [1, -2] as const;

const BLOCK_SIZE = 6;
const BLOCK_PITCH = 8;
const COLUMNS = 5;
const BLOCK_SEGMENTS = 48;
/** The back 2 m of a block rising at 35° */
const RAMP_DEPTH = 2;
const RAMP_SLOPE = Math.tan(THREE.MathUtils.degToRad(35));
const BLOCK_GEOMETRY_ID = 'proceduralSurfacesBlock';
const CAMERA_APP_ID = 'proceduralSurfacesCam';
/** The camera over every block, and a block's close-up offset (in front, above, looking down). */
const OVERVIEW = { position: { x: 0, y: 22, z: 34 }, look: { x: 0, y: 0, z: 4 } };
const CLOSE_UP = { y: 2.4, z: 3.2 };

/** A generator's checks: per packing its slots', and the periodicity. */
export type GeneratorResult = {
  packings: Partial<Record<TextureSetPacking, Record<string, SlotCheck>>>;
  periodicity?: PeriodicityCheck;
  /** The live surface's checks (section 4). */
  live?: LiveCheck;
  /** Every failure, in words, prefixed by its packing; empty when it passes. */
  failures: string[];
};

/**
 * A generator's shown bake, for the tab's export: its id and its slots (none before it's baked).
 * @param generatorId one of `GENERATORS`' ids
 * @returns the bake's id and output names, or undefined
 */
export const getShownBake = (generatorId: string) => {
  const bake = blocks.get(generatorId)?.shown?.bake;
  return bake && !bake.isDisposed()
    ? { id: bake.id, slots: Object.keys(bake.textures) }
    : undefined;
};

/**
 * Moves the scene's camera to a block's close-up, or back over every block (the tab's list, and the
 * test bridge's shots: `window.__proceduralSurfaces.viewBlock`).
 * @param generatorId the block's generator (a JSON set's id for its block, `live:<setId>` for the
 * live block next to it), or null for the overview
 */
export const viewBlock = (generatorId: string | null) => {
  const world = getECSWorld();
  const cameraId = getEntityIdByAppId(CAMERA_APP_ID, world);
  if (cameraId === undefined) return;
  const index = GENERATORS.findIndex((generator) => generator.id === generatorId);
  const jsonIndex = JSON_SETS.findIndex((setId) => setId === generatorId);
  const liveBlock = LIVE_BLOCKS.find(({ setId }) => `live:${setId}` === generatorId);
  if (index < 0 && jsonIndex < 0 && !liveBlock) {
    world.setTransform(cameraId, { pos: OVERVIEW.position });
    cameraLookAtPoint(cameraId, OVERVIEW.look, world);
    return;
  }
  const { x, z } = liveBlock
    ? getLiveBlockPosition(liveBlock)
    : index < 0
      ? getJsonBlockPosition(jsonIndex)
      : getBlockPosition(index);
  world.setTransform(cameraId, { pos: { x, y: CLOSE_UP.y, z: z + CLOSE_UP.z } });
  cameraLookAtPoint(cameraId, { x, y: 0, z: z - 0.5 }, world);
};

/** A procedural set's checks (the JSON path): its slots', and against a code bake. */
export type JsonSetResult = {
  generator: string;
  packing: TextureSetPacking;
  slots: Record<string, SlotCheck>;
  /** Each slot's readback against the code bake's (equal: the same graph). */
  compare: Record<string, ImageComparison>;
  /** Whether `loadTextureSetAsync` returned the load's textures (re-tagged, not baked again). */
  isLoadShared: boolean;
  failures: string[];
};

/** What `window.__proceduralSurfaces` holds. */
export type ProceduralSurfacesResults = {
  backend?: string;
  generators?: Record<string, GeneratorResult>;
  /** The JSON path's sets, by id. */
  jsonSets?: Record<string, JsonSetResult>;
  /** The packing the blocks show. */
  shownPacking?: TextureSetPacking;
  /** Whether the ten blocks draw their generators live instead of their bakes. */
  isLiveShown?: boolean;
  /** Every generator and JSON set passed. */
  passed?: boolean;
  error?: string;
  done?: boolean;
};

const state = {
  results: {} as ProceduralSurfacesResults,
  viewBlock,
  setShownLive: (isLive: boolean) => setShownLive(isLive),
};

/** This visit's: false once the scene is left, so an await that ends later does nothing. */
let visit = { isCurrent: false };
/** Each block's material and shown bake, by generator id. */
const blocks = new Map<
  string,
  { material: THREE.MeshStandardNodeMaterial; shown?: BakedSurface }
>();
/** The latest packing switch: an older one that finishes later is dropped. */
let packingRequest = 0;

const getBlockPosition = (index: number) => ({
  x: ((index % COLUMNS) - (COLUMNS - 1) / 2) * BLOCK_PITCH,
  z: (Math.floor(index / COLUMNS) - 0.5) * BLOCK_PITCH,
});
/** The JSON sets' blocks: a third row in front, centred */
const getJsonBlockPosition = (index: number) => ({
  x: (index - (JSON_SETS.length - 1) / 2) * BLOCK_PITCH,
  z: 1.5 * BLOCK_PITCH,
});

/** The live blocks: the front row, outside the JSON sets' */
const getLiveBlockPosition = (block: (typeof LIVE_BLOCKS)[number]) => ({
  x: block.x * BLOCK_PITCH,
  z: 1.5 * BLOCK_PITCH,
});

const getBlockGeometry = () =>
  getGeometry(BLOCK_GEOMETRY_ID) ??
  saveBufferGeometry(
    generateTerrain({
      width: BLOCK_SIZE,
      depth: BLOCK_SIZE,
      widthSegments: BLOCK_SEGMENTS,
      depthSegments: BLOCK_SEGMENTS,
      maxHeight: 0.25,
      noiseOctaves: [{ frequency: 1 / 3, amplitude: 1 }],
      seed: 304,
      heightModifier: (_x, z, h) => h + Math.max(0, -BLOCK_SIZE / 2 + RAMP_DEPTH - z) * RAMP_SLOPE,
    }).geometry,
    { id: BLOCK_GEOMETRY_ID }
  );

const bakeShownAsync = (generator: SurfaceGenerator, packing: TextureSetPacking) =>
  bakeSurfaceGenerator({
    id: `p304_surface_${generator.id}_${packing}`,
    generator,
    packing,
    size: SHOWN_SIZE,
    seed: SEED,
    anisotropy: 'MAX',
  });

/** An output of a bake, read back as RGBA8 bytes (level 0, rows without padding). */
const readOutputAsync = (baked: BakedTexture, name: string, size: number) =>
  readBakedTextureAsync(baked.textures[name], size);

/** A baked texture (a render target's) read back as RGBA8 bytes (level 0, no row padding). */
const readBakedTextureAsync = async (texture: THREE.Texture, size: number) => {
  const renderer = getRenderer(true) as THREE.Renderer;
  const target = texture.renderTarget as THREE.RenderTarget;
  const index = target.textures.indexOf(texture);
  const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, size, size, index);
  return pixels as Uint8Array;
};

/** Reads each slot of a packing's bake back and checks it. */
const checkPackingAsync = async (surface: BakedSurface, size: number) => {
  const checks: Record<string, SlotCheck> = {};
  for (const slot of Object.keys(surface.bake.textures)) {
    checks[slot] = checkSurfaceSlot(slot, await readOutputAsync(surface.bake, slot, size), size);
  }
  return checks;
};

/**
 * The periodicity bake: `|slot(uv) − slot(uv + whole tiles)| × 100` of the `LITE` slots, built by
 * the engine's interface (`buildPacking`) at both points, read back and checked.
 */
const checkPeriodicityAsync = async (generator: SurfaceGenerator) => {
  const opts = {
    packing: 'LITE' as const,
    seed: SEED,
    physicalSize: generator.physicalSize,
    heightScale: generator.heightScale,
  };
  const baked = await bakeTexture({
    id: `p304_period_${generator.id}`,
    size: CHECK_SIZE,
    mipmaps: false,
    outputs: [{ name: 'albedoRough' }, { name: 'normalHeight' }],
    build: (ctx) => {
      const shifted = ctx.uv.add(vec2(...PERIOD_SHIFT)) as Node<'vec2'>;
      const at = generator.buildPacking(ctx, opts);
      const away = generator.buildPacking({ ...ctx, uv: shifted }, opts);
      const diff = (slot: string) =>
        (at[slot] as Node<'vec4'>)
          .sub(away[slot] as Node<'vec4'>)
          .abs()
          .mul(100) as THREE.Node;
      return { albedoRough: diff('albedoRough'), normalHeight: diff('normalHeight') };
    },
  });
  const images = [
    await readOutputAsync(baked, 'albedoRough', CHECK_SIZE),
    await readOutputAsync(baked, 'normalHeight', CHECK_SIZE),
  ];
  baked.dispose();
  return checkPeriodicity(images, CHECK_SIZE * CHECK_SIZE);
};

/**
 * The live check's bake: the generator's live surface over one tile (`surface`), its difference a
 * whole number of tiles away × 100 (`away`: live, no period makes them equal) and a second live
 * surface's opt-in taps (`tapped`: the normal and the cavity AO, through the height's layout
 * function), read back and checked.
 */
const checkLiveAsync = async (generator: SurfaceGenerator) => {
  const baked = await bakeTexture({
    id: `p304_live_${generator.id}`,
    size: CHECK_SIZE,
    mipmaps: false,
    // The albedo sRGB, as a bake's albedo slot (a dark channel's spread is below a byte linear)
    outputs: [{ name: 'surface', colorSpace: 'SRGB' }, { name: 'away' }, { name: 'tapped' }],
    build: (ctx) => {
      const shifted = ctx.uv.add(vec2(...PERIOD_SHIFT)) as Node<'vec2'>;
      const at = createLiveSurface(generator, { uv: ctx.uv, seed: SEED });
      const away = createLiveSurface(generator, { uv: shifted, seed: SEED });
      const tapped = createLiveSurface(generator, {
        uv: ctx.uv,
        seed: SEED,
        normal: 'TAPS',
        ao: 'CAVITY',
      });
      const pack = (live: LiveSurface) => vec4(live.albedo, live.height) as unknown as Node<'vec4'>;
      return {
        surface: pack(at).clamp(0, 1) as THREE.Node,
        away: pack(at).sub(pack(away)).abs().mul(100) as THREE.Node,
        tapped: vec4(
          (tapped.normalTS as Node<'vec3'>).mul(0.5).add(0.5),
          tapped.ao as Node<'float'>
        ) as THREE.Node,
      };
    },
  });
  const images = {
    surface: await readOutputAsync(baked, 'surface', CHECK_SIZE),
    away: await readOutputAsync(baked, 'away', CHECK_SIZE),
    tapped: await readOutputAsync(baked, 'tapped', CHECK_SIZE),
  };
  baked.dispose();
  return checkLiveSurface(images, CHECK_SIZE);
};

/** A generator's block: its material, the shown bake, and the checks of every packing. */
const createBlockAsync = async (generator: SurfaceGenerator, index: number) => {
  const material = createMaterial({
    id: `p304_surface_${generator.id}`,
    type: 'STANDARDNODEMATERIAL',
    params: {},
  }) as THREE.MeshStandardNodeMaterial;
  const block: { material: THREE.MeshStandardNodeMaterial; shown?: BakedSurface } = { material };
  blocks.set(generator.id, block);
  const shown = await bakeShownAsync(generator, 'LITE');
  block.shown = shown;
  shadeBakedSurface(material, shown);
  createMeshEntity(
    {
      geo: getBlockGeometry(),
      mat: material,
      position: getBlockPosition(index),
      castShadow: false,
      receiveShadow: false,
    },
    { appId: `proceduralSurfaces_${generator.id}`, debugData: { name: `Block: ${generator.id}` } }
  );

  const result: GeneratorResult = { packings: {}, failures: [] };
  result.packings.LITE = await checkPackingAsync(shown, SHOWN_SIZE);
  for (const packing of ['FULL', 'MINIMAL'] as const) {
    const check = await bakeSurfaceGenerator({
      id: `p304_check_${generator.id}_${packing}`,
      generator,
      packing,
      size: CHECK_SIZE,
      seed: SEED,
    });
    result.packings[packing] = await checkPackingAsync(check, CHECK_SIZE);
    check.bake.dispose();
  }
  result.periodicity = await checkPeriodicityAsync(generator);
  result.live = await checkLiveAsync(generator);
  for (const [packing, slots] of Object.entries(result.packings)) {
    for (const slot of Object.values(slots)) {
      result.failures.push(...slot.failures.map((failure) => `${packing}: ${failure}`));
    }
  }
  result.failures.push(...result.periodicity.failures, ...result.live.failures);
  for (const failure of result.failures) {
    lerror(`[proceduralSurfaces] ${generator.id} (${getBackendName()}): ${failure}.`);
  }
  return result;
};

/**
 * A JSON set's block and checks: the set baked by the load (its textures registered as
 * `<setId>.<slot>`), drawn by `textureSetSurface` through `{ textureSet }`, read back, checked as a
 * generator's packing is, compared with a code bake of the same values, and loaded from code.
 */
const createJsonSetBlockAsync = async (setId: string, index: number): Promise<JsonSetResult> => {
  const set = getTextureSet(setId);
  const procedural = set?.procedural;
  const textures = getTextureSetPackingTextures(setId) as Record<string, THREE.Texture> | undefined;
  if (!set || !procedural || !textures) {
    throw new Error(`the procedural set "${setId}" isn't in the data, or wasn't baked by the load`);
  }
  createMeshEntity(
    {
      geo: getBlockGeometry(),
      mat: getMaterial(SET_MATERIAL_ID) as THREE.Material,
      matOverrides: { inputs: { surface: { textureSet: setId } } },
      position: getJsonBlockPosition(index),
      castShadow: false,
      receiveShadow: false,
    },
    { appId: `proceduralSurfaces_${setId}`, debugData: { name: `JSON set: ${setId}` } }
  );

  const generator = GENERATORS.find(({ id }) => id === procedural.generator);
  if (!generator) throw new Error(`no generator "${procedural.generator}" in GENERATORS`);
  const size = typeof procedural.size === 'number' ? procedural.size : procedural.size[0];
  const reference = await bakeSurfaceGenerator({
    id: `p304_json_${setId}`,
    generator,
    packing: procedural.packing,
    size: procedural.size,
    seed: procedural.seed,
    params: procedural.params as never,
    physicalSize: set.physicalSize,
    heightScale: set.heightScale,
  });
  const result: JsonSetResult = {
    generator: generator.id,
    packing: procedural.packing,
    slots: {},
    compare: {},
    isLoadShared: false,
    failures: [],
  };
  for (const [slot, texture] of Object.entries(textures)) {
    const bytes = await readBakedTextureAsync(texture, size);
    const check = checkSurfaceSlot(slot, bytes, size);
    const compare = compareImages(bytes, await readOutputAsync(reference.bake, slot, size));
    result.slots[slot] = check;
    result.compare[slot] = compare;
    result.failures.push(...check.failures);
    if (compare.maxByte) {
      result.failures.push(
        `${slot}: the JSON bake differs from the code bake on ${compare.offTexels} texels, up to ${compare.maxByte} / 255`
      );
    }
  }
  reference.bake.dispose();
  const loaded = (await loadTextureSetAsync(setId)) as Record<string, THREE.Texture>;
  result.isLoadShared = Object.entries(textures).every(
    ([slot, texture]) => loaded[slot] === texture
  );
  if (!result.isLoadShared) {
    result.failures.push("loadTextureSetAsync didn't return the load's baked textures");
  }
  for (const failure of result.failures) {
    lerror(`[proceduralSurfaces] JSON set ${setId} (${getBackendName()}): ${failure}.`);
  }
  return result;
};

/**
 * A live block (section 4): a JSON set's generator run live in the block's material with the
 * set's values (its params, seed and physical facts, as p305's `PROCEDURAL_LIVE` layer reads a
 * procedural set), beside the set's baked block.
 */
const createLiveBlock = (block: (typeof LIVE_BLOCKS)[number]) => {
  const set = getTextureSet(block.setId);
  const generator = GENERATORS.find(({ id }) => id === set?.procedural?.generator);
  if (!set?.procedural || !generator) {
    throw new Error(`the live block's set "${block.setId}" has no generator in GENERATORS`);
  }
  const material = createMaterial({
    id: `p304_live_${block.setId}`,
    type: 'STANDARDNODEMATERIAL',
    params: {},
  }) as THREE.MeshStandardNodeMaterial;
  shadeLiveSurface(
    material,
    createLiveSurface(generator, {
      seed: set.procedural.seed,
      params: set.procedural.params as never,
      physicalSize: set.physicalSize,
      heightScale: set.heightScale,
      normal: block.hasTaps ? 'TAPS' : 'NONE',
      ao: block.hasTaps ? 'CAVITY' : 'NONE',
    })
  );
  createMeshEntity(
    {
      geo: getBlockGeometry(),
      mat: material,
      position: getLiveBlockPosition(block),
      castShadow: false,
      receiveShadow: false,
    },
    {
      appId: `proceduralSurfaces_live_${block.setId}`,
      debugData: { name: `Live: ${generator.id}${block.hasTaps ? ' (taps)' : ''}` },
    }
  );
};

/**
 * Draws the ten blocks' generators live (`createLiveSurface`, the bakes' seed, the normal a bump
 * from the height) or their shown bakes again (the tab's "Surface" switch).
 * @param isLive true for live
 */
export const setShownLive = (isLive: boolean) => {
  for (const generator of GENERATORS) {
    const block = blocks.get(generator.id);
    if (!block) continue;
    if (isLive) {
      shadeLiveSurface(block.material, createLiveSurface(generator, { seed: SEED }));
    } else if (block.shown) shadeBakedSurface(block.material, block.shown);
  }
  state.results.isLiveShown = isLive;
};

/**
 * Bakes every block's generator in a packing and draws it (the tab's packing switch); the latest
 * call wins, and the bakes of the packing left are disposed.
 * @param packing the packing to show
 */
export const setShownPackingAsync = async (packing: TextureSetPacking) => {
  const request = ++packingRequest;
  const startedOn = visit;
  const bakes = await Promise.all(
    GENERATORS.map((generator) => bakeShownAsync(generator, packing))
  ).catch((error: unknown) => {
    lerror(`[proceduralSurfaces] The ${packing} bakes failed:`, error);
    return null;
  });
  if (!bakes || !startedOn.isCurrent || request !== packingRequest) return;
  GENERATORS.forEach((generator, i) => {
    const block = blocks.get(generator.id);
    if (!block) return;
    if (block.shown && block.shown !== bakes[i]) block.shown.bake.dispose();
    block.shown = bakes[i];
    // Shown live: the bake waits for the switch back
    if (!state.results.isLiveShown) shadeBakedSurface(block.material, bakes[i]);
  });
  state.results.shownPacking = packing;
};

/** Builds the scene; see the file's header. */
export const scene = async () => {
  (window as unknown as { __proceduralSurfaces: typeof state }).__proceduralSurfaces = state;
  state.results = { shownPacking: 'LITE', isLiveShown: false };
  const thisVisit = { isCurrent: true };
  visit = thisVisit;
  blocks.clear();
  registerOnSceneExit(PROCEDURAL_SURFACES_SCENE_ID, () => {
    thisVisit.isCurrent = false;
    blocks.clear();
  });
  createCameraEntity(
    {
      type: 'PERSPECTIVE',
      fov: 50,
      position: OVERVIEW.position,
      lookAtPoint: OVERVIEW.look,
      active: true,
    },
    { appId: CAMERA_APP_ID, debugData: { name: 'Procedural surfaces' } }
  );
  createMeshEntity(
    {
      geo: {
        id: 'proceduralSurfacesGround',
        type: 'BOX',
        params: { width: COLUMNS * BLOCK_PITCH + 2, height: 0.2, depth: 3 * BLOCK_PITCH + 2 },
      },
      mat: {
        id: 'proceduralSurfacesGround',
        type: 'STANDARD',
        params: { color: '#2e2f31', roughness: 0.95 },
      },
      position: { y: -0.5, z: BLOCK_PITCH / 2 },
      castShadow: false,
      receiveShadow: false,
    },
    { appId: 'proceduralSurfaces_ground', debugData: { name: 'Ground' } }
  );

  try {
    const generators: Record<string, GeneratorResult> = {};
    for (let i = 0; i < GENERATORS.length; i++) {
      generators[GENERATORS[i].id] = await createBlockAsync(GENERATORS[i], i);
    }
    state.results.generators = generators;
    const jsonSets: Record<string, JsonSetResult> = {};
    for (let i = 0; i < JSON_SETS.length; i++) {
      jsonSets[JSON_SETS[i]] = await createJsonSetBlockAsync(JSON_SETS[i], i);
    }
    state.results.jsonSets = jsonSets;
    LIVE_BLOCKS.forEach(createLiveBlock);
    state.results.passed = [...Object.values(generators), ...Object.values(jsonSets)].every(
      (result) => !result.failures.length
    );
    state.results.backend = getBackendName();
    state.results.done = true;
  } catch (error) {
    lerror('[proceduralSurfaces] Build failed', error);
    state.results.error = getErrorMessage(error);
  }
  const debugTab = await loadDebugModuleAsync(
    () => import('./_dbg__proceduralSurfaces'),
    false,
    'proceduralSurfaces tab'
  );
  debugTab?.current?.createProceduralSurfacesTab(state.results);
};
