import * as THREE from 'three/webgpu';
import {
  ComponentType,
  createCameraEntity,
  createLightEntity,
  createMaterial,
  createMeshEntity,
  getActiveCamera,
  getECSWorld,
  getGeometry,
  getRenderer,
  isWebGPURenderer,
  lerror,
  mergeGeometryParts,
  registerOnSceneExit,
  saveBufferGeometry,
  saveMaterial,
  saveTexture,
} from 'aekasha';
import {
  getBackendName,
  getErrorMessage,
  getHarnessHandles,
  nextFrames,
} from '../../shared/verifyHarness';
import {
  createMatIndexAttribute,
  createMergeMaterialPrototype,
  getPaletteEntry,
  MAT_INDEX_ATTRIBUTE,
  type MatIndexType,
  type TableKind,
} from './mergeMaterialPrototype';

/**
 * p374's verification scene (docs/plans/p374_multi-material-merging.md). Phase 0: two STANDARD
 * materials (A: albedo, normal and ORM maps; B: albedo and normal maps with a UV transform, no ORM
 * map, emissive, a negative normal scale y) on eight meshes (spheres, boxes, tori, cylinders, one
 * mirrored), drawn
 * - `REFERENCE`: as eight mesh entities, one per material;
 * - `BAKED`: the control, one geometry merged with a group per material and drawn by the two
 *   materials (two draws): it differs from `REFERENCE` only by the bake, so the merge material is
 *   compared with it;
 * - `UNIFORM`, `TEXTURE`, `STORAGE`: as one merged geometry with a per-vertex `aekMatIndex`, drawn by
 *   one merge material (`mergeMaterialPrototype.ts`) whose parameter table is a uniform array, a
 *   float texture or a storage buffer (WebGPU only: three r187's WebGL2 backend fails that draw).
 * The textures are made here, so a material's map and its array layer hold the same texels (layer
 * 1 of the ORM array is the neutral white a material without an ORM map gets).
 *
 * The camera is orthographic (one view direction everywhere), so a variant shown alone at the
 * origin (`window.__mergeMaterials.show(variant)`) renders the same pixels as the reference
 * wherever the merge material is right. `?aekMatIndex=uint8|uint16|uint32|float32` picks the index
 * attribute's type (default uint8);
 * `?aekMips=false` drops the mip chains and `?aekStrip=normal,ao,orm,emissive` features from both
 * sides (Phase 0's bisection of the WebGPU residual: see the plan's Phase 0 "As built"). `measureDraws()` counts each variant's draws; `results` holds
 * them, the backend and the index type (`done` once measured).
 */

const SCENE_ID = 'mergeMaterials';
const SIZE = 256;
const VARIANTS = ['REFERENCE', 'BAKED', 'UNIFORM', 'TEXTURE', 'STORAGE'] as const;
type Variant = (typeof VARIANTS)[number];
const TABLE_KINDS: TableKind[] = ['UNIFORM', 'TEXTURE', 'STORAGE'];
/** Each variant's block when all are shown */
const GRID_OFFSETS: Record<Variant, THREE.Vector3> = {
  REFERENCE: new THREE.Vector3(-5.2, 1.4, 0),
  BAKED: new THREE.Vector3(-5.2, -1.4, 0),
  UNIFORM: new THREE.Vector3(0, 1.4, 0),
  TEXTURE: new THREE.Vector3(0, -1.4, 0),
  STORAGE: new THREE.Vector3(5.2, 1.4, 0),
};

// ---- Textures: RGBA8 texels, the same bytes in a material's map and its array layer ----

const fillTexels = (fn: (u: number, v: number) => [number, number, number, number]) => {
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const texel = fn((x + 0.5) / SIZE, (y + 0.5) / SIZE);
      data.set(
        texel.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255)),
        (y * SIZE + x) * 4
      );
    }
  }
  return data;
};

