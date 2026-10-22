import * as THREE from 'three/webgpu';
import { float, normalMap, vec2 } from 'three/tsl';
import {
  createCameraEntity,
  IS_DEBUG_ENV,
  getECSWorld,
  ComponentType,
  createGeometry,
  existsOrThrow,
  getGeometry,
  saveBufferGeometry,
  importAssetAsync,
  releaseImportedAsset,
  spawnImportedAsset,
  createActionMap,
  createMaterial,
  deleteMaterial,
  saveMaterial,
  createMeshEntity,
  getRenderer,
  getLoaderStatusUpdater,
  deleteTexture,
  getTexture,
  loadTextureAsync,
  lerror,
  lwarn,
  registerOnSceneExit,
} from 'aekasha';
import type { ImportedAssetManifest } from 'aekasha';
import { getErrorMessage, meshUv, sampleTexture } from '../../shared/verifyHarness';

/**
 * The texture codecs side by side: the KTX2 variants that
 * `devTools/assetPipeline/fixtures/assetCompareVariants.ts` builds, against their uncompressed
 * baselines, to pick an asset's codec by eye and by its numbers. Two slots (A and B) each build the
 * whole set at the same spots, one variant per slot, and the V key (or the scene's debug tab) shows
 * one or the other:
 * - a tiled ground (rocks01 in the LITE texture-set packing, p303: albedo × AO + roughness, normal
 *   XY + height) at grazing angles, REPEAT and the renderer's max anisotropy;
 * - a sphere with the MetalRust ORM and normal map (a normal map is where a codec shows most), on
 *   its committed base colour;
 * - the metal toolbox prop GLB (meshopt geometry, all three maps in the variant's codec).
 * The "png" variant is each one's uncompressed baseline (the toolbox's JPG source GLB). The files
 * are the fixture script's gitignored outputs: run it first (a missing prop GLB is reported in the
 * tab). The debug tab (`_dbg__assetCompare.ts`) also measures every variant on the device and
 * checks the collider copies the fixture builds.
 */

export const ASSET_COMPARE_SCENE_ID = 'assetCompare';

/** Where assetCompareVariants.ts writes its outputs (and report.json). */
export const VARIANTS_URL = '/debugger/assets/testOptimized/phase1';
const BASE_COLOR_URL = '/debugger/assets/testTextures/Poliigon_MetalRust_7642_BaseColor.jpg';
/** The base colour both slots share (the same JPG in every variant). */
const BASE_COLOR_ID = 'assetCompare/metalRustBaseColor';

export const COMPARE_VARIANTS = [
  'png',
  'etc1s_q128',
  'etc1s_q255',
  'uastc',
  'uastc_rdo1',
  'uastc_rdo2',
  'uastc_rdo4',
] as const;
export type CompareVariant = (typeof COMPARE_VARIANTS)[number];
export type CompareSlotId = 'A' | 'B';
export type CompareSubject = 'ground' | 'sphere' | 'prop';

/** Both slots' settings and which one is shown. The debug tab binds to (and persists) this. */
export const compareConfig = {
  variantA: 'png' as CompareVariant,
  /** The MetalRust normal map's `--normal-mode` copy (KTX2 variants only). */
  normalModeA: false,
  variantB: 'uastc_rdo2' as CompareVariant,
  normalModeB: false,
  shown: 'A' as CompareSlotId,
};

/** A texture a slot shows: what it is, its file (relative to VARIANTS_URL; `<glb>#<name>` for the
 * prop's embedded ones) and the loaded texture. */
export type CompareTexture = {
  subject: CompareSubject;
  name: string;
  file: string;
  texture: THREE.Texture;
  /** A prop texture's kind in report.json, which names it after its image, not its material. */
  reportKind?: 'color' | 'normal' | 'data';
};

export type CompareSlot = {
  id: CompareSlotId;
  /** What the slot holds now (null while it builds for the first time, or after an error). */
  built: { variant: CompareVariant; normalMode: boolean } | null;
  isBuilding: boolean;
  textures: CompareTexture[];
  /** The prop GLB's file and size, when it was loaded. */
  propFile: string | null;
  /** Problems to show in the debug tab (eg. a gitignored prop GLB that isn't built). */
  messages: string[];
  entityIds: number[];
  textureIds: string[];
  materialIds: string[];
  propImportId: string | null;
  queue: Promise<void>;
  /** Set when the scene is left: a build still running stops at its next await. */
  isLeft: boolean;
};

