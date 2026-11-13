import * as THREE from 'three/webgpu';
import {
  createCameraEntity,
  createLightEntity,
  createMeshEntity,
  existsOrThrow,
  getGeometry,
  getMaterial,
  getTexture,
  lerror,
  saveBufferGeometry,
} from 'aekasha';
import {
  getTextureSet,
  getTextureSetPackingTextures,
  loadTextureSetAsync,
  type TextureSetPacking,
} from 'aekasha/texturesets';
import {
  expectError,
  getBackendName,
  getErrorMessage,
  getHarnessHandles,
} from '../../shared/verifyHarness';

/**
 * The p303 Phase 1 verification scene: the hand-made texture set `p303TestSet` (PNGs, no encode;
 * `devTools/assetPipeline/fixtures/textureSetsFiles.ts`: 4 × 4 bevelled stones in mortar, the top
 * left one orange) drawn through the `{ "textureSet" }` material input in each packing, left to
 * right `LITE` (the set's default), `FULL` and `MINIMAL` (`p303SetLiteMat`, `p303SetFullMat`,
 * `p303SetMinimalMat`, one TSL file: `p303TextureSetMat.tsl.ts`). Each lit quad is 2 m square,
 * its UVs in metres, so a 1 m tile shows 2 × 2 times; the sun grazes from the upper left, so a
 * stone's top and left bevels are lit (the normals' +Y, OpenGL). The three should look alike:
 * MINIMAL's bump is softer, its roughness constant. The scene lists the set (`textureSets`, its
 * default packing) and its materials name it (all three packings, the gather's closure).
 *
 * `window.__textureSets` holds the checks' results (`results.done` once they ran) and handles to
 * drive the scene from the console; `await __textureSets.checkReleaseAsync()` leaves the scene and
 * lists the set's textures still registered (none: the scene's exit released them). They're read
 * by hand: nothing asserts them yet (the scene runner checks the snapshot and the console).
 */

const SET_ID = 'p303TestSet';
const PACKINGS: { packing: TextureSetPacking; materialId: string }[] = [
  { packing: 'LITE', materialId: 'p303SetLiteMat' },
  { packing: 'FULL', materialId: 'p303SetFullMat' },
  { packing: 'MINIMAL', materialId: 'p303SetMinimalMat' },
];
/** A quad's side in metres (its UVs run 0 to this) */
const QUAD_SIZE = 2;
const GAP = 0.4;
/** In front of the debug helpers at the world origin */
const Z = 2;

/** Every texture id of the set's packings, as the data lists them */
const getSetTextureIds = () => {
  const set = existsOrThrow(getTextureSet(SET_ID), `No texture set "${SET_ID}".`);
  return Object.values(set.packings).flatMap((slots) => Object.values(slots ?? {}));
};

/** What `window.__textureSets` holds: the checks' results and the console's handles */
const state = {
  ...getHarnessHandles(),
  results: {} as Record<string, unknown>,
  /**
   * Loads another scene and lists the set's textures still registered after it (none: the
   * scene's exit released them), also in `results.release`.
   * @param sceneId the scene to load
   * @returns the ids still registered
   */
  checkReleaseAsync: async (sceneId = 'testDebugScene') => {
    const ids = getSetTextureIds();
    await state.leaveTo(sceneId);
    const stillRegistered = ids.filter((id) => getTexture(id));
    state.results.release = { leftTo: sceneId, stillRegistered };
    return stillRegistered;
  },
};

/** A quad of `QUAD_SIZE` metres with its UVs in metres (a 1 m tile covers 1 × 1 of them) */
const getQuadGeometry = () => {
  const existing = getGeometry('textureSetsQuad');
  if (existing) return existing;
  const geometry = new THREE.PlaneGeometry(QUAD_SIZE, QUAD_SIZE);
  const uvs = geometry.getAttribute('uv');
  for (let i = 0; i < uvs.count; i++) {
    uvs.setXY(i, uvs.getX(i) * QUAD_SIZE, uvs.getY(i) * QUAD_SIZE);
  }
  return saveBufferGeometry(geometry, { id: 'textureSetsQuad' });
};

const addQuads = () => {
  const geo = getQuadGeometry();
  const x0 = -(QUAD_SIZE + GAP);
  PACKINGS.forEach(({ packing, materialId }, i) => {
    const mat = existsOrThrow(getMaterial(materialId), `No material "${materialId}".`);
    createMeshEntity(
      { geo, mat, position: { x: x0 + i * (QUAD_SIZE + GAP), y: 0, z: Z } },
      { appId: `textureSets_${packing}`, debugData: { name: `Texture set, ${packing}` } }
    );
  });
};

/** The runtime's lookups against what the scene load registered */
const runChecksAsync = async () => {
  const { results } = state;
  results.backend = getBackendName();
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
  results.done = true;
};

export const scene = async () => {
  (window as unknown as { __textureSets: typeof state }).__textureSets = state;
  state.results = {};

  createCameraEntity(
    {
      type: 'PERSPECTIVE',
      fov: 45,
      position: { x: 0, y: 0, z: Z + 7.5 },
      lookAtPoint: { x: 0, y: 0, z: Z },
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
    addQuads();
    await runChecksAsync();
  } catch (error) {
    lerror('[textureSets] Build failed', error);
    state.results.buildError = getErrorMessage(error);
  }
};
