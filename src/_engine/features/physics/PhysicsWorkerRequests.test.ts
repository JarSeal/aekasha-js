import { describe, expect, it, vi } from 'vitest';

// WORKER_THREAD requests against the real worker module and the real Rapier (the compat build
// runs in Node), on this thread: a fake `Worker` loads the worker module with a stubbed `self` and
// structured-clones every message both ways on a macrotask, as postMessage does.

const bridge = vi.hoisted(() => {
  type Listener = (event: { data: unknown }) => unknown;
  const state = {
    /** Queue the worker's messages until `releaseReplies()`: a delete between a request and its reply. */
    holdReplies: false,
    held: [] as unknown[],
    /** What the worker's message handler rejected with (a browser reports it as unhandled). */
    workerRejections: [] as unknown[],
    /** Every message posted to the worker, as it arrived there. */
    sent: [] as { type: number; [key: string]: unknown }[],
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
    private listeners: Listener[] = [];

    constructor() {
      state.instance = this;
      vi.stubGlobal('self', {
        crossOriginIsolated: false,
        addEventListener: (_type: string, fn: Listener) => this.listeners.push(fn),
        postMessage: (message: unknown) => {
          const copy = structuredClone(message);
          if (state.holdReplies) state.held.push(copy);
          else setTimeout(() => this.deliver(copy));
        },
      });
      void import('./worker/PhysicsWorker');
    }

    deliver(data: unknown) {
      this.onmessage?.({ data });
    }

    postMessage(message: unknown) {
      const copy = structuredClone(message);
      state.sent.push(copy as (typeof state.sent)[number]);
      setTimeout(() => {
        for (const fn of this.listeners) {
          const result = fn({ data: copy });
          if (result instanceof Promise) result.catch((err) => state.workerRejections.push(err));
        }
      });
    }

    terminate() {}
  }

  return { state, InProcessWorker };
});

vi.mock('./worker/PhysicsWorker?worker', () => ({ default: bridge.InProcessWorker }));

import { initEnvironment, loadConfig } from '../../kernel/config/Config';
import * as THREE from 'three/webgpu';
import { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import {
  createCollider,
  createJoint,
  createPhysicsWorld,
  createRigidBodies,
  getPhysicsWorld,
  initPhysics,
} from './PhysicsAPI';
import { PhysicsProtocolType } from './PhysicsAPITypes';
import { createPhysicsEntity, deleteAllPhysicsEntities } from './PhysicsEntity';
// The worker's own backend module: the in-process worker imports the same instance
import { getAllRigidBodyIds } from './backends/rapier/EngineRapier';

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

/** A rotation's fields as a plain object: what the worker must receive. */
const plain = ({ x, y, z, w }: THREE.Quaternion) => ({ x, y, z, w });

const countBodies = () => [...getAllRigidBodyIds()].length;

describe('physics worker requests (WORKER_THREAD, in-process worker)', () => {
  it('boots against the real worker and creates collider 0', async () => {
    initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });
    loadConfig({ physics: { enabled: true, workerTarget: 'WORKER_THREAD', useSAB: false } });
    await initPhysics(true);
    await createPhysicsWorld();
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
    bridge.state.workerRejections.length = 0;
    const creation = createCollider(BROKEN_TRIMESH);
    expect(await settlesWithin(creation, 300)).toMatch(/^rejected: .*indices/);
    expect(bridge.state.workerRejections).toEqual([]);
  });

  it('A1: a createPhysicsEntity the worker fails rejects', async () => {
    bridge.state.workerRejections.length = 0;
    const world = new ECSWorld({ id: 'p614-a1' });
    const creation = createPhysicsEntity(
      BROKEN_TRIMESH,
      { rigidType: 'FIXED' },
      undefined,
      undefined,
      world
    );
    expect(await settlesWithin(creation, 300)).toMatch(/^rejected: .*indices/);
    expect(bridge.state.workerRejections).toEqual([]);
  });

  it('A10: a body whose collider fails is deleted', async () => {
    const world = new ECSWorld({ id: 'p614-a10' });
    const bodiesBefore = countBodies();
    const creation = createPhysicsEntity(
      [{ type: 'BALL', radius: 0.5 }, BROKEN_TRIMESH],
      { rigidType: 'DYNAMIC' },
      undefined,
      undefined,
      world
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
      { type: 'BALL', radius: 0.5 },
      { rigidType: 'DYNAMIC', translation: { x: 0, y: 2, z: 0 } },
      undefined,
      undefined,
      world
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
});
