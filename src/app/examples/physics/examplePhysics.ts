import * as THREE from 'three/webgpu';
import { createActionMap, createMeshEntity, getECSWorld, getRandomStream } from 'aekasha';
import type { GeoProps, MatProps } from 'aekasha';
import { createPhysicsEntity } from 'aekasha/physics';
import type { ColliderParams } from 'aekasha/physics';
import { createExampleHud } from '../exampleHud';

const SCENE_ID = 'examplePhysics';
/** The oldest dropped shape is deleted past this many */
const MAX_SHAPES = 80;

// #region physics-shapes (shown in the Hub: hub/pages/examples/physics/)
type Shape = { geo: GeoProps; mat: MatProps; collider: ColliderParams };

// A mesh and a collider of the same size. The ids register each geometry and material once:
// every shape of a kind shares them.
const SHAPES: Shape[] = [
  {
    geo: { id: 'physicsBox', type: 'BOX', params: { width: 1, height: 1, depth: 1 } },
    mat: { id: 'physicsBox', type: 'STANDARD', params: { color: '#e8833a' } },
    collider: { type: 'BOX', hx: 0.5, hy: 0.5, hz: 0.5 },
  },
  {
    geo: { id: 'physicsBall', type: 'SPHERE', params: { radius: 0.5 } },
    mat: { id: 'physicsBall', type: 'STANDARD', params: { color: '#4fa3d9' } },
    collider: { type: 'BALL', radius: 0.5, restitution: 0.5 },
  },
  {
    // three's capsule height is the straight part's, Rapier's halfHeight is half of it
    geo: { id: 'physicsCapsule', type: 'CAPSULE', params: { radius: 0.35, height: 0.7 } },
    mat: { id: 'physicsCapsule', type: 'STANDARD', params: { color: '#7cc46b' } },
    collider: { type: 'CAPSULE', radius: 0.35, halfHeight: 0.35 },
  },
  {
    geo: {
      id: 'physicsCylinder',
      type: 'CYLINDER',
      params: { radiusTop: 0.45, radiusBottom: 0.45, height: 1, radialSegments: 24 },
    },
    mat: { id: 'physicsCylinder', type: 'STANDARD', params: { color: '#c26bc4' } },
    collider: { type: 'CYLINDER', radius: 0.45, halfHeight: 0.5 },
  },
];
// #endregion physics-shapes

// #region physics-drop (shown in the Hub: hub/pages/examples/physics/)
const tmpEuler = new THREE.Euler();

/** A mesh entity, then a dynamic Rapier body attached to it: physics moves the mesh */
const dropShape = async (shape: Shape, position: { x: number; y: number; z: number }) => {
  const entityId = createMeshEntity({
    geo: shape.geo,
    mat: shape.mat,
    position,
    castShadow: true,
    receiveShadow: true,
  });
  const tilt = new THREE.Quaternion().setFromEuler(tmpEuler.set(position.z, 0, position.x));
  await createPhysicsEntity(
    shape.collider,
    { rigidType: 'DYNAMIC', translation: position, rotation: tilt },
    entityId
  );
  return entityId;
};
// #endregion physics-drop

// #region physics-scene (shown in the Hub: hub/pages/examples/physics/)
export const scene = async () => {
  // The ground: a mesh with a FIXED body, which nothing moves
  const groundId = createMeshEntity({
    geo: { id: 'physicsGround', type: 'BOX', params: { width: 20, height: 0.5, depth: 20 } },
    mat: { id: 'physicsGround', type: 'STANDARD', params: { color: '#59606e' } },
    position: { y: -0.25 },
    receiveShadow: true,
  });
  await createPhysicsEntity(
    { type: 'BOX', hx: 10, hy: 0.25, hz: 10 },
    { rigidType: 'FIXED', translation: { x: 0, y: -0.25, z: 0 } },
    groundId
  );

  // One of each, in a row: the same drop on every visit (scene loads are deterministic)
  const dropped = await Promise.all(
    SHAPES.map((shape, i) => dropShape(shape, { x: (i - 1.5) * 2, y: 3 + i, z: 0.3 * i }))
  );

  // A random shape: a named stream restarts with every load, so the drops come in the same order
  const random = getRandomStream('examplePhysics:drops');
  const dropRandomShape = async () => {
    const shape = SHAPES[Math.floor(random() * SHAPES.length)];
    const position = { x: random() * 8 - 4, y: 8, z: random() * 8 - 4 };
    dropped.push(await dropShape(shape, position));
    // Deleting the entity removes its body too
    if (dropped.length > MAX_SHAPES) getECSWorld().deleteEntity(dropped.shift()!);
  };

  // Space or a gamepad's bottom button drops one. The map's sceneId: it does nothing in other
  // scenes (and the next visit's map replaces it, by its id)
  const actions = createActionMap({
    id: SCENE_ID,
    sceneId: SCENE_ID,
    actions: { drop: { type: 'BUTTON', name: 'Drop a shape' } },
    bindings: {
      drop: [
        { device: 'KEYBOARD', keys: [' '] },
        { device: 'GAMEPAD', button: 'SOUTH' },
      ],
    },
  });
  actions.onPressed('drop', () => void dropRandomShape());
  createExampleHud('Space or pad A: drop a shape');
};
// #endregion physics-scene
