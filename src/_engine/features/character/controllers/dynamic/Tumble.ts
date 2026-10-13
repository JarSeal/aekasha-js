import * as THREE from 'three/webgpu';
import { LEVEL_GROUND_NORMAL } from '../../../../kernel/render/ThreeMath';
import { getRandomStream } from '../../../../utils/RandomStreams';
import { setRot, setVec } from './Casts';
import type { DynamicCharacterContext } from './DynamicCharacterData';

// Tumbling: knocked over by a hard hit (the sensors record it, the tick starts it), or handed to
// physics alone (`PHYSICS_ONLY`); then getting up, an eased uprighting torque that ends upright
// with the facing kept.

const _tumbleStartImpulse = new THREE.Vector3();
const _getUpQuat = new THREE.Quaternion();
const _getUpBodyUp = new THREE.Vector3();
const _getUpAxis = new THREE.Vector3();
const _getUpYawEuler = new THREE.Euler();
const _getUpUprightQuat = new THREE.Quaternion();
const _getUpUprightEuler = new THREE.Euler();
const _stopRotationVector4 = new THREE.Vector4();
const _stopRotationQuat = new THREE.Quaternion(0, 0, 0, 1);
const _stopEuler = new THREE.Euler();

/** Knocks the character over at `step`, with a small push in a direction drawn from its own
 * random stream (`character:<id>`), so a scene tumbles the same way on every visit. */
const startTumbling = (c: DynamicCharacterContext, step: number) => {
  const { state, internal, body } = c;
  state.isGettingUp = false;
  state.isTumbling = true;
  internal.isTumblingStartStep = step;
  // angularDampingSync() throws in WORKER_THREAD mode (not backed by the hot-path buffer).
  // The body's angular damping is never touched by anything except this tumble/getting-up/
  // stop cycle, and the walk-capsule rigidBodyParams never set one at creation — so the value
  // to restore once tumbling ends is always the engine default (0), not something that needs
  // querying live.
  internal.charAngDamping = 0;
  body.setAngularDamping(c.config.tumblingAngularDamping);
  body.lockRotations(false, true);
  body.setEnabledRotations(true, true, true, true);
  const random = getRandomStream(`character:${c.id}`);
  const rando1 = random() > 0.5 ? 1 : -1;
  const rando2 = random() > 0.5 ? 1 : -1;
  body.applyImpulse(_tumbleStartImpulse.set(random() * rando1, 0, random() * rando2), true);
};

/** Upright again, keeping the facing: rotations locked, no angular velocity, the angular damping
 * restored. */
const stopTumbling = (c: DynamicCharacterContext) => {
  const { state, internal, body } = c;
  body.setAngvel(setVec(0, 0, 0), true);
  body.setAngularDamping(0);
  body.setEnabledRotations(false, false, false, true);
  body.lockRotations(true, true);
  // The facing is read from the body, not the mesh: in the interpolation modes the mesh holds
  // a blended in-between pose (and in 'NONE' last frame's), while body.rotation() already
  // returns a rotation set earlier this sub-step, in both MAIN_THREAD and WORKER_THREAD mode.
  const rot = body.rotation();
  _stopRotationQuat.set(rot.x, rot.y, rot.z, rot.w);
  state.charRotation = _stopEuler.setFromQuaternion(_stopRotationQuat, 'XZY').y;
  // Upright, but keeping the facing: the body's rotation is what the mesh gets synced from,
  // so resetting it to identity would snap the character to face the default direction.
  const q = _stopRotationQuat.setFromAxisAngle(LEVEL_GROUND_NORMAL, state.charRotation);
  body.setRotation(_stopRotationVector4.set(q.x, q.y, q.z, q.w), true);
  body.setAngularDamping(internal.charAngDamping);
  internal.charAngDamping = 0;
  state.isTumbling = false;
  internal.isTumblingStartStep = -1;
  state.isGettingUp = false;
  internal.isGettingUpStartStep = -1;
};

/** A hard hit the sensors recorded at this sub-step's start (the events' flush) starts tumbling,
 * before the tick reads the body. */
export const applyPendingTumble = (c: DynamicCharacterContext, step: number) => {
  if (!c.internal.pendingTumble) return;
  c.internal.pendingTumble = false;
  startTumbling(c, step);
};

/** Applies a control mode change (`setControlMode`) here, so only the tick touches the body.
 * Returns whether the controller moves the body (`CONTROLLED`). */