/** A tangent-space normal from a height function's slopes, encoded to 0..1 */
const normalTexels = (height: (u: number, v: number) => number, strength: number) =>
  fillTexels((u, v) => {
    const e = 1 / SIZE;
    const dx = (height(u + e, v) - height(u - e, v)) / (2 * e);
    const dy = (height(u, v + e) - height(u, v - e)) / (2 * e);
    const n = new THREE.Vector3(-dx * strength, -dy * strength, 1).normalize();
    return [n.x * 0.5 + 0.5, n.y * 0.5 + 0.5, n.z * 0.5 + 0.5, 1];
  });

const isChecker = (u: number, v: number, cells: number) =>
  (Math.floor(u * cells) + Math.floor(v * cells)) % 2 === 0;

const TEXELS = {
  albedoA: fillTexels((u, v) =>
    isChecker(u, v, 8) ? [0.78, 0.35, 0.24, 1] : [0.9, 0.86, 0.75, 1]
  ),
  albedoB: fillTexels((u, v) =>
    (u + v) * 6 - Math.floor((u + v) * 6) < 0.5 ? [0.16, 0.55, 0.59, 1] : [0.08, 0.16, 0.24, 1]
  ),
  normalA: normalTexels((u, v) => Math.sin(u * Math.PI * 8) * Math.sin(v * Math.PI * 8) * 0.02, 1),
  normalB: normalTexels((_u, v) => Math.sin(v * Math.PI * 16) * 0.01, 1),
  // AO darker towards each checker cell's edges, roughness by u, metal on alternate cells
  ormA: fillTexels((u, v) => {
    const cu = Math.abs(((u * 8) % 1) - 0.5) * 2;
    const cv = Math.abs(((v * 8) % 1) - 0.5) * 2;
    return [1 - 0.6 * Math.max(cu, cv) ** 4, 0.15 + 0.8 * u, isChecker(u, v, 8) ? 1 : 0, 1];
  }),
  /** What a palette entry without the map gets: white (AO 1, roughness and metalness × 1) */
  neutralOrm: fillTexels(() => [1, 1, 1, 1]),
};

/** `?aekMips=false`: no mip chains (separates the arrays' GPU mip generation from the material) */
const hasMips = () => new URLSearchParams(window.location.search).get('aekMips') !== 'false';

const configureTexture = <T extends THREE.Texture>(tex: T, colorSpace: string) => {
  tex.colorSpace = colorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = hasMips() ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.generateMipmaps = hasMips();
  tex.needsUpdate = true;
  return tex;
};

const createMap = (id: string, data: Uint8Array, colorSpace: string) =>
  saveTexture(configureTexture(new THREE.DataTexture(data, SIZE, SIZE), colorSpace), id);

const createArray = (id: string, layers: Uint8Array[], colorSpace: string) => {
  const data = new Uint8Array(SIZE * SIZE * 4 * layers.length);
  layers.forEach((layer, i) => data.set(layer, i * layer.length));
  return saveTexture(
    configureTexture(new THREE.DataArrayTexture(data, SIZE, SIZE, layers.length), colorSpace),
    id
  );
};

/** Material B's maps' UV transform (every map of a palette entry shares one) */
const setUvTransformB = (tex: THREE.Texture) => {
  tex.offset.set(0.1, 0.25);
  tex.repeat.set(2, 1.5);
  tex.rotation = 0.4;
  tex.center.set(0.5, 0.5);
};

const getStripped = () =>
  new Set((new URLSearchParams(window.location.search).get('aekStrip') ?? '').split(','));

