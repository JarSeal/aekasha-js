import * as THREE from 'three/webgpu';
import { ECSSystemStage } from 'aekasha';
import type { ECSWorld } from 'aekasha';
import { SpinComponentType } from './SpinComponent';

// Shared by two scenes (exampleEcs, exampleHubHero) and AppECSPlugins.ts. Shared app code goes in
// src/app/shared/, but this stays here: the Hub's ECS example (hub/pages/examples/ecs/) shows it
// from this folder.

// #region spin-system (shown in the Hub: hub/pages/examples/ecs/)
// Scratch objects, reused every frame: a system that runs for every entity shouldn't allocate.
// setTransform copies the rotation it's given, so one patch object serves every entity.
const axis = new THREE.Vector3();
const turn = new THREE.Quaternion();
const nextRotation = new THREE.Quaternion();
const patch = { rot: nextRotation };

/** Turns every entity with a SPIN component by its speed × the frame's time */
export const spinSystem = (world: ECSWorld, dt: number) => {
  for (const [entityId, spin] of world.getStorage(SpinComponentType.SPIN)) {
    // getRotation's quaternion is to read: the new one goes through setTransform
    const rotation = world.getRotation(entityId);
    if (!rotation) continue;
    axis.set(spin.axis.x, spin.axis.y, spin.axis.z).normalize();
    nextRotation.copy(rotation).multiply(turn.setFromAxisAngle(axis, spin.speed * dt));
    world.setTransform(entityId, patch);
  }
};

/** Adds the system to a world, at the stage where gameplay systems run */
export const registerSpinSystem = (world: ECSWorld) =>
  world.addSystem(ECSSystemStage.APP_LOGIC, 'exampleSpin', spinSystem);
// #endregion spin-system
