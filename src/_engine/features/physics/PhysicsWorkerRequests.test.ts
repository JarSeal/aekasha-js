import { describe, expect, it, vi } from 'vitest';

// WORKER_THREAD requests against the real worker module and the real Rapier (the compat build
// runs in Node), on this thread: a fake `Worker` loads the worker module with a stubbed `self` and
// structured-clones every message both ways on a macrotask, as postMessage does. Both sides talk
// through their transports (p614 D5), as in the browser. The worker's handler never rejects (its
// catch replies ERROR); if it did, Vitest would fail the run on the unhandled rejection.

const bridge = vi.hoisted(() => {
  type Listener = (event: { data: unknown }) => unknown;
  const state = {
    /** Queue the worker's messages until `releaseReplies()`: a delete between a request and its reply. */
    holdReplies: false,
    held: [] as unknown[],
    /** Whether the main thread terminated the worker. */
    terminated: false,
    /** Every message posted to the worker, as it arrived there. */
    sent: [] as { type: number; [key: string]: unknown }[],
    /** Every message the worker posted, as the main thread got it. */
    received: [] as { type: number; [key: string]: unknown }[],
    instance: undefined as { deliver: (data: unknown) => void } | undefined,
    releaseReplies() {
      state.holdReplies = false;
      const held = state.held;
      state.held = [];
      for (const message of held) setTimeout(() => state.instance?.deliver(message));
    },
  };

  class InProcessWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((err: unknown) => void) | null = null;
    /** The worker module's listeners on its `self`. */
    private listeners: Listener[] = [];
    /** The main thread's listeners on this worker (its transport's). */
    private mainListeners: Listener[] = [];

    constructor() {
      state.instance = this;
      vi.stubGlobal('self', {
        crossOriginIsolated: false,
        // Rapier's step reads its clock through `self` (a STEP panics with `unreachable` without)
        performance: globalThis.performance,
        addEventListener: (_type: string, fn: Listener) => this.listeners.push(fn),
        removeEventListener: (_type: string, fn: Listener) => {
          this.listeners = this.listeners.filter((listener) => listener !== fn);
        },
        postMessage: (message: unknown) => {
          const copy = structuredClone(message);
          if (state.holdReplies) state.held.push(copy);
          else setTimeout(() => this.deliver(copy));
        },
      });
      void import('./worker/PhysicsWorker');
    }

    deliver(data: unknown) {
      if (state.terminated) return;
      state.received.push(data as (typeof state.received)[number]);
      this.onmessage?.({ data });
      for (const fn of this.mainListeners) fn({ data });
    }

    addEventListener(_type: string, fn: Listener) {
      this.mainListeners.push(fn);
    }

    removeEventListener(_type: string, fn: Listener) {
      this.mainListeners = this.mainListeners.filter((listener) => listener !== fn);
    }

    postMessage(message: unknown) {
      if (state.terminated) return;
      const copy = structuredClone(message);
      state.sent.push(copy as (typeof state.sent)[number]);
      setTimeout(() => {
        for (const fn of this.listeners) fn({ data: copy });
      });
    }

    terminate() {
      state.terminated = true;
    }
  }

  return { state, InProcessWorker };
});

vi.mock('./worker/PhysicsWorker?worker', () => ({ default: bridge.InProcessWorker }));