const createMaterials = () => {
  const srgb = THREE.SRGBColorSpace;
  const linear = THREE.LinearSRGBColorSpace;
  createMap('mergeMaterials/albedoA', TEXELS.albedoA, srgb);
  createMap('mergeMaterials/normalA', TEXELS.normalA, linear);
  createMap('mergeMaterials/ormA', TEXELS.ormA, linear);
  setUvTransformB(createMap('mergeMaterials/albedoB', TEXELS.albedoB, srgb));
  setUvTransformB(createMap('mergeMaterials/normalB', TEXELS.normalB, linear));

  const matA = createMaterial({
    id: 'mergeMaterials/matA',
    type: 'STANDARD',
    params: {
      color: new THREE.Color('#ffe8d0'),
      map: 'mergeMaterials/albedoA',
      normalMap: 'mergeMaterials/normalA',
      aoMap: 'mergeMaterials/ormA',
      roughnessMap: 'mergeMaterials/ormA',
      metalnessMap: 'mergeMaterials/ormA',
      roughness: 1,
      metalness: 1,
      aoMapIntensity: 0.8,
    },
  }) as THREE.MeshStandardMaterial;
  const matB = createMaterial({
    id: 'mergeMaterials/matB',
    type: 'STANDARD',
    params: {
      color: new THREE.Color('#d8ffff'),
      map: 'mergeMaterials/albedoB',
      normalMap: 'mergeMaterials/normalB',
      normalScale: new THREE.Vector2(0.6, -0.6),
      roughness: 0.35,
      metalness: 0.3,
      emissive: new THREE.Color('#202060'),
      emissiveIntensity: 1.5,
    },
  }) as THREE.MeshStandardMaterial;

  const arrays = {
    map: createArray('mergeMaterials/mapArray', [TEXELS.albedoA, TEXELS.albedoB], srgb),
    normalMap: createArray('mergeMaterials/normalArray', [TEXELS.normalA, TEXELS.normalB], linear),
    orm: createArray('mergeMaterials/ormArray', [TEXELS.ormA, TEXELS.neutralOrm], linear),
  };
  // `?aekStrip=normal,ao`: drops a feature from both sides, to find what differs
  if (getStripped().has('normal')) for (const mat of [matA, matB]) mat.normalMap = null;
  if (getStripped().has('ao')) matA.aoMap = null;
  if (getStripped().has('orm')) {
    matA.aoMap = null;
    matA.roughnessMap = null;
    matA.metalnessMap = null;
  }
  if (getStripped().has('emissive')) matB.emissive.set(0x000000);
  return { palette: [matA, matB], arrays };
};

// ---- Members ----

type Member = {
  geo: string;
  /** Palette index: 0 = A, 1 = B */
  mat: 0 | 1;
  position: [number, number];
  rotation: [number, number, number];
  scale?: [number, number, number];
};

const MEMBERS: Member[] = [
  { geo: 'sphere', mat: 0, position: [-1.8, 0.6], rotation: [0.3, -0.5, 0] },
  { geo: 'box', mat: 1, position: [-0.6, 0.6], rotation: [0.5, 0.7, 0.1] },
  { geo: 'torus', mat: 0, position: [0.6, 0.6], rotation: [0.9, 0.2, 0] },
  { geo: 'cylinder', mat: 1, position: [1.8, 0.6], rotation: [0.4, 0, 0.3] },
  { geo: 'box', mat: 0, position: [-1.8, -0.6], rotation: [-0.4, 0.6, 0] },
  { geo: 'sphere', mat: 1, position: [-0.6, -0.6], rotation: [0.2, 1.1, 0] },
  { geo: 'cylinder', mat: 0, position: [0.6, -0.6], rotation: [-0.5, 0.3, 0.2] },
  // Mirrored: the merge flips its winding, the reference mesh its front face
  { geo: 'torus', mat: 1, position: [1.8, -0.6], rotation: [0.7, -0.4, 0], scale: [-1, 1, 1] },
];

const GEOMETRIES: Record<string, () => THREE.BufferGeometry> = {
  sphere: () => new THREE.SphereGeometry(0.5, 40, 20),
  box: () => new THREE.BoxGeometry(0.75, 0.75, 0.75),
  torus: () => new THREE.TorusGeometry(0.34, 0.15, 20, 40),
  cylinder: () => new THREE.CylinderGeometry(0.35, 0.35, 0.8, 32),
};

const getMemberGeometry = (name: string) => {
  const id = `mergeMaterials/${name}`;
  return getGeometry(id) ?? saveBufferGeometry(GEOMETRIES[name](), { id });
};

