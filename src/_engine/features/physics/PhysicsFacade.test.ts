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
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { runInPhysicsCreationScope } from '../../kernel/ecs/PhysicsTierAccess';
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
import { createJointSync, deleteJoint, deleteJointSync } from './PhysicsJoints';
import { requestPhysicsTierWants } from './PhysicsTiers';
import type { PhysicsTier } from './PhysicsTierTypes';
import { RigidBodyTypeAPI } from './types/PhysicsBodyTypes';
import { getAllColliderEntries, getAllRigidBodyEntries } from './PhysicsRegistry';
import { facade, getPhysicsState, getPhysicsWorld, isPhysicsWorldEnabled } from './PhysicsState';
import { holdPhysicsStepping, isPhysicsSteppingHeld } from './PhysicsStepping';
import {
  createPhysicsWorld,
  deletePhysicsWorld,
  initPhysics,
  resetPhysicsWorld,
  stopPhysics,
} from './PhysicsWorld';
import {
  getAllRigidBodyIds,
  getColliderAPIWithId,
  getRigidBodyAPIWithId,
} from './backends/rapier/EngineRapier';

// The facade on MAIN_THREAD, against the real Rapier backend (the compat build runs in Node)

/** A TRIMESH without indices: the backend's `paramsToShape` throws. */
const BROKEN_TRIMESH = { type: 'TRIMESH', vertices: new Float32Array(9) } as const;

const count = (entries: IterableIterator<unknown>) => [...entries].length;

const BALL = { type: 'BALL', radius: 0.5 } as const;

/** A DYNAMIC ball entity in `world` at `x`, with `opts`' physics options. */
const createBall = (world: ECSWorld, x: number, opts?: Parameters<typeof createPhysicsEntity>[1]) =>
  createPhysicsEntity(
    { colliders: BALL, body: { rigidType: 'DYNAMIC', translation: { x, y: 5, z: 0 } } },
    { world, ...opts }
  );

/** The tier an entity's request has queued (its PHYSICS_SIM_TIER target; none: FULL). */
const targetOf = (world: ECSWorld, entityId: number) =>
  world.getComponent(entityId, ComponentType.PHYSICS_SIM_TIER)?.target ?? 'FULL';

