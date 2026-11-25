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
    /** The transfer list of every message the worker posted with one, by the message's type. */
    transfers: [] as { type: number; transfer: unknown[] }[],
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
        postMessage: (message: unknown, transfer?: unknown[]) => {
          if (transfer) {
            state.transfers.push({ type: (message as { type: number }).type, transfer });
          }
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
import type { RigidBodyAPI } from './types/PhysicsBodyTypes';
import { createJoint } from './PhysicsJoints';
import { createMultibodyJoint, deleteMultibodyJoint } from './PhysicsMultibodyJoints';
import { getMultibodyJoint } from './PhysicsRegistry';
import { MultibodyJointProxyAPI } from './proxies/MultibodyJointProxyAPI';
import type { MultibodyJointParams } from './types/PhysicsJointTypes';
import { facade, getPhysicsState, getPhysicsWorld } from './PhysicsState';
import {
  createPhysicsWorld,
  flushPhysics,
  getResolvedTransportMode,
  initPhysics,
  onPhysicsRestore,
  resetPhysicsWorld,
  restorePhysicsSnapshot,
  setPhysicsWorldBounds,
  stopPhysics,
  takePhysicsSnapshot,
} from './PhysicsWorld';
import {
  getPhysicsSimClock,
  getPhysicsSnapshotStepIndex,
  latchPhysicsSnapshot,
  resetSimClock,
} from './PhysicsStepping';
import { getResolverStats } from '../../utils/PromiseResolver';
import { PhysicsProtocolType } from './protocol/PhysicsProtocolType';
import {
  createPhysicsEntity,
  deleteAllPhysicsEntities,
  installPhysicsEntities,
  physicsToTransformSystem,
  reconcilePhysicsEntitiesAfterRestore,
} from './PhysicsEntity';
import { WorldProxyAPI } from './proxies/WorldProxyAPI';
import { getPhysicsTier, installPhysicsTiers, requestPhysicsTier } from './PhysicsTiers';
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

let isEntitiesInstalled = false;
/** Physics' install of its entities (the TAG_IS_PHYSICS_OBJECT delete hook disposes a deleted
 * entity's body) and their restore hook (p500 Phase 3). Static, so installed once, by the first
 * test that needs them: the tests after it have them too. */
const installEntities = () => {
  if (isEntitiesInstalled) return;
  isEntitiesInstalled = true;
  installPhysicsEntities(
    {
      registerTransformResetListener: () => {},
      registerComponentHooks: ECSWorld.registerComponentHooks.bind(ECSWorld),
    } as unknown as FeatureContext,
    new ECSWorld({ id: 'p500-worker-entity-systems' })
  );
  onPhysicsRestore(reconcilePhysicsEntitiesAfterRestore);
};

type WorldPlugin = (world: ECSWorld) => void;
let tiersPlugin: WorldPlugin | undefined;
/** The tiers' install (their hooks, the joint listener, the restore hook) and its system on `world`.
 * The install is static, so it runs once, by the first test that needs it. */
const installTiers = (world: ECSWorld) => {
  if (!tiersPlugin) {
    installPhysicsTiers({
      registerPlugin: (plugin: WorldPlugin) => (tiersPlugin = plugin),
      registerComponentHooks: ECSWorld.registerComponentHooks.bind(ECSWorld),
    } as unknown as FeatureContext);
  }
  tiersPlugin!(world);
};

describe('physics worker requests (WORKER_THREAD, in-process worker)', () => {
  it('boots against the real worker and creates collider 0', async () => {
    initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });
    loadConfig({
      // useSAB: the stubbed `self` isn't cross-origin isolated, so MESSAGE_BATCH until a test makes
      // it so (the p500 restores in SHARED_MEMORY)
      physics: { enabled: true, workerTarget: 'WORKER_THREAD', useSAB: true, maxCcdSubsteps: 3 },
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

  it('p250: a multibody joint is made, asked, refused and deleted through the worker', async () => {
    const hinge = (body1Id: number, body2Id: number): MultibodyJointParams => ({
      type: 'REVOLUTE',
      body1Id,
      body2Id,
      anchor1: { x: 0.5, y: 0, z: 0 },
      anchor2: { x: -0.5, y: 0, z: 0 },
      axis: { x: 0, y: 0, z: 1 },
    });
    const root = await createRigidBody({ rigidType: 'FIXED', translation: { x: 300, y: 0, z: 0 } });
    const [a, b, c] = await createRigidBodies(
      [301, 302, 303].map((x) => ({ rigidType: 'DYNAMIC', translation: { x, y: 0, z: 0 } }))
    );
    // The child counts as linked from the request on: its type check doesn't wait for the reply
    const creating = createMultibodyJoint(hinge(root.id, a.id));
    expect(() => a.setBodyType(RigidBodyTypeAPI.Fixed, true)).toThrow(
      "it's a multibody link with a parent"
    );
    expect(a.bodyTypeSync()).toBe(RigidBodyTypeAPI.Dynamic);
    const ra = await creating;
    expect(ra).toBeInstanceOf(MultibodyJointProxyAPI);
    expect(getMultibodyJoint(ra.id)).toBe(ra);
    expect(getPhysicsWorld().getMultibodyJointSync(ra.id)).toBe(ra);

    // A FIXED one's frames cross as plain objects
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1);
    const ab = await createMultibodyJoint({
      type: 'FIXED',
      body1Id: a.id,
      body2Id: b.id,
      anchor1: { x: 0.5, y: 0, z: 0 },
      frame1: rotation,
      anchor2: { x: -0.5, y: 0, z: 0 },
      frame2: new THREE.Quaternion(),
    });
    const sent = lastSent(PhysicsProtocolType.CREATE_MULTIBODY_JOINT)?.params as { frame1: object };
    expect(sent.frame1).toEqual(plain(rotation));

    // Its queries and setters
    expect(await ab.isValid()).toBe(true);
    expect(() => ab.isValidSync()).toThrow('MultibodyJointAPI.isValidSync()');
    expect(ab.body2IdSync()).toBe(b.id);
    expect(await ab.contactsEnabled()).toBe(true);
    ab.setContactsEnabled(false);
    expect(await ab.contactsEnabled()).toBe(false);
    ab.setUserData({ name: 'arm' });
    expect(await ab.getUserData()).toEqual({ name: 'arm' });

    // The worker's refusal rejects
    expect(await settlesWithin(createMultibodyJoint(hinge(b.id, a.id)), 300)).toMatch(
      /^rejected: .*body2 has a parent already/
    );

    // A body's delete takes its joints; a joint's delete resolves with its id
    const bc = await createMultibodyJoint(hinge(b.id, c.id));
    await deleteRigidBody(a.id);
    expect([ra, ab].map((j) => j.isBeingDeleted)).toEqual([true, true]);
    expect(getMultibodyJoint(ab.id)).toBeUndefined();
    expect(bc.isBeingDeleted).toBe(false);
    expect(await deleteMultibodyJoint(bc.id)).toBe(bc.id);
    expect(bc.isBeingDeleted).toBe(true);
    // b is a root now: it can change type
    b.setBodyType(RigidBodyTypeAPI.Fixed, true);
    expect(b.bodyTypeSync()).toBe(RigidBodyTypeAPI.Fixed);
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

  /** Steps the worker's world `steps` times (the tests step by message, not by stepPhysics) and
   * waits for the write-back, latched as a frame would. */
  const stepWorker = async (steps: number) => {
    messageWorker({ type: PhysicsProtocolType.STEP, steps, isOneWay: true });
    await flushPhysics();
    latchPhysicsSnapshot();
  };

  /** A body proxy's transform-buffer slot (-1 without one). */
  const slotOf = (body: RigidBodyAPI) => (body as unknown as { slot: number }).slot;

  /** p500 Phase 2's matrix, on a fresh world in the transport `mode`. */
  const checkRestoreMatrix = async (mode: 'MESSAGE_BATCH' | 'SHARED_MEMORY') => {
    await resetPhysicsWorld();
    expect(getResolvedTransportMode()).toBe(mode);
    const falling = await createRigidBody({
      rigidType: 'DYNAMIC',
      translation: { x: 0, y: 10, z: 0 },
    });
    const switched = await createRigidBody({
      rigidType: 'DYNAMIC',
      translation: { x: 3, y: 10, z: 0 },
    });
    const fixed = await createRigidBody({ rigidType: 'FIXED', translation: { x: 5, y: 0, z: 0 } });
    const deletedSince = await createRigidBody({
      rigidType: 'DYNAMIC',
      translation: { x: 9, y: 10, z: 0 },
    });
    await stepWorker(10);

    const snapshot = await takePhysicsSnapshot();
    expect(snapshot?.step).toBe(10);
    // The worker transferred its bytes' buffer (D9)
    const { transfers } = bridge.state;
    expect(transfers[transfers.length - 1].type).toBe(PhysicsProtocolType.TAKE_SNAPSHOT);
    const [transferred] = transfers[transfers.length - 1].transfer as ArrayBuffer[];
    expect(transferred.byteLength).toBe(snapshot!.bytes.byteLength);
    const byteLength = snapshot!.bytes.byteLength;
    const atSnapshot = { pos: falling.pos, linvel: falling.linvel() };

    // Since the snapshot: a body made (with a collider) and one deleted, a body's type and enabled
    // state switched, the fixed one moved, the gravity set; then a write not shown yet, on the
    // main thread's clock as 35 issued steps would leave it (these tests step by message)
    const late = await createRigidBody({
      rigidType: 'DYNAMIC',
      translation: { x: 12, y: 10, z: 0 },
    });
    const lateCollider = await createCollider({ type: 'BALL', radius: 0.5 }, late.id);
    const lateSlot = slotOf(late);
    await deleteRigidBody(deletedSince.id);
    switched.setEnabled(false);
    switched.setBodyType(RigidBodyTypeAPI.Fixed, false);
    fixed.setTranslation({ x: 5, y: 3, z: 0 }, false);
    getPhysicsWorld().setGravity({ x: 0, y: -20, z: 0 });
    await stepWorker(25);
    resetSimClock(35);
    falling.setLinvel({ x: 7, y: 7, z: 7 }, true);
    expect(falling.linvel()).toEqual({ x: 7, y: 7, z: 7 });

    const world = getPhysicsWorld();
    const result = await restorePhysicsSnapshot(snapshot!);
    expect(facade.isRestoringSnapshot).toBe(false);
    expect(result.world).toBe(world);
    expect(getPhysicsWorld()).toBe(world);
    expect(result.reapedRigidBodyIds).toEqual([late.id]);
    expect(result.reapedColliderIds).toEqual([lateCollider.id]);
    expect(result.orphanCounts.rigidBodies).toBe(1);
    expect(late.isBeingDeleted).toBe(true);

    // Shown without a step (D13), on the snapshot's step, the write not shown dropped
    latchPhysicsSnapshot();
    expect(getPhysicsSnapshotStepIndex()).toBe(10);
    expect(getPhysicsSimClock()).toBe(10);
    expect(falling.pos).toEqual(atSnapshot.pos);
    expect(falling.linvel()).toEqual(atSnapshot.linvel);
    // The proxies' and the world proxy's copies are the restored world's
    expect([switched.isEnabledSync(), switched.bodyTypeSync()]).toEqual([
      true,
      RigidBodyTypeAPI.Dynamic,
    ]);
    expect(fixed.pos).toEqual({ x: 5, y: 0, z: 0 });
    expect(world.getGravitySync().y).toBeCloseTo(-9.81, 5);
    expect(await world.getGravity()).toEqual(world.getGravitySync());

    // The reaped body's slot is free again: the next create takes it
    const again = await createRigidBody({ rigidType: 'DYNAMIC' });
    expect(slotOf(again)).toBe(lateSlot);

    // The same snapshot again: its bytes were copied to the worker, not transferred
    expect(snapshot!.bytes.byteLength).toBe(byteLength);
    await stepWorker(5);
    const second = await restorePhysicsSnapshot(snapshot!);
    expect(second.reapedRigidBodyIds).toEqual([again.id]);
    latchPhysicsSnapshot();
    expect(falling.pos).toEqual(atSnapshot.pos);
    expect(getResolverStats().pendingRequests).toBe(0);
  };

  it('p500: a restore through the worker (MESSAGE_BATCH)', async () => {
    await checkRestoreMatrix('MESSAGE_BATCH');
  });

  it('p500: a restore through the worker (SHARED_MEMORY)', async () => {
    const self = globalThis.self as unknown as { crossOriginIsolated: boolean };
    self.crossOriginIsolated = true;
    try {
      await checkRestoreMatrix('SHARED_MEMORY');
    } finally {
      self.crossOriginIsolated = false;
      await resetPhysicsWorld();
    }
  });

  it('p250 D7: a restore through the worker rebinds the multibody joints, forgets the ones made since and takes out the ones deleted since, with KEEP too', async () => {
    await resetPhysicsWorld();
    const hinge = (body1Id: number, body2Id: number): MultibodyJointParams => ({
      type: 'REVOLUTE',
      body1Id,
      body2Id,
      anchor1: { x: 0.5, y: 0, z: 0 },
      anchor2: { x: -0.5, y: 0, z: 0 },
      axis: { x: 0, y: 0, z: 1 },
    });
    const root = await createRigidBody({ rigidType: 'FIXED', translation: { x: 300, y: 0, z: 0 } });
    const [a, b, c] = await createRigidBodies(
      [301, 302, 303].map((x) => ({ rigidType: 'DYNAMIC', translation: { x, y: 0, z: 0 } }))
    );
    const ab = await createMultibodyJoint(hinge(root.id, a.id));
    const bc = await createMultibodyJoint(hinge(a.id, b.id));
    const snapshot = (await takePhysicsSnapshot())!;
    await deleteMultibodyJoint(bc.id);
    const late = await createMultibodyJoint(hinge(b.id, c.id));

    const result = await restorePhysicsSnapshot(snapshot, { orphanPolicy: 'KEEP' });
    expect(result.reapedMultibodyJointIds).toEqual([late.id]);
    expect(result.orphanCounts.multibodyJoints).toBe(1);
    expect(late.isBeingDeleted).toBe(true);
    expect(getMultibodyJoint(late.id)).toBeUndefined();
    expect(getMultibodyJoint(ab.id)).toBe(ab);
    expect(await ab.isValid()).toBe(true);
    // The deleted joint stayed out: the worker's tree has b free for a parent again
    await createMultibodyJoint(hinge(a.id, b.id));
    await stepWorker(1);
    expect(getResolverStats().pendingRequests).toBe(0);
  });

  it('p500: overlapping restores apply in order, and stepping waits for the last', async () => {
    await resetPhysicsWorld();
    await createRigidBody({ rigidType: 'DYNAMIC', translation: { x: 0, y: 10, z: 0 } });
    const snapshot = (await takePhysicsSnapshot())!;
    const first = restorePhysicsSnapshot(snapshot);
    const last = restorePhysicsSnapshot(snapshot);
    await first;
    expect(facade.isRestoringSnapshot).toBe(true);
    await last;
    expect(facade.isRestoringSnapshot).toBe(false);
  });

  it("p500: a restore drops the world bounds' exits not delivered, and the bounds stay", async () => {
    await resetPhysicsWorld();
    const handled: OutOfBoundsRecord[] = [];
    setOutOfBoundsHandler((records) => handled.push(...records));
    try {
      setPhysicsWorldBounds({ min: { y: -5 } });
      const body = await createRigidBody({
        rigidType: 'DYNAMIC',
        translation: { x: 50, y: 0, z: 0 },
        linvel: { x: 0, y: -600, z: 0 },
      });
      const snapshot = (await takePhysicsSnapshot())!;
      await stepWorker(1);
      expect(getOutOfBoundsExitSteps().get(body.id)).toBe(1);
      await restorePhysicsSnapshot(snapshot);
      // Taken back with its step: neither noted nor delivered
      expect(getOutOfBoundsExitSteps().has(body.id)).toBe(false);
      flushPhysicsEvents();
      expect(handled).toEqual([]);
      expect(await body.isEnabled()).toBe(true);
      // The bounds survived the restore: the same step leaves them again
      await stepWorker(1);
      flushPhysicsEvents();
      expect(handled.map((r) => [r.bodyId, r.step])).toEqual([[body.id, 1]]);
    } finally {
      setOutOfBoundsHandler(null);
      setPhysicsWorldBounds(null);
    }
  });

  it('p500 Phase 3: the entities made after the snapshot go, and their deletes send nothing', async () => {
    installEntities();
    await resetPhysicsWorld();
    const world = new ECSWorld({ id: 'p500-worker-reconcile' });
    const BALL = { type: 'BALL', radius: 0.5 } as const;
    const ball = (x: number) =>
      createPhysicsEntity(
        { colliders: BALL, body: { rigidType: 'DYNAMIC', translation: { x, y: 10, z: 0 } } },
        { world }
      );
    const kept = await ball(0);
    const wall = await createPhysicsEntity({ colliders: BALL }, { world });
    const snapshot = (await takePhysicsSnapshot())!;

    // Since the snapshot: an entity with a body, one with a collider only, and a collider on the
    // kept entity's body
    const late = await ball(3);
    const lateWall = await createPhysicsEntity({ colliders: BALL }, { world });
    const keptColliders = world.getComponent(kept, ComponentType.COLLIDER)!;
    const [keptCollider] = keptColliders;
    keptColliders.push(await createCollider(BALL, world.getRigidBody(kept)!.id));

    const sentBefore = bridge.state.sent.length;
    await restorePhysicsSnapshot(snapshot);
    expect([late, lateWall].map((id) => world.isAlive(id))).toEqual([false, false]);
    expect([kept, wall].map((id) => world.isAlive(id))).toEqual([true, true]);
    expect(keptColliders).toEqual([keptCollider]);
    // The delete hook's disposal found the ids forgotten: no delete reached the worker
    await flushPhysics();
    const deletes = [
      PhysicsProtocolType.DELETE_RIGID_BODY,
      PhysicsProtocolType.DELETE_RIGID_BODIES,
      PhysicsProtocolType.DELETE_COLLIDER,
      PhysicsProtocolType.DELETE_COLLIDERS,
    ];
    expect(bridge.state.sent.slice(sentBefore).filter((m) => deletes.includes(m.type))).toEqual([]);
    expect(countBodies()).toBe(1);
    expect(getResolverStats().pendingRequests).toBe(0);
  });

  it('p500 Phase 3: BODY_STATIC entities moved since the snapshot get their restored pose', async () => {
    installEntities();
    await resetPhysicsWorld();
    const world = new ECSWorld({ id: 'p500-worker-static-sync' });
    facade.tiersInstalled = true;
    try {
      const create = (x: number, rigidType: 'FIXED' | 'DYNAMIC', initialTier?: 'STATIC') =>
        createPhysicsEntity(
          {
            colliders: { type: 'BALL', radius: 0.5 },
            body: { rigidType, translation: { x, y: 0, z: 0 } },
          },
          { world, initialTier }
        );
      // No transform slot (its proxy keeps its pose), and a tier's (its pose in the buffer)
      const fixedId = await create(5, 'FIXED');
      const frozenId = await create(7, 'DYNAMIC', 'STATIC');
      const ids = [fixedId, frozenId];
      const positionsX = () =>
        ids.map((id) => world.getComponent(id, ComponentType.TRANSFORM)!.position.x);
      const snapshot = (await takePhysicsSnapshot())!;
      for (const id of ids) world.getRigidBody(id)!.setTranslation({ x: 20, y: 0, z: 0 }, false);
      // A step later the moves are shown, and their syncs are done
      await stepWorker(1);
      physicsToTransformSystem(world);
      expect(positionsX()).toEqual([20, 20]);

      await restorePhysicsSnapshot(snapshot);
      latchPhysicsSnapshot();
      physicsToTransformSystem(world);
      expect(positionsX()).toEqual([5, 7]);
    } finally {
      facade.tiersInstalled = false;
    }
  });

  it('p500 Phase 3: the tiers become what the restored bodies are, from the reply', async () => {
    installEntities();
    await resetPhysicsWorld();
    const world = new ECSWorld({ id: 'p500-worker-tiers' });
    installTiers(world);
    facade.tiersInstalled = true;
    try {
      const create = (x: number, initialTier?: 'STATIC') =>
        createPhysicsEntity(
          {
            colliders: { type: 'BALL', radius: 0.5 },
            body: { rigidType: 'DYNAMIC', translation: { x, y: 10, z: 0 } },
          },
          { world, initialTier }
        );
      const frozen = await create(0); // FULL, STATIC since
      const thawed = await create(2, 'STATIC'); // FULL since
      const removed = await create(4); // REMOVED since
      const snapshot = (await takePhysicsSnapshot())!;
      requestPhysicsTier(frozen, 'STATIC', world);
      requestPhysicsTier(thawed, 'FULL', world);
      requestPhysicsTier(removed, 'REMOVED', world);
      world.updatePhysicsStep(0);
      await stepWorker(1);
      expect(world.getRigidBody(frozen)!.bodyTypeSync()).toBe(RigidBodyTypeAPI.Fixed);

      await restorePhysicsSnapshot(snapshot);
      const ids = [frozen, thawed, removed];
      expect(
        ids.map((id) => {
          const { tier, pending } = getPhysicsTier(id, world);
          return [tier, pending, world.hasComponent(id, ComponentType.BODY_STATIC)];
        })
      ).toEqual([
        ['FULL', null, false],
        ['STATIC', null, true],
        ['REMOVED', null, false],
      ]);
      expect(world.hasComponent(frozen, ComponentType.BODY_DYNAMIC_HEADLESS)).toBe(true);
      // The worker agrees
      expect(await world.getRigidBody(frozen)!.bodyType()).toBe(RigidBodyTypeAPI.Dynamic);
      expect(await world.getRigidBody(thawed)!.bodyType()).toBe(RigidBodyTypeAPI.Fixed);
    } finally {
      facade.tiersInstalled = false;
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
