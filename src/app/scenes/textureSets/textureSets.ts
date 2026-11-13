import * as THREE from 'three/webgpu';
import {
  createCameraEntity,
  createLightEntity,
  createMaterial,
  createMeshEntity,
  ensureMaterialDependencies,
  existsOrThrow,
  getAllTextures,
  getGeometry,
  getMaterial,
  getTexture,
  lerror,
  registerOnSceneExit,
  saveBufferGeometry,
  takeSnapshotAsync,
  type MatProps,
  type Snapshot,
} from 'aekasha';
import {
  getTextureSet,
  getTextureSetArray,
  getTextureSetPackingTextures,
  loadTextureSetAsync,
  type TextureSetPacking,
} from 'aekasha/texturesets';
import {
  expectError,
  getBackendName,
  getErrorMessage,
  getHarnessHandles,
  nextFrames,
} from '../../shared/verifyHarness';
import { LAYER_ATTRIBUTE } from './liteSurface';

/**
 * The p303 verification scene for texture sets, two parts:
 *
 * - **The top row** (Phase 1's exit): the hand-made texture set `p303TestSet` (PNGs, no encode;
 *   `devTools/assetPipeline/fixtures/textureSetsFiles.ts`: 4 × 4 bevelled stones in mortar, the
 *   top left one orange) drawn through the `{ "textureSet" }` material input in each packing, left
 *   to right `LITE` (the set's default), `FULL` and `MINIMAL` (`p303SetLiteMat`, `p303SetFullMat`,
 *   `p303SetMinimalMat`, one TSL file: `p303TextureSetMat.tsl.ts`). Each lit quad is 2 m square,
 *   its UVs in metres, so a 1 m tile shows 2 × 2 times. The three should look alike: MINIMAL's
 *   bump is softer, its roughness constant.
 * - **The set arrays** (Phase 3's exit, D4): four `LITE` sets (cobbles, bricks, ridges, dots; the
 *   last three in `arraySets/`, each with its own `physicalSize`, `tint`, `normalStrength` and
 *   `roughnessScale`) in 1 m quads, a column per layer. Rows, top down: the PNG sets through
 *   `{ textureSet }` (a material each, `p303SetLiteMat`'s graph), the same four through ONE
 *   `{ textureSetArray }` material (`p303ArrayPngMat`, by list: the uncompressed path), then the
 *   KTX2 copies of the sets (`*Ktx`) the same way (`p303ArrayKtxMat`, by the id of the scene's
 *   listed `p303KtxArray`: the compressed path, its members loaded for the array alone). The
 *   layer comes from each quad's `setLayer` attribute, and both materials shade with the same
 *   graph (`liteSurface.ts`), so each array quad must match the quad above it.
 *
 * The sun grazes from the upper left, so a stone's top and left bevels are lit (the normals' +Y,
 * OpenGL). After the build, an orthographic snapshot of the array rows (256 px a metre, no MSAA,
 * no PostFX: every quad lands on whole pixels, so a layer and its set raster alike) compares each
 * array quad with its set's, pixel by pixel.
 *
 * `window.__textureSets` holds the checks' results (`results.done` once they ran) and handles to
 * drive the scene from the console; `await __textureSets.checkReleaseAsync()` leaves the scene and
 * lists the sets' textures and set arrays still registered (none: the scene's exit released
 * them). They're read by hand: nothing asserts them yet (the scene runner checks the snapshot and
 * the console).
 */

const SET_ID = 'p303TestSet';
const PACKINGS: { packing: TextureSetPacking; materialId: string }[] = [
  { packing: 'LITE', materialId: 'p303SetLiteMat' },
  { packing: 'FULL', materialId: 'p303SetFullMat' },
  { packing: 'MINIMAL', materialId: 'p303SetMinimalMat' },
];
/** The top row's quad side in metres (its UVs run 0 to this) */
const QUAD_SIZE = 2;
const GAP = 0.4;
/** The top row's centre height */
const TOP_ROW_Y = 2.6;
/** In front of the debug helpers at the world origin */
const Z = 2;

/** The array layers' sets, PNG and KTX2 (layer `i` = column `i`) */
const ARRAY_SETS = ['p303TestSet', 'p303BrickSet', 'p303RidgeSet', 'p303DotSet'];
const KTX_ARRAY_SETS = ARRAY_SETS.map((id) => `${id}Ktx`);
/** The arrays' rows: each set row's centre height, then its array row's (1 m quads) */
const ARRAY_GROUPS = [
  { name: 'png', sets: ARRAY_SETS, setRowY: 0.625, arrayRowY: -0.625, arrayMat: 'p303ArrayPngMat' },
  {
    name: 'ktx2',
    sets: KTX_ARRAY_SETS,
    setRowY: -2.125,
    arrayRowY: -3.375,
    arrayMat: 'p303ArrayKtxMat',
  },
];
/** A column's centre x: 1 m quads 1.25 m apart */
const columnX = (layer: number) => (layer - 1.5) * 1.25;

