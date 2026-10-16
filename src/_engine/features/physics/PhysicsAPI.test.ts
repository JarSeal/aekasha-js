import { describe, expect, it } from 'vitest';
import { initEnvironment, loadConfig } from '../../kernel/config/Config';
import {
  createColliderSync,
  createPhysicsWorld,
  createRigidBodySync,
  createRigidBodyWithCollidersSync,
  deleteColliderSync,
  deleteCollider,
  deleteCollidersSync,
  deleteJoint,
  deleteJointSync,
  deletePhysicsWorld,
  deleteRigidBodiesSync,
  deleteRigidBodies,
  deleteRigidBodySync,
  getAllColliderEntries,
  getAllRigidBodyEntries,
  initPhysics,
} from './PhysicsAPI';
import { getAllRigidBodyIds, getColliderAPIWithId } from './backends/rapier/EngineRapier';

// The facade on MAIN_THREAD, against the real Rapier backend (the compat build runs in Node)

/** A TRIMESH without indices: the backend's `paramsToShape` throws. */
const BROKEN_TRIMESH = { type: 'TRIMESH', vertices: new Float32Array(9) } as const;

const count = (entries: IterableIterator<unknown>) => [...entries].length;

describe('PhysicsAPI (MAIN_THREAD)', () => {
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
});
