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
import type { FeatureContext } from '../../kernel/init/Features';
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
import { onPhysicsJointCreated, requestPhysicsTier, requestPhysicsTierWants } from './PhysicsTiers';
import type { PhysicsTier } from './PhysicsTierTypes';
import { RigidBodyTypeAPI } from './types/PhysicsBodyTypes';
import { getAllColliderEntries, getAllRigidBodyEntries } from './PhysicsRegistry';
import { facade, getPhysicsState, getPhysicsWorld, isPhysicsWorldEnabled } from './PhysicsState';
import {
  getPhysicsSnapshotStepIndex,
  holdPhysicsStepping,
  isPhysicsSteppingHeld,
} from './PhysicsStepping';
import {
  flushPhysicsEvents,
  getOutOfBoundsExitSteps,
  setOutOfBoundsHandler,
} from './PhysicsMessaging';
import type { OutOfBoundsRecord, WorldBoundsExitEvent } from './types/PhysicsWorldBoundsTypes';
import {
  applySceneWorldBounds,
  getWorldBoundsStats,
  handleOutOfBounds,
  installPhysicsWorldBounds,
  registerSceneJsonWorldBounds,
  setEntityWorldBounds,
  setSceneWorldBounds,
} from './PhysicsWorldBounds';
import { setLoadingSceneId } from '../../kernel/scene/Scene';
import {
  createPhysicsWorld,
  deletePhysicsWorld,
  initPhysics,
  onPhysicsRestore,
  resetPhysicsWorld,
  restorePhysicsSnapshot,
  setPhysicsWorldBounds,
  stopPhysics,
  takePhysicsSnapshot,
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

/** The world bounds' install (p102): the WORLD_BOUNDS hooks are static, so installed once; the
 * tests that deliver exits set the handler themselves. */
installPhysicsWorldBounds({
  registerComponentHooks: ECSWorld.registerComponentHooks.bind(ECSWorld),
} as unknown as FeatureContext);
setOutOfBoundsHandler(null);

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

  it('p353: a jointed body is STATIC where DISABLED is asked for, and a new joint makes it so', async () => {
    // docs/issues/i250_rapier-joint-on-disabled-bodies-panics.md: disabled bodies with joints corrupt
    // Rapier's solving of other joints
    const world = new ECSWorld({ id: 'p353-joint-safe-tier' });
    facade.tiersInstalled = true;
    try {
      const [a, b, lone, c, d] = await Promise.all(
        [0, 2, 4, 6, 8].map((x) => createBall(world, x))
      );
      const body = (id: number) => world.getRigidBody(id)!;
      const spherical = (id1: number, id2: number) =>
        createJointSync({
          type: 'SPHERICAL',
          body1Id: body(id1).id,
          body2Id: body(id2).id,
          anchor1: { x: 1, y: 0, z: 0 },
          anchor2: { x: -1, y: 0, z: 0 },
        });
      const ab = spherical(a, b);
      expect(requestPhysicsTier(a, 'DISABLED', world)).toBe(true);
      expect([a, b].map((id) => targetOf(world, id))).toEqual(['STATIC', 'STATIC']);
      expect(requestPhysicsTier(lone, 'DISABLED', world)).toBe(true);
      expect(targetOf(world, lone)).toBe('DISABLED');
      requestPhysicsTierWants(world, [lone], () => 'DISABLED');
      expect(targetOf(world, lone)).toBe('DISABLED');
      // p353 Phase 5 D11: a batch's REMOVED is STATIC for a jointed group (the request refuses it)
      expect(requestPhysicsTier(a, 'REMOVED', world)).toBe(false);
      requestPhysicsTierWants(world, [a, lone], () => 'REMOVED');
      expect([a, b].map((id) => targetOf(world, id))).toEqual(['STATIC', 'STATIC']);
      expect(targetOf(world, lone)).toBe('REMOVED');

      // c and d DISABLED, then joined: the listener moves them to STATIC
      requestPhysicsTier(c, 'DISABLED', world);
      requestPhysicsTier(d, 'DISABLED', world);
      const cd = spherical(c, d);
      onPhysicsJointCreated(body(c).id, body(d).id);
      expect([c, d].map((id) => targetOf(world, id))).toEqual(['STATIC', 'STATIC']);
      for (const j of [ab, cd]) deleteJointSync(j.id);
    } finally {
      facade.tiersInstalled = false;
    }
  });

  it('a joint created between disabled bodies after a step steps (Rapier 0.19.3 panicked)', async () => {
    // docs/issues/i250_rapier-joint-on-disabled-bodies-panics.md: both disabled, and disabled to fixed
    const world = new ECSWorld({ id: 'p353-joint-on-disabled' });
    facade.tiersInstalled = true;
    try {
      const [a, b, c] = await Promise.all(
        [0, 2, 4].map((x) => createBall(world, x, { initialTier: 'DISABLED' }))
      );
      const fixedId = await createPhysicsEntity(
        { colliders: BALL, body: { rigidType: 'FIXED', translation: { x: 6, y: 5, z: 0 } } },
        { world }
      );
      const pw = getPhysicsWorld();
      pw.step();
      const body = (id: number) => world.getRigidBody(id)!;
      const joints = [
        createJointSync({
          type: 'SPHERICAL',
          body1Id: body(a).id,
          body2Id: body(b).id,
          anchor1: { x: 1, y: 0, z: 0 },
          anchor2: { x: -1, y: 0, z: 0 },
        }),
        createJointSync({
          type: 'SPHERICAL',
          body1Id: body(c).id,
          body2Id: body(fixedId).id,
          anchor1: { x: 1, y: 0, z: 0 },
          anchor2: { x: -1, y: 0, z: 0 },
        }),
      ];
      expect(() => {
        for (let i = 0; i < 10; i++) pw.step();
      }).not.toThrow();
      // Still disabled, where they were
      for (const id of [a, b, c]) {
        const rb = getRigidBodyAPIWithId(body(id).id)!;
        expect(rb.isEnabledSync()).toBe(false);
        expect(rb.translation().y).toBe(5);
      }
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

  it('p102: the world bounds hand their exits to the handler at the next flush, in order', async () => {
    await resetPhysicsWorld();
    const handled: OutOfBoundsRecord[][] = [];
    setOutOfBoundsHandler((records) => handled.push([...records]));
    try {
      const below = createRigidBodySync({
        rigidType: 'DYNAMIC',
        translation: { x: 50, y: -10, z: 0 },
      });
      setPhysicsWorldBounds({ min: { y: -5 } });
      const falling = createRigidBodySync({
        rigidType: 'DYNAMIC',
        translation: { x: 60, y: 0, z: 0 },
        linvel: { x: 0, y: -600, z: 0 },
      });
      createColliderSync(BALL, falling.id);
      // A sub-step: its flush first (the set's exit), then the step (the fall's)
      flushPhysicsEvents();
      facade.engAPI!.step();
      expect(handled).toEqual([
        [{ bodyId: below.id, step: 0, x: 50, y: -10, z: 0, source: 'GLOBAL', frozen: false }],
      ]);
      // The probe's read: the step's exit before its flush delivers it
      expect([...getOutOfBoundsExitSteps()]).toEqual([
        [below.id, 0],
        [falling.id, 1],
      ]);
      flushPhysicsEvents();
      expect(handled[1]).toEqual([expect.objectContaining({ bodyId: falling.id, step: 1 })]);
      facade.engAPI!.step();
      flushPhysicsEvents();
      expect(handled).toHaveLength(2);
      expect(falling.isEnabledSync()).toBe(false);
      await resetPhysicsWorld();
      expect(getOutOfBoundsExitSteps().size).toBe(0);
    } finally {
      setOutOfBoundsHandler(null);
    }
  });

  it('p102: an entity whose body leaves the bounds is deleted at the next flush', async () => {
    await resetPhysicsWorld();
    setOutOfBoundsHandler(handleOutOfBounds);
    const world = new ECSWorld({ id: 'p102-delete' });
    try {
      const fallingId = await createPhysicsEntity(
        {
          colliders: BALL,
          body: {
            rigidType: 'DYNAMIC',
            translation: { x: 50, y: 0, z: 0 },
            linvel: { x: 0, y: -600, z: 0 },
          },
        },
        { world }
      );
      const keptId = await createBall(world, 0);
      setPhysicsWorldBounds({ min: { y: -5 } });
      facade.engAPI!.step();
      expect(world.isAlive(fallingId)).toBe(true);
      flushPhysicsEvents();
      expect(world.isAlive(fallingId)).toBe(false);
      expect(world.isAlive(keptId)).toBe(true);
    } finally {
      setOutOfBoundsHandler(null);
      setPhysicsWorldBounds(null);
    }
  });

  it("p102: a scene's bounds apply at once and to its every new world, else the config's; null turns them off", async () => {
    await resetPhysicsWorld();
    // A body below the kill height, and a step (a new body is checked before the next one)
    const createBelow = () => {
      const body = createRigidBodySync({
        rigidType: 'DYNAMIC',
        translation: { x: 50, y: -10, z: 0 },
      });
      facade.engAPI!.step();
      return body;
    };
    setLoadingSceneId('p102Own');
    try {
      const first = createBelow();
      setSceneWorldBounds({ min: { y: -5 } });
      expect(first.isEnabledSync()).toBe(false);
      // A new world starts without, until the scene hook applies the scene's again
      await resetPhysicsWorld();
      const second = createBelow();
      expect(second.isEnabledSync()).toBe(true);
      applySceneWorldBounds();
      expect(second.isEnabledSync()).toBe(false);

      // A scene without its own gets the config's, until it sets null
      facade.state.worldBounds = { min: { y: -5 } };
      setLoadingSceneId('p102Default');
      await resetPhysicsWorld();
      applySceneWorldBounds();
      expect(createBelow().isEnabledSync()).toBe(false);
      setSceneWorldBounds(null);
      expect(createBelow().isEnabledSync()).toBe(true);
      // Another scene's bounds wait for its own world
      setSceneWorldBounds({ min: { y: 0 } }, 'p102Other');
      expect(createBelow().isEnabledSync()).toBe(true);
    } finally {
      facade.state.worldBounds = null;
      setLoadingSceneId(null);
      setPhysicsWorldBounds(null);
      facade.engAPI!.drainPendingOutOfBoundsRecords();
    }
  });

  it("p102 Phase 4: a scene's JSON bounds are its own, null over the config's, until its code sets them", async () => {
    await resetPhysicsWorld();
    const createBelow = () => {
      const body = createRigidBodySync({
        rigidType: 'DYNAMIC',
        translation: { x: 50, y: -10, z: 0 },
      });
      facade.engAPI!.step();
      return body;
    };
    const loadWorld = async (sceneId: string) => {
      setLoadingSceneId(sceneId);
      await resetPhysicsWorld();
      applySceneWorldBounds();
    };
    facade.state.worldBounds = { min: { y: -5 } };
    try {
      // Registered before any load: kept, applied to the scene's worlds only
      registerSceneJsonWorldBounds('p102Json', { worldBounds: { min: { y: -20 } } });
      registerSceneJsonWorldBounds('p102JsonNull', { worldBounds: null });
      registerSceneJsonWorldBounds('p102JsonNone', {});
      await loadWorld('p102Json');
      expect(createBelow().isEnabledSync()).toBe(true); // -10 is inside its own, not the config's
      expect(getWorldBoundsStats()).toMatchObject({ def: { min: { y: -20 } }, source: 'SCENE' });
      await loadWorld('p102JsonNull');
      expect(createBelow().isEnabledSync()).toBe(true);
      expect(getWorldBoundsStats()).toMatchObject({ def: null, source: 'SCENE' });
      await loadWorld('p102JsonNone');
      expect(createBelow().isEnabledSync()).toBe(false);
      expect(getWorldBoundsStats().source).toBe('CONFIG');

      // The scene's code replaces them, at once and for its later visits
      await loadWorld('p102Json');
      setSceneWorldBounds({ min: { y: 0 } });
      await loadWorld('p102Json');
      expect(createBelow().isEnabledSync()).toBe(false);
      expect(getWorldBoundsStats().def).toEqual({ min: { y: 0 } });
    } finally {
      facade.state.worldBounds = null;
      setLoadingSceneId(null);
      setPhysicsWorldBounds(null);
      facade.engAPI!.drainPendingOutOfBoundsRecords();
    }
  });

  it('p102: a new world has no bounds', async () => {
    setPhysicsWorldBounds({ min: { y: -5 } });
    await resetPhysicsWorld();
    const body = createRigidBodySync({
      rigidType: 'DYNAMIC',
      translation: { x: 50, y: -10, z: 0 },
    });
    facade.engAPI!.step();
    expect(facade.engAPI!.drainPendingOutOfBoundsRecords()).toHaveLength(0);
    expect(body.isEnabledSync()).toBe(true);
  });

  it("p102 Phase 2: an entity's own bounds replace the world's, from its create or a set", async () => {
    await resetPhysicsWorld();
    setOutOfBoundsHandler(handleOutOfBounds);
    const world = new ECSWorld({ id: 'p102-own' });
    /** A ball entity resting below the kill height (no gravity), with `opts`. */
    const createLow = (x: number, opts?: Parameters<typeof createPhysicsEntity>[1]) =>
      createPhysicsEntity(
        {
          colliders: BALL,
          body: { rigidType: 'DYNAMIC', translation: { x, y: -10, z: 0 }, gravityScale: 0 },
        },
        { world, ...opts }
      );
    const subStep = () => {
      flushPhysicsEvents();
      facade.engAPI!.step();
      flushPhysicsEvents();
    };
    try {
      setPhysicsWorldBounds({ min: { y: -5 } });
      const ignored = await createLow(50, { worldBounds: { ignore: true } });
      const deep = await createLow(60, { worldBounds: { min: { y: -100 } } });
      // Set on the target entity before its body: the create takes them
      const targetId = world.createEntity();
      setEntityWorldBounds(targetId, { ignore: true }, world);
      const target = await createPhysicsEntity(
        {
          colliders: BALL,
          body: { rigidType: 'DYNAMIC', translation: { x: 70, y: -10, z: 0 }, gravityScale: 0 },
          target: targetId,
        },
        { world }
      );
      const plain = await createLow(80);
      subStep();
      expect([ignored, deep, target].map((id) => world.isAlive(id))).toEqual([true, true, true]);
      expect(world.isAlive(plain)).toBe(false);
      expect(world.getComponent(deep, ComponentType.WORLD_BOUNDS)).toEqual({ min: { y: -100 } });

      // A set replaces them (out by its own box), null follows the world's again
      const deepBodyId = world.getRigidBody(deep)!.id;
      const ignoredBodyId = world.getRigidBody(ignored)!.id;
      setEntityWorldBounds(deep, { min: { y: -1 } }, world);
      setEntityWorldBounds(ignored, null, world);
      expect(world.hasComponent(ignored, ComponentType.WORLD_BOUNDS)).toBe(false);
      const handled: OutOfBoundsRecord[] = [];
      setOutOfBoundsHandler((records) => {
        handled.push(...records);
        handleOutOfBounds(records);
      });
      subStep();
      expect(handled.map((r) => [r.bodyId, r.source])).toEqual([
        [deepBodyId, 'ENTITY'],
        [ignoredBodyId, 'GLOBAL'],
      ]);
      expect(world.isAlive(deep)).toBe(false);
      expect(world.isAlive(ignored)).toBe(false);
      expect(world.isAlive(target)).toBe(true);
    } finally {
      setOutOfBoundsHandler(null);
      setPhysicsWorldBounds(null);
    }
  });

  it("p102 Phase 2: the actions: the entity's own, else the scene's; DISABLE, CALLBACK, frozen", async () => {
    await resetPhysicsWorld();
    setOutOfBoundsHandler(handleOutOfBounds);
    const world = new ECSWorld({ id: 'p102-actions' });
    const createLow = (x: number, opts?: Parameters<typeof createPhysicsEntity>[1]) =>
      createPhysicsEntity(
        {
          colliders: BALL,
          body: { rigidType: 'DYNAMIC', translation: { x, y: -10, z: 0 }, gravityScale: 0 },
        },
        { world, ...opts }
      );
    const subStep = () => {
      flushPhysicsEvents();
      facade.engAPI!.step();
      flushPhysicsEvents();
    };
    setLoadingSceneId('p102Actions');
    try {
      setSceneWorldBounds({ min: { y: -5 }, action: 'DISABLE' });
      const disabled = await createLow(50);
      // Its tier policy membership goes (added here as the option would)
      world.addComponent(disabled, ComponentType.PHYSICS_TIER_POLICY, {
        refusedTier: null,
        placed: false,
      });
      const events: WorldBoundsExitEvent[] = [];
      // No side: the scene's box, the entity's own action
      const called = await createLow(60, {
        worldBounds: { action: 'CALLBACK', onExit: (e) => events.push(e) },
      });
      const deleted = await createLow(70, { worldBounds: { action: 'DELETE' } });
      const noCallback = await createLow(80, { worldBounds: { action: 'CALLBACK' } });
      // A jointed pair: frozen (FIXED), not disabled, and only the DISABLED component for DISABLE
      const anchor = await createLow(90);
      const hanging = await createLow(92);
      createJointSync({
        type: 'SPHERICAL',
        body1Id: world.getRigidBody(anchor)!.id,
        body2Id: world.getRigidBody(hanging)!.id,
        anchor1: { x: 1, y: 0, z: 0 },
        anchor2: { x: -1, y: 0, z: 0 },
      });
      subStep();

      expect(world.isAlive(disabled) && world.isDisabled(disabled)).toBe(true);
      expect(world.getRigidBody(disabled)!.isEnabledSync()).toBe(false);
      expect(world.hasComponent(disabled, ComponentType.PHYSICS_TIER_POLICY)).toBe(false);
      expect(world.isAlive(deleted)).toBe(false);
      expect(world.isDisabled(noCallback)).toBe(true);
      // CALLBACK leaves the entity as it is: alive, not disabled, its body out
      expect([world.isAlive(called), world.isDisabled(called)]).toEqual([true, false]);
      expect(events).toEqual([
        {
          entityId: called,
          world,
          bodyId: world.getRigidBody(called)!.id,
          step: 0,
          position: { x: 60, y: -10, z: 0 },
          source: 'GLOBAL',
          frozen: false,
        },
      ]);
      for (const id of [anchor, hanging]) {
        const body = world.getRigidBody(id)!;
        expect([world.isDisabled(id), body.isEnabledSync(), body.bodyTypeSync()]).toEqual([
          true,
          true,
          RigidBodyTypeAPI.Fixed,
        ]);
      }

      // The callback's put-back: moved inside and enabled, it stays in
      const body = world.getRigidBody(called)!;
      body.setTranslation({ x: 60, y: 0, z: 0 }, true);
      body.setEnabled(true);
      subStep();
      expect(events).toHaveLength(1);
      expect(body.isEnabledSync()).toBe(true);
    } finally {
      setOutOfBoundsHandler(null);
      setLoadingSceneId(null);
      setPhysicsWorldBounds(null);
    }
  });

  it("p102 Phase 3: getWorldBoundsStats: the bounds' source, the exits named with their actions, kept per scene", async () => {
    await resetPhysicsWorld();
    setOutOfBoundsHandler(handleOutOfBounds);
    const world = new ECSWorld({ id: 'p102-stats' });
    const createLow = (x: number, opts?: Parameters<typeof createPhysicsEntity>[1]) =>
      createPhysicsEntity(
        {
          colliders: BALL,
          body: { rigidType: 'DYNAMIC', translation: { x, y: -10, z: 0 }, gravityScale: 0 },
        },
        { world, ...opts }
      );
    const createBareLow = (x: number) =>
      createRigidBodySync({ rigidType: 'DYNAMIC', translation: { x, y: -10, z: 0 } });
    const subStep = () => {
      flushPhysicsEvents();
      facade.engAPI!.step();
      flushPhysicsEvents();
    };
    try {
      facade.state.worldBounds = { min: { y: -5 }, action: 'DISABLE' };
      setLoadingSceneId('p102Stats');
      applySceneWorldBounds();
      expect(getWorldBoundsStats()).toEqual({
        def: { min: { y: -5 }, action: 'DISABLE' },
        source: 'CONFIG',
        exitCount: 0,
        recentExits: [],
      });

      const named = await createLow(50, { appId: 'p102Named' });
      const deleted = await createLow(60, { worldBounds: { action: 'DELETE' } });
      const bare = createBareLow(70);
      subStep();
      const stats = getWorldBoundsStats();
      expect(stats.exitCount).toBe(3);
      expect(stats.recentExits.map((e) => [e.name, e.entityId, e.action])).toEqual([
        ['p102Named', named, 'DISABLE'],
        [`entity ${deleted}`, deleted, 'DELETE'],
        [`body ${bare.id}`, null, null],
      ]);
      expect(stats.recentExits[0]).toMatchObject({
        world,
        step: 0,
        position: { x: 50, y: -10, z: 0 },
        source: 'GLOBAL',
        frozen: false,
      });
      // The entity is gone, its exit still listed
      expect(world.isAlive(deleted)).toBe(false);

      // The latest 20 only, every exit counted
      for (let i = 0; i < 20; i++) createBareLow(100 + i);
      subStep();
      const { exitCount, recentExits } = getWorldBoundsStats();
      expect(exitCount).toBe(23);
      expect(recentExits).toHaveLength(20);
      expect(recentExits[0].position.x).toBe(100);

      // The scene's own, null included
      setSceneWorldBounds(null);
      expect(getWorldBoundsStats()).toMatchObject({ def: null, source: 'SCENE', exitCount: 23 });

      // A new scene's world starts over, without bounds when neither sets them
      facade.state.worldBounds = null;
      setLoadingSceneId('p102StatsNext');
      await resetPhysicsWorld();
      applySceneWorldBounds();
      expect(getWorldBoundsStats()).toEqual({
        def: null,
        source: 'NONE',
        exitCount: 0,
        recentExits: [],
      });
    } finally {
      facade.state.worldBounds = null;
      setOutOfBoundsHandler(null);
      setLoadingSceneId(null);
      setPhysicsWorldBounds(null);
    }
  });

  it('p102 Phase 2: own bounds on a fixed, kinematic or bodiless entity warn and are not sent', async () => {
    await resetPhysicsWorld();
    const world = new ECSWorld({ id: 'p102-not-dynamic' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sent = vi.spyOn(facade.engAPI!, 'setBodyWorldBounds');
    const boundsWarnings = () =>
      warn.mock.calls.filter((c) => String(c[0]).includes('only DYNAMIC bodies are checked'));
    try {
      await createPhysicsEntity(
        { colliders: BALL, body: { rigidType: 'FIXED' } },
        { world, worldBounds: { min: { y: 0 } } }
      );
      const kinematic = await createPhysicsEntity(
        { colliders: BALL, body: { rigidType: 'POS_BASED' } },
        { world }
      );
      setEntityWorldBounds(kinematic, { ignore: true }, world);
      const bodiless = await createPhysicsEntity({ colliders: BALL }, { world });
      setEntityWorldBounds(bodiless, { ignore: true }, world);
      // Removing them warns about nothing
      setEntityWorldBounds(kinematic, null, world);
      expect(
        boundsWarnings().map((c) => String(c[0]).match(/its body is \w+|no body/)?.[0])
      ).toEqual(['its body is FIXED', 'its body is POS_BASED', 'no body']);
      expect(sent).not.toHaveBeenCalled();
      const dynamic = await createBall(world, 0);
      setEntityWorldBounds(dynamic, { ignore: true }, world);
      expect(sent).toHaveBeenCalledTimes(1);
      expect(boundsWarnings()).toHaveLength(3);
    } finally {
      warn.mockRestore();
      sent.mockRestore();
    }
  });

  it('p500: a restore keeps the survivors, forgets what came after it before its hooks run, and rewinds the step clock', async () => {
    await resetPhysicsWorld();
    const body = createRigidBodySync({
      rigidType: 'DYNAMIC',
      translation: { x: -80, y: 10, z: 0 },
    });
    const collider = createColliderSync(BALL, body.id);
    for (let i = 0; i < 10; i++) facade.engAPI!.step();
    const snapshot = (await takePhysicsSnapshot())!;
    expect(snapshot.step).toBe(10);
    const y = body.pos.y;
    for (let i = 0; i < 10; i++) facade.engAPI!.step();
    const late = createRigidBodySync({
      rigidType: 'DYNAMIC',
      translation: { x: -90, y: 10, z: 0 },
    });
    const lateCollider = createColliderSync(BALL, late.id);
    const seen: { reaped: number[]; isLateKnown: boolean }[] = [];
    const remove = onPhysicsRestore((delta) => {
      const isLateKnown = [...getAllRigidBodyEntries()].some(([id]) => id === late.id);
      seen.push({ reaped: delta.reapedRigidBodyIds, isLateKnown });
    });

    const result = await restorePhysicsSnapshot(snapshot);
    expect(result.world).toBe(getPhysicsWorld());
    expect(result.reapedRigidBodyIds).toEqual([late.id]);
    expect(result.reapedColliderIds).toEqual([lateCollider.id]);
    expect(late.isBeingDeleted).toBe(true);
    expect(lateCollider.isBeingDeleted).toBe(true);
    expect(count(getAllColliderEntries())).toBe(1);
    // The facade forgot the reaped body before the hooks ran
    expect(seen).toEqual([{ reaped: [late.id], isLateKnown: false }]);
    expect(body.pos.y).toBe(y);
    expect(collider.isBeingDeleted).toBe(false);
    expect(getPhysicsSnapshotStepIndex()).toBe(10);
    expect(facade.isRestoringSnapshot).toBe(false);

    remove();
    await restorePhysicsSnapshot(snapshot);
    expect(seen).toHaveLength(1);
  });

  it("p500: the world's settings come back with a snapshot, the state's doubles kept where unchanged", async () => {
    const state = getPhysicsState();
    const { gravity, timestepRatio } = state;
    const snapshot = (await takePhysicsSnapshot())!;
    getPhysicsWorld().setGravity({ x: 0, y: -1, z: 0 });
    state.gravity = { x: 0, y: -1, z: 0 };
    await restorePhysicsSnapshot(snapshot);
    expect(state.gravity.y).toBeCloseTo(gravity.y, 5);
    expect(getPhysicsWorld().getGravitySync().y).toBeCloseTo(gravity.y, 5);
    expect(state.timestepRatio).toBe(timestepRatio);
  });

  it('p500: a snapshot of another world is refused, and nothing changes', async () => {
    const snapshot = (await takePhysicsSnapshot())!;
    await resetPhysicsWorld();
    const body = createRigidBodySync({ rigidType: 'DYNAMIC' });
    await expect(restorePhysicsSnapshot(snapshot)).rejects.toThrow(/another world/);
    expect(facade.isRestoringSnapshot).toBe(false);
    expect(body.isBeingDeleted).toBe(false);
    expect(count(getAllRigidBodyEntries())).toBe(1);
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