/** The comparison's snapshot: its extent in metres and its scale (whole pixels per quarter metre) */
const SNAP = { left: -2.5, right: 2.5, top: 1.25, bottom: -4, pxPerMetre: 256 };
/** Pixels left out at a quad's edges */
const SNAP_INSET = 2;

/** The texture ids of a set's packings, as the data lists them */
const getSetTextureIds = (setId: string) => {
  const set = existsOrThrow(getTextureSet(setId), `No texture set "${setId}".`);
  return Object.values(set.packings).flatMap((slots) => Object.values(slots ?? {}));
};

/** The registered set arrays' ids (their slot arrays are registered as `<id>.<slot>`) */
const getSetArrayIds = () => [
  ...new Set(
    Object.keys(getAllTextures())
      .filter((id) => id.startsWith('tsa:') || id.startsWith('p303KtxArray.'))
      .map((id) => id.slice(0, id.lastIndexOf('.')))
  ),
];

/** What `window.__textureSets` holds: the checks' results and the console's handles */
const state = {
  ...getHarnessHandles(),
  results: {} as Record<string, unknown>,
  /** The array rows' comparison snapshot (save it with `snapshotToBlobAsync`) */
  snapshot: null as Snapshot | null,
  /**
   * Loads another scene and lists the sets' textures and set arrays still registered after it
   * (none: the scene's exit released them), also in `results.release`.
   * @param sceneId the scene to load
   * @returns the ids still registered
   */
  checkReleaseAsync: async (sceneId = 'testDebugScene') => {
    const ids = [SET_ID, ...ARRAY_SETS.slice(1), ...KTX_ARRAY_SETS].flatMap(getSetTextureIds);
    const arrayIds = getSetArrayIds();
    await state.leaveTo(sceneId);
    const stillRegistered = [
      ...ids.filter((id) => getTexture(id)),
      ...arrayIds.filter((id) => getTextureSetArray(id)),
    ];
    state.results.release = { leftTo: sceneId, arrays: arrayIds, stillRegistered };
    return stillRegistered;
  },
};

/** A quad of `size` metres with its UVs in metres (a 1 m tile covers 1 × 1 of them) */
const getQuadGeometry = (id: string, size: number, layer?: number) => {
  const existing = getGeometry(id);
  if (existing) return existing;
  const geometry = new THREE.PlaneGeometry(size, size);
  const uvs = geometry.getAttribute('uv');
  for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i) * size, uvs.getY(i) * size);
  if (layer !== undefined) {
    const layers = new Float32Array(uvs.count).fill(layer);
    geometry.setAttribute(LAYER_ATTRIBUTE, new THREE.BufferAttribute(layers, 1));
  }
  return saveBufferGeometry(geometry, { id });
};

const addPackingQuads = () => {
  const geo = getQuadGeometry('textureSetsQuad', QUAD_SIZE);
  const x0 = -(QUAD_SIZE + GAP);
  PACKINGS.forEach(({ packing, materialId }, i) => {
    const mat = existsOrThrow(getMaterial(materialId), `No material "${materialId}".`);
    createMeshEntity(
      { geo, mat, position: { x: x0 + i * (QUAD_SIZE + GAP), y: TOP_ROW_Y, z: Z } },
      { appId: `textureSets_${packing}`, debugData: { name: `Texture set, ${packing}` } }
    );
  });
};

/** A set's `LITE` through `{ textureSet }`, with `p303SetLiteMat`'s graph (its TSL file) */
const getSetMaterialProps = (setId: string): MatProps => ({
  id: `textureSets/set_${setId}`,
  type: 'STANDARDNODEMATERIAL',
  tslFile: 'scenes/textureSets/p303TextureSetMat.tsl.ts',
  tslMaterialId: 'p303SetLiteMat',
  inputs: { surface: { textureSet: setId, packing: 'LITE' } },
});

/**
 * The array rows: per group, a quad per set through its own material, and below it a quad per
 * layer through the group's one array material. The KTX2 sets' textures aren't the scene's (only
 * the array's members are, loaded for it alone), so their materials load them first.
 * @param isCurrent whether the load that started this is still the scene's
 * @returns false when the scene was left during the loads
 */