const GROUND_SIZE = 120;
/** rocks01 (ambientCG Ground079S) covers about 2 × 2 m. */
const GROUND_TILES = GROUND_SIZE / 2;
const SPHERE_RADIUS = 0.75;
const SPHERE_POS = { x: -1.1, y: SPHERE_RADIUS, z: 0 };
const PROP_POS = { x: 0.9, y: 0, z: 1.1 };

type TextureSpec = {
  subject: CompareSubject;
  group: 'rocks01' | 'metalRust';
  name: string;
  srgb?: boolean;
  hasNormalMode?: boolean;
};

const GROUND_ALBEDO_ROUGH: TextureSpec = {
  subject: 'ground',
  group: 'rocks01',
  name: 'albedoRough',
  srgb: true,
};
const GROUND_NORMAL_HEIGHT: TextureSpec = {
  subject: 'ground',
  group: 'rocks01',
  name: 'normalHeight',
};
const SPHERE_ORM: TextureSpec = { subject: 'sphere', group: 'metalRust', name: 'orm' };
const SPHERE_NORMAL: TextureSpec = {
  subject: 'sphere',
  group: 'metalRust',
  name: 'normal',
  hasNormalMode: true,
};

const getTextureFile = (spec: TextureSpec, variant: CompareVariant, normalMode: boolean) =>
  variant === 'png'
    ? `${spec.group}/${spec.name}.png`
    : `${spec.group}/${spec.name}_${spec.hasNormalMode && normalMode ? 'nm_' : ''}${variant}.ktx2`;

const getPropFile = (variant: CompareVariant) =>
  `metalToolbox/${variant === 'png' ? 'source' : variant}.glb`;

/** A slot whose builds queue after `after`: a new visit's wait for the last visit's builds, so a
 * build the exit stopped has cleared what it registered before this visit registers the ids. */
const createSlot = (id: CompareSlotId, after = Promise.resolve()): CompareSlot => ({
  id,
  built: null,
  isBuilding: false,
  textures: [],
  propFile: null,
  messages: [],
  entityIds: [],
  textureIds: [],
  materialIds: [],
  propImportId: null,
  queue: after,
  isLeft: false,
});

let slots: Record<CompareSlotId, CompareSlot> = { A: createSlot('A'), B: createSlot('B') };
let onChange: (() => void) | null = null;

export const getCompareSlots = () => slots;

/** Called after a slot was rebuilt or the shown slot changed (the debug tab's refresh). */
export const setCompareChangeListener = (fn: (() => void) | null) => {
  onChange = fn;
};

/** Whether the dev server serves the file: the gitignored prop GLBs may not be built, and a
 * missing file gets the SPA's index.html. */
const isServed = async (url: string) => {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok && !(res.headers.get('content-type') || '').includes('text/html');
  } catch {
    return false;
  }
};

const getMaxAnisotropy = () => getRenderer()?.getMaxAnisotropy() ?? 1;

const applyVisibility = () => {
  const world = getECSWorld();
  for (const slot of Object.values(slots)) {
    for (const entityId of slot.entityIds) {
      const obj = world.getComponent(entityId, ComponentType.OBJECT3D)?.value;
      if (obj) obj.visible = slot.id === compareConfig.shown;
    }
  }
};

/** Deletes what a slot built: its entities, materials, textures and prop import. */
const clearSlot = (slot: CompareSlot) => {
  const world = getECSWorld();
  for (const entityId of slot.entityIds) if (world.isAlive(entityId)) world.deleteEntity(entityId);
  // The meshes' refs are gone, so these only remain when a build failed half way
  deleteMaterial(slot.materialIds);
  // Standalone textures are sampled through TSL nodes, which a material's dispose doesn't track
  for (const id of slot.textureIds) if (getTexture(id)) deleteTexture(id);
  if (slot.propImportId) releaseImportedAsset(slot.propImportId);
  Object.assign(slot, {
    built: null,
    textures: [],
    propFile: null,
    messages: [],
    entityIds: [],
    textureIds: [],
    materialIds: [],
    propImportId: null,
  });
};

