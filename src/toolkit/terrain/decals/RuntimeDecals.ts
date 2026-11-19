// Runtime decals (p309 D4, Phase 4): footprints, impacts and tracks stamped while a scene runs.
// A pool is an explicit `BATCHED` merge group (p375: one render object for every decal; one
// multi-draw on WebGL2, a draw per decal on WebGPU), its decals mesh entities joined to it, each
// with its own geometry: a patch conformed to a terrain block (`DecalPatch.ts`), or a mesh's
// triangles clipped to the decal (three's `DecalGeometry`, loaded with the first), written in world
// space on an entity at the origin, so a decal is placed by its geometry alone (a `TRANSFORM`
// written outside `MAIN` would reach the batch a frame after the slot's rewrite). The pool keeps
// at most `maxDecals` entities: a spawn takes a free place (one never used, or a decal whose
// lifetime ended), else the oldest decal's, rewrites its patch in place (`updateMergeMember`, which
// also draws it last in a `JOIN` batch: on top) and keeps every slot within the group's
// `geometryReserve`, so the batch's buffers stop growing. Fades are the member's colour's opacity
// (`setMergeMemberColor`), written only on a change: a lifetime's last `fadeSec` by time (the
// pool's system, only the decals fading), and the oldest `fifoFade` decals by their place in line
// for reuse (on a spawn or an expiry), so the decal a full pool takes next is already faded out.
// Visual only: no physics, and the draws a spawn makes come from a named random stream.
import * as THREE from 'three/webgpu';
import {
  ComponentType,
  ECSSystemStage,
  createMeshEntity,
  getAtlasCell,
  getECSWorld,
  getMaterial,
  getRandomStream,
  lwarn,
  registerOnAllSceneExits,
  saveBufferGeometry,
} from 'aekasha';
import type { AtlasCellRect, ECSWorld } from 'aekasha';
import {
  addToMergeGroup,
  createMergeGroup,
  dissolveMergeGroup,
  setMergeMemberColor,
  updateMergeMember,
} from 'aekasha/merging';
import type { MergeTransparentOrder } from 'aekasha/merging';
import { getTerrainBlock } from 'aekasha/terrain';
import type { TerrainBlock } from 'aekasha/terrain';
import { readBlockSurface } from '../blocks/BlockSurface';
import type { BlockSurface } from '../blocks/BlockSurface';
import {
  createDecalPatchArrays,
  getDecalFrame,
  getDecalPatchMaxIndices,
  writeDecalPatch,
  writeMeshDecalPatch,
} from './DecalPatch';
import type { DecalFrame, DecalPatchArrays, DecalPatchCounts, DecalPatchSpec } from './DecalPatch';

const DEFAULTS = {
  maxDecals: 128,
  /** A 13 × 13 window: a 3 m decal turned 45° on a 0.5 m grid */
  maxPatchVertices: 169,
  /** Metres along the block's normals; the material's polygon offset does the coplanar work */
  lift: 0.005,
  /** After the terrain (0), before other transparents (20 and up): p309's bands */
  renderOrder: 10,
  transparentOrder: 'JOIN' as MergeTransparentOrder,
  randomStream: 'decals',
  fadeSec: 1,
};
/** A written opacity this close to the new one isn't written again */
const OPACITY_EPSILON = 1e-3;

/** How {@link createDecalPool} makes a pool. */
export type CreateDecalPoolOpts = {
  /** The pool's id, also its merge group's (unique in its world). */
  id: string;
  /** A decal material's id the scene lists (eg. the toolkit's `decalsGround_blend`): every decal of the pool draws with it. */
  material: string;
  /** The `DECAL` atlas the material samples (eg. `decalsGround`), whose cells the decals name. */
  atlas: string;
  /** The most decals at once (default 128); a spawn past it takes the oldest's place. */
  maxDecals?: number;
  /** The most vertices a decal's patch has (default 169), every slot's reserve in the batch: a decal whose block window has more takes every n-th grid line (warned once). */
  maxPatchVertices?: number;
  /** How far a patch is lifted along the block's normals, metres (default 0.005). */
  lift?: number;
  /** How many of the oldest decals fade out by their place in line for reuse (default `maxDecals / 8`, rounded; 0: none, a full pool's oldest decal goes at once). */
  fifoFade?: number;
  /** The decals' `renderOrder` (default 10: after the terrain). */
  renderOrder?: number;
  /** Whether the decals receive shadows (default true; they never cast). */
  receiveShadow?: boolean;
  /** A `BLEND` material's draw order (default `'JOIN'`: the newest on top; `'DEPTH'`: back to front). */
  transparentOrder?: MergeTransparentOrder;
  /** The random stream a spawn draws a cell from a list and a missing rotation from (default `'decals'`). */
  randomStream?: string;
  /** The pool's world (default: the default world). */
  world?: ECSWorld;
};

