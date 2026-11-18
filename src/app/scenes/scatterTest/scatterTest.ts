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
import {
  createRulesScatterState,
  spawnRulesScatterAsync,
  type RulesScatterState,
} from './rulesScatter';

/**
 * p308 Phase 1's verification scene (`docs/plans/_DONE_p308_terrain-scatter.md`): a flat 64 m terrain
 * block whose own scatter (`scatterTestPebbles`, the block JSON's `scatter`) places 20,000 pebbles
 * of two kinds by `scatterTestUniform`, a test generator this file registers (uniform over the
 * target's square, yaw, scale and a grey tint per instance), in 16 m cells: one `InstancedMesh`
 * entity per cell and kind, none per pebble. Each cell hides as a whole below its LOD's
 * `cullScreenSize`: from the start camera the near half of the block shows and the far half is
 * culled. `scatterTestBoulders` (a `PLACEMENTS` source) puts six hand-placed boulders on the
 * block's centre through `spawnScatter`. In front, p308 Phase 2's Blender scatter
 * (`devTools/blender/buildScatterTest.py`: one Geometry Nodes scatter of two rocks) spawns twice from
 * `IMPORTED` sources, exported with GPU Instances on the left (`scatterTestGnGpu`) and as a point
 * cloud on the right (`scatterTestGnPoints`), and the load checks that both place the same rocks the
 * same way. Behind them, p308 Phase 3's rules block (`rulesScatter.ts`): the toolkit's
 * `terrainScatter` places pebbles on its rock layer and slabs with colliders on its sand, and a box
 * dropped on a slab must rest on it.
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
/** The Blender scatter's two exports, each spawned on its own target, side by side in front */
const BLENDER_SCATTERS = [
  { id: 'scatterTestGnGpu', position: { x: -14, y: 0, z: 16 } },
  { id: 'scatterTestGnPoints', position: { x: 14, y: 0, z: 16 } },
] as const;
/** How far apart the two exports' matrix elements may be */
const BLENDER_TOLERANCE = 1e-4;
/** Frames the check waits at most for the LOD's first selection of every cell */
const MAX_CHECK_FRAMES = 120;

const state: {
  pebbleCellIds: number[];
  boulderCellIds: number[];
  pebbles: number;
  boulders: number;
  culledCells: number;
  /** Each Blender export's instances, and how many differ from the other's */
  blender: { gpu: number; points: number; mismatches: number };
  /** p308 Phase 3's rules block: its scatters' counts and checks (`rulesScatter.ts`) */
  rules: RulesScatterState;
} = {
  pebbleCellIds: [],
  boulderCellIds: [],
  pebbles: 0,
  boulders: 0,
  culledCells: -1,
  blender: { gpu: 0, points: 0, mismatches: -1 },
  rules: createRulesScatterState(),
};

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

/** A spawned scatter's instances relative to its target, each with its item (from its cell's app
 * id, `scatter/<id>/<item>/<cellX>,<cellZ>`), sorted by item and position */
const readInstances = (
  scatterId: string,
  entityIds: readonly number[],
  origin: { x: number; z: number }
) => {
  const world = getECSWorld();
  const prefix = `scatter/${scatterId}/`;
  const matrix = new THREE.Matrix4();
  const instances: { item: number; elements: number[] }[] = [];
  for (const entityId of entityIds) {
    const appId = world.getComponent(entityId, ComponentType.APP_ID)?.id ?? '';
    const item = Number(appId.slice(prefix.length).split('/')[0]);
    const mesh = world.getComponent(entityId, ComponentType.OBJECT3D)?.value as THREE.InstancedMesh;
    const cell = world.getComponent(entityId, ComponentType.TRANSFORM)!.position;
    for (let i = 0; i < mesh.count; i++) {
      const elements = [...mesh.getMatrixAt(i, matrix).elements];
      elements[12] += cell.x - origin.x;
      elements[13] += cell.y;
      elements[14] += cell.z - origin.z;
      instances.push({ item, elements });
    }
  }
  return instances.sort(
    (a, b) => a.item - b.item || a.elements[12] - b.elements[12] || a.elements[14] - b.elements[14]
  );
};

/** The two exports' instances, pair by pair: how many differ (another item, or a matrix element
 * past the tolerance), all of them when the counts differ */
const countMismatches = (
  gpu: ReturnType<typeof readInstances>,
  points: ReturnType<typeof readInstances>
) => {
  if (gpu.length !== points.length) return Math.max(gpu.length, points.length);
  return gpu.filter(
    (a, i) =>
      a.item !== points[i].item ||
      a.elements.some((value, e) => Math.abs(value - points[i].elements[e]) > BLENDER_TOLERANCE)
  ).length;
};

/** Spawns the Blender scatter's two exports and checks they agree; logs an error otherwise. Null
 * when the scene was left meanwhile. */
const spawnBlenderScattersAsync = async (isCurrent: () => boolean) => {
  const read: ReturnType<typeof readInstances>[] = [];
  for (const { id, position } of BLENDER_SCATTERS) {
    const spawned = await spawnScatter(id, { target: { position } });
    if (!spawned || !isCurrent()) return null;
    read.push(readInstances(id, spawned.entityIds, position));
  }
  const [gpu, points] = read;
  state.blender = {
    gpu: gpu.length,
    points: points.length,
    mismatches: countMismatches(gpu, points),
  };
  if (!gpu.length || state.blender.mismatches) {
    lerror(
      `scatterTest: the Blender scatter's exports differ: ${gpu.length} GPU instances and ${points.length} points, ${state.blender.mismatches} of them placed differently.`
    );
  }
  return state.blender;
};

export const scene = async () => {
  (window as unknown as { __scatterTest: typeof state }).__scatterTest = state;
  Object.assign(state, {
    pebbleCellIds: [],
    boulderCellIds: [],
    pebbles: 0,
    boulders: 0,
    culledCells: -1,
    blender: { gpu: 0, points: 0, mismatches: -1 },
    rules: createRulesScatterState(),
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
  if (!(await spawnBlenderScattersAsync(() => isLoaded))) return;
  const settleDropAsync = await spawnRulesScatterAsync(state.rules, () => isLoaded);
  if (!isLoaded) return;
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

  // Not awaited: the load waits for the scene function, and the LOD selects (and physics steps)
  // once it's done
  void checkCulledCellsAsync(() => isLoaded);
  if (settleDropAsync) void settleDropAsync();
};