/** A STANDARD material with the maps the import's glTF material had (its first primitive's). */
const createPropMaterial = (manifest: ImportedAssetManifest, id: string) => {
  const slotTextures = manifest.geometries[0]?.textureSlots || {};
  const params: Record<string, THREE.Texture | undefined> = {};
  for (const [key, textureId] of Object.entries(slotTextures)) params[key] = getTexture(textureId);
  return createMaterial({ id, type: 'STANDARD', params });
};

/** Thrown after an await in a build when the scene was left meanwhile. */
class SceneLeftError extends Error {}

/** Stops a build whose scene was left during its last await: what it registers from now on would
 * belong to the next scene. */
const throwIfLeft = (slot: CompareSlot) => {
  if (slot.isLeft) throw new SceneLeftError();
};

/** The slot's settings as its build reads them */
type SlotBuild = {
  slot: CompareSlot;
  variant: CompareVariant;
  normalMode: boolean;
  /** The ids' prefix: `assetCompare/<slot id>` */
  prefix: string;
  anisotropy: number;
};

const tiledTexOpts = (anisotropy: number) => ({
  wrapS: THREE.RepeatWrapping,
  wrapT: THREE.RepeatWrapping,
  anisotropy,
});

/** One of the slot's standalone textures, in the slot's variant */
const loadSlotTextureAsync = async (build: SlotBuild, spec: TextureSpec) => {
  const { slot, variant, normalMode, prefix, anisotropy } = build;
  const file = getTextureFile(spec, variant, normalMode);
  const id = `${prefix}/${file}`;
  slot.textureIds.push(id);
  const loaded = await loadTextureAsync({
    id,
    fileName: `${VARIANTS_URL}/${file}`,
    // A KTX2 file carries its own colour space; the PNG baselines get theirs here
    texOpts: {
      ...tiledTexOpts(anisotropy),
      ...(variant === 'png' && spec.srgb ? { colorSpace: THREE.SRGBColorSpace } : {}),
    },
    throwOnError: true,
  });
  slot.textures.push({ subject: spec.subject, name: spec.name, file, texture: loaded });
  return loaded;
};

/** The ground: the LITE packing (albedo × AO in RGB, roughness in A; normal XY, height in B) */
const buildGround = (build: SlotBuild, albedoRough: THREE.Texture, normalHeight: THREE.Texture) => {
  const { slot, prefix } = build;
  const tiledUv = meshUv().mul(GROUND_TILES);
  const groundAr = sampleTexture(albedoRough, tiledUv);
  const groundNormal = normalMap(sampleTexture(normalHeight, tiledUv));
  groundNormal.unpackNormalMode = THREE.NormalRGPacking;
  const material = new THREE.MeshStandardNodeMaterial();
  material.colorNode = groundAr.rgb;
  material.roughnessNode = groundAr.a;
  material.metalnessNode = float(0);
  material.normalNode = groundNormal;
  saveMaterial(material, `${prefix}/groundMaterial`);
  slot.materialIds.push(`${prefix}/groundMaterial`);

  const geo =
    getGeometry('assetCompareGround') ??
    saveBufferGeometry(new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE).rotateX(-Math.PI / 2), {
      id: 'assetCompareGround',
    });
  slot.entityIds.push(
    createMeshEntity(
      { geo, mat: material, receiveShadow: true },
      { appId: `assetCompare${slot.id}Ground` }
    )
  );
};