const addArrayQuadsAsync = async (isCurrent: () => boolean) => {
  const setProps = ARRAY_GROUPS.flatMap((group) => group.sets.map(getSetMaterialProps));
  await Promise.all(setProps.map((props) => ensureMaterialDependencies(props)));
  if (!isCurrent()) return false;
  for (const group of ARRAY_GROUPS) {
    const arrayMat = existsOrThrow(getMaterial(group.arrayMat), `No material "${group.arrayMat}".`);
    group.sets.forEach((setId, layer) => {
      const geo = getQuadGeometry(`textureSetsLayerQuad${layer}`, 1, layer);
      const setMat = createMaterial(getSetMaterialProps(setId));
      const x = columnX(layer);
      createMeshEntity(
        { geo, mat: setMat, position: { x, y: group.setRowY, z: Z } },
        { appId: `textureSets_set_${setId}`, debugData: { name: `Texture set ${setId}` } }
      );
      createMeshEntity(
        { geo, mat: arrayMat, position: { x, y: group.arrayRowY, z: Z } },
        {
          appId: `textureSets_${group.name}_layer${layer}`,
          debugData: { name: `Set array (${group.name}), layer ${layer}` },
        }
      );
    });
  }
  return true;
};

/** The distinct textures a material's graph samples (its texture bindings) */
const countSampledTextures = (material: THREE.Material) => {
  const textures = new Set<THREE.Texture>();
  const nodes = material as unknown as Record<string, THREE.Node | null | undefined>;
  for (const key of ['colorNode', 'normalNode', 'roughnessNode', 'metalnessNode', 'aoNode']) {
    nodes[key]?.traverse((node) => {
      const textureNode = node as THREE.TextureNode;
      if (textureNode.isTextureNode && textureNode.value) textures.add(textureNode.value);
    });
  }
  return textures.size;
};

/** A set array's shape: its slots' array kinds, sizes and mip counts */
const describeSetArray = (id: string) => {
  const setArray = existsOrThrow(getTextureSetArray(id), `No set array "${id}".`);
  const slots = Object.fromEntries(
    Object.entries(setArray.arrays).map(([slot, array]) => {
      const tex = array as THREE.Texture;
      const image = tex.image as { width: number; height: number; depth: number };
      const kind = (tex as THREE.CompressedArrayTexture).isCompressedArrayTexture
        ? 'CompressedArrayTexture'
        : 'DataArrayTexture';
      const mips = (tex.mipmaps as unknown[] | undefined)?.length ?? 0;
      return [slot, { kind, size: `${image.width}×${image.height}×${image.depth}`, mips }];
    })
  );
  return { id, sets: setArray.sets, layerCount: setArray.layerCount, slots };
};

/** The snapshot's pixel rectangle of the 1 m quad centred at `(x, y)`, inset at its edges */
const getQuadRect = (x: number, y: number) => ({
  left: Math.round((x - 0.5 - SNAP.left) * SNAP.pxPerMetre) + SNAP_INSET,
  top: Math.round((SNAP.top - (y + 0.5)) * SNAP.pxPerMetre) + SNAP_INSET,
  size: SNAP.pxPerMetre - 2 * SNAP_INSET,
});

/** Two quads' pixels compared: the largest channel difference (0-255), the mean, the pixels off */
const compareQuads = (snap: Snapshot, a: { x: number; y: number }, b: { x: number; y: number }) => {
  const ra = getQuadRect(a.x, a.y);
  const rb = getQuadRect(b.x, b.y);
  let maxDiff = 0;
  let sum = 0;
  let differing = 0;
  for (let row = 0; row < ra.size; row++) {
    for (let col = 0; col < ra.size; col++) {
      const ia = ((ra.top + row) * snap.width + ra.left + col) * 4;
      const ib = ((rb.top + row) * snap.width + rb.left + col) * 4;
      let pixelMax = 0;
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(snap.data[ia + c] - snap.data[ib + c]);
        sum += d;
        if (d > pixelMax) pixelMax = d;
      }
      if (pixelMax > 0) differing++;
      if (pixelMax > maxDiff) maxDiff = pixelMax;
    }
  }
  const pixels = ra.size * ra.size;
  return { maxDiff, meanDiff: +(sum / (pixels * 3)).toFixed(4), differing, pixels };
};

/** The array rows through an orthographic camera at whole pixels, compared layer by layer */
const compareArraysAsync = async () => {
  const width = (SNAP.right - SNAP.left) * SNAP.pxPerMetre;
  const height = (SNAP.top - SNAP.bottom) * SNAP.pxPerMetre;
  const halfHeight = (SNAP.top - SNAP.bottom) / 2;
  const camera = new THREE.OrthographicCamera(
    SNAP.left,
    SNAP.right,
    halfHeight,
    -halfHeight,
    0.1,
    20
  );
  camera.position.set(0, (SNAP.top + SNAP.bottom) / 2, Z + 5);
  camera.updateMatrixWorld();
  const snap = await takeSnapshotAsync({ width, height, camera, postFx: false, samples: 0 });
  state.snapshot = snap;
  const compare = Object.fromEntries(
    ARRAY_GROUPS.map((group) => [
      group.name,
      group.sets.map((setId, layer) => ({
        set: setId,
        ...compareQuads(
          snap,
          { x: columnX(layer), y: group.setRowY },
          { x: columnX(layer), y: group.arrayRowY }
        ),
      })),
    ])
  );
  // The comparison's control: a layer against another set (it must differ)
  const control = compareQuads(
    snap,
    { x: columnX(0), y: ARRAY_GROUPS[0].setRowY },
    { x: columnX(1), y: ARRAY_GROUPS[0].arrayRowY }
  );
  return { size: `${width}×${height}`, ...compare, control };
};

