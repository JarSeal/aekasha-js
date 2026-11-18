import * as THREE from 'three/webgpu';
import { ComponentType, createMeshEntity, getECSWorld, lerror, llog } from 'aekasha';
import {
  getScatter,
  getScatterGenerator,
  spawnScatter,
  type ScatterGeneratorInput,
} from 'aekasha/instancing';
import { createPhysicsEntity, getPhysicsSimClock } from 'aekasha/physics';
import { spawnTerrainBlock } from 'aekasha/terrain';
import { nextFrames } from '../../shared/verifyHarness';

/**
 * p308 Phase 3's part of `scatterTest`: the rules block (`scatterTestRulesBlock`, a `rulesTerrain`
 * block behind the flat one: rock on its slopes in its vertex colour's R, sand on its flats) with
 * two scatters by the toolkit's `terrainScatter`: pebbles masked to the rock layer and slabs on the
 * sand, each slab with a `CONVEXHULL` collider. The checks log an error, which fails the scene
 * runner: no pebble on ground with no rock under it and the pebbles' ground much rockier than the
 * block's, a second spawn of the pebbles on the same target placing every one the same, a collider
 * per slab, and a box dropped on a slab resting on its top by `SETTLE_STEPS`.
 */

const BLOCK_ID = 'scatterTestRulesBlock';
const PEBBLES_ID = 'scatterTestRulesPebbles';
const SLABS_ID = 'scatterTestRulesSlabs';
/** The block's mesh app id, its scatters' cells' app ids under it */
const BLOCK_APP_ID = `terrainBlock/${BLOCK_ID}`;
/** The second spawn's cells' app ids */
const REPEAT_APP_ID = 'scatterTestRepeat';
/** The pebbles' ground's rock weight (its R, 0..1) on average, at least, and the share over the
 * block's average */
const MIN_PEBBLE_ROCK = 0.6;
/** The dropped box's half side and its drop over the slab's top */
const DROP_HALF = 0.2;
const DROP_HEIGHT = 1.5;
/** Fixed steps until the box rests (the fall takes about 35), short of the probe's 120 */
const SETTLE_STEPS = 110;
/** How far the box may rest from the slab's top */
const REST_TOLERANCE = 0.08;

/**
 * What the rules part found, in `window.__scatterTest.rules`.
 */
export type RulesScatterState = {
  pebbles: number;
  /** The pebbles' ground's rock weight on average, and the block's vertices' */
  pebbleRock: number;
  blockRock: number;
  /** Pebbles over a cell with no rock at any corner */
  pebblesOffRock: number;
  /** Pebbles the second spawn placed differently (all of them when the counts differ) */
  repeatMismatches: number;
  /** The generator's time for the pebbles, in the browser, ms */
  generateMs: number;
  slabs: number;
  colliders: number;
  /** The dropped box's height over the slab's top less its half side once it settled (0 rests) */
  dropOffset: number;
};

export const createRulesScatterState = (): RulesScatterState => ({
  pebbles: 0,
  pebbleRock: 0,
  blockRock: 0,
  pebblesOffRock: -1,
  repeatMismatches: -1,
  generateMs: 0,
  slabs: 0,
  colliders: 0,
  dropOffset: NaN,
});

/** The instances of the cells whose app ids start `prefix`: each world matrix's elements, sorted by
 * position */
const readWorldMatrices = (entityIds: readonly number[], prefix: string) => {
  const world = getECSWorld();
  const matrix = new THREE.Matrix4();
  const cellMatrix = new THREE.Matrix4();
  const matrices: number[][] = [];
  for (const entityId of entityIds) {
    const appId = world.getComponent(entityId, ComponentType.APP_ID)?.id ?? '';
    if (!appId.startsWith(prefix)) continue;
    const mesh = world.getComponent(entityId, ComponentType.OBJECT3D)?.value as THREE.InstancedMesh;
    const cell = world.getComponent(entityId, ComponentType.TRANSFORM)!.position;
    cellMatrix.makeTranslation(cell.x, cell.y, cell.z);
    for (let i = 0; i < mesh.count; i++) {
      matrices.push([...matrix.multiplyMatrices(cellMatrix, mesh.getMatrixAt(i, matrix)).elements]);
    }
  }
  return matrices.sort((a, b) => a[12] - b[12] || a[14] - b[14]);
};