/** The sphere: MetalRust, its UVs wrapping twice round the equator */
const buildSphere = (
  build: SlotBuild,
  maps: { orm: THREE.Texture; normal: THREE.Texture; baseColor: THREE.Texture }
) => {
  const { slot, variant, normalMode, prefix } = build;
  const sphereUv = meshUv().mul(vec2(2, 1));
  const sphereOrm = sampleTexture(maps.orm, sphereUv);
  const sphereNormal = normalMap(sampleTexture(maps.normal, sphereUv));
  // `--normal-mode` files have X in RGB and Y in A, and three only unpacks RG formats by itself
  if (normalMode && variant !== 'png') sphereNormal.unpackNormalMode = THREE.NormalGAPacking;
  const material = new THREE.MeshStandardNodeMaterial();
  material.colorNode = sampleTexture(maps.baseColor, sphereUv).rgb;
  material.aoNode = sphereOrm.r;
  material.roughnessNode = sphereOrm.g;
  material.metalnessNode = sphereOrm.b;
  material.normalNode = sphereNormal;
  saveMaterial(material, `${prefix}/sphereMaterial`);
  slot.materialIds.push(`${prefix}/sphereMaterial`);
  slot.entityIds.push(
    createMeshEntity(
      {
        geo: createGeometry({
          id: 'assetCompareSphere',
          type: 'SPHERE',
          params: { radius: SPHERE_RADIUS, widthSegments: 128, heightSegments: 64 },
        }),
        mat: material,
        position: SPHERE_POS,
        castShadow: true,
        receiveShadow: true,
      },
      { appId: `assetCompare${slot.id}Sphere` }
    )
  );
};

/** The prop's textures as the tab lists them: one row per texture (the ARM map fills more than
 * one material slot) */
const addPropTextures = (
  slot: CompareSlot,
  manifest: ImportedAssetManifest,
  importId: string,
  propFile: string
) => {
  const slotsByTexture = new Map<string, string[]>();
  for (const [key, textureId] of Object.entries(manifest.geometries[0]?.textureSlots || {})) {
    slotsByTexture.set(textureId, [...(slotsByTexture.get(textureId) || []), key]);
  }
  for (const [textureId, keys] of slotsByTexture) {
    const loaded = getTexture(textureId);
    if (!loaded) continue;
    slot.textures.push({
      subject: 'prop',
      name: keys.join(' + '),
      file: `${propFile}#${textureId.slice(importId.length + 1)}`,
      texture: loaded,
      reportKind: keys.includes('normalMap') ? 'normal' : keys.includes('map') ? 'color' : 'data',
    });
  }
};

/** The prop: the gitignored GLBs are built by assetCompareVariants.ts, so one may be missing */
const buildPropAsync = async (build: SlotBuild) => {
  const { slot, variant, prefix, anisotropy } = build;
  const propFile = getPropFile(variant);
  const isPropServed = await isServed(`${VARIANTS_URL}/${propFile}`);
  throwIfLeft(slot);
  if (!isPropServed) {
    const message = `${propFile} is not built: run \`npx tsx devTools/assetPipeline/fixtures/assetCompareVariants.ts --only metalToolbox\``;
    lwarn(`[assetCompare] ${message}`);
    slot.messages.push(message);
    return;
  }
  const importId = `${prefix}/prop/${variant}`;
  slot.propImportId = importId;
  const manifest = existsOrThrow(
    await importAssetAsync({
      id: importId,
      fileName: `${VARIANTS_URL}/${propFile}`,
      importTextures: { texOpts: { anisotropy } },
      throwOnError: true,
    }),
    `No manifest for ${propFile}.`
  );
  throwIfLeft(slot);
  const material = createPropMaterial(manifest, `${prefix}/propMaterial`);
  slot.materialIds.push(`${prefix}/propMaterial`);
  const { meshEntityIds } = await spawnImportedAsset(manifest, {
    transform: { position: PROP_POS, rotation: { x: 0, y: -0.5, z: 0 } },
    material,
    castShadow: true,
    receiveShadow: true,
    entityOpts: { appId: `assetCompare${slot.id}Prop` },
  });
  slot.entityIds.push(...meshEntityIds);
  throwIfLeft(slot);
  slot.propFile = propFile;
  addPropTextures(slot, manifest, importId, propFile);
};

/** Builds the slot from compareConfig: the textures, then the ground, the sphere and the prop */
const buildSlotAsync = async (slot: CompareSlot) => {
  clearSlot(slot);
  const build: SlotBuild = {
    slot,
    variant: compareConfig[`variant${slot.id}`],
    normalMode: compareConfig[`normalMode${slot.id}`],
    prefix: `assetCompare/${slot.id}`,
    anisotropy: getMaxAnisotropy(),
  };

  const [albedoRough, normalHeight, orm, normal, baseColor] = await Promise.all([
    loadSlotTextureAsync(build, GROUND_ALBEDO_ROUGH),
    loadSlotTextureAsync(build, GROUND_NORMAL_HEIGHT),
    loadSlotTextureAsync(build, SPHERE_ORM),
    loadSlotTextureAsync(build, SPHERE_NORMAL),
    // Shared by both slots (the same JPG in every variant), released with the scene
    loadTextureAsync({
      id: BASE_COLOR_ID,
      fileName: BASE_COLOR_URL,
      texOpts: { ...tiledTexOpts(build.anisotropy), colorSpace: THREE.SRGBColorSpace },
      throwOnError: true,
    }),
  ]);
  throwIfLeft(slot);

  buildGround(build, albedoRough, normalHeight);
  buildSphere(build, { orm, normal, baseColor });
  await buildPropAsync(build);
  slot.built = { variant: build.variant, normalMode: build.normalMode };
};

