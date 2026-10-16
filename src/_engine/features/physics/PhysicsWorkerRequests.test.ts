import { describe, expect, it, vi } from 'vitest';

// WORKER_THREAD requests against the real worker module and the real Rapier (the compat build
// runs in Node), on this thread: a fake `Worker` loads the worker module with a stubbed `self` and
// structured-clones every message both ways on a macrotask, as postMessage does.
// p614 Phase 0 reproduces A1 and E1 here as `it.fails` (red, so the suite stays green); Phase 1
// fixes them and makes them `it`.

const bridge = vi.hoisted(() => {
  type Listener = (event: { data: unknown }) => unknown;
  const state = {
    /** Queue the worker's messages until `releaseReplies()`: a delete between a request and its reply. */
    holdReplies: false,
    held: [] as unknown[],
    /** What the worker's message handler rejected with (a browser reports it as unhandled). */
    workerRejections: [] as unknown[],
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
import { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { createCollider, createPhysicsWorld, initPhysics } from './PhysicsAPI';
import { createPhysicsEntity, deleteAllPhysicsEntities } from './PhysicsEntity';

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

describe('physics worker requests (WORKER_THREAD, in-process worker)', () => {
  it('boots against the real worker and creates a collider', async () => {
    initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });
    loadConfig({ physics: { enabled: true, workerTarget: 'WORKER_THREAD', useSAB: false } });
    await initPhysics(true);
    await createPhysicsWorld();
    const collider = await createCollider({ type: 'BALL', radius: 0.5 });
    expect(collider.id).toBeTypeOf('number');
  });

  // A1: the worker's handler returns the COLL / RIGID / JOINT switch's promise without awaiting it,
  // so a throw there skips its catch (no ERROR reply), and the facade ignores an ERROR's requestId
  it.fails('A1: a request the worker fails rejects, and the worker replies ERROR', async () => {
    bridge.state.workerRejections.length = 0;
    const creation = createCollider(BROKEN_TRIMESH);
    expect(await settlesWithin(creation, 300)).toMatch(/^rejected: .*indices/);
    expect(bridge.state.workerRejections).toEqual([]);
  });

  it.fails('A1: a createPhysicsEntity the worker fails rejects', async () => {
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

  // E1: createPhysicsEntityNow doesn't re-check its entity after the create's await
  it.fails('E1: an entity deleted while its create is in flight gets nothing back', async () => {
    const world = new ECSWorld({ id: 'p614-e1' });
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
  });
});
