// A scatter's colliders (p308 D2): loaded by `spawnScatter` with the first scatter that has a
// collider item, so the instancing feature's own code imports no physics, and an app without
// `physics()` loads none. A feature → feature runtime import after character → physics and
// terrain → physics; physics never imports instancing.
import * as THREE from 'three/webgpu';
import { getGeometry } from '../../kernel/assets/Geometry';
import type { ECSWorld } from '../../kernel/ecs/ECS';
import { createPhysicsEntity } from '../physics/PhysicsEntity';
import type { ColliderParams } from '../physics/types/PhysicsColliderTypes';
import type { ScatterItemDef } from './ScatterSchema';

const MATRIX_SIZE = 16;

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();

/** An item's shape before an instance's scale: a hull's points (each once) or a ball */
type ItemShape =
  | { type: 'CONVEXHULL'; points: Float32Array }
  | { type: 'BALL'; radius: number; center: THREE.Vector3 }
  | null;

/** The geometry's positions, each point once (a faceted geometry repeats them per face) */
const getHullPoints = (geometry: THREE.BufferGeometry) => {
  const position = geometry.getAttribute('position');
  const seen = new Set<string>();
  const points: number[] = [];
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const key = `${x},${y},${z}`;
    if (seen.has(key)) continue;
    seen.add(key);
    points.push(x, y, z);
  }
  return Float32Array.from(points);
};

/** Each item's shape (null without a collider); throws naming the scatter and the item */
const getItemShapes = (scatterId: string, items: readonly ScatterItemDef[]): ItemShape[] =>
  items.map((item, index) => {
    if (item.collider === 'NONE') return null;
    const geometry = getGeometry(item.geometry);
    if (!geometry) {
      throw new Error(
        `spawnScatter: the scatter "${scatterId}"'s item ${index} has a collider, but its geometry "${item.geometry}" isn't registered.`
      );
    }
    if (item.collider === 'CONVEXHULL')
      return { type: 'CONVEXHULL', points: getHullPoints(geometry) };
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere!;
    return { type: 'BALL', radius: sphere.radius, center: sphere.center.clone() };
  });

/** An instance's collider: the item's shape at its scale (Rapier's shapes don't scale) */
const toCollider = (shape: NonNullable<ItemShape>, scale: THREE.Vector3): ColliderParams => {
  if (shape.type === 'CONVEXHULL') {
    const vertices = new Float32Array(shape.points.length);
    for (let i = 0; i < vertices.length; i += 3) {
      vertices[i] = shape.points[i] * scale.x;
      vertices[i + 1] = shape.points[i + 1] * scale.y;
      vertices[i + 2] = shape.points[i + 2] * scale.z;
    }
    return { type: 'CONVEXHULL', vertices };
  }
  const largest = Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
  return {
    type: 'BALL',
    radius: shape.radius * largest,
    translation: {
      x: shape.center.x * scale.x,
      y: shape.center.y * scale.y,
      z: shape.center.z * scale.z,
    },
  };
};

/**
 * A scatter's colliders: a `FIXED` body per instance of an item with a `collider`, at the
 * instance's position and rotation, its shape scaled as the instance is, no visual. Every create is
 * requested before the first is awaited, in instance order, so the bodies are made in that order
 * on either worker target (the scene load's determinism).
 * @internal
 * @param scatterId the scatter's id, for the errors
 * @param items each item's geometry and collider type
 * @param matrices every instance's world matrix
 * @param picked every instance's item
 * @param world the world they're made in
 * @returns the physics entities, in instance order
 * @throws (rejects) when an item's geometry isn't registered, or a create fails (the others are
 * deleted first)
 */
export const createScatterCollidersAsync = async (
  scatterId: string,
  items: readonly ScatterItemDef[],
  matrices: Float32Array,
  picked: Int16Array,
  world: ECSWorld
): Promise<number[]> => {
  const shapes = getItemShapes(scatterId, items);
  const creates: Promise<number>[] = [];
  for (let i = 0; i < picked.length; i++) {
    const shape = shapes[picked[i]];
    if (!shape) continue;
    _matrix.fromArray(matrices, i * MATRIX_SIZE).decompose(_position, _quaternion, _scale);
    creates.push(
      createPhysicsEntity(
        {
          colliders: toCollider(shape, _scale),
          body: {
            rigidType: 'FIXED',
            translation: { x: _position.x, y: _position.y, z: _position.z },
            rotation: { x: _quaternion.x, y: _quaternion.y, z: _quaternion.z, w: _quaternion.w },
          },
        },
        { world }
      )
    );
  }
  const results = await Promise.allSettled(creates);
  const failed = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );
  const entityIds = results.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : []
  );
  if (failed) {
    for (const entityId of entityIds) world.deleteEntity(entityId);
    const reason = failed.reason instanceof Error ? failed.reason.message : String(failed.reason);
    throw new Error(`spawnScatter: the scatter "${scatterId}"'s colliders: ${reason}`);
  }
  return entityIds;
};