const getMemberMatrix = (member: Member) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(member.position[0], member.position[1], 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...member.rotation)),
    new THREE.Vector3(...(member.scale ?? [1, 1, 1]))
  );

const getMergeParts = () =>
  MEMBERS.map((member, i) => ({
    geo: getMemberGeometry(member.geo),
    matrix: getMemberMatrix(member),
    materialSlot: member.mat,
    key: String(i),
  }));

/** The control: the members merged with one geometry group per material, drawn by the materials
 * themselves (a material array, one draw per group). It differs from the reference only by the
 * bake, so the merge material is checked against it. */
const createBakedGeometry = () =>
  saveBufferGeometry(mergeGeometryParts(getMergeParts(), { groups: 'BY_SLOT' }), {
    id: 'mergeMaterials/baked',
  });

/** The members merged in block space, each vertex tagged with its member's palette index */
const createMergedGeometry = (indexType: MatIndexType) => {
  const merged = mergeGeometryParts(getMergeParts());
  const values: number[] = [];
  for (const part of merged.userData.mergeParts) {
    const paletteIndex = MEMBERS[Number(part.key)].mat;
    for (let v = 0; v < part.vertexCount; v++) values[part.vertexStart + v] = paletteIndex;
  }
  merged.setAttribute(MAT_INDEX_ATTRIBUTE, createMatIndexAttribute(values, indexType));
  return saveBufferGeometry(merged, { id: `mergeMaterials/merged_${indexType}` });
};

// ---- The variants ----

/** A variant's entities and each one's position in its block */
type VariantEntities = { entityId: number; local: THREE.Vector3 }[];

const readIndexType = (): MatIndexType => {
  const param = new URLSearchParams(window.location.search).get('aekMatIndex');
  return param === 'uint16' || param === 'uint32' || param === 'float32' ? param : 'uint8';
};

/** What `window.__mergeMaterials` holds: the results and the console's handles */
const state = {
  ...getHarnessHandles(),
  results: {} as Record<string, unknown>,
  variants: {} as Partial<Record<Variant, VariantEntities>>,
  /** Shows one variant alone at the origin, all in a grid, or none */
  show: (shown: Variant | 'ALL' | 'NONE') => {
    const world = getECSWorld();
    for (const variant of VARIANTS) {
      const isShown = shown === 'ALL' || shown === variant;
      const offset = shown === 'ALL' ? GRID_OFFSETS[variant] : new THREE.Vector3();
      for (const { entityId, local } of state.variants[variant] ?? []) {
        world.setDisabled(entityId, !isShown);
        const pos = local.clone().add(offset);
        world.setTransform(entityId, { pos: { x: pos.x, y: pos.y, z: pos.z } });
      }
    }
    // The grid is three blocks wide: zoomed out for it
    const camera = getActiveCamera() as THREE.OrthographicCamera | undefined;
    if (camera?.isOrthographicCamera) {
      camera.zoom = shown === 'ALL' ? 0.6 : 1;
      camera.updateProjectionMatrix();
    }
    state.shown = shown;
  },
  shown: 'ALL' as Variant | 'ALL' | 'NONE',
  /** The renderer's draws per frame with each variant shown alone (and with none) */
  measureDraws: async () => {
    const draws: Record<string, number> = {};
    const renderer = getRenderer() as unknown as { info: { render: { drawCalls: number } } };
    const built = VARIANTS.filter((variant) => state.variants[variant]);
    for (const shown of ['NONE', ...built] as const) {
      state.show(shown);
      await nextFrames(3);
      draws[shown] = renderer.info.render.drawCalls;
    }
    state.show('ALL');
    return draws;
  },
};

