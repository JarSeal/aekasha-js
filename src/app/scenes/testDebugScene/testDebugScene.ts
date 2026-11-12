import * as THREE from 'three/webgpu';
import { color, mix, uniform, uv } from 'three/tsl';
import {
  createGeometry,
  createMaterial,
  createMeshEntity,
  existsOrThrow,
  getECSWorld,
  getTexture,
  loadTextureAsync,
  importAssetAsync,
  registerMaterialInputResolver,
  registerMergedGeometry,
  registerTslMaterial,
  spawnImportedAsset,
} from 'aekasha';
import type {
  ImportedAssetManifest,
  MaterialInputResolver,
  TexOpts,
  TslMaterialFns,
} from 'aekasha';
import { loadDebugModuleAsync } from 'aekasha/debug';
import { addToMergeGroup, createMergeGroup } from 'aekasha/merging';

const TEX = '/debugger/assets/testTextures';
const OPT = '/debugger/assets/testOptimized';
const MODELS = '/debugger/assets/testModels';

// The PNG gets the sRGB colour space its KTX2 copy carries in its own header
const TEXTURES: { id: string; fileName: string; texOpts?: TexOpts }[] = [
  {
    id: 'p300_uvChecker_png',
    fileName: `${TEX}/UVMaps/UVCheckerMap-orange-white-1024.png`,
    texOpts: { colorSpace: THREE.SRGBColorSpace },
  },
  { id: 'p300_uvChecker_ktx2', fileName: `${OPT}/uvChecker_etc1s.ktx2` },
  { id: 'p300_normal_png', fileName: `${TEX}/Poliigon_MetalRust_7642_Normal.png` },
  { id: 'p300_normal_ktx2', fileName: `${OPT}/metalRust_normal_uastc.ktx2` },
];

const MODELS_TO_IMPORT = [
  { id: 'p300_source', fileName: `${MODELS}/box01Textured.glb` },
  { id: 'p300_meshoptKtx2', fileName: `${OPT}/box01Textured_meshopt_ktx2.glb` },
  { id: 'p300_meshoptKtx2Quantized', fileName: `${OPT}/box01Textured_meshopt_ktx2_quantized.glb` },
  { id: 'p300_untexturedSource', fileName: `${MODELS}/box01.glb`, noTextures: true },
  { id: 'p300_meshoptOnly', fileName: `${OPT}/box01_meshopt.glb`, noTextures: true },
];

/** A STANDARD material with the maps the import's glTF material had (its first primitive's). */
const createSlotMaterial = (manifest: ImportedAssetManifest) => {
  const slots = manifest.geometries[0]?.textureSlots || {};
  const params: Record<string, THREE.Texture | undefined> = {};
  for (const [slot, textureId] of Object.entries(slots)) params[slot] = getTexture(textureId);
  return createMaterial({ id: `${manifest.id}_material`, type: 'STANDARD', params });
};

// three/tsl's `uv()`, with the real type (the shim's is loose)
const meshUv = uv as unknown as () => THREE.Node<'vec2'>;

type GradientInput = { gradient: [string, string] };

/** The input resolver check's resolver (p302 D4): `{ gradient: [from, to] }` → a bundle of two
 * colour uniforms, kept as `setup_<key>_from` and `setup_<key>_to`. */
const gradientResolver: MaterialInputResolver<GradientInput> = {
  kind: 'testDebugScene.gradient',
  match: (value) => typeof value === 'object' && value !== null && 'gradient' in value,
  resolve: ({ gradient }) => ({
    from: uniform(color(gradient[0])),
    to: uniform(color(gradient[1])),
  }),
};

/** The gradient check's graph: its `band` input's bundle, bottom to top. */
const gradientFns = {
  setup: (
    inputs: { band: { from: THREE.Node<'color'>; to: THREE.Node<'color'> } },
    material: THREE.MeshBasicNodeMaterial
  ) => {
    material.colorNode = mix(inputs.band.from, inputs.band.to, meshUv().y);
  },
} satisfies TslMaterialFns;