/** A pool of runtime decals ({@link createDecalPool}). */
export type DecalPool = {
  /** The pool's id, and its merge group's. */
  readonly id: string;
  /** The most decals at once. */
  readonly maxDecals: number;
  /** The decals drawn now: spawned, and their lifetime not over. */
  getDecalCount: () => number;
  /** Whether the pool is gone: disposed, or its scene left. */
  isDisposed: () => boolean;
  /** Deletes the pool's decals and its merge group now (its scene's exit deletes them anyway). Safe to call twice. */
  dispose: () => void;
};

/** What and where {@link spawnDecal} stamps. */
export type SpawnDecalOpts = {
  /** The terrain block it lies on (`spawnTerrainBlock`'s result). */
  target: TerrainBlock;
  /** Its centre, in world space (its height is the block's). */
  position: { x: number; z: number };
  /** The normal of its plane, along which it's projected (default the block's at its centre). */
  normal?: { x: number; y: number; z: number };
  /** The atlas cell it shows, or a list to draw one from (the pool's random stream). */
  cell: string | readonly string[];
  /** Its size in metres along u and v, or its width with the cell's aspect (default the cell's `physicalSize`). */
  size?: number | readonly [number, number];
  /** Radians around its normal, counter-clockwise seen from above (default drawn from the pool's random stream); 0 lays u along +x on flat ground. */
  rotation?: number;
  /** Multiplied into the material's colour (default white). */
  color?: THREE.ColorRepresentation;
  /** Its opacity, 0..1 (default 1), before the fades. */
  opacity?: number;
  /** Seconds it's drawn for (default: until the pool takes its place). */
  lifetimeSec?: number;
  /** Seconds its lifetime's end fades over (default 1). */
  fadeSec?: number;
};

/** What and where {@link spawnMeshDecalAsync} projects: {@link SpawnDecalOpts}' cell, look and lifetime, on a mesh. */
export type SpawnMeshDecalOpts = Omit<SpawnDecalOpts, 'target' | 'position' | 'normal'> & {
  /** The mesh entity it's projected onto (a plain mesh: not instanced, batched or skinned). */
  target: { entityId: number };
  /** Its centre on the mesh's surface, in world space. */
  position: { x: number; y: number; z: number };
  /** The surface's normal there, in world space: the decal is projected along it. */
  normal: { x: number; y: number; z: number };
  /** How far the projection reaches along the normal, metres, half each side of the centre (default the decal's larger side). */
  depth?: number;
};

/** A decal's cell, size and rotation: what both spawns resolve before their patch */
type DecalLook = { cellRect: AtlasCellRect; width: number; height: number; rotation: number };

const createLook = (): DecalLook => ({ cellRect: [0, 0, 1, 1], width: 1, height: 1, rotation: 0 });

/** A place in the pool: its decal's entity, geometry and patch arrays */
type DecalPlace = { entityId: number; geometry: THREE.BufferGeometry; arrays: DecalPatchArrays };