const createVariants = (indexType: MatIndexType) => {
  const { palette, arrays } = createMaterials();
  const disposers: (() => void)[] = [];

  state.variants.REFERENCE = MEMBERS.map((member, i) => {
    const local = new THREE.Vector3(member.position[0], member.position[1], 0);
    const rotation = { x: member.rotation[0], y: member.rotation[1], z: member.rotation[2] };
    const [sx, sy, sz] = member.scale ?? [1, 1, 1];
    const entityId = createMeshEntity(
      {
        geo: getMemberGeometry(member.geo),
        mat: palette[member.mat],
        position: { x: local.x, y: local.y, z: 0 },
        rotation,
        scale: { x: sx, y: sy, z: sz },
      },
      { appId: `mergeMaterials_ref${i}` }
    );
    return { entityId, local };
  });

  const bakedId = createMeshEntity(
    { geo: createBakedGeometry(), mat: palette[0], position: { x: 0, y: 0, z: 0 } },
    { appId: 'mergeMaterials_baked' }
  );
  // createMeshEntity takes one material: the array goes on the mesh (both are the scene's)
  const bakedMesh = getECSWorld().getComponent(bakedId, ComponentType.OBJECT3D)?.value;
  (bakedMesh as THREE.Mesh).material = palette;
  state.variants.BAKED = [{ entityId: bakedId, local: new THREE.Vector3() }];

  const merged = createMergedGeometry(indexType);
  const entries = palette.map(getPaletteEntry);
  for (const table of TABLE_KINDS) {
    // three r187's WebGL2 backend can't read a storage buffer in a fragment shader (its PBO path
    // fails the draw: "Vertex buffer is not big enough"), so that variant is WebGPU's only
    if (table === 'STORAGE' && !isWebGPURenderer()) continue;
    const { material, dispose } = createMergeMaterialPrototype({
      arrays,
      entries,
      table,
      indexType,
      strip: getStripped(),
    });
    disposers.push(dispose);
    if (getStripped().has('normal')) material.normalNode = null;
    if (getStripped().has('ao')) material.aoNode = null;
    saveMaterial(material, `mergeMaterials/merge_${table}`);
    const entityId = createMeshEntity(
      { geo: merged, mat: material, position: { x: 0, y: 0, z: 0 } },
      { appId: `mergeMaterials_merged${table}` }
    );
    state.variants[table] = [{ entityId, local: new THREE.Vector3() }];
  }
  return () => disposers.forEach((dispose) => dispose());
};

export const scene = async () => {
  (window as unknown as { __mergeMaterials: typeof state }).__mergeMaterials = state;
  state.results = {};
  state.variants = {};
  const indexType = readIndexType();

  createCameraEntity(
    {
      type: 'ORTHOGRAPHIC',
      frustumSize: 6.4,
      position: { x: 0, y: 0, z: 10 },
      lookAtPoint: { x: 0, y: 0, z: 0 },
      active: true,
    },
    { appId: 'mergeMaterialsCam', debugData: { name: 'Merge materials' } }
  );
  createLightEntity(
    { type: 'AMBIENT', color: '#ffffff', intensity: 0.5 },
    { appId: 'mergeMaterialsAmbient' }
  );
  createLightEntity(
    {
      type: 'DIRECTIONAL',
      color: '#ffffff',
      intensity: 2.5,
      position: { x: 3, y: 4, z: 6 },
      targetPos: { x: 0, y: 0, z: 0 },
    },
    { appId: 'mergeMaterialsSun' }
  );

  const visit = { isLeft: false };
  try {
    const dispose = createVariants(indexType);
    registerOnSceneExit(SCENE_ID, () => {
      visit.isLeft = true;
      dispose();
    });
    state.show('ALL');
  } catch (error) {
    lerror('[mergeMaterials] Build failed', error);
    state.results.buildError = getErrorMessage(error);
    return;
  }

  // After the load: nothing is drawn while it runs
  void (async () => {
    await nextFrames(10);
    if (visit.isLeft) return;
    state.results.backend = getBackendName();
    state.results.indexType = indexType;
    state.results.draws = await state.measureDraws();
    if (visit.isLeft) return;
    state.results.done = true;
  })().catch((error) => {
    if (visit.isLeft) return;
    lerror('[mergeMaterials] Measuring failed', error);
    state.results.measureError = getErrorMessage(error);
  });
};
