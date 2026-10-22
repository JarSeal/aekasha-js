import { afterEach, describe, expect, it } from 'vitest';
import type { ECSWorld } from 'aekasha';
import type { PhysVector } from 'aekasha/physics';
import {
  addGravityBody,
  clearGravityBodies,
  getMutualGravityDefaults,
  registerMutualGravityEffect,
  setMutualGravityConfig,
} from './MutualGravity';

// The `it.fails` cases are known bugs, each failing on its assertion: p620 Phase 1 fixes them
// and turns them into `it`s (docs/plans/p620_review-toolkit-and-app-code.md, C12, C13).

// A rigid body at a fixed position, recording the last force added to it
type BodyStub = {
  isBeingDeleted: boolean;
  position: [number, number, number];
  force: PhysVector | null;
  readPoseInto: (out: Float64Array, offset: number) => void;
  resetForces: () => void;
  addForce: (force: PhysVector) => void;
};
const createBodyStub = (x: number): BodyStub => {
  const body: BodyStub = {
    isBeingDeleted: false,
    position: [x, 0, 0],
    force: null,
    readPoseInto: (out, offset) => out.set([...body.position, 0, 0, 0, 1], offset),
    resetForces: () => (body.force = null),
    addForce: (force) => (body.force = { ...force }),
  };
  return body;
};

// The system, captured from a stub world whose bodies are the stubs above
const bodies = new Map<number, BodyStub>();
let systemFn: ((world: ECSWorld, dt: number) => void) | null = null;
const stubWorld = {
  addSystem: (_stage: unknown, _name: string, fn: (world: ECSWorld, dt: number) => void) => {
    systemFn = fn;
  },
  isAlive: (entityId: number) => bodies.has(entityId),
  getRigidBody: (entityId: number) => bodies.get(entityId),
} as unknown as ECSWorld;
registerMutualGravityEffect(stubWorld);

// `count` bodies of mass 1, 2 m apart along x
const addBodies = (count: number) => {
  for (let i = 0; i < count; i++) {
    bodies.set(i, createBodyStub(i * 2));
    addGravityBody(i, 1, stubWorld);
  }
};

afterEach(() => {
  clearGravityBodies();
  bodies.clear();
  setMutualGravityConfig(getMutualGravityDefaults());
});

describe('mutualGravitySystem', () => {
  // First in the file: the scratch arrays grow (from 16) only once per module
  it.fails('the first 16 bodies keep their mass in the sub-step the 17th joins', () => {
    addBodies(17);
    systemFn!(stubWorld, 1 / 60);
    // Body 0, at the end of the row, is pulled toward the others (+x)
    expect(bodies.get(0)!.force!.x).toBeGreaterThan(0);
  });

  it.fails('a config key given as undefined keeps its value', () => {
    addBodies(2);
    setMutualGravityConfig({ G: undefined });
    systemFn!(stubWorld, 1 / 60);
    expect(Number.isFinite(bodies.get(0)!.force!.x)).toBe(true);
  });
});