/** Where the material input checks stand, either side of the top row. */
const INPUT_CHECK_ROW = { y: 1.9, channelX: -4.0, gradientX: 4.0 };

/**
 * The material input checks (p302 Phase 4): left, `p302ChannelMat` (the scene JSON's), the
 * texture on its left half and its red channel in grey on its right, from object-form texture
 * refs; right, a gradient from navy to amber, bottom to top, its colours a bundle from this
 * scene's input resolver. Each registration is on this call, never at the module's load (a visit
 * again registers the same functions, which does nothing).
 */
const createMaterialInputChecks = (planeGeo: THREE.BufferGeometry) => {
  registerMaterialInputResolver(gradientResolver);
  registerTslMaterial('testDebugScene.gradient', gradientFns);
  const gradientMat = createMaterial({
    id: 'p302_gradientMat',
    type: 'BASICNODEMATERIAL',
    tslMaterialId: 'testDebugScene.gradient',
    inputs: { band: { gradient: ['#1c233a', '#ffaa00'] } },
  });
  createMeshEntity(
    {
      geo: planeGeo,
      mat: 'p302ChannelMat',
      position: { x: INPUT_CHECK_ROW.channelX, y: INPUT_CHECK_ROW.y, z: 0 },
    },
    { appId: 'p302_channelPlane' }
  );
  createMeshEntity(
    {
      geo: planeGeo,
      mat: gradientMat,
      position: { x: INPUT_CHECK_ROW.gradientX, y: INPUT_CHECK_ROW.y, z: 0 },
    },
    { appId: 'p302_gradientPlane' }
  );
};

/** The merge check's parts, in their group's space: a box, a sphere and a tilted, mirrored
 * cylinder (scale x -1), whose winding the merge must flip. */