type PoolState = {
  pool: DecalPool;
  world: ECSWorld;
  material: string;
  atlas: string;
  maxPatchVertices: number;
  lift: number;
  fifoFade: number;
  renderOrder: number;
  receiveShadow: boolean;
  randomStream: string;
  places: DecalPlace[];
  /** The places drawn now, oldest first (`orderCount` of them) */
  order: Int32Array;
  orderCount: number;
  /** The places made and not drawn (their lifetime over) */
  free: number[];
  /** Per place: seconds drawn, lifetime (Infinity: none), fade, opacity, the FIFO's factor and
   * the opacity last written */
  age: Float32Array;
  lifetime: Float32Array;
  fadeSec: Float32Array;
  opacity: Float32Array;
  fifoFactor: Float32Array;
  written: Float32Array;
  /** The places drawn with a finite lifetime */
  timedCount: number;
  cells: Map<string, { rect: AtlasCellRect; size: readonly [number, number] | undefined }>;
  isStrideWarned: boolean;
  isDisposed: boolean;
  removeExitListener: () => void;
};

const states = new WeakMap<DecalPool, PoolState>();
/** A block's grid, read once per geometry */
const surfaces = new WeakMap<THREE.BufferGeometry, BlockSurface>();

/** `writeDecalPatch`'s spec and counts, and the colour options, reused */
const spec: DecalPatchSpec = {
  x: 0,
  z: 0,
  rotation: 0,
  width: 1,
  height: 1,
  cellRect: [0, 0, 1, 1],
  lift: 0,
  origin: { x: 0, y: 0, z: 0 },
};
const counts: DecalPatchCounts = { vertexCount: 0, indexCount: 0, stride: 1 };
const look: DecalLook = createLook();
const frame: DecalFrame = { ux: 1, uy: 0, uz: 0, vx: 0, vy: 0, vz: -1 };
/** The mesh decals' projector, reused */
const projectorPosition = new THREE.Vector3();
const projectorSize = new THREE.Vector3();
const projectorU = new THREE.Vector3();
const projectorV = new THREE.Vector3();
const projectorN = new THREE.Vector3();
const projectorBasis = new THREE.Matrix4();
const projectorEuler = new THREE.Euler();
/** three's `DecalGeometry`, loaded with the first mesh decal */
let decalGeometryModule:
  | Promise<typeof import('three/examples/jsm/geometries/DecalGeometry.js')>
  | undefined;
const colorOpts: { color?: THREE.ColorRepresentation; opacity?: number } = {};

const getSystemId = (id: string) => `decalPool:${id}`;

const checkInteger = (name: string, value: number, min: number, max: number) => {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`createDecalPool: ${name} is ${value}: use an integer from ${min} to ${max}.`);
  }
};

/**
 * Makes a pool of runtime decals: an explicit `BATCHED` merge group (`aekasha/merging`) whose
 * members are the decals {@link spawnDecal} stamps, drawn as one render object. It belongs to the
 * scene it's made in: that scene's exit deletes its decals and group, and the pool is gone.
 * @param opts the pool's id, decal material and atlas, its size and the decals' settings
 * @returns the pool: its id, size, decal count and `dispose`
 * @throws for a material the scene doesn't list, a `maxDecals`, `maxPatchVertices` or `fifoFade`
 * out of range, a merge group id taken, or without the `merging()` feature
 * @remarks The material's mode decides the batch's: a `BLEND` material's decals are sorted by
 * `transparentOrder`, a `CUTOUT` one's drawn in the opaque pass. Make the pool in the scene's code,
 * after its load: the decals' cells are read from the atlas's loaded slots.
 * @example
 * ```ts
 * import { createDecalPool, spawnDecal } from 'aekasha/toolkit/terrain';
 * import { spawnTerrainBlock } from 'aekasha/terrain';
 *
 * // A scene file's scene function: its scene JSON lists the block and the decalsGround_cutout material
 * export const scene = async () => {
 *   const block = await spawnTerrainBlock('meadow');
 *   if (!block) return;
 *   const prints = createDecalPool({ id: 'prints', material: 'decalsGround_cutout', atlas: 'decalsGround' });
 *   spawnDecal(prints, { target: block, position: { x: 2, z: -1 }, cell: 'footprintBoot', lifetimeSec: 30 });
 * };
 * ```
 */
