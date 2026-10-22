import * as THREE from 'three/webgpu';
import {
  createMeshEntity,
  existsOrThrow,
  getCameraByAppId,
  getECSWorld,
  getMeshByAppId,
} from 'aekasha';
import { createDynamicCharacter } from 'aekasha/character';
import { createPhysicsEntity } from 'aekasha/physics';
import { createFollowObjectCameraRig } from 'aekasha/toolkit/ecs';
import { createExampleHud } from '../exampleHud';

const SCENE_ID = 'exampleCharacter';
const CHARACTER_ID = 'exampleCharacterPlayer';
const CAMERA_RIG_ID = 'exampleCharacterCam';
/** Where the character starts: the ground's top is at y = 0, the capsule's centre 0.8 above it */
const SPAWN = { x: 0, y: 1, z: 3 };

// #region character-level (shown in the Hub: hub/pages/examples/character/)
type Vec3 = [x: number, y: number, z: number];
type Block = { size: Vec3; at: Vec3; color: string; tiltX?: number };

const GREY = '#59606e';
const DARK = '#474d59';
const ORANGE = '#e8833a';
const GREEN = '#7cc46b';
const PURPLE = '#c26bc4';
const X_AXIS = new THREE.Vector3(1, 0, 0);

const BLOCKS: Block[] = [
  // The ground, its top at y = 0, and a low wall round it
  { size: [30, 0.5, 30], at: [0, -0.25, 0], color: GREY },
  { size: [31, 1, 0.5], at: [0, 0.5, -15.25], color: DARK },
  { size: [31, 1, 0.5], at: [0, 0.5, 15.25], color: DARK },
  { size: [0.5, 1, 30], at: [-15.25, 0.5, 0], color: DARK },
  { size: [0.5, 1, 30], at: [15.25, 0.5, 0], color: DARK },
  // Crates to walk round, and a low block to jump onto
  { size: [1, 1, 1], at: [-3, 0.5, 7], color: ORANGE },
  { size: [1, 1, 1], at: [4, 0.5, 6], color: ORANGE },
  { size: [1, 1, 1], at: [-0.5, 0.5, -7], color: ORANGE },
  { size: [1, 1, 1], at: [0.6, 0.5, -7.2], color: ORANGE },
  { size: [2, 0.5, 2], at: [9, 0.25, 2], color: GREEN },
  // The platforms the stairs and the ramp lead up to
  { size: [3, 1, 3], at: [-6, 0.5, -5.5], color: PURPLE },
  { size: [3, 1.5, 3], at: [6, 0.75, -8.5], color: PURPLE },
];

/** A box mesh with a FIXED box body of the same size: nothing moves it */
const createBlock = async ({
  size: [width, height, depth],
  at: [x, y, z],
  color,
  tiltX = 0,
}: Block) => {
  const rotation = new THREE.Quaternion().setFromAxisAngle(X_AXIS, tiltX);
  const entityId = createMeshEntity({
    // A geometry per size and a material per colour: an id is registered with its first params
    geo: {
      id: `exampleCharacterBox_${width}_${height}_${depth}`,
      type: 'BOX',
      params: { width, height, depth },
    },
    mat: { id: `exampleCharacter_${color}`, type: 'STANDARD', params: { color } },
    position: { x, y, z },
    quaternion: rotation,
    castShadow: true,
    receiveShadow: true,
  });
  await createPhysicsEntity(
    { type: 'BOX', hx: width / 2, hy: height / 2, hz: depth / 2 },
    { rigidType: 'FIXED', translation: { x, y, z }, rotation },
    entityId
  );
};

/** A box `thickness` thick, tilted about X, whose top face rises from `from` to `to` ([y, z],
 * North, -Z, being up): its length, tilt and centre */
const getSlope = (from: [y: number, z: number], to: [y: number, z: number], thickness: number) => {
  const run = from[1] - to[1];
  const rise = to[0] - from[0];
  const angle = Math.atan2(rise, run);
  // The top face's middle, moved down half the thickness along the face's normal
  const y = (from[0] + to[0]) / 2 - (Math.cos(angle) * thickness) / 2;
  const z = (from[1] + to[1]) / 2 - (Math.sin(angle) * thickness) / 2;
  return { length: Math.hypot(run, rise), angle, y, z };
};

/** A ramp up to the 1.5 m platform: 17°, the controller walks up to 45° (maxWalkableAngle) */
const createRamp = () => {
  const ramp = getSlope([0, -2], [1.5, -7], 0.2);
  return createBlock({
    size: [3, 0.2, ramp.length],
    at: [6, ramp.y, ramp.z],
    color: PURPLE,
    tiltX: ramp.angle,
  });
};

/** Stairs up to the 1 m platform: four 0.2 m steps, drawn only. A capsule catches on a step's
 * edge, so the body walks up one smooth slope under them, through the middle of each step. */