/** The runtime's lookups against what the scene load registered */
const runSetChecksAsync = async () => {
  const { results } = state;
  const set = existsOrThrow(getTextureSet(SET_ID), `No texture set "${SET_ID}".`);
  // The gatherer's defaults: the JSON's `defaultPacking`, every `surface` field
  results.set = { defaultPacking: set.defaultPacking, surface: set.surface };
  // Each packing's textures, registered by the scene load: slot → id
  results.packings = Object.fromEntries(
    PACKINGS.map(({ packing }) => {
      const textures = getTextureSetPackingTextures(SET_ID, { packing });
      const slots = textures
        ? Object.fromEntries(Object.entries(textures).map(([slot, t]) => [slot, t.userData.id]))
        : null;
      return [packing, slots];
    })
  );
  // A load of a registered packing: the same textures (re-tagged, not loaded again)
  const loaded = await loadTextureSetAsync(SET_ID, { packing: 'FULL' });
  const registered = getTextureSetPackingTextures(SET_ID, { packing: 'FULL' });
  results.loadIsCacheHit = Boolean(
    registered && Object.entries(loaded).every(([slot, t]) => registered[slot as 'orm'] === t)
  );
  results.unknownSetError = await expectError(() => loadTextureSetAsync('noSuchSet'));
  // The resolver's uniforms on the LITE material (`setup_surface_<field>`)
  const lite = existsOrThrow(getMaterial('p303SetLiteMat'), 'No p303SetLiteMat.');
  results.liteUniforms = Object.keys(
    (lite.userData.uniforms as Record<string, unknown> | undefined) ?? {}
  ).sort();
};

/** The set arrays the scene load built, the textures each material samples, the comparison */
const runArrayChecksAsync = async (isCurrent: () => boolean) => {
  const { results } = state;
  results.arrays = getSetArrayIds().map(describeSetArray);
  const count = (id: string) =>
    countSampledTextures(existsOrThrow(getMaterial(id), `No material "${id}".`));
  results.sampledTextures = Object.fromEntries(
    ARRAY_GROUPS.map((group) => [
      group.name,
      {
        array: count(group.arrayMat),
        sets: group.sets.reduce((sum, id) => sum + count(`textureSets/set_${id}`), 0),
      },
    ])
  );
  // Let the main view draw everything once (uploads, compiles) before the snapshot
  await nextFrames(5);
  if (!isCurrent()) return;
  results.compare = await compareArraysAsync();
};

export const scene = async () => {
  (window as unknown as { __textureSets: typeof state }).__textureSets = state;
  state.results = { backend: getBackendName() };
  state.snapshot = null;
  // Cleared when the scene is left: the checks' awaits stop there
  let isLoaded = true;
  registerOnSceneExit('textureSets', () => {
    isLoaded = false;
  });
  const isCurrent = () => isLoaded;

  createCameraEntity(
    {
      type: 'PERSPECTIVE',
      fov: 45,
      position: { x: 0, y: -0.2, z: Z + 12 },
      lookAtPoint: { x: 0, y: -0.2, z: Z },
      active: true,
    },
    { appId: 'textureSetsCam', debugData: { name: 'Texture sets' } }
  );
  createLightEntity(
    { type: 'AMBIENT', color: '#ffffff', intensity: 0.35 },
    { appId: 'textureSetsAmbient' }
  );
  // Grazing from the upper left: the bevels facing it are lit
  createLightEntity(
    {
      type: 'DIRECTIONAL',
      color: '#ffffff',
      intensity: 3,
      position: { x: -4, y: 4, z: Z + 2 },
      targetPos: { x: 0, y: 0, z: Z },
    },
    { appId: 'textureSetsSun' }
  );

  try {
    addPackingQuads();
    await runSetChecksAsync();
    if (!(await addArrayQuadsAsync(isCurrent))) return;
    await runArrayChecksAsync(isCurrent);
    state.results.done = true;
  } catch (error) {
    lerror('[textureSets] Build failed', error);
    state.results.buildError = getErrorMessage(error);
  }
};
