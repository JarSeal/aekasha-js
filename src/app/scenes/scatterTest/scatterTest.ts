import * as THREE from 'three/webgpu';
import {
  ComponentType,
  createCameraEntity,
  createLightEntity,
  createSeededRandom,
  getECSWorld,
  lerror,
  registerOnSceneExit,
} from 'aekasha';
import {
  getScatterGenerator,
  registerScatterGenerator,
  spawnScatter,
  type ScatterGenerator,
} from 'aekasha/instancing';
import { spawnTerrainBlock } from 'aekasha/terrain';
import { nextFrames } from '../../shared/verifyHarness';

/**
 * p308 Phase 1's verification scene (`docs/plans/p308_terrain-scatter.md`): a flat 64 m terrain
 * block whose own scatter (`scatterTestPebbles`, the block JSON's `scatter`) places 20,000 pebbles
 * of two kinds by `scatterTestUniform`, a test generator this file registers (uniform over the
 * target's square, yaw, scale and a grey tint per instance), in 16 m cells: one `InstancedMesh`
 * entity per cell and kind, none per pebble. Each cell hides as a whole below its LOD's
 * `cullScreenSize`: from the start camera the near half of the block shows and the far half is
 * culled. `scatterTestBoulders` (a `PLACEMENTS` source) puts six hand-placed boulders on the
 * block's centre through `spawnScatter`.
 *
 * The load checks the counts, then, once the LOD has selected every pebble cell, that some are
 * LOD-culled and some aren't, and logs an error otherwise, which fails the scene runner. `window.__scatterTest` holds the spawn results and the culled cells.
 */

const SCENE_ID = 'scatterTest';
const GENERATOR_ID = 'scatterTestUniform';
const PEBBLES = 20000;
/** 64 m in 16 m cells, for each of the two kinds */
const PEBBLE_CELLS = 32;
const BOULDERS = 6;
/** Frames the check waits at most for the LOD's first selection of every cell */
const MAX_CHECK_FRAMES = 120;

const state: {
  pebbleCellIds: number[];
  boulderCellIds: number[];
  pebbles: number;
  boulders: number;
  culledCells: number;
} = { pebbleCellIds: [], boulderCellIds: [], pebbles: 0, boulders: 0, culledCells: -1 };

/** `params.count` instances uniform over the target's square, at its height, with a random yaw,
 * a scale in `params.scale` and a grey tint of `params.tint` */
const uniformScatter: ScatterGenerator = ({ params, seed, target }) => {
  const count = Number(params.count);
  const [minScale, maxScale] = params.scale as [number, number];
  const tint = Number(params.tint);
  const size = target.size ?? 0;
  const random = createSeededRandom(seed);
  const matrices = new Float32Array(count * 16);
  const colors = new Float32Array(count * 3);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < count; i++) {
    position.set(
      target.position.x + (random() - 0.5) * size,
      target.position.y,
      target.position.z + (random() - 0.5) * size
    );
    quaternion.setFromAxisAngle(up, random() * Math.PI * 2);
    scale.setScalar(minScale + random() * (maxScale - minScale));
    matrix.compose(position, quaternion, scale).toArray(matrices, i * 16);
    colors.fill(1 - random() * tint, i * 3, i * 3 + 3);
  }
  return { matrices, colors };
};

/** Whether the LOD has selected the cell: a level, or culled */
const isSelected = (entityId: number) => {
  const world = getECSWorld();
  return (
    world.hasComponent(entityId, ComponentType.TAG_LOD_CULLED) ||
    (world.getComponent(entityId, ComponentType.LOD)?.level ?? -1) >= 0
  );
};

/** Once the LOD has selected every pebble cell (the main loop runs after the load), that some
 * are culled and some aren't; logs an error otherwise */
const checkCulledCellsAsync = async (isCurrent: () => boolean) => {
  for (let frame = 0; frame < MAX_CHECK_FRAMES; frame++) {
    if (state.pebbleCellIds.every(isSelected)) break;
    await nextFrames(1);
    if (!isCurrent()) return;
  }
  const world = getECSWorld();
  state.culledCells = state.pebbleCellIds.filter((id) =>
    world.hasComponent(id, ComponentType.TAG_LOD_CULLED)
  ).length;
  if (state.culledCells === 0 || state.culledCells === state.pebbleCellIds.length) {
    lerror(
      `scatterTest: ${state.culledCells} of ${state.pebbleCellIds.length} pebble cells LOD-culled; the far half should be, the near half not.`
    );
  }
};

export const scene = async () => {
  (window as unknown as { __scatterTest: typeof state }).__scatterTest = state;
  Object.assign(state, {
    pebbleCellIds: [],
    boulderCellIds: [],
    pebbles: 0,
    boulders: 0,
    culledCells: -1,
  });
  let isLoaded = true;
  registerOnSceneExit(SCENE_ID, () => {
    isLoaded = false;
  });
  // A test generator: registered with the scene's first visit and kept, as an install's would be
  if (!getScatterGenerator(GENERATOR_ID)) registerScatterGenerator(GENERATOR_ID, uniformScatter);

  createCameraEntity(
    {
      type: 'PERSPECTIVE',
      fov: 50,
      far: 500,
      position: { x: 0, y: 5, z: 44 },
      lookAtPoint: { x: 0, y: 0, z: 0 },
      active: true,
    },
    { appId: 'scatterTestCam', debugData: { name: 'Scatter overview' } }
  );
  createLightEntity(
    { type: 'AMBIENT', color: '#dfe8ff', intensity: 0.6 },
    { appId: 'scatterTestAmbient' }
  );
  createLightEntity(
    {
      type: 'DIRECTIONAL',
      color: '#fff2d9',
      intensity: 2.5,
      position: { x: -30, y: 40, z: 30 },
      targetPos: { x: 0, y: 0, z: 0 },
      castShadow: true,
      shadowPreset: 'HIGH',
      shadowCameraNearFar: [1, 120],
      shadowCameraFrustum: [-40, 40, 40, -40],
    },
    { appId: 'scatterTestSun' }
  );

  const block = await spawnTerrainBlock('scatterTestBlock');
  if (!block || !isLoaded) return;
  state.pebbleCellIds = block.scatterIds;
  const boulders = await spawnScatter('scatterTestBoulders', {
    target: { position: { x: 0, y: 0, z: 0 }, grid: { x: 0, z: 0 }, size: 64 },
  });
  if (!boulders || !isLoaded) return;
  state.boulderCellIds = boulders.entityIds;
  state.boulders = boulders.count;
  const world = getECSWorld();
  state.pebbles = block.scatterIds.reduce((sum, id) => {
    const mesh = world.getComponent(id, ComponentType.OBJECT3D)?.value as THREE.InstancedMesh;
    return sum + (mesh?.count ?? 0);
  }, 0);

  if (
    state.pebbles !== PEBBLES ||
    state.pebbleCellIds.length !== PEBBLE_CELLS ||
    state.boulders !== BOULDERS
  ) {
    lerror(
      `scatterTest: ${state.pebbles} pebbles in ${state.pebbleCellIds.length} cells and ${state.boulders} boulders, not ${PEBBLES} in ${PEBBLE_CELLS} and ${BOULDERS}.`
    );
  }

  // Not awaited: the load waits for the scene function, and the LOD selects once it's done
  void checkCulledCellsAsync(() => isLoaded);
};