export const createDecalPool = (opts: CreateDecalPoolOpts): DecalPool => {
  const maxDecals = opts.maxDecals ?? DEFAULTS.maxDecals;
  const maxPatchVertices = opts.maxPatchVertices ?? DEFAULTS.maxPatchVertices;
  checkInteger('maxDecals', maxDecals, 1, 65536);
  checkInteger('maxPatchVertices', maxPatchVertices, 4, 65536);
  const fifoFade = opts.fifoFade ?? Math.round(maxDecals / 8);
  checkInteger('fifoFade', fifoFade, 0, maxDecals);
  const material = getMaterial(opts.material);
  if (!material) {
    throw new Error(
      `createDecalPool: the material "${opts.material}" isn't loaded (list it in the scene JSON's materials).`
    );
  }
  const world = opts.world ?? getECSWorld();
  const receiveShadow = opts.receiveShadow ?? true;
  createMergeGroup(
    {
      id: opts.id,
      mode: 'BATCHED',
      castShadow: false,
      receiveShadow,
      geometryReserve: {
        vertices: maxPatchVertices,
        indices: getDecalPatchMaxIndices(maxPatchVertices),
      },
      ...(material.transparent
        ? { transparentOrder: opts.transparentOrder ?? DEFAULTS.transparentOrder }
        : {}),
    },
    world
  );

  const pool: DecalPool = {
    id: opts.id,
    maxDecals,
    getDecalCount: () => state.orderCount,
    isDisposed: () => state.isDisposed,
    dispose: () => {
      if (state.isDisposed) return;
      for (const place of state.places) world.deleteEntity(place.entityId);
      dissolveMergeGroup(opts.id, world);
      endPool(state);
    },
  };
  const state: PoolState = {
    pool,
    world,
    material: opts.material,
    atlas: opts.atlas,
    maxPatchVertices,
    lift: opts.lift ?? DEFAULTS.lift,
    fifoFade,
    renderOrder: opts.renderOrder ?? DEFAULTS.renderOrder,
    receiveShadow,
    randomStream: opts.randomStream ?? DEFAULTS.randomStream,
    places: [],
    order: new Int32Array(maxDecals),
    orderCount: 0,
    free: [],
    age: new Float32Array(maxDecals),
    lifetime: new Float32Array(maxDecals),
    fadeSec: new Float32Array(maxDecals),
    opacity: new Float32Array(maxDecals),
    fifoFactor: new Float32Array(maxDecals),
    written: new Float32Array(maxDecals),
    timedCount: 0,
    cells: new Map(),
    isStrideWarned: false,
    isDisposed: false,
    removeExitListener: () => {},
  };
  states.set(pool, state);
  world.addSystem(ECSSystemStage.APP_LOGIC, getSystemId(opts.id), (_world, dt) =>
    ageDecals(state, dt)
  );
  // The pool's scene's exit deletes its entities and group: the first exit after it's made
  state.removeExitListener = registerOnAllSceneExits(getSystemId(opts.id), () => endPool(state));
  return pool;
};

/** The pool's system and exit listener gone, the pool marked disposed */
const endPool = (state: PoolState) => {
  state.isDisposed = true;
  state.world.removeSystem(getSystemId(state.pool.id));
  state.removeExitListener();
};

/**
 * Stamps a decal on a terrain block: a patch of the block's own grid around `position` (so it
 * follows the block exactly), the cell's UVs projected along `normal`, drawn by the pool's batch.
 * A full pool takes its oldest decal's place (faded out first by `fifoFade`).
 * @param pool the pool ({@link createDecalPool})
 * @param opts the block, the place, the cell and the decal's look and lifetime
 * @returns the decal's mesh entity, or `null` when its centre is off the block or the pool is gone
 * @throws for a block the scene doesn't list, a cell the atlas doesn't have (or isn't loaded), or a
 * size it can't take
 * @remarks A decal is cut at the block's edge: stamp one on each block for a decal across two. A
 * `normal` far off the block's can leave a corner of the decal uncovered (the patch's window is the
 * cells under its corners). The draws (a cell from a list, then a missing rotation) come from the
 * pool's random stream, so a replayed scene stamps the same decals.
 * @example
 * ```ts
 * import { spawnDecal } from 'aekasha/toolkit/terrain';
 *
 * // A step's print, left or right of the walker, gone after 20 s
 * spawnDecal(prints, {
 *   target: block,
 *   position: { x: foot.x, z: foot.z },
 *   rotation: heading,
 *   cell: 'footprintBoot',
 *   lifetimeSec: 20,
 *   fadeSec: 4,
 * });
 * ```
 */