/** The block's rock weight (its colour's R) at each grid point, and the grid's place */
const readBlockRock = (meshEntityId: number) => {
  const mesh = getECSWorld().getComponent(meshEntityId, ComponentType.OBJECT3D)
    ?.value as THREE.Mesh;
  const colors = mesh.geometry.getAttribute('color');
  const resolution = Math.round(Math.sqrt(colors.count));
  const rock = Float32Array.from({ length: resolution * resolution }, (_, i) => colors.getX(i));
  return { rock, resolution, center: mesh.position };
};

/** The pebbles' ground: how many sit over a cell with no rock at any corner, and its rock on
 * average (the nearest grid point's) */
const measurePebbleGround = (
  pebbles: number[][],
  { rock, resolution, center }: ReturnType<typeof readBlockRock>,
  size: number
) => {
  const spacing = size / (resolution - 1);
  let offRock = 0;
  let sum = 0;
  for (const elements of pebbles) {
    const u = (elements[12] - center.x + size / 2) / spacing;
    const v = (elements[14] - center.z + size / 2) / spacing;
    const col = Math.min(resolution - 2, Math.floor(u));
    const row = Math.min(resolution - 2, Math.floor(v));
    const at = (r: number, c: number) => rock[r * resolution + c];
    if (!(at(row, col) || at(row, col + 1) || at(row + 1, col) || at(row + 1, col + 1))) offRock++;
    sum += at(Math.round(v), Math.round(u));
  }
  return { offRock, average: pebbles.length ? sum / pebbles.length : 0 };
};

/** The two spawns' instances pair by pair: how many differ at all */
const countMismatches = (a: number[][], b: number[][]) =>
  a.length !== b.length
    ? Math.max(a.length, b.length)
    : a.filter((elements, i) => elements.some((value, e) => value !== b[i][e])).length;

/** The pebbles' generator timed alone, on the block (its code loaded with the block's spawn) */
const timeGeneratorAsync = async (target: ScatterGeneratorInput['target']) => {
  const def = getScatter(PEBBLES_ID);
  const generator = getScatterGenerator('terrainScatter');
  if (!def || def.source.type !== 'PROCEDURAL' || !generator) return NaN;
  const start = performance.now();
  await generator({
    scatterId: def.id,
    params: def.source.params,
    seed: 1,
    items: def.items,
    target,
    world: getECSWorld(),
  });
  return performance.now() - start;
};

/** The first slab's top centre: its origin and its box's top, upright (`alignToNormal` 0) */
const getSlabTop = (slabs: number[][]) => {
  const [elements] = slabs;
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  new THREE.Matrix4().fromArray(elements).decompose(position, new THREE.Quaternion(), scale);
  // The slab geometry is 0.7 m high, centred
  return position.setY(position.y + 0.35 * scale.y);
};

/** A box dropped `DROP_HEIGHT` over the slab's top: where it rests once `SETTLE_STEPS` ran */
const dropOnSlabAsync = async (top: THREE.Vector3, isCurrent: () => boolean) => {
  const position = { x: top.x, y: top.y + DROP_HALF + DROP_HEIGHT, z: top.z };
  const meshId = createMeshEntity({
    geo: {
      type: 'BOX',
      params: { width: DROP_HALF * 2, height: DROP_HALF * 2, depth: DROP_HALF * 2 },
    },
    mat: 'scatterTestStone',
    castShadow: true,
    receiveShadow: true,
    position,
    appId: 'scatterTestDrop',
  });
  await createPhysicsEntity({
    colliders: { type: 'BOX', friction: 1 },
    body: { rigidType: 'DYNAMIC' },
    target: meshId,
  });
  return async () => {
    while (getPhysicsSimClock() < SETTLE_STEPS) {
      await nextFrames(1);
      if (!isCurrent()) return NaN;
    }
    const rest = getECSWorld().getComponent(meshId, ComponentType.TRANSFORM)?.position;
    return rest ? rest.y - DROP_HALF - top.y : NaN;
  };
};

