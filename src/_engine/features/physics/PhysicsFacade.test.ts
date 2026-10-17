import { describe, expect, it, vi } from 'vitest';

/** The visibility listeners physics added and hasn't removed. */
const visibility = vi.hoisted(() => ({ listeners: new Set<unknown>() }));
vi.mock(import('../../kernel/loop/MainLoop'), async (importOriginal) => ({
  ...(await importOriginal()),
  onVisibilityChange: (fn: (isHidden: boolean) => void) => {
    visibility.listeners.add(fn);
    return () => {
      visibility.listeners.delete(fn);
    };
  },
}));

import { initEnvironment, loadConfig } from '../../kernel/config/Config';
import { DEFAULT_ECS_WORLD_ID, ECSWorld, getEntityIdByAppId } from '../../kernel/ecs/ECS';
import {
  createRigidBodySync,
  createRigidBodyWithCollidersSync,
  deleteRigidBodies,
  deleteRigidBodiesSync,
  deleteRigidBodySync,
} from './PhysicsBodies';
import {
  createColliderSync,
  createCollidersSync,
  deleteCollider,
  deleteColliderSync,
  deleteCollidersSync,
} from './PhysicsColliders';
import {
  createPhysicsEntity,
  getPhysicsEntityBody,
  getPhysicsEntityByAppId,
} from './PhysicsEntity';
import { deleteJoint, deleteJointSync } from './PhysicsJoints';
import { getAllColliderEntries, getAllRigidBodyEntries } from './PhysicsRegistry';
import { isPhysicsWorldEnabled } from './PhysicsState';
import { holdPhysicsStepping, isPhysicsSteppingHeld } from './PhysicsStepping';
import { createPhysicsWorld, deletePhysicsWorld, initPhysics, stopPhysics } from './PhysicsWorld';
import { getAllRigidBodyIds, getColliderAPIWithId } from './backends/rapier/EngineRapier';

// The facade on MAIN_THREAD, against the real Rapier backend (the compat build runs in Node)

/** A TRIMESH without indices: the backend's `paramsToShape` throws. */
const BROKEN_TRIMESH = { type: 'TRIMESH', vertices: new Float32Array(9) } as const;

const count = (entries: IterableIterator<unknown>) => [...entries].length;

describe('the facade (MAIN_THREAD)', () => {
  it('boots and creates the world', async () => {
    initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });
    loadConfig({ physics: { enabled: true, workerTarget: 'MAIN_THREAD' } });
    await initPhysics(true);
    await createPhysicsWorld();
    expect(createRigidBodySync({ rigidType: 'DYNAMIC' }).id).toBeTypeOf('number');
  });

  it('A10: a body whose collider fails is deleted with the colliders made before it', () => {
    const bodies = count(getAllRigidBodyEntries());
    const engineBodies = count(getAllRigidBodyIds());
    const colliders = count(getAllColliderEntries());
    expect(() =>
      createRigidBodyWithCollidersSync({ rigidType: 'DYNAMIC' }, [
        { type: 'BALL', radius: 0.5 },
        BROKEN_TRIMESH,
      ])
    ).toThrow(/indices/);
    expect(count(getAllRigidBodyEntries())).toBe(bodies);
    expect(count(getAllRigidBodyIds())).toBe(engineBodies);
    expect(count(getAllColliderEntries())).toBe(colliders);
  });

  it('A10: without a body, the colliders made before the failing one are deleted', () => {
    // Ids are handed out in order: the ball made before the broken TRIMESH gets the next one
    const probe = createColliderSync({ type: 'BALL', radius: 0.5 });
    const colliders = count(getAllColliderEntries());
    expect(() =>
      createRigidBodyWithCollidersSync(undefined, [{ type: 'BALL', radius: 0.5 }, BROKEN_TRIMESH])
    ).toThrow(/indices/);
    expect(count(getAllColliderEntries())).toBe(colliders);
    expect(getColliderAPIWithId(probe.id + 1)).toBeUndefined();
  });

  it('A10: createColliders is all or nothing', () => {
    const probe = createColliderSync({ type: 'BALL', radius: 0.5 });
    expect(() => createCollidersSync([{ type: 'BALL', radius: 0.5 }, BROKEN_TRIMESH])).toThrow(
      /indices/
    );
    expect(getColliderAPIWithId(probe.id + 1)).toBeUndefined();
  });

  it('a deleted body and its colliders are marked isBeingDeleted', () => {
    const { rigidBody, colliders } = createRigidBodyWithCollidersSync({ rigidType: 'DYNAMIC' }, [
      { type: 'BALL', radius: 0.5 },
    ]);
    deleteRigidBodySync(rigidBody!.id);
    expect(rigidBody!.isBeingDeleted).toBe(true);
    expect(colliders[0].isBeingDeleted).toBe(true);
  });

  it('E4: getPhysicsEntityByAppId finds only physics entities; E6: their bodies', async () => {
    const world = new ECSWorld({ id: DEFAULT_ECS_WORLD_ID });
    world.createEntity({ appId: 'plain' });
    const ballId = await createPhysicsEntity(
      { type: 'BALL', radius: 0.5 },
      { rigidType: 'DYNAMIC' },
      undefined,
      { appId: 'ball' }
    );
    expect(getPhysicsEntityByAppId('ball')).toBe(ballId);
    expect(getPhysicsEntityByAppId('plain')).toBeUndefined();
    expect(getPhysicsEntityByAppId('missing')).toBeUndefined();
    expect(getPhysicsEntityBody(world, ballId)).toBe(world.getRigidBody(ballId));
    expect(getPhysicsEntityBody(world, getEntityIdByAppId('plain')!)).toBeUndefined();
  });

  it('A4: deletes without a world are quiet no-ops', async () => {
    await deletePhysicsWorld();
    expect(deleteRigidBodySync(1)).toBeUndefined();
    expect(deleteRigidBodiesSync([1, 2])).toEqual([]);
    expect(await deleteRigidBodies([1, 2])).toEqual([]);
    expect(deleteColliderSync(1)).toBeUndefined();
    expect(await deleteCollider(1)).toBeUndefined();
    expect(deleteCollidersSync([1])).toEqual([]);
    expect(deleteJointSync(1)).toBeUndefined();
    expect(await deleteJoint(1)).toBeUndefined();
  });

  it('D6: the stop deletes the world, releases the hold and the listener, and creates no world', async () => {
    await createPhysicsWorld();
    createRigidBodySync({ rigidType: 'DYNAMIC' });
    expect(visibility.listeners.size).toBe(1);
    holdPhysicsStepping();
    stopPhysics();
    expect(isPhysicsWorldEnabled()).toBe(false);
    expect(count(getAllRigidBodyEntries())).toBe(0);
    expect(count(getAllRigidBodyIds())).toBe(0);
    expect(isPhysicsSteppingHeld()).toBe(false);
    expect(visibility.listeners.size).toBe(0);
    expect(await createPhysicsWorld()).toBeUndefined();
    expect(isPhysicsWorldEnabled()).toBe(false);
    stopPhysics();
  });
});
