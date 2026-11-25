// The Rapier backend: the module backends/Engines.ts loads, the backend contract (EngineAPIType)
// assembled from its modules (p614 D7; RapierState.ts lists them).

export {
  countDynamicBodyActivity,
  createRigidBodies,
  createRigidBody,
  deleteRigidBodies,
  deleteRigidBody,
  detachRigidBody,
  reattachRigidBody,
  readBodyPositions,
} from './RapierBodies';
export {
  createCollider,
  createColliders,
  deleteCollider,
  deleteColliders,
} from './RapierColliders';
export { dispatchPendingEventRecords, drainPendingEventRecords } from './RapierEvents';
export { createJoint, createJoints, deleteJoint, deleteJoints } from './RapierJoints';
export { createMultibodyJoint, deleteMultibodyJoint } from './RapierMultibodyJoints';
export {
  getAllRigidBodyIds,
  getColliderAPIWithId,
  getJointAPIWithId,
  getMultibodyJointAPIWithId,
  getRigidBodyAPIWithId,
  setBodyMovedObserver,
  setQueryObserver,
} from './RapierState';
export {
  drainPendingOutOfBoundsRecords,
  setBodyWorldBounds,
  setWorldBounds,
} from './RapierWorldBounds';
export {
  createWorld,
  debugRender,
  deleteWorld,
  init,
  restoreSnapshot,
  step,
  takeSnapshot,
} from './RapierWorld';
