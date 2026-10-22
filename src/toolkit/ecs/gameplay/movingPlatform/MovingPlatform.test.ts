import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import type { ECSWorld } from 'aekasha';
import type { ColliderParams, RigidBodyParams } from 'aekasha/physics';
import {
  createMovingPlatform,
  registerMovingPlatformSystem,
  type MovingPlatformControls,
} from './MovingPlatform';

// The platform's rigid body: what the system and the controls write to it
type Vec = { x: number; y: number; z: number };
type Quat = Vec & { w: number };
type BodyStub = {
  userData: Record<string, unknown>;
  nextTranslation: Vec | null;
  nextRotation: Quat | null;
  setUserData: (data: Record<string, unknown>, addToExisting?: boolean) => void;
  setTranslation: (pos: Vec) => void;
  setRotation: (rot: Quat) => void;
  setNextKinematicTranslation: (pos: Vec) => void;
  setNextKinematicRotation: (rot: Quat) => void;
};

// The world, the physics entity and the mesh are stand-ins (no renderer, no physics backend)
const stubs = vi.hoisted(() => {
  const bodies = new Map<number, unknown>();
  let nextEntityId = 1;
  const state = { systemFn: null as ((world: unknown, dt: number) => void) | null };
  const world = {
    addSystem: (_stage: unknown, _name: string, fn: (world: unknown, dt: number) => void) => {
      state.systemFn = fn;
    },
    isAlive: () => true,
    getRigidBody: (entityId: number) => bodies.get(entityId),
    deleteEntity: (entityId: number) => bodies.delete(entityId),
  };
  return {
    bodies,
    world,
    state,
    newEntityId: () => nextEntityId++,
  };
});

const createBodyStub = (userData: Record<string, unknown> = {}): BodyStub => {
  const body: BodyStub = {
    userData: { ...userData },
    nextTranslation: null,
    nextRotation: null,
    setUserData: (data, addToExisting) => {
      body.userData = addToExisting ? { ...body.userData, ...data } : { ...data };
    },
    setTranslation: () => {},
    setRotation: () => {},
    setNextKinematicTranslation: (pos) => (body.nextTranslation = { x: pos.x, y: pos.y, z: pos.z }),
    setNextKinematicRotation: (rot) =>
      (body.nextRotation = { x: rot.x, y: rot.y, z: rot.z, w: rot.w }),
  };
  return body;
};

vi.mock('aekasha', async (importOriginal) => {
  const THREE = await import('three/webgpu');
  const meshes = new Map<string, THREE.Mesh>();
  return {
    ...(await importOriginal<typeof import('aekasha')>()),
    getECSWorld: () => stubs.world,
    createGeometry: () => new THREE.BoxGeometry(),
    createMaterial: () => new THREE.MeshBasicNodeMaterial(),
    createMeshEntity: (props: { appId?: string }, opts?: { appId?: string }) => {
      const appId = opts?.appId ?? props.appId ?? 'mesh';
      const mesh = new THREE.Mesh();
      mesh.userData.entityId = stubs.newEntityId();
      meshes.set(appId, mesh);
      return mesh.userData.entityId;
    },
    getMeshByAppId: (appId: string) => meshes.get(appId),
  };
});
vi.mock('aekasha/physics', () => ({
  createPhysicsEntity: async (
    _colliders: ColliderParams[],
    rigidBody: RigidBodyParams,
    target?: number | THREE.Object3D
  ) => {
    const entityId = typeof target === 'number' ? target : stubs.newEntityId();
    stubs.bodies.set(entityId, createBodyStub(rigidBody.userData));
    return entityId;
  },
}));

registerMovingPlatformSystem(stubs.world as unknown as ECSWorld);

const tick = (dt: number, count = 1) => {
  for (let i = 0; i < count; i++) stubs.state.systemFn!(stubs.world, dt);
};

// Ticks of 0.1 s until the platform stops (or 1,000 ticks)
const runUntilStopped = (controls: MovingPlatformControls) => {
  let ticks = 0;
  while (controls.getState().isPlaying && ticks < 1000) {
    tick(0.1);
    ticks++;
  }
  return ticks;
};

let platformCount = 0;
type PlatformProps = Parameters<typeof createMovingPlatform>[0];
const createPlatform = async (props: Partial<PlatformProps> = {}) => {
  const platform = await createMovingPlatform({
    id: `testPlatform${platformCount++}`,
    scene: new THREE.Group(),
    physicsParams: { collider: { type: 'BOX' }, rigidBody: { rigidType: 'POS_BASED' } },
    // Three points, a second between each
    points: [
      { pos: { x: 0, y: 0, z: 0 }, dur: 1000 },
      { pos: { x: 10, y: 0, z: 0 }, dur: 1000 },
      { pos: { x: 10, y: 0, z: 10 }, dur: 1000 },
    ],
    ...props,
  });
  return { ...platform, body: stubs.bodies.get(platform.entityId) as BodyStub };
};

const ZERO = { x: 0, y: 0, z: 0 };

