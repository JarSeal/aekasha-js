// Mesh decals (p309 D4, Phase 4): a decal of a pool (`RuntimeDecals.ts`) projected onto any plain
// mesh (a prop, a structure) by three's `DecalGeometry`, loaded with the first: the mesh's
// triangles clipped to a box at the decal, written into the place's patch arrays
// (`writeMeshDecalPatch`) and drawn by the pool's batch like its other decals. It reads every
// triangle of the mesh, so a terrain block's decals are `spawnDecal`'s, which reads only the cells
// under the decal.
import * as THREE from 'three/webgpu';
import { ComponentType } from 'aekasha';
import { createDecalPatchArrays, getDecalFrame, writeMeshDecalPatch } from './DecalPatch';
import type { DecalFrame, DecalPatchCounts } from './DecalPatch';
import {
  createLook,
  createPlace,
  finishSpawn,
  getLiveState,
  resolveLook,
  takePlace,
} from './RuntimeDecals';
import type { DecalPool, SpawnDecalOpts } from './RuntimeDecals';

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

const meshCounts: DecalPatchCounts = { vertexCount: 0, indexCount: 0, stride: 1 };
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
  writeMeshDecalPatch(source, meshLook.cellRect, state.lift, place.arrays, meshCounts);
  source.dispose();
  return finishSpawn(state, index, place, meshCounts, opts);
};