export const spawnDecal = (pool: DecalPool, opts: SpawnDecalOpts): number | null => {
  const state = getLiveState(pool, 'spawnDecal');
  if (!state) return null;
  const { target } = opts;
  const block = getTerrainBlock(target.id);
  if (!block) {
    throw new Error(`spawnDecal: the scene doesn't list the terrain block "${target.id}".`);
  }
  const mesh = state.world.getComponent(target.meshEntityId, ComponentType.OBJECT3D)?.value as
    | THREE.Mesh
    | undefined;
  if (!mesh?.geometry) {
    lwarn(`spawnDecal: the terrain block "${target.id}" has no mesh (deleted?).`);
    return null;
  }
  const { size, x: gridX, z: gridZ } = block.grid;
  const originX = gridX * size;
  const originZ = gridZ * size;
  const localX = opts.position.x - originX;
  const localZ = opts.position.z - originZ;
  const half = size / 2;
  if (Math.abs(localX) > half || Math.abs(localZ) > half) return null;

  let surface = surfaces.get(mesh.geometry);
  if (!surface) {
    surface = readBlockSurface(mesh.geometry, size, `spawnDecal: the terrain block "${target.id}"`);
    surfaces.set(mesh.geometry, surface);
  }
  resolveLook(state, opts, look, 'spawnDecal');
  spec.x = localX;
  spec.z = localZ;
  spec.normal = opts.normal;
  spec.rotation = look.rotation;
  spec.width = look.width;
  spec.height = look.height;
  spec.cellRect = look.cellRect;
  spec.lift = state.lift;
  spec.origin.x = originX;
  spec.origin.z = originZ;

  const index = takePlace(state);
  const place = state.places[index] ?? createPlace(state);
  writeDecalPatch(surface, spec, place.arrays, counts);
  if (counts.stride > 1 && !state.isStrideWarned) {
    state.isStrideWarned = true;
    lwarn(
      `spawnDecal: a decal of the pool "${pool.id}" covers more of the block's grid than its maxPatchVertices (${state.maxPatchVertices}) holds: it takes every ${counts.stride}th grid line, no longer on the block's triangles (raise maxPatchVertices or the lift).`
    );
  }
  return finishSpawn(state, index, place, opts);
};

/**
 * Projects a decal onto a mesh: three's `DecalGeometry` (its code loaded with the first call) clips
 * the mesh's triangles to a box at `position`, `normal` its depth, and the clipped triangles are the
 * decal, drawn by the pool's batch like a block's. For props and structures: it reads every
 * triangle of the mesh, so it costs with the mesh's size (a terrain block's decals are
 * {@link spawnDecal}'s, which reads only the cells under the decal).
 * @param pool the pool ({@link createDecalPool})
 * @param opts the mesh entity, the place and its normal, the cell and the decal's look and lifetime
 * @returns the decal's mesh entity, or `null` when the decal misses the mesh, the mesh entity is
 * gone or the pool is (also when either went during the code's load)
 * @throws for a mesh that isn't a plain one (instanced, batched or skinned), a decal of more than
 * 65 536 vertices, a cell the atlas doesn't have (or isn't loaded), or a size it can't take
 * @remarks The cell and a missing rotation are drawn from the pool's random stream at the call,
 * before the load; overlapping calls stamp in call order. A decal with more vertices than the
 * pool's `maxPatchVertices` takes a larger slot in the batch, whose buffers then grow once (its
 * place keeps it). The box projects through the whole mesh along the normal over `depth`: a thin
 * mesh's back faces inside it get the decal too.
 * @example
 * ```ts
 * import { spawnMeshDecalAsync } from 'aekasha/toolkit/terrain';
 *
 * // A scorch where a shot hit a crate (the raycast's point and face normal, in world space)
 * await spawnMeshDecalAsync(scorches, {
 *   target: { entityId: crateId },
 *   position: hit.point,
 *   normal: hit.normal,
 *   cell: 'scorch',
 *   size: 0.6,
 * });
 * ```
 */