const createStairs = () => {
  for (let i = 0; i < 4; i++) {
    const height = 0.2 * (i + 1);
    createMeshEntity({
      geo: {
        id: `exampleCharacterStep${i}`,
        type: 'BOX',
        params: { width: 3, height, depth: 0.5 },
      },
      mat: { id: `exampleCharacter_${PURPLE}`, type: 'STANDARD', params: { color: PURPLE } },
      position: { x: -6, y: height / 2, z: -2.25 - 0.5 * i },
      castShadow: true,
      receiveShadow: true,
    });
  }
  const stairs = getSlope([0, -1.75], [1, -4.25], 0.2);
  return createPhysicsEntity(
    { type: 'BOX', hx: 1.5, hy: 0.1, hz: stairs.length / 2 },
    {
      rigidType: 'FIXED',
      translation: { x: -6, y: stairs.y, z: stairs.z },
      rotation: new THREE.Quaternion().setFromAxisAngle(X_AXIS, stairs.angle),
    }
  );
};

/** Every body requested at once, then awaited together: a create sends its body before its first
 * await, so the bodies are made in this order, as one by one */
const createLevel = () => Promise.all([...BLOCKS.map(createBlock), createRamp(), createStairs()]);
// #endregion character-level

// #region character-visual (shown in the Hub: hub/pages/examples/character/)
/** The character's look: a capsule of the body's size with a nose on +X, its forward at yaw 0.
 * The controller never reads it, so any Object3D works (a skinned mesh, a group). */
const createCharacterVisual = () => {
  createMeshEntity(
    {
      geo: {
        id: 'exampleCharacterNoseGeo',
        type: 'BOX',
        params: { width: 0.5, height: 0.2, depth: 0.25 },
      },
      mat: { id: 'exampleCharacterNose', type: 'STANDARD', params: { color: '#333333' } },
      position: { x: 0.45, y: 0.45 },
    },
    // Not in the scene: it goes into the capsule below
    { appId: 'exampleCharacterNose', doNotAddToScene: true }
  );
  createMeshEntity(
    {
      // three's capsule height is the straight part's: 1.6 m tall in all, 0.5 m radius
      geo: {
        id: 'exampleCharacterBodyGeo',
        type: 'CAPSULE',
        params: { radius: 0.5, height: 0.6, capSegments: 8, radialSegments: 24 },
      },
      mat: { id: 'exampleCharacterBody', type: 'STANDARD', params: { color: '#f2c14e' } },
      castShadow: true,
      receiveShadow: true,
    },
    { appId: 'exampleCharacterBody' }
  );
  const body = existsOrThrow(getMeshByAppId('exampleCharacterBody'), 'No character body mesh');
  body.add(existsOrThrow(getMeshByAppId('exampleCharacterNose'), 'No nose mesh'));
  return body;
};
// #endregion character-visual

export const scene = async () => {
  await createLevel();

  // #region dynamic-character (shown in the Hub: hub/pages/examples/character/, hub/pages/features/characters/)
  // A dynamic character (a Rapier body the controller pushes around) on a WORLD_FIXED player
  // brain: its own action map reads the keys at every physics step and writes the intent
  const visual = createCharacterVisual();
  const { character } = await createDynamicCharacter({
    id: CHARACTER_ID,
    name: 'Example character',
    visual,
    brain: {
      kind: 'WORLD_FIXED',
      params: {
        bindings: {
          move: [
            { device: 'KEYBOARD', up: ['w'], down: ['s'], left: ['a'], right: ['d'] },
            {
              device: 'KEYBOARD',
              up: ['ArrowUp'],
              down: ['ArrowDown'],
              left: ['ArrowLeft'],
              right: ['ArrowRight'],
            },
          ],
          jump: [{ device: 'KEYBOARD', keys: [' '] }],
          run: [{ device: 'KEYBOARD', keys: ['Shift'] }],
          // Not Control: Ctrl+W closes the tab on Windows and Linux
          crouch: [{ device: 'KEYBOARD', keys: ['c'] }],
        },
        // Run while Shift is held; C switches crouching on and off (the default, TOGGLE)
        runMode: 'HOLD',
        // A tap turns the character all the way to the key's direction
        turnToLastMoveDirection: true,
      },
    },
  });
  getECSWorld().getRigidBody(character.entityId)?.setTranslation(SPAWN, true);
  // #endregion dynamic-character

  // #region follow-camera (shown in the Hub: hub/pages/examples/character/)
  // South of and above the character, looking North-down without ever turning, and a little
  // ahead of where it's heading. The rig isn't an entity: its sceneId deletes it on the scene's
  // exit, as the character goes with the scene.
  createFollowObjectCameraRig({
    id: CAMERA_RIG_ID,
    sceneId: SCENE_ID,
    camera: existsOrThrow(getCameraByAppId('exampleCharacterCamera'), 'No example camera'),
    targetMesh: visual,
    offset: { x: 0, y: 10, z: 8 },
    orientation: 'FIXED',
    lookAhead: { distance: 1.5 },
  });
  // #endregion follow-camera

  createExampleHud('W A S D or the arrows: move · Space: jump · Shift (hold): run · C: crouch');
};