export const applyControlMode = (c: DynamicCharacterContext, step: number) => {
  const { state, internal, body } = c;
  if (c.character.controlMode !== c.appliedControlMode) {
    c.appliedControlMode = c.character.controlMode;
    if (c.appliedControlMode === 'PHYSICS_ONLY') {
      // Physics alone: free rotations and the body's own (default) angular damping
      state.isGettingUp = false;
      internal.isGettingUpStartStep = -1;
      body.setAngularDamping(0);
      body.lockRotations(false, true);
      body.setEnabledRotations(true, true, true, true);
    } else {
      // Back from physics: get up first (the getting-up path locks the rotations at its end)
      state.isTumbling = true;
      state.isGettingUp = true;
      internal.isGettingUpStartStep = step;
    }
  }
  return c.appliedControlMode === 'CONTROLLED';
};

/** Scales the angular velocity scratch (and the body's) down to `maxAngVel`. */
const clampAngularVelocity = (c: DynamicCharacterContext, maxAngVel: number) => {
  const vels = c.vels;
  const len = Math.hypot(vels[3], vels[4], vels[5]);
  if (len > maxAngVel) {
    const scale = maxAngVel / len;
    vels[3] *= scale;
    vels[4] *= scale;
    vels[5] *= scale;
    c.body.setAngvel(setVec(vels[3], vels[4], vels[5]), true);
  }
};

/** While tumbling: starts getting up once the minimum time is over and the body has calmed down,
 * else clamps its spin. */
export const updateTumbling = (
  c: DynamicCharacterContext,
  step: number,
  stepMs: number,
  isControlled: boolean
) => {
  const { state, config, internal } = c;
  if (!isControlled || !state.isTumbling) return;
  if (
    !state.isGettingUp &&
    (step - internal.isTumblingStartStep) * stepMs > config.tumblingMinTime &&
    state.relVelocity.length < config.tumblingEndMinVelo &&
    state.angularVelocity.length < config.tumblingEndMinAngVelo
  ) {
    // End tumbling and start isGettingUp phase
    state.isGettingUp = true;
    internal.isGettingUpStartStep = step;
  } else {
    // Clamp angular velocity when tumbling
    clampAngularVelocity(c, config.tumblingMaxAngVelo);
  }
};

/** While getting up: an uprighting torque, eased in over `gettingUpDuration`, then upright with
 * the facing kept. */
export const updateGettingUp = (
  c: DynamicCharacterContext,
  step: number,
  stepMs: number,
  isControlled: boolean
) => {
  const { state, config, internal, pose, vels, body } = c;
  if (!isControlled || !state.isGettingUp) return;
  body.setAngularDamping(config.gettingUpAngularDamping);
  const ratio = Math.min(
    ((step - internal.isGettingUpStartStep) * stepMs) / config.gettingUpDuration,
    1
  );
  const q = _getUpQuat.set(pose[3], pose[4], pose[5], pose[6]);
  // Compute body's current up direction
  const bodyUp = _getUpBodyUp.set(0, 1, 0).applyQuaternion(q).normalize();
  // Axis of rotation required to align bodyUp → worldUp
  const axis = _getUpAxis.copy(bodyUp).cross(LEVEL_GROUND_NORMAL);
  const dot = bodyUp.dot(LEVEL_GROUND_NORMAL);
  const angle = Math.acos(Math.min(Math.max(dot, -1), 1)); // clamp to valid range
  clampAngularVelocity(c, config.gettingUpMaxAngVelo);
  // Prevent NaN or tiny oscillations
  if (angle > 0.00005) {
    axis.normalize();
    const ease = 1 - Math.pow(1 - ratio, 3);
    const torqueStrength = config.gettingUpTorque * ease;
    const torque = axis.multiplyScalar(angle * torqueStrength);
    body.applyTorqueImpulse(setVec(torque.x, torque.y, torque.z), true);
  }
  if (ratio >= 1) {
    // Fully upright the player, preserving yaw
    const yaw = _getUpYawEuler.setFromQuaternion(q, 'YXZ').y;
    const uprightQuat = _getUpUprightQuat.setFromEuler(_getUpUprightEuler.set(0, yaw, 0));
    body.setRotation(setRot(uprightQuat.x, uprightQuat.y, uprightQuat.z, uprightQuat.w), true);

    // Clear any leftover rotational velocity
    stopTumbling(c);
    vels[3] = 0;
    vels[4] = 0;
    vels[5] = 0;
  }
};
