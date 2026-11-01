// A rigid body's pose rows in a debug edit window (p806 D10): the physics entity's and the
// character's. The fields edit a copy of the pose read at the build, since the body keeps
// simulating: a live field would move under the user's typing, and a write on each step would
// fight the solver. The Set buttons apply the copy and report it for the window's undo record.
import * as THREE from 'three/webgpu';
import type { PropertyGridItem } from '../../../ui/forms/PropertyGridItems';
import type { RigidBodyAPI } from '../types/PhysicsBodyTypes';
import type { PhysRotation, PhysVector } from '../types/PhysicsCommonTypes';

/** A pose's part as plain data, what an undo record holds */
export type BodyPosePart =
  | { field: 'position'; prev: PhysVector; next: PhysVector }
  | { field: 'rotation'; prev: PhysRotation; next: PhysRotation };

/** What {@link getBodyPoseItems} makes the rows from */
export type BodyPoseItemsProps = {
  rigidBody: RigidBodyAPI;
  /** Re-reads the window's grid ("Update … input") */
  refresh: () => void;
  /** A Set button applied a pose part: the window records it */
  onSet: (part: BodyPosePart) => void;
};

const scratchQuat = new THREE.Quaternion();

/**
 * The position (a vector field) and rotation (Euler angles, in degrees, a step of π / 8) rows of a
 * copy of the body's pose, each with its buttons: "Set …" applies the copy (and "Set position and
 * cancel velocities" zeroes the velocities too, which an undo doesn't restore), "Update … input"
 * reads the body again.
 */
export const getBodyPoseItems = (props: BodyPoseItemsProps): PropertyGridItem[] => {
  const { rigidBody, refresh, onSet } = props;
  const readRotation = (euler: THREE.Euler) => {
    const { x, y, z, w } = rigidBody.rotation();
    return euler.setFromQuaternion(scratchQuat.set(x, y, z, w));
  };
  const pose = { position: rigidBody.translation(), rotation: readRotation(new THREE.Euler()) };

  const setPosition = () => {
    const { x, y, z } = rigidBody.translation();
    const next = { x: pose.position.x, y: pose.position.y, z: pose.position.z };
    rigidBody.setTranslation(next, true);
    onSet({ field: 'position', prev: { x, y, z }, next });
  };
  const setRotation = () => {
    const quat = new THREE.Quaternion().setFromEuler(pose.rotation);
    const { x, y, z, w } = rigidBody.rotation();
    const next = { x: quat.x, y: quat.y, z: quat.z, w: quat.w };
    rigidBody.setRotation(next, true);
    onSet({ field: 'rotation', prev: { x, y, z, w }, next });
  };

  return [
    // Two decimals shown (a simulated pose has many, which a box cuts); the copy keeps them all
    { target: pose, key: 'position', label: 'Position', precision: 2 },
    { type: 'button', title: 'Set position', onClick: setPosition },
    {
      type: 'button',
      title: 'Set position and cancel velocities',
      onClick: () => {
        setPosition();
        rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      },
    },
    {
      type: 'button',
      title: 'Update position input',
      onClick: () => {
        Object.assign(pose.position, rigidBody.translation());
        refresh();
      },
    },
    { type: 'separator' },
    { target: pose, key: 'rotation', label: 'Rotation', kind: 'rotation', step: Math.PI / 8 },
    { type: 'button', title: 'Set rotation', onClick: setRotation },
    {
      type: 'button',
      title: 'Update rotation input',
      onClick: () => {
        readRotation(pose.rotation);
        refresh();
      },
    },
  ];
};