export const spawnMeshDecalAsync = async (
  pool: DecalPool,
  opts: SpawnMeshDecalOpts
): Promise<number | null> => {
  const where = 'spawnMeshDecalAsync';
  const before = getLiveState(pool, where);
  if (!before) return null;
  const meshLook = resolveLook(before, opts, createLook(), where);
  const { DecalGeometry } = await (decalGeometryModule ??= import(
    'three/examples/jsm/geometries/DecalGeometry.js'
  ));
  const state = getLiveState(pool, where);
  if (!state) return null;
  const mesh = state.world.getComponent(opts.target.entityId, ComponentType.OBJECT3D)?.value as
    | THREE.Mesh
    | undefined;
  if (!mesh?.isMesh || !state.world.isAlive(opts.target.entityId)) return null;
  const kind = mesh as THREE.Mesh & {
    isInstancedMesh?: boolean;
    isBatchedMesh?: boolean;
    isSkinnedMesh?: boolean;
  };
  if (kind.isInstancedMesh || kind.isBatchedMesh || kind.isSkinnedMesh) {
    throw new Error(
      `${where}: the entity ${opts.target.entityId} isn't a plain mesh (instanced, batched or skinned): a decal can't be projected onto it.`
    );
  }

  const { normal, position } = opts;
  const length = Math.hypot(normal.x, normal.y, normal.z) || 1;
  getDecalFrame(normal.x / length, normal.y / length, normal.z / length, meshLook.rotation, frame);
  projectorBasis.makeBasis(
    projectorU.set(frame.ux, frame.uy, frame.uz),
    projectorV.set(frame.vx, frame.vy, frame.vz),
    projectorN.set(normal.x / length, normal.y / length, normal.z / length)
  );
  projectorEuler.setFromRotationMatrix(projectorBasis);
  projectorSize.set(
    meshLook.width,
    meshLook.height,
    opts.depth ?? Math.max(meshLook.width, meshLook.height)
  );
  // A member of a merge group is out of the scene graph: nothing else updates its matrix
  mesh.updateWorldMatrix(true, false);
  const source = new DecalGeometry(
    mesh,
    projectorPosition.set(position.x, position.y, position.z),
    projectorEuler,
    projectorSize
  );
  const vertexCount = source.getAttribute('position').count;
  if (!vertexCount) {
    source.dispose();
    return null;
  }
  if (vertexCount > 65536) {
    source.dispose();
    throw new Error(
      `${where}: the decal has ${vertexCount} vertices on the entity ${opts.target.entityId}, over the 65 536 a patch takes (a smaller decal or depth).`
    );
  }
  const index = takePlace(state);
  const place = state.places[index] ?? createPlace(state);
  if (vertexCount * 3 > place.arrays.positions.length) {
    place.arrays = createDecalPatchArrays(Math.max(vertexCount, 4));
  }
  writeMeshDecalPatch(source, meshLook.cellRect, state.lift, place.arrays, counts);
  source.dispose();
  return finishSpawn(state, index, place, opts);
};

/** The pool's state while it lives; a warning and undefined once it's gone */
const getLiveState = (pool: DecalPool, where: string) => {
  const state = states.get(pool);
  if (state && !state.isDisposed) return state;
  lwarn(`${where}: the decal pool "${pool.id}" is gone (disposed, or its scene left).`);
  return undefined;
};

/** Resolves the cell (a list's drawn from the random stream), then the size and the rotation (a
 * missing one drawn) into `out` */
const resolveLook = (
  state: PoolState,
  opts: Pick<SpawnDecalOpts, 'cell' | 'size' | 'rotation'>,
  out: DecalLook,
  where: string
) => {
  const random = getRandomStream(state.randomStream);
  const cellId =
    typeof opts.cell === 'string' ? opts.cell : opts.cell[Math.floor(random() * opts.cell.length)];
  const cell = getCell(state, cellId, where);
  out.cellRect = cell.rect;
  setDecalSize(cellId, cell.size, opts.size, out, where);
  out.rotation = opts.rotation ?? random() * Math.PI * 2;
  return out;
};