describe('createMovingPlatform', () => {
  it('builds its mesh from geo + mat', async () => {
    await expect(
      createPlatform({ shape: { geo: { type: 'BOX' }, mat: { type: 'BASIC' } } })
    ).resolves.toHaveProperty('mesh');
  });

  it('moves the character again on play() after pause()', async () => {
    const { controls, body } = await createPlatform();
    tick(0.1, 2);
    controls.pause();
    controls.play();
    tick(0.1);
    // The first segment: 10 m along x in 1 s
    expect(body.userData.velo).toEqual({ x: 10, y: 0, z: 0 });
  });

  it('zeroes its velocity when its loops end', async () => {
    const { controls, body } = await createPlatform({ opts: { loopTimes: 0 } });
    runUntilStopped(controls);
    expect(body.userData.velo).toEqual(ZERO);
  });

  it('zeroes its velocity on stop()', async () => {
    const { controls, body } = await createPlatform();
    tick(0.1, 2);
    controls.stop();
    expect(body.userData.velo).toEqual(ZERO);
  });

  it('keeps its velocity zero on setOptions() while paused', async () => {
    const { controls, body } = await createPlatform();
    controls.pause();
    controls.setOptions({ speedMultiplier: 2 });
    expect(body.userData.velo).toEqual(ZERO);
  });

  it("runs BACKWARD's loop over the whole path, as FORWARD's does", async () => {
    const forward = await createPlatform({ opts: { loopTimes: 0 } });
    const backward = await createPlatform({ opts: { loopTimes: 0, direction: 'BACKWARD' } });
    // Both tick in the one shared system: the tick each stopped on
    const stoppedOn = { forward: 0, backward: 0 };
    for (let i = 1; i <= 1000 && !(stoppedOn.forward && stoppedOn.backward); i++) {
      tick(0.1);
      if (!stoppedOn.forward && !forward.controls.getState().isPlaying) stoppedOn.forward = i;
      if (!stoppedOn.backward && !backward.controls.getState().isPlaying) stoppedOn.backward = i;
    }
    expect(stoppedOn.forward).toBeGreaterThan(0);
    expect(stoppedOn.backward).toBe(stoppedOn.forward);
  });

  it("times a BACKWARD segment by the edge's dur", async () => {
    // Backward from point 0, the first segment is the edge 2 → 0, which takes point 2's dur
    const { controls } = await createPlatform({
      points: [
        { pos: { x: 0, y: 0, z: 0 }, dur: 1000 },
        { pos: { x: 10, y: 0, z: 0 }, dur: 2000 },
        { pos: { x: 10, y: 0, z: 10 }, dur: 3000 },
      ],
      opts: { direction: 'BACKWARD' },
    });
    expect(controls.getState().segmentDuration).toBe(3);
  });

  it('stop() resets the loop count', async () => {
    const { controls } = await createPlatform({ opts: { loopTimes: 1 } });
    runUntilStopped(controls);
    controls.stop();
    expect(controls.getState().currentLoopCount).toBe(0);
  });

  it("stop() drops playSegment()'s target", async () => {
    const { controls } = await createPlatform();
    controls.playSegment(1);
    controls.stop();
    expect(controls.getState().targetSegmentIndex).toBeNull();
  });

  it('play() after a finished run moves the platform again', async () => {
    const { controls } = await createPlatform({ opts: { loopTimes: 0 } });
    runUntilStopped(controls);
    controls.play();
    tick(0.1);
    expect(controls.getState().isPlaying).toBe(true);
  });

  it('keeps the rotation of the last point that gave one', async () => {
    const quarterTurn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1);
    const { body } = await createPlatform({
      points: [
        { pos: { x: 0, y: 0, z: 0 }, dur: 1000, rot: quarterTurn },
        { pos: { x: 10, y: 0, z: 0 }, dur: 1000 },
        { pos: { x: 10, y: 0, z: 10 }, dur: 1000 },
      ],
    });
    // Into the second segment (1 → 2), where neither point has a rot
    tick(0.1, 15);
    const rot = body.nextRotation!;
    const angle = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w).angleTo(quarterTurn);
    expect(angle).toBeLessThan(1e-6);
  });

  it('an empty physicsParams array throws its own message', async () => {
    await expect(createPlatform({ physicsParams: [] })).rejects.toThrow(/moving platform/);
  });

  it('a point with dur 0 writes finite velocities', async () => {
    const { body } = await createPlatform({
      points: [
        { pos: { x: 0, y: 0, z: 0 }, dur: 0 },
        { pos: { x: 10, y: 0, z: 0 }, dur: 1000 },
      ],
    });
    const velo = body.userData.velo as Vec;
    expect([velo.x, velo.y, velo.z].every(Number.isFinite)).toBe(true);
  });

  it("leaves the caller's rigid body params as they were", async () => {
    const rigidBody: RigidBodyParams = { rigidType: 'POS_BASED', userData: { tag: 'mine' } };
    await createPlatform({ physicsParams: { collider: { type: 'BOX' }, rigidBody } });
    expect(rigidBody.userData).toEqual({ tag: 'mine' });
  });
});
