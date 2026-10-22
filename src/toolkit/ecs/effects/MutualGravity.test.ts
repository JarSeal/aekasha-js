import { afterEach, describe, expect, it } from 'vitest';
import type { ECSWorld } from 'aekasha';
import type { PhysVector } from 'aekasha/physics';
import {
  addGravityBody,
  clearGravityBodies,
  getGravityBodies,
  getMutualGravityConfig,
  getMutualGravityDefaults,
  registerMutualGravityEffect,
  removeGravityBody,
  setMutualGravityConfig,
} from './MutualGravity';

// A rigid body at a fixed position, recording the last force added to it and its resets
type BodyStub = {
  isBeingDeleted: boolean;
  position: [number, number, number];
  force: PhysVector | null;
  resetCount: number;
  readPoseInto: (out: Float64Array, offset: number) => void;
  resetForces: () => void;
  addForce: (force: PhysVector) => void;
};
const createBodyStub = (x: number, y = 0, z = 0): BodyStub => {
  const body: BodyStub = {
    isBeingDeleted: false,
    position: [x, y, z],
    force: null,
    resetCount: 0,
    readPoseInto: (out, offset) => out.set([...body.position, 0, 0, 0, 1], offset),
    resetForces: () => {
      body.force = null;
      body.resetCount++;
    },
    addForce: (force) => (body.force = { ...force }),
  };
  return body;
};

// A stub world whose bodies are the stubs above, registered with the system (captured)
let systemFn: ((world: ECSWorld, dt: number) => void) | null = null;
const createStubWorld = () => {
  const worldBodies = new Map<number, BodyStub>();
  const world = {
    bodies: worldBodies,
    addSystem: (_stage: unknown, _name: string, fn: (world: ECSWorld, dt: number) => void) => {
      systemFn = fn;
    },
    isAlive: (entityId: number) => worldBodies.has(entityId),
    getRigidBody: (entityId: number) => worldBodies.get(entityId),
  };
  return world as typeof world & ECSWorld;
};
const stubWorld = createStubWorld();
const bodies = stubWorld.bodies;
registerMutualGravityEffect(stubWorld);
const runStep = (world: ECSWorld = stubWorld) => systemFn!(world, 1 / 60);

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
  it('the first 16 bodies keep their mass in the sub-step the 17th joins', () => {
    addBodies(17);
    runStep();
    // Body 0, at the end of the row, is pulled toward the others (+x)
    expect(bodies.get(0)!.force!.x).toBeGreaterThan(0);
  });

  it('a config key given as undefined keeps its value', () => {
    addBodies(2);
    setMutualGravityConfig({ G: undefined });
    runStep();
    expect(Number.isFinite(bodies.get(0)!.force!.x)).toBe(true);
    expect(getMutualGravityConfig().G).toBe(1);
  });

  it('pulls a pair equal and opposite, softened: G·m₁·m₂·r / (r² + ε²)^(3/2)', () => {
    bodies.set(1, createBodyStub(0));
    bodies.set(2, createBodyStub(3, 4));
    addGravityBody(1, 2, stubWorld);
    addGravityBody(2, 5, stubWorld);
    setMutualGravityConfig({ G: 0.5, softening: 1 });
    runStep();
    // r = (3, 4, 0), r² + ε² = 26
    const s = (0.5 * 2 * 5) / (26 * Math.sqrt(26));
    const a = bodies.get(1)!.force!;
    const b = bodies.get(2)!.force!;
    expect(a.x).toBeCloseTo(3 * s, 15);
    expect(a.y).toBeCloseTo(4 * s, 15);
    expect([b.x, b.y, b.z]).toEqual([-a.x, -a.y, 0]);
  });

  it('drops a body whose entity or rigid body is gone', () => {
    addBodies(3);
    bodies.delete(1);
    bodies.get(2)!.isBeingDeleted = true;
    runStep();
    expect(getGravityBodies()).toEqual([{ entityId: 0, mass: 1 }]);
    // Alone, it's pulled by nothing
    expect(bodies.get(0)!.force).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('resets the forces once when it is turned off', () => {
    addBodies(2);
    runStep();
    setMutualGravityConfig({ enabled: false });
    runStep();
    runStep();
    // The step's own reset before its addForce, then the one reset when turned off
    expect(bodies.get(0)!.resetCount).toBe(2);
    expect(bodies.get(0)!.force).toBeNull();
  });

  it("keeps each world's bodies apart, an entity id in each", () => {
    const otherWorld = createStubWorld();
    addBodies(2);
    otherWorld.bodies.set(0, createBodyStub(-2));
    addGravityBody(0, 3, otherWorld);
    expect(getGravityBodies()).toEqual([
      { entityId: 0, mass: 1 },
      { entityId: 1, mass: 1 },
      { entityId: 0, mass: 3 },
    ]);
    // The default world's pair: pulled by its own bodies only, the same as without the other
    runStep();
    const pairForce = bodies.get(0)!.force!.x;
    expect(otherWorld.bodies.get(0)!.force).toBeNull();
    runStep(otherWorld);
    expect(otherWorld.bodies.get(0)!.force).toEqual({ x: 0, y: 0, z: 0 });
    // Turning it off resets each world's forces in that world's step
    setMutualGravityConfig({ enabled: false });
    runStep(otherWorld);
    expect(otherWorld.bodies.get(0)!.resetCount).toBe(2);
    expect(bodies.get(0)!.force!.x).toBe(pairForce);
  });

  it('removeGravityBody resets its forces, and clear removes every body', () => {
    addBodies(3);
    runStep();
    removeGravityBody(1);
    expect(bodies.get(1)!.force).toBeNull();
    expect(getGravityBodies().map(({ entityId }) => entityId)).toEqual([0, 2]);
    clearGravityBodies();
    expect(getGravityBodies()).toEqual([]);
  });
});