import { initEnvironment, loadConfig } from '../../kernel/config/Config';
import * as THREE from 'three/webgpu';
import { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import {
  createRigidBodies,
  createRigidBody,
  deleteRigidBody,
  detachRigidBody,
  reattachRigidBody,
} from './PhysicsBodies';
import { createCollider, createColliders } from './PhysicsColliders';
import {
  beginSubStepCapture,
  endSubStepCapture,
  flushPhysicsEvents,
  getOutOfBoundsExitSteps,
  messageWorker,
  setOutOfBoundsHandler,
} from './PhysicsMessaging';
import type { OutOfBoundsRecord } from './types/PhysicsWorldBoundsTypes';
import {
  handleOutOfBounds,
  installPhysicsWorldBounds,
  setEntityWorldBounds,
} from './PhysicsWorldBounds';
import type { FeatureContext } from '../../kernel/init/Features';
import { RigidBodyTypeAPI } from './types/PhysicsBodyTypes';
import { createJoint } from './PhysicsJoints';
import { facade, getPhysicsState, getPhysicsWorld } from './PhysicsState';
import {
  createPhysicsWorld,
  flushPhysics,
  initPhysics,
  resetPhysicsWorld,
  setPhysicsWorldBounds,
  stopPhysics,
} from './PhysicsWorld';
import { PhysicsProtocolType } from './protocol/PhysicsProtocolType';
import { createPhysicsEntity, deleteAllPhysicsEntities } from './PhysicsEntity';
import { WorldProxyAPI } from './proxies/WorldProxyAPI';
// The worker's own backend module: the in-process worker imports the same instance
import {
  getAllRigidBodyIds,
  getColliderAPIWithId,
  getRigidBodyAPIWithId,
} from './backends/rapier/EngineRapier';
import type { RigidBodyProxyAPI } from './proxies/RigidBodyProxyAPI';

/** What `promise` did within `ms` (a reply takes a few macrotasks here). */
const settlesWithin = (promise: Promise<unknown>, ms: number) =>
  Promise.race([
    promise.then(
      () => 'resolved',
      (err: unknown) => `rejected: ${err instanceof Error ? err.message : String(err)}`
    ),
    new Promise<string>((resolve) => setTimeout(() => resolve('pending'), ms)),
  ]);

/** A TRIMESH without indices: the worker's `paramsToShape` throws. */
const BROKEN_TRIMESH = { type: 'TRIMESH', vertices: new Float32Array(9) } as const;

/** The last message of `type` the worker received. */
const lastSent = (type: PhysicsProtocolType) => {
  const { sent } = bridge.state;
  for (let i = sent.length - 1; i >= 0; i--) if (sent[i].type === type) return sent[i];
  return undefined;
};

/** The last message of `type` the worker posted to the main thread. */
const lastReceived = (type: PhysicsProtocolType) => {
  const { received } = bridge.state;
  for (let i = received.length - 1; i >= 0; i--) if (received[i].type === type) return received[i];
  return undefined;
};

/** A rotation's fields as a plain object: what the worker must receive. */
const plain = ({ x, y, z, w }: THREE.Quaternion) => ({ x, y, z, w });

const countBodies = () => [...getAllRigidBodyIds()].length;

/** The world bounds' install (p102): the WORLD_BOUNDS hooks are static, so installed once; the
 * tests that deliver exits set the handler themselves. */
installPhysicsWorldBounds({
  registerComponentHooks: ECSWorld.registerComponentHooks.bind(ECSWorld),
} as unknown as FeatureContext);
setOutOfBoundsHandler(null);

describe('physics worker requests (WORKER_THREAD, in-process worker)', () => {
  it('boots against the real worker and creates collider 0', async () => {
    initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });
    loadConfig({
      physics: { enabled: true, workerTarget: 'WORKER_THREAD', useSAB: false, maxCcdSubsteps: 3 },
    });
    await initPhysics(true);
    // doNotCreateWorld: the worker answers worldCreated false, so no world proxy yet
    expect(getPhysicsWorld()).not.toBeInstanceOf(WorldProxyAPI);
    await createPhysicsWorld();
    expect(getPhysicsWorld()).toBeInstanceOf(WorldProxyAPI);
    const collider = await createCollider({ type: 'BALL', radius: 0.5 });
    expect(collider.id).toBe(0);
  });

  it('A3: collider 0 gets its contact pairs asked for', async () => {
    const pairs: number[] = [];
    await getPhysicsWorld().contactPairsWith(0, (other) => pairs.push(other.id));
    expect(lastSent(PhysicsProtocolType.WORLD_CONTACT_PAIRS_WITH)?.colliderId).toBe(0);
  });

  it('A2: createRigidBodies and a FIXED createJoint send plain rotations', async () => {
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1);
    const [body1, body2] = await createRigidBodies([
      { rigidType: 'DYNAMIC', rotation },
      { rigidType: 'DYNAMIC', translation: { x: 2, y: 0, z: 0 } },
    ]);
    const sentBodies = lastSent(PhysicsProtocolType.CREATE_RIGID_BODIES)?.params as {
      rotation?: object;
    }[];
    expect(sentBodies[0].rotation).toEqual(plain(rotation));
    expect(body1.rot.w).toBeCloseTo(rotation.w, 5);
    expect(body1.rot.y).toBeCloseTo(rotation.y, 5);

    await createJoint({
      type: 'FIXED',
      body1Id: body1.id,
      body2Id: body2.id,
      anchor1: { x: 0, y: 0, z: 0 },
      frame1: rotation,
      anchor2: { x: 0, y: 0, z: 0 },
      frame2: new THREE.Quaternion(),
    });
    const sentJoint = lastSent(PhysicsProtocolType.CREATE_JOINT)?.params as {
      frame1: object;
      frame2: object;
    };
    expect(sentJoint.frame1).toEqual(plain(rotation));
    expect(sentJoint.frame2).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  // A1: the worker's handler returns the COLL / RIGID / JOINT switch's promise without awaiting it,
  // so a throw there skips its catch (no ERROR reply), and the facade ignores an ERROR's requestId
  it('A1: a request the worker fails rejects, and the worker replies ERROR', async () => {
    const creation = createCollider(BROKEN_TRIMESH);
    expect(await settlesWithin(creation, 300)).toMatch(/^rejected: .*indices/);
  });

  it('A1: a createPhysicsEntity the worker fails rejects', async () => {
    const world = new ECSWorld({ id: 'p614-a1' });
    const creation = createPhysicsEntity(
      { colliders: BROKEN_TRIMESH, body: { rigidType: 'FIXED' } },
      { world }
    );
    expect(await settlesWithin(creation, 300)).toMatch(/^rejected: .*indices/);
  });

  it('A10: a body whose collider fails is deleted', async () => {
    const world = new ECSWorld({ id: 'p614-a10' });
    const bodiesBefore = countBodies();
    const creation = createPhysicsEntity(
      {
        colliders: [{ type: 'BALL', radius: 0.5 }, BROKEN_TRIMESH],
        body: { rigidType: 'DYNAMIC' },
      },
      { world }
    );
    expect(await settlesWithin(creation, 300)).toMatch(/^rejected: .*indices/);
    expect(countBodies()).toBe(bodiesBefore);
    expect([...world.getEntitiesWith(ComponentType.TAG_IS_PHYSICS_OBJECT)]).toEqual([]);
  });

  // E1: createPhysicsEntityNow doesn't re-check its entity after the create's await
  it('E1: an entity deleted while its create is in flight gets nothing back', async () => {
    const world = new ECSWorld({ id: 'p614-e1' });
    const bodiesBefore = countBodies();
    bridge.state.holdReplies = true;
    const creation = createPhysicsEntity(
      {
        colliders: { type: 'BALL', radius: 0.5 },
        body: { rigidType: 'DYNAMIC', translation: { x: 0, y: 2, z: 0 } },
      },
      { world }
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    const [entityId] = [...world.getEntitiesWith(ComponentType.TAG_IS_PHYSICS_OBJECT)];
    expect(entityId).toBeTypeOf('number');
    deleteAllPhysicsEntities(world); // a scene exit, while the reply is held
    bridge.state.releaseReplies();
    expect(await settlesWithin(creation, 300)).not.toBe('pending');
    expect(world.hasComponent(entityId, ComponentType.COLLIDER)).toBe(false);
    expect(world.hasComponent(entityId, ComponentType.BODY_DYNAMIC_HEADLESS)).toBe(false);
    // The body the create made is deleted again (its DELETE posted after the reply)
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(countBodies()).toBe(bodiesBefore);
  });

  it('p353 D3: initialTier rides in the create and switches the body before its reply', async () => {
    const world = new ECSWorld({ id: 'p353-worker-initial-tier' });
    facade.tiersInstalled = true;
    try {
      const create = (initialTier: 'STATIC' | 'DISABLED') =>
        createPhysicsEntity(
          { colliders: { type: 'BALL', radius: 0.5 }, body: { rigidType: 'DYNAMIC' } },
          { world, initialTier }
        );
      const staticId = await create('STATIC');
      expect(lastSent(PhysicsProtocolType.CREATE_PHYSICS_ENTITY)?.tier).toBe('STATIC');
      const staticProxy = world.getRigidBody(staticId) as RigidBodyProxyAPI;
      // Its slot kept (a requested STATIC keeps it), its proxy caching the tier's type
      expect(staticProxy.hasSlot).toBe(true);
      expect(staticProxy.bodyTypeSync()).toBe(RigidBodyTypeAPI.Fixed);
      expect(getRigidBodyAPIWithId(staticProxy.id)!.isFixedSync()).toBe(true);
      expect(world.hasComponent(staticId, ComponentType.BODY_STATIC)).toBe(true);
      expect(world.getComponent(staticId, ComponentType.PHYSICS_SIM_TIER)?.tier).toBe('STATIC');

      const disabledId = await create('DISABLED');
      const disabledProxy = world.getRigidBody(disabledId) as RigidBodyProxyAPI;
      expect(disabledProxy.isEnabledSync()).toBe(false);
      expect(getRigidBodyAPIWithId(disabledProxy.id)!.isEnabledSync()).toBe(false);
    } finally {
      facade.tiersInstalled = false;
    }
  });

  it('A10: createColliders is all or nothing', async () => {
    const probe = await createCollider({ type: 'BALL', radius: 0.5 });
    const creation = createColliders([{ type: 'BALL', radius: 0.5 }, BROKEN_TRIMESH]);
    expect(await settlesWithin(creation, 300)).toMatch(/^rejected: .*indices/);
    // Ids are handed out in order: the ball made before the broken TRIMESH got the next one
    expect(getColliderAPIWithId(probe.id + 1)).toBeUndefined();
  });

  it('A9: a reattached body keeps its new type and enabled state on the proxy', async () => {
    const body = await createRigidBody({ rigidType: 'DYNAMIC' });
    expect(body.isEnabledSync()).toBe(true);
    await detachRigidBody(body.id);
    await reattachRigidBody(body.id, { bodyType: RigidBodyTypeAPI.Fixed, enabled: false });
    expect(body.bodyTypeSync()).toBe(RigidBodyTypeAPI.Fixed);
    expect(body.isEnabledSync()).toBe(false);
    body.setEnabled(true);
    expect(body.isEnabledSync()).toBe(true);
  });

  it('a deleted body, its colliders and its joints are marked isBeingDeleted', async () => {
    const [body1, body2] = await createRigidBodies([
      { rigidType: 'DYNAMIC' },
      { rigidType: 'DYNAMIC', translation: { x: 2, y: 0, z: 0 } },
    ]);
    const collider = await createCollider({ type: 'BALL', radius: 0.5 }, body1.id);
    const joint = await createJoint({
      type: 'SPHERICAL',
      body1Id: body1.id,
      body2Id: body2.id,
      anchor1: { x: 0, y: 0, z: 0 },
      anchor2: { x: 0, y: 0, z: 0 },
    });
    await deleteRigidBody(body1.id);
    expect([body1, collider, joint].map((api) => api.isBeingDeleted)).toEqual([true, true, true]);
    expect(body2.isBeingDeleted).toBe(false);
  });

  it('A7: a sub-step capture is made on its first command only', () => {
    beginSubStepCapture();
    expect(endSubStepCapture()).toBeNull();
    beginSubStepCapture();
    messageWorker({ type: PhysicsProtocolType.RIGID_WAKE_UP, rigidBodyId: 0 });
    expect(endSubStepCapture()).toEqual([
      { type: PhysicsProtocolType.RIGID_WAKE_UP, rigidBodyId: 0 },
    ]);
  });

  // Replaces the world: after the tests that use the first world's collider 0
  it("p102: the world bounds' exits reach the main thread in the next STEP's EVENTS_PUSH", async () => {
    await resetPhysicsWorld();
    // Outside before the bounds are set: their set catches it, on the new world's step 0
    const below = await createRigidBody({
      rigidType: 'DYNAMIC',
      translation: { x: 50, y: -10, z: 0 },
    });
    // A corner given as a Vector3 goes as plain data, and a side not given isn't sent
    setPhysicsWorldBounds({ min: { y: -5 }, max: new THREE.Vector3(1e6, 1e6, 1e6) });
    // 10 m down in its first step: outside after step 1
    const falling = await createRigidBody({
      rigidType: 'DYNAMIC',
      translation: { x: 60, y: 0, z: 0 },
      linvel: { x: 0, y: -600, z: 0 },
    });
    await createCollider({ type: 'BALL', radius: 0.5 }, falling.id);
    messageWorker({ type: PhysicsProtocolType.STEP, steps: 1, isOneWay: true });
    // Replied after the STEP's push
    await flushPhysics();
    const push = lastReceived(PhysicsProtocolType.EVENTS_PUSH);
    expect(push?.outOfBounds).toEqual([
      { bodyId: below.id, step: 0, x: 50, y: -10, z: 0, source: 'GLOBAL', frozen: false },
      expect.objectContaining({ bodyId: falling.id, step: 1, source: 'GLOBAL' }),
    ]);
    expect(getRigidBodyAPIWithId(falling.id)?.isEnabledSync()).toBe(false);
    expect(lastSent(PhysicsProtocolType.SET_WORLD_BOUNDS)?.bounds).toEqual({
      min: { y: -5 },
      max: { x: 1e6, y: 1e6, z: 1e6 },
    });

    // Noted on arrival (the probe's read); the push waits for the next sub-step's flush, which hands
    // the exits to the handler
    expect(getOutOfBoundsExitSteps().get(falling.id)).toBe(1);
    const handled: OutOfBoundsRecord[] = [];
    setOutOfBoundsHandler((records) => handled.push(...records));
    try {
      flushPhysicsEvents();
    } finally {
      setOutOfBoundsHandler(null);
    }
    expect(handled.map((r) => r.bodyId)).toEqual([below.id, falling.id]);
  });

  it('p102: an entity whose body leaves the bounds is deleted at the flush after the push', async () => {
    await resetPhysicsWorld();
    setOutOfBoundsHandler(handleOutOfBounds);
    const world = new ECSWorld({ id: 'p102-worker' });
    try {
      setPhysicsWorldBounds({ min: { y: -5 } });
      const id = await createPhysicsEntity(
        {
          colliders: { type: 'BALL', radius: 0.5 },
          body: {
            rigidType: 'DYNAMIC',
            translation: { x: 50, y: 0, z: 0 },
            linvel: { x: 0, y: -600, z: 0 },
          },
        },
        { world }
      );
      messageWorker({ type: PhysicsProtocolType.STEP, steps: 1, isOneWay: true });
      await flushPhysics();
      expect(world.isAlive(id)).toBe(true);
      flushPhysicsEvents();
      expect(world.isAlive(id)).toBe(false);
    } finally {
      setOutOfBoundsHandler(null);
      setPhysicsWorldBounds(null);
    }
  });

  it("p102 Phase 2: an entity's own bounds go with its create, a set and a set made in flight", async () => {
    await resetPhysicsWorld();
    setOutOfBoundsHandler(handleOutOfBounds);
    const world = new ECSWorld({ id: 'p102-worker-own' });
    /** A ball entity resting below the kill height (no gravity), with `opts`. */
    const createLow = (x: number, opts?: Parameters<typeof createPhysicsEntity>[1]) =>
      createPhysicsEntity(
        {
          colliders: { type: 'BALL', radius: 0.5 },
          body: { rigidType: 'DYNAMIC', translation: { x, y: -10, z: 0 }, gravityScale: 0 },
        },
        { world, ...opts }
      );
    const subStep = async () => {
      messageWorker({ type: PhysicsProtocolType.STEP, steps: 1, isOneWay: true });
      await flushPhysics();
      flushPhysicsEvents();
    };
    try {
      setPhysicsWorldBounds({ min: { y: -5 } });
      // The corner as plain data with its given sides only, the action and callback left out
      const deep = await createLow(50, {
        worldBounds: { min: new THREE.Vector3(-1e6, -100, -1e6) },
      });
      expect(lastSent(PhysicsProtocolType.CREATE_PHYSICS_ENTITY)?.worldBounds).toEqual({
        min: { x: -1e6, y: -100, z: -1e6 },
      });
      const ignored = await createLow(60, { worldBounds: { ignore: true, min: { y: 0 } } });
      expect(lastSent(PhysicsProtocolType.CREATE_PHYSICS_ENTITY)?.worldBounds).toBe('IGNORE');

      // Set while the create is in flight: sent once the body is known
      bridge.state.holdReplies = true;
      const creation = createLow(70);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const [inFlight] = [...world.getEntitiesWith(ComponentType.TAG_IS_PHYSICS_OBJECT)].filter(
        (id) => id !== deep && id !== ignored
      );
      setEntityWorldBounds(inFlight, { ignore: true }, world);
      expect(lastSent(PhysicsProtocolType.RIGID_SET_BOUNDS)).toBeUndefined();
      bridge.state.releaseReplies();
      await creation;
      expect(lastSent(PhysicsProtocolType.RIGID_SET_BOUNDS)).toMatchObject({
        rigidBodyId: world.getRigidBody(inFlight)!.id,
        bounds: 'IGNORE',
      });

      await subStep();
      expect([deep, ignored, inFlight].map((id) => world.isAlive(id))).toEqual([true, true, true]);

      // A set on a live entity: RIGID_SET_BOUNDS, out by its own box on the next step
      setEntityWorldBounds(deep, { min: { y: -1 } }, world);
      expect(lastSent(PhysicsProtocolType.RIGID_SET_BOUNDS)?.bounds).toEqual({ min: { y: -1 } });
      await subStep();
      expect(world.isAlive(deep)).toBe(false);
      expect(lastReceived(PhysicsProtocolType.EVENTS_PUSH)?.outOfBounds).toEqual([
        expect.objectContaining({ source: 'ENTITY' }),
      ]);
    } finally {
      bridge.state.releaseReplies();
      setOutOfBoundsHandler(null);
      setPhysicsWorldBounds(null);
    }
  });

  it("p102 Phase 2: an exit's delivery updates the proxy's cached state, then DISABLE applies", async () => {
    await resetPhysicsWorld();
    setOutOfBoundsHandler(handleOutOfBounds);
    const world = new ECSWorld({ id: 'p102-worker-actions' });
    const createLow = (x: number) =>
      createPhysicsEntity(
        {
          colliders: { type: 'BALL', radius: 0.5 },
          body: { rigidType: 'DYNAMIC', translation: { x, y: -10, z: 0 }, gravityScale: 0 },
        },
        { world, worldBounds: { action: 'DISABLE' } }
      );
    try {
      setPhysicsWorldBounds({ min: { y: -5 } });
      const loose = await createLow(50);
      const anchor = await createLow(60);
      const hanging = await createLow(62);
      await createJoint({
        type: 'SPHERICAL',
        body1Id: world.getRigidBody(anchor)!.id,
        body2Id: world.getRigidBody(hanging)!.id,
        anchor1: { x: 1, y: 0, z: 0 },
        anchor2: { x: -1, y: 0, z: 0 },
      });
      messageWorker({ type: PhysicsProtocolType.STEP, steps: 1, isOneWay: true });
      await flushPhysics();
      // Not delivered yet: the proxies still cache what the main thread last set
      expect(world.getRigidBody(loose)!.isEnabledSync()).toBe(true);
      flushPhysicsEvents();
      expect(world.getRigidBody(loose)!.isEnabledSync()).toBe(false);
      expect(world.isDisabled(loose)).toBe(true);
      for (const id of [anchor, hanging]) {
        const body = world.getRigidBody(id)!;
        expect([world.isDisabled(id), body.isEnabledSync(), body.bodyTypeSync()]).toEqual([
          true,
          true,
          RigidBodyTypeAPI.Fixed,
        ]);
        // The worker agrees
        expect([await body.isEnabled(), await body.bodyType()]).toEqual([
          true,
          RigidBodyTypeAPI.Fixed,
        ]);
      }
      expect(await world.getRigidBody(loose)!.isEnabled()).toBe(false);
    } finally {
      setOutOfBoundsHandler(null);
      setPhysicsWorldBounds(null);
    }
  });

  it("D7: every new world gets the config's maxCcdSubsteps, 0 included; the setter sets it", async () => {
    // The proxy's copy and the worker's world
    const read = async () => [
      getPhysicsWorld().getMaxCcdSubstepsSync(),
      await getPhysicsWorld().getMaxCcdSubsteps(),
    ];
    expect(await read()).toEqual([3, 3]);
    getPhysicsWorld().setMaxCcdSubsteps(5);
    expect(await read()).toEqual([5, 5]);
    // A scene load's fresh world
    await resetPhysicsWorld();
    expect(await read()).toEqual([3, 3]);
    getPhysicsState().maxCcdSubsteps = 0;
    await resetPhysicsWorld();
    expect(await read()).toEqual([0, 0]);
    getPhysicsState().maxCcdSubsteps = 3;
  });

  // Last: physics stays stopped for this file
  it('D6: the stop terminates the worker and rejects what is pending, and later requests', async () => {
    bridge.state.holdReplies = true;
    const pending = createCollider({ type: 'BALL', radius: 0.5 });
    const captured = settlesWithin(pending, 300);
    await new Promise((resolve) => setTimeout(resolve, 20));
    stopPhysics();
    expect(await captured).toMatch(/^rejected: Physics was stopped/);
    expect(bridge.state.terminated).toBe(true);
    expect(await settlesWithin(createCollider({ type: 'BALL', radius: 0.5 }), 100)).toMatch(
      /^rejected: Physics world is not created/
    );
    expect(await createPhysicsWorld()).toBeUndefined();
    bridge.state.releaseReplies();
  });
});