const MERGE_PARTS = [
  { geoId: 'p371_box', position: [-0.8, 0, 0], rotation: [0, 0.5, 0], scale: [1, 1, 1] },
  { geoId: 'p371_sphere', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  { geoId: 'p371_cylinder', position: [0.8, 0, 0], rotation: [0, 0.6, 0.3], scale: [-1, 1, 1] },
] as const;
/** Where the merge check's two groups stand: the separate meshes left, the merged mesh right. */
const MERGE_ROW = { y: -1.5, separateX: -1.8, mergedX: 1.8 };

/**
 * The merge check (p371 Phase 1): the parts as three meshes, and merged into one geometry
 * (`p371_merged`, one draw in the profiler), each group on a slab that takes their shadows. The
 * two groups must look the same: the mirrored cylinder not inside out, the checker the same way
 * round, the shading and shadows alike.
 */
const createMergeCheck = (checker: THREE.Texture) => {
  createGeometry({ id: 'p371_box', type: 'BOX', params: { width: 0.6, height: 0.6, depth: 0.6 } });
  createGeometry({ id: 'p371_sphere', type: 'SPHERE', params: { radius: 0.35 } });
  createGeometry({
    id: 'p371_cylinder',
    type: 'CYLINDER',
    params: { radiusTop: 0.15, radiusBottom: 0.25, height: 0.6, radialSegments: 16 },
  });
  const mat = createMaterial({ id: 'p371_mergeMat', type: 'STANDARD', params: { map: checker } });
  const slabMat = createMaterial({
    id: 'p371_slabMat',
    type: 'STANDARD',
    params: { color: 0x667788 },
  });
  const slabGeo = createGeometry({
    id: 'p371_slab',
    type: 'BOX',
    params: { width: 2.6, height: 0.04, depth: 1.2 },
  });

  const matrices = MERGE_PARTS.map(({ position, rotation, scale }) =>
    new THREE.Matrix4().compose(
      new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
      new THREE.Vector3(...scale)
    )
  );
  const mergedGeo = registerMergedGeometry(
    MERGE_PARTS.map(({ geoId }, i) => ({ geo: geoId, matrix: matrices[i], key: geoId })),
    { id: 'p371_merged' }
  );

  MERGE_PARTS.forEach(({ geoId, position, rotation, scale }) => {
    createMeshEntity(
      {
        geo: geoId,
        mat,
        castShadow: true,
        receiveShadow: true,
        position: { x: MERGE_ROW.separateX + position[0], y: MERGE_ROW.y + position[1], z: 0 },
        rotation: { x: rotation[0], y: rotation[1], z: rotation[2] },
        scale: { x: scale[0], y: scale[1], z: scale[2] },
      },
      { appId: `${geoId}_separate` }
    );
  });
  createMeshEntity(
    {
      geo: mergedGeo,
      mat,
      castShadow: true,
      receiveShadow: true,
      position: { x: MERGE_ROW.mergedX, y: MERGE_ROW.y, z: 0 },
    },
    { appId: 'p371_mergedMesh' }
  );
  for (const x of [MERGE_ROW.separateX, MERGE_ROW.mergedX]) {
    createMeshEntity(
      {
        geo: slabGeo,
        mat: slabMat,
        receiveShadow: true,
        position: { x, y: MERGE_ROW.y - 0.38, z: 0 },
      },
      { appId: `p371_slab_${x < 0 ? 'separate' : 'merged'}` }
    );
  }
};

/** The merge group check's grid: two blocks of 10 × 10 boxes, left and right of the rows. */
const GROUP_GRID = {
  columns: 10,
  rows: 10,
  spacing: 0.24,
  size: 0.16,
  blockX: [-6.6, 4.44],
  topY: -0.2,
};

/**
 * The merge group check (p372 Phase 1): 200 boxes of one material, each turned its own way, drawn
 * by one merge group (`p372_grid`): one draw in the profiler where there were 200, and the same
 * image. `dissolveMergeGroup('p372_grid')` draws them on their own again. No shadows: one pass.
 */
const createMergeGroupCheck = (checker: THREE.Texture) => {
  const geo = createGeometry({
    id: 'p372_box',
    type: 'BOX',
    params: { width: GROUP_GRID.size, height: GROUP_GRID.size, depth: GROUP_GRID.size },
  });
  const mat = createMaterial({ id: 'p372_gridMat', type: 'STANDARD', params: { map: checker } });
  createMergeGroup({ id: 'p372_grid' });
  const boxes: number[] = [];
  for (const blockX of GROUP_GRID.blockX) {
    for (let row = 0; row < GROUP_GRID.rows; row++) {
      for (let column = 0; column < GROUP_GRID.columns; column++) {
        const i = boxes.length;
        boxes.push(
          createMeshEntity(
            {
              geo,
              mat,
              position: {
                x: blockX + column * GROUP_GRID.spacing,
                y: GROUP_GRID.topY - row * GROUP_GRID.spacing,
                z: 0,
              },
              rotation: { x: i * 0.37, y: i * 0.23, z: 0 },
            },
            { appId: `p372_box_${i}` }
          )
        );
      }
    }
  }
  addToMergeGroup('p372_grid', boxes);
};

/** The AUTO check's lattice: 10 columns (x) × 10 rows (y) × 5 layers (z), under the right block.
 * The scene's `mergeGroups` makes AUTO's cells 2 m, so x 4-6 / 6-8 and z -2-0 / 0-2: four cells. */
const AUTO_LATTICE = {
  columns: 10,
  rows: 10,
  layers: 5,
  x: 4.2,
  y: -3.3,
  z: -0.8,
  spacing: { x: 0.28, y: 0.28, z: 0.4 },
  materials: ['p372_autoMatA', 'p372_autoMatB', 'p372_autoMatC'],
};

/**
 * The AUTO merge check (p372 Phase 3): 500 boxes of `p372_autoBox` (the scene JSON's), the three
 * materials in turn, `merge: 'AUTO'`: 12 groups, 3 materials in 4 cells, built by the scene step
 * so the first frame draws them merged and `p372_autoBox` is never uploaded. The bottom row's four
 * corners are the JSON's meshes (`p372_autoJson_*`, material A): the code skips them.
 */
const createAutoMergeCheck = () => {
  const { columns, rows, layers, spacing, materials } = AUTO_LATTICE;
  let i = 0;
  for (let layer = 0; layer < layers; layer++) {
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const isJsonCorner =
          row === rows - 1 &&
          (column === 0 || column === columns - 1) &&
          (layer === 0 || layer === layers - 1);
        if (isJsonCorner) continue;
        createMeshEntity(
          {
            geo: 'p372_autoBox',
            mat: materials[i % materials.length],
            position: {
              x: AUTO_LATTICE.x + column * spacing.x,
              y: AUTO_LATTICE.y - row * spacing.y,
              z: AUTO_LATTICE.z + layer * spacing.z,
            },
            rotation: { x: i * 0.41, y: i * 0.29, z: 0 },
            merge: 'AUTO',
          },
          { appId: `p372_auto_${i}` }
        );
        i++;
      }
    }
  }
};