/** Rebuilds a slot from compareConfig (queued after a build that is still running). A build the
 * scene's exit stops clears what it built, the assets it registered in the next scene included. */
export const rebuildCompareSlot = (slotId: CompareSlotId) => {
  const slot = slots[slotId];
  slot.queue = slot.queue.then(async () => {
    if (slot.isLeft) return;
    slot.isBuilding = true;
    onChange?.();
    try {
      await buildSlotAsync(slot);
    } catch (error) {
      if (!(error instanceof SceneLeftError)) {
        lerror(`[assetCompare] Slot ${slot.id} failed to build`, error);
        slot.messages.push(`Build failed: ${getErrorMessage(error)}`);
      }
    }
    if (slot.isLeft) {
      clearSlot(slot);
      if (getTexture(BASE_COLOR_ID)) deleteTexture(BASE_COLOR_ID);
      return;
    }
    slot.isBuilding = false;
    applyVisibility();
    onChange?.();
  });
  return slot.queue;
};

export const showCompareSlot = (slotId: CompareSlotId) => {
  compareConfig.shown = slotId;
  applyVisibility();
  onChange?.();
};

export const toggleCompareSlot = () => showCompareSlot(compareConfig.shown === 'A' ? 'B' : 'A');

export const scene = async () => {
  const updateLoaderFn = getLoaderStatusUpdater();
  updateLoaderFn({ loadedCount: 0, totalCount: 2 });
  const prevBuilds = Promise.all([slots.A.queue, slots.B.queue]).then(() => undefined);
  slots = { A: createSlot('A', prevBuilds), B: createSlot('B', prevBuilds) };
  // A build or a measure still running stops at its next await, and the debug tab is gone
  registerOnSceneExit(ASSET_COMPARE_SCENE_ID, () => {
    slots.A.isLeft = true;
    slots.B.isLeft = true;
    onChange = null;
  });

  // Low over the ground, looking along it (grazing angles), the sphere and the prop in front.
  // One camera only: another camera's debug symbol would stand in this view (close-ups: F1)
  createCameraEntity(
    {
      type: 'PERSPECTIVE',
      fov: 50,
      far: 300,
      position: { x: 0, y: 1.1, z: 3.6 },
      lookAtPoint: { x: 0, y: 0.35, z: -6 },
      active: true,
    },
    { appId: 'assetCompareGrazing', debugData: { name: 'Asset compare: grazing' } }
  );
  // The debug tab first: it restores the saved slot settings the builds read
  if (IS_DEBUG_ENV) {
    const { createAssetCompareTab } = await import('./_dbg__assetCompare');
    createAssetCompareTab();
  }

  // A scene map (replaced on the next visit, by its id); exact modifiers, so Ctrl+V isn't a switch
  createActionMap({
    id: ASSET_COMPARE_SCENE_ID,
    sceneId: ASSET_COMPARE_SCENE_ID,
    ignoreModifiers: false,
    actions: {
      toggleSlot: {
        type: 'BUTTON',
        name: 'Show slot A / B',
        description: 'Switches between the two codec variants (the Asset compare tab picks them).',
      },
    },
    bindings: { toggleSlot: [{ device: 'KEYBOARD', keys: ['v'] }] },
  }).onPressed('toggleSlot', () => toggleCompareSlot());

  await rebuildCompareSlot('A');
  updateLoaderFn({ loadedCount: 1, totalCount: 2 });
  await rebuildCompareSlot('B');
  updateLoaderFn({ loadedCount: 2, totalCount: 2 });
};