/** A spawn's end: the place's geometry from its arrays, its entity made and joined (a new place)
 * or shown and its slot rewritten, its lifetime, colour and the FIFO's fades */
const finishSpawn = (
  state: PoolState,
  index: number,
  place: DecalPlace,
  opts: Pick<SpawnDecalOpts, 'color' | 'opacity' | 'lifetimeSec' | 'fadeSec'>
) => {
  const { world, pool } = state;
  setPatchAttributes(place.geometry, place.arrays, counts);
  if (index < state.places.length) {
    if (world.isDisabled(place.entityId)) world.setDisabled(place.entityId, false);
    updateMergeMember(place.entityId, world);
  } else {
    place.entityId = createMeshEntity(
      {
        geo: saveBufferGeometry(place.geometry),
        mat: state.material,
        castShadow: false,
        receiveShadow: state.receiveShadow,
        renderOrder: state.renderOrder,
      },
      { world, appId: `decalPool/${pool.id}/${index}` }
    );
    state.places.push(place);
    addToMergeGroup(pool.id, [place.entityId], world);
  }

  const lifetime = opts.lifetimeSec ?? Infinity;
  if (lifetime !== Infinity) state.timedCount++;
  state.age[index] = 0;
  state.lifetime[index] = lifetime;
  state.fadeSec[index] = opts.fadeSec ?? DEFAULTS.fadeSec;
  state.opacity[index] = opts.opacity ?? 1;
  state.fifoFactor[index] = 1;
  state.order[state.orderCount++] = index;
  colorOpts.color = opts.color ?? 0xffffff;
  writeOpacity(state, index, true);
  colorOpts.color = undefined;
  writeFifoFades(state);
  return place.entityId;
};

/** A cell's UV rect and physical size, from the atlas's table once */
const getCell = (state: PoolState, cellId: string, where: string) => {
  let cell = state.cells.get(cellId);
  if (cell) return cell;
  const info = getAtlasCell(state.atlas, cellId);
  if (!info) {
    throw new Error(
      `${where}: the atlas "${state.atlas}" has no cell "${cellId}" (or no slot of it is loaded: list the pool's material in the scene JSON).`
    );
  }
  const physicalSize = (info.data as { physicalSize?: unknown } | undefined)?.physicalSize;
  cell = {
    rect: info.uv,
    size:
      typeof physicalSize === 'number'
        ? [physicalSize, physicalSize]
        : Array.isArray(physicalSize)
          ? (physicalSize as [number, number])
          : undefined,
  };
  state.cells.set(cellId, cell);
  return cell;
};

/** A decal's width and height into `out`: the option's, else the cell's physical size */
const setDecalSize = (
  cellId: string,
  cellSize: readonly [number, number] | undefined,
  size: SpawnDecalOpts['size'],
  out: DecalLook,
  where: string
) => {
  if (Array.isArray(size)) {
    out.width = size[0];
    out.height = size[1];
  } else if (typeof size === 'number') {
    out.width = size;
    out.height = cellSize ? (size * cellSize[1]) / cellSize[0] : size;
  } else if (cellSize) {
    out.width = cellSize[0];
    out.height = cellSize[1];
  } else {
    throw new Error(
      `${where}: the cell "${cellId}" has no physicalSize in its data: give the decal a size.`
    );
  }
  if (!(out.width > 0) || !(out.height > 0)) {
    throw new Error(
      `${where}: the decal "${cellId}" is ${out.width} × ${out.height} m: give it a size over 0.`
    );
  }
};

/** The place a spawn takes: a free one, a new one, else the oldest drawn (out of the line) */
const takePlace = (state: PoolState) => {
  if (state.free.length) return state.free.pop()!;
  if (state.places.length < state.pool.maxDecals) return state.places.length;
  const index = state.order[0];
  removeFromOrder(state, 0);
  if (state.lifetime[index] !== Infinity) state.timedCount--;
  return index;
};