/**
 * The orientation check of hand-optimized assets (KTX2 textures, meshopt GLBs, made with gltfpack)
 * next to their sources; its camera and lights are in its JSON. Top row: each PNG texture, then
 * its KTX2 copy; they must look the same (the KTX2 files are encoded flipped, so this is the
 * orientation check). Middle row, left to right: `box01Textured.glb`, its meshopt + KTX2 copy and
 * its quantized meshopt + KTX2 copy (all three must look the same), then `box01.glb` (no
 * textures, a plain material) and its meshopt copy. Switch the GLTF worker target in the Assets
 * tab (and reload) to check the assets worker path. Bottom row: the geometry merge check
 * (`createMergeCheck`). Only the bottom row casts and takes the sun's shadows. Left and right of
 * the rows, the merge group check (`createMergeGroupCheck`), and under the right block the AUTO
 * check (`createAutoMergeCheck`). Either side of the top row, the material input checks
 * (`createMaterialInputChecks`).
 */
export const scene = async () => {
  const textures = await Promise.all(
    TEXTURES.map(({ id, fileName, texOpts }) => loadTextureAsync({ id, fileName, texOpts }))
  );
  const planeGeo = createGeometry({
    id: 'p300_plane',
    type: 'BOX',
    params: { width: 1.4, height: 1.4, depth: 0.02 },
  });
  textures.forEach((texture, i) => {
    createMeshEntity(
      {
        geo: planeGeo,
        mat: createMaterial({
          id: `${TEXTURES[i].id}_material`,
          type: 'BASIC',
          params: { map: texture },
        }),
        position: { x: -2.4 + i * 1.6, y: 1.9, z: 0 },
      },
      { appId: `${TEXTURES[i].id}_plane` }
    );
  });
  createMaterialInputChecks(planeGeo);
  createMergeCheck(textures[0]);
  createMergeGroupCheck(textures[0]);
  createAutoMergeCheck();
  // p376 Phase 0's probe (`window.__aekHlod`, `src/app/shared/_dbg__hlodSpike.ts`)
  const hlodProbe = await loadDebugModuleAsync(
    () => import('../../shared/_dbg__hlodSpike'),
    true,
    'HLOD spike probe'
  );
  hlodProbe?.current?.installHlodSpike(getECSWorld());

  for (let i = 0; i < MODELS_TO_IMPORT.length; i++) {
    const { id, fileName, noTextures } = MODELS_TO_IMPORT[i];
    const manifest = existsOrThrow(
      await importAssetAsync({ id, fileName, importTextures: !noTextures, throwOnError: true }),
      `Could not import ${fileName}.`
    );
    await spawnImportedAsset(manifest, {
      transform: { position: { x: -3.2 + i * 1.6, y: 0, z: 0 } },
      material: noTextures
        ? createMaterial({ id: `${id}_material`, type: 'STANDARD', params: { color: 0x8899aa } })
        : createSlotMaterial(manifest),
    });
  }
};