/**
 * Spawns the rules block with its scatters and runs the checks but the drop's, which the returned
 * function awaits (after the load: physics steps once the scene is in). Null when the scene was
 * left meanwhile.
 */
export const spawnRulesScatterAsync = async (
  state: RulesScatterState,
  isCurrent: () => boolean
) => {
  const block = await spawnTerrainBlock(BLOCK_ID);
  if (!block || !isCurrent()) return null;
  const world = getECSWorld();
  const size = 64;
  const center = world.getComponent(block.meshEntityId, ComponentType.TRANSFORM)!.position;
  const target = {
    position: { x: center.x, y: 0, z: center.z },
    grid: { x: 0, z: -1 },
    size,
    entityId: block.meshEntityId,
  };

  const pebbles = readWorldMatrices(block.scatterIds, `${BLOCK_APP_ID}/scatter/${PEBBLES_ID}/`);
  const slabs = readWorldMatrices(block.scatterIds, `${BLOCK_APP_ID}/scatter/${SLABS_ID}/`);
  const blockRock = readBlockRock(block.meshEntityId);
  const ground = measurePebbleGround(pebbles, blockRock, size);
  Object.assign(state, {
    pebbles: pebbles.length,
    pebbleRock: ground.average,
    blockRock: blockRock.rock.reduce((sum, value) => sum + value, 0) / blockRock.rock.length,
    pebblesOffRock: ground.offRock,
    slabs: slabs.length,
    colliders: block.scatterIds.filter((id) => !world.hasComponent(id, ComponentType.OBJECT3D))
      .length,
  });

  // The same scatter on the same target again: every pebble where it was
  const repeat = await spawnScatter(PEBBLES_ID, { target, appId: REPEAT_APP_ID });
  if (!repeat || !isCurrent()) return null;
  state.repeatMismatches = countMismatches(
    pebbles,
    readWorldMatrices(repeat.entityIds, `${REPEAT_APP_ID}/`)
  );
  repeat.dispose();
  state.generateMs = await timeGeneratorAsync(target);
  if (!isCurrent()) return null;
  llog(
    `scatterTest: terrainScatter placed ${state.pebbles} pebbles in ${state.generateMs.toFixed(1)} ms, ${state.slabs} slabs with ${state.colliders} colliders.`
  );

  const problems: string[] = [];
  if (!state.pebbles || state.pebblesOffRock) {
    problems.push(`${state.pebbles} pebbles, ${state.pebblesOffRock} of them off the rock`);
  }
  if (state.pebbleRock < MIN_PEBBLE_ROCK || state.pebbleRock < state.blockRock * 1.5) {
    problems.push(
      `the pebbles' ground is ${state.pebbleRock.toFixed(2)} rock, the block's ${state.blockRock.toFixed(2)}`
    );
  }
  if (state.repeatMismatches) {
    problems.push(`a second spawn placed ${state.repeatMismatches} pebbles differently`);
  }
  if (!state.slabs || state.colliders !== state.slabs) {
    problems.push(`${state.slabs} slabs with ${state.colliders} colliders`);
  }
  if (problems.length) lerror(`scatterTest: the rules block's scatters: ${problems.join('; ')}.`);
  if (!slabs.length) return null;

  const settleAsync = await dropOnSlabAsync(getSlabTop(slabs), isCurrent);
  return async () => {
    state.dropOffset = await settleAsync();
    if (!isCurrent()) return;
    if (!(Math.abs(state.dropOffset) <= REST_TOLERANCE)) {
      lerror(
        `scatterTest: the box dropped on a slab rests ${state.dropOffset.toFixed(2)} m from its top (its collider should hold it).`
      );
    }
  };
};