/** A new place's arrays and geometry (its entity made by the spawn) */
const createPlace = (state: PoolState): DecalPlace => ({
  entityId: -1,
  geometry: new THREE.BufferGeometry(),
  arrays: createDecalPatchArrays(state.maxPatchVertices),
});

const removeFromOrder = (state: PoolState, rank: number) => {
  state.order.copyWithin(rank, rank + 1, state.orderCount);
  state.orderCount--;
};

/** One attribute over its array's used part: the same attribute when its count is (the data is
 * written in place), else a new view (three's batch copies a source's whole array) */
const setView = (
  geometry: THREE.BufferGeometry,
  name: string,
  array: Float32Array,
  itemSize: number,
  count: number
) => {
  const attribute = geometry.getAttribute(name) as THREE.BufferAttribute | undefined;
  if (attribute?.count === count) {
    attribute.needsUpdate = true;
    return;
  }
  geometry.setAttribute(
    name,
    new THREE.BufferAttribute(array.subarray(0, count * itemSize), itemSize)
  );
};

const setPatchAttributes = (
  geometry: THREE.BufferGeometry,
  arrays: DecalPatchArrays,
  { vertexCount, indexCount }: DecalPatchCounts
) => {
  setView(geometry, 'position', arrays.positions, 3, vertexCount);
  setView(geometry, 'normal', arrays.normals, 3, vertexCount);
  setView(geometry, 'uv', arrays.uvs, 2, vertexCount);
  setView(geometry, 'uv1', arrays.decalUvs, 2, vertexCount);
  if (geometry.index?.count === indexCount) geometry.index.needsUpdate = true;
  else geometry.setIndex(new THREE.BufferAttribute(arrays.indices.subarray(0, indexCount), 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
};

/** A decal's opacity: its own × its FIFO factor × its lifetime's fade; written on a change (or
 * `force`, with `colorOpts.color`) */
const writeOpacity = (state: PoolState, index: number, force = false) => {
  const remaining = state.lifetime[index] - state.age[index];
  const fade = state.fadeSec[index];
  const timeFactor = remaining >= fade ? 1 : fade > 0 ? Math.max(0, remaining / fade) : 0;
  const opacity = state.opacity[index] * state.fifoFactor[index] * timeFactor;
  if (!force && Math.abs(opacity - state.written[index]) < OPACITY_EPSILON) return;
  state.written[index] = opacity;
  colorOpts.opacity = opacity;
  setMergeMemberColor(state.places[index].entityId, colorOpts, state.world);
};

/** The oldest `fifoFade` decals' opacity by how many spawns are left before their place is taken */
const writeFifoFades = (state: PoolState) => {
  const { fifoFade, order } = state;
  const available = state.free.length + state.pool.maxDecals - state.places.length;
  const band = Math.min(fifoFade, state.orderCount);
  for (let rank = 0; rank < band; rank++) {
    const index = order[rank];
    const factor = Math.min(1, (available + rank + 1) / (fifoFade + 1));
    if (factor === state.fifoFactor[index]) continue;
    state.fifoFactor[index] = factor;
    writeOpacity(state, index);
  }
};

/** The pool's system: the lifetimes' ages, their fades, and the decals whose lifetime ended
 * hidden (`DISABLED`) and their places freed. Allocates nothing. */
const ageDecals = (state: PoolState, dt: number) => {
  if (!state.timedCount) return;
  let hasExpired = false;
  for (let rank = 0; rank < state.orderCount; rank++) {
    const index = state.order[rank];
    const lifetime = state.lifetime[index];
    if (lifetime === Infinity) continue;
    const age = (state.age[index] += dt);
    if (age < lifetime) {
      if (lifetime - age < state.fadeSec[index]) writeOpacity(state, index);
      continue;
    }
    state.world.setDisabled(state.places[index].entityId, true);
    state.free.push(index);
    state.timedCount--;
    removeFromOrder(state, rank);
    rank--;
    hasExpired = true;
  }
  if (hasExpired) writeFifoFades(state);
};