describe('the facade (MAIN_THREAD)', () => {
  it('boots and creates the world', async () => {
    initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });
    loadConfig({ physics: { enabled: true, workerTarget: 'MAIN_THREAD', maxCcdSubsteps: 3 } });
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
      { colliders: { type: 'BALL', radius: 0.5 }, body: { rigidType: 'DYNAMIC' } },
      { appId: 'ball' }
    );
    expect(getPhysicsEntityByAppId('ball')).toBe(ballId);
    expect(getPhysicsEntityByAppId('plain')).toBeUndefined();
    expect(getPhysicsEntityByAppId('missing')).toBeUndefined();
    expect(getPhysicsEntityBody(world, ballId)).toBe(world.getRigidBody(ballId));
    expect(getPhysicsEntityBody(world, getEntityIdByAppId('plain')!)).toBeUndefined();
  });

  it('p353 D3: initialTier makes the body STATIC or DISABLED before any step, only with the tiers', async () => {
    const world = new ECSWorld({ id: 'p353-initial-tier' });
    facade.tiersInstalled = true;
    try {
      const staticId = await createBall(world, 0, { initialTier: 'STATIC' });
      const staticBody = getRigidBodyAPIWithId(world.getRigidBody(staticId)!.id)!;
      expect(staticBody.isFixedSync()).toBe(true);
      expect(world.hasComponent(staticId, ComponentType.BODY_STATIC)).toBe(true);
      expect(world.hasComponent(staticId, ComponentType.BODY_DYNAMIC_HEADLESS)).toBe(false);
      expect(world.getComponent(staticId, ComponentType.PHYSICS_SIM_TIER)).toMatchObject({
        tier: 'STATIC',
        target: 'STATIC',
        bucket: 'BODY_DYNAMIC_HEADLESS',
      });

      const disabledId = await createBall(world, 2, { initialTier: 'DISABLED' });
      const disabledBody = getRigidBodyAPIWithId(world.getRigidBody(disabledId)!.id)!;
      expect(disabledBody.isEnabledSync()).toBe(false);
      expect(disabledBody.bodyTypeSync()).toBe(RigidBodyTypeAPI.Dynamic);
      expect(world.getComponent(disabledId, ComponentType.PHYSICS_SIM_TIER)?.tier).toBe('DISABLED');

      // A FIXED body has no tier: the option is ignored
      const fixedId = await createPhysicsEntity(
        { colliders: BALL, body: { rigidType: 'FIXED' } },
        { world, initialTier: 'STATIC' }
      );
      expect(world.hasComponent(fixedId, ComponentType.PHYSICS_SIM_TIER)).toBe(false);
    } finally {
      facade.tiersInstalled = false;
    }
    // Without physicsTiers(): ignored (with one warning)
    const fullId = await createBall(world, 4, { initialTier: 'STATIC' });
    expect(world.hasComponent(fullId, ComponentType.BODY_DYNAMIC_HEADLESS)).toBe(true);
    expect(getRigidBodyAPIWithId(world.getRigidBody(fullId)!.id)!.isFixedSync()).toBe(false);
  });

  it('p353 D3, D5: a creation scope gives its tier, holds policy members out, and loses to the option', async () => {
    const world = new ECSWorld({ id: 'p353-creation-scope' });
    facade.tiersInstalled = true;
    try {
      const held: number[] = [];
      const scope = {
        tier: 'STATIC' as const,
        holdPolicyMember: (_w: ECSWorld, id: number) => held.push(id),
      };
      const [memberId, fullId] = await runInPhysicsCreationScope(scope, () =>
        Promise.all([
          createBall(world, 0, { tierPolicy: true }),
          createBall(world, 2, { initialTier: 'FULL' }),
        ])
      );
      expect(world.getComponent(memberId, ComponentType.PHYSICS_SIM_TIER)?.tier).toBe('STATIC');
      expect(world.hasComponent(memberId, ComponentType.PHYSICS_TIER_POLICY)).toBe(false);
      expect(held).toEqual([memberId]);
      expect(world.hasComponent(fullId, ComponentType.PHYSICS_SIM_TIER)).toBe(false);
      // Outside the scope: as before
      const outsideId = await createBall(world, 4, { tierPolicy: true });
      expect(world.hasComponent(outsideId, ComponentType.PHYSICS_SIM_TIER)).toBe(false);
      expect(world.hasComponent(outsideId, ComponentType.PHYSICS_TIER_POLICY)).toBe(true);
    } finally {
      facade.tiersInstalled = false;
    }
  });

  it('p353 D6: a batch gives a joint group its finest want, leaves POLICY groups alone, skips the rest quietly', async () => {
    const world = new ECSWorld({ id: 'p353-tier-wants' });
    facade.tiersInstalled = true;
    try {
      const [a, b, c, lone] = await Promise.all([0, 2, 4, 6].map((x) => createBall(world, x)));
      const fixedId = await createPhysicsEntity(
        { colliders: BALL, body: { rigidType: 'FIXED' } },
        { world }
      );
      const joint = (id1: number, id2: number) =>
        createJointSync({
          type: 'SPHERICAL',
          body1Id: world.getRigidBody(id1)!.id,
          body2Id: world.getRigidBody(id2)!.id,
          anchor1: { x: 1, y: 0, z: 0 },
          anchor2: { x: -1, y: 0, z: 0 },
        });
      const joints = [joint(a, b), joint(b, c)];
      const wants = new Map<number, PhysicsTier | 'POLICY'>([
        [a, 'DISABLED'],
        [b, 'STATIC'],
        [c, 'DISABLED'],
        [lone, 'DISABLED'],
        [fixedId, 'STATIC'],
      ]);
      const wantOf = (id: number) => wants.get(id) ?? null;
      // Only a and the lone ball listed: the group asks b and c too, and takes b's STATIC
      requestPhysicsTierWants(world, [a, lone, fixedId], wantOf);
      expect([a, b, c].map((id) => targetOf(world, id))).toEqual(['STATIC', 'STATIC', 'STATIC']);
      expect(targetOf(world, lone)).toBe('DISABLED');
      expect(world.hasComponent(fixedId, ComponentType.PHYSICS_SIM_TIER)).toBe(false);

      // A POLICY member leaves the group to the policy
      wants.set(c, 'POLICY');
      wants.set(a, 'DISABLED');
      wants.set(b, 'DISABLED');
      requestPhysicsTierWants(world, [a], wantOf);
      expect([a, b, c].map((id) => targetOf(world, id))).toEqual(['STATIC', 'STATIC', 'STATIC']);
      for (const j of joints) deleteJointSync(j.id);
    } finally {
      facade.tiersInstalled = false;
    }
  });

  it("D7: every new world gets the config's maxCcdSubsteps, 0 included; the setter sets it", async () => {
    expect(getPhysicsWorld().getMaxCcdSubstepsSync()).toBe(3);
    getPhysicsWorld().setMaxCcdSubsteps(5);
    expect(getPhysicsWorld().getMaxCcdSubstepsSync()).toBe(5);
    // A scene load's fresh world
    await resetPhysicsWorld();
    expect(getPhysicsWorld().getMaxCcdSubstepsSync()).toBe(3);
    getPhysicsState().maxCcdSubsteps = 0;
    await resetPhysicsWorld();
    expect(getPhysicsWorld().getMaxCcdSubstepsSync()).toBe(0);
    getPhysicsState().maxCcdSubsteps = 3;
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
