import { afterEach, describe, expect, it, vi } from 'vitest';
import { InspectorBase } from 'three/webgpu';

type FakePool = {
  timestamps: Map<string, number>;
  queryOffsets: Map<string, number>;
  queryStates?: Map<number, string>;
};

// A renderer whose resolves the test settles by hand, and the closer system it calls itself
const fake = vi.hoisted(() => ({
  renderer: null as null | Record<string, unknown>,
  systems: new Map<string, () => void>(),
  resolves: [] as { type: string; settle: () => void }[],
}));
vi.mock('../kernel/render/Renderer', () => ({ getRenderer: () => fake.renderer }));
vi.mock('../kernel/ecs/ECS', () => ({
  getECSWorld: () => ({
    addSystem: (_stage: string, id: string, fn: () => void) => fake.systems.set(id, fn),
    removeSystem: (id: string) => fake.systems.delete(id),
  }),
}));
vi.mock('../kernel/render/Views', () => ({ addViewFrameListener: () => () => undefined }));

import {
  _acquireGpuFrameTimes,
  _getGpuFrameTimesCounts,
  _onGpuFrameTime,
  _releaseGpuFrameTimes,
  type GpuFrameTime,
} from './_dbg__GPUFrameTimes';
import { _keepTimedUids } from './_dbg__GPUTimer';

const createPool = (): FakePool => ({ timestamps: new Map(), queryOffsets: new Map() });

/** A WebGPU renderer (or WebGL with `webgl`), timestamps on unless `noTimestamps`. */
const createRenderer = (opts: { webgl?: boolean; noTimestamps?: boolean } = {}) => {
  const pools: { render: FakePool | null; compute: FakePool | null } = {
    render: createPool(),
    compute: null,
  };
  const backend = {
    isWebGPUBackend: !opts.webgl,
    hasTimestamp: !opts.noTimestamps,
    trackTimestamp: false,
    timestampQueryPool: pools,
  };
  const renderer = {
    backend,
    inspector: new InspectorBase(),
    hasFeature: () => !opts.noTimestamps,
    resolveTimestampsAsync: (type: string) =>
      new Promise<void>((settle) => fake.resolves.push({ type, settle })),
  };
  fake.renderer = renderer;
  return { renderer, backend, pools };
};

type Renderer = ReturnType<typeof createRenderer>['renderer'];

/** One frame: its contexts opened through the installed inspector, then the closer. */
const runFrame = (renderer: Renderer, uids: string[]) => {
  const inspector = renderer.inspector as unknown as InspectorBase;
  for (const uid of uids) {
    if (uid.startsWith('c:')) {
      inspector.beginCompute(uid, {} as never);
      inspector.finishCompute(uid);
    } else {
      inspector.beginRender(uid, {} as never, {} as never, {} as never);
      inspector.finishRender(uid);
    }
  }
  fake.systems.get('aekGpuFrameTimesCloser')?.();
};

/** Settles every resolve requested so far, then lets their callbacks run. */
const settleResolves = async () => {
  const settling = fake.resolves.splice(0);
  for (const resolve of settling) resolve.settle();
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const collect = () => {
  const times: GpuFrameTime[] = [];
  const remove = _onGpuFrameTime((time) => times.push({ ...time }));
  return { times, remove };
};

afterEach(async () => {
  _releaseGpuFrameTimes('RENDER');
  _releaseGpuFrameTimes('COMPUTE');
  await settleResolves();
  fake.renderer = null;
  fake.systems.clear();
});

describe('GPU frame times (p807 D5)', () => {
  it('holds nothing without a renderer or without timestamp queries', () => {
    expect(_acquireGpuFrameTimes('RENDER')).toBeNull();
    const { renderer, backend } = createRenderer({ noTimestamps: true });
    const inspector = renderer.inspector;
    expect(_acquireGpuFrameTimes('RENDER')).toBe(false);
    expect(fake.systems.size).toBe(0);
    expect(renderer.inspector).toBe(inspector);
    expect(backend.trackTimestamp).toBe(false);
  });

  it("sums a frame's render contexts once a batch has them all", async () => {
    const { renderer, pools } = createRenderer();
    expect(_acquireGpuFrameTimes('RENDER')).toBe(true);
    const { times, remove } = collect();

    runFrame(renderer, ['r:1:a:f1', 'r:2:b:f1']);
    pools.render?.timestamps.set('r:1:a:f1', 0.5);
    pools.render?.timestamps.set('r:2:b:f1', 0.25);
    await settleResolves();

    expect(times).toEqual([{ renderMs: 0.75, computeMs: null }]);
    remove();
  });

  it('waits for a missing uid, then drops the frame after 8 batches', async () => {
    const { renderer, pools } = createRenderer();
    _acquireGpuFrameTimes('RENDER');
    const { times, remove } = collect();
    const { dropped } = _getGpuFrameTimesCounts();

    runFrame(renderer, ['r:1:a:f1', 'r:2:b:f1']);
    pools.render?.timestamps.set('r:1:a:f1', 0.5);
    await settleResolves();
    expect(times).toEqual([]);

    // The next batch has it: the frame completes late
    pools.render?.timestamps.set('r:2:b:f1', 0.5);
    runFrame(renderer, ['r:3:a:f2']);
    await settleResolves();
    expect(times).toEqual([{ renderMs: 1, computeMs: null }]);

    // Never in a batch: dropped, never reported
    pools.render?.timestamps.clear();
    for (let i = 0; i < 8; i++) {
      runFrame(renderer, [`r:${10 + i}:a:f${10 + i}`]);
      await settleResolves();
    }
    expect(times).toHaveLength(1);
    expect(_getGpuFrameTimesCounts().dropped).toBeGreaterThan(dropped);
    remove();
  });

  it('drops the oldest frame when every record is pending', () => {
    const { renderer } = createRenderer();
    _acquireGpuFrameTimes('RENDER');
    const { dropped } = _getGpuFrameTimesCounts();
    // One resolve in flight that never settles: the frames pile up. The pool's 10 records are
    // the open one and 9 pending, so frames 10 to 12 each drop the oldest
    for (let i = 0; i < 12; i++) runFrame(renderer, [`r:${i}:a:f${i}`]);
    expect(fake.resolves).toHaveLength(1);
    expect(_getGpuFrameTimesCounts().dropped - dropped).toBe(3);
  });

  it('times compute dispatches, resolving the compute pool once it exists', async () => {
    const { renderer, pools } = createRenderer();
    _acquireGpuFrameTimes('COMPUTE');
    const { times, remove } = collect();

    // No compute pool yet: only the render one is resolved, and the frame's compute time is 0
    runFrame(renderer, ['r:1:a:f1']);
    expect(fake.resolves.map((r) => r.type)).toEqual(['render']);
    await settleResolves();
    expect(times).toEqual([{ renderMs: null, computeMs: 0 }]);

    pools.compute = createPool();
    runFrame(renderer, ['c:1:x:f2', 'r:2:a:f2', 'c:2:y:f2']);
    expect(fake.resolves.map((r) => r.type)).toEqual(['render', 'compute']);
    pools.compute.timestamps.set('c:1:x:f2', 0.25);
    pools.compute.timestamps.set('c:2:y:f2', 0.5);
    await settleResolves();
    expect(times[1]).toEqual({ renderMs: null, computeMs: 0.75 });
    remove();
  });

  it('keeps the timer while either side is held and gives it back with the last', () => {
    const { renderer, backend } = createRenderer();
    const inspector = renderer.inspector;
    _acquireGpuFrameTimes('RENDER');
    _acquireGpuFrameTimes('COMPUTE');
    expect(backend.trackTimestamp).toBe(true);
    expect(renderer.inspector).not.toBe(inspector);

    _releaseGpuFrameTimes('RENDER');
    expect(fake.systems.size).toBe(1);
    _releaseGpuFrameTimes('COMPUTE');
    expect(fake.systems.size).toBe(0);
    expect(renderer.inspector).toBe(inspector);
    expect(backend.trackTimestamp).toBe(false);
    // An extra release is a no-op
    _releaseGpuFrameTimes('COMPUTE');
  });
});

describe('GPU timer on WebGL (p807 Phase 1)', () => {
  it('drops the contexts nested in another, whose queries never begin', async () => {
    const { renderer, pools } = createRenderer({ webgl: true });
    _acquireGpuFrameTimes('RENDER');
    const { times, remove } = collect();
    const pool = pools.render as FakePool;
    pool.queryStates = new Map();
    // The scene pass (b) opened inside the composite (a): its query stays inactive
    const states: [string, string][] = [
      ['r:1:a:f1', 'ended'],
      ['r:2:b:f1', 'inactive'],
      ['r:3:c:f1', 'ended'],
    ];
    states.forEach(([uid, state], i) => {
      pool.queryOffsets.set(uid, i * 2);
      pool.queryStates?.set(i * 2, state);
    });

    runFrame(renderer, ['r:1:a:f1', 'r:2:b:f1', 'r:3:c:f1']);
    pool.timestamps.set('r:1:a:f1', 1.5);
    pool.timestamps.set('r:3:c:f1', 0.5);
    await settleResolves();

    expect(times).toEqual([{ renderMs: 2, computeMs: null }]);
    remove();
  });

  it('keeps every uid on WebGPU and a uid the pool no longer knows on WebGL', () => {
    createRenderer();
    _acquireGpuFrameTimes('RENDER');
    expect(_keepTimedUids(['r:1:a:f1', 'r:2:b:f1'])).toEqual(['r:1:a:f1', 'r:2:b:f1']);
    _releaseGpuFrameTimes('RENDER');

    createRenderer({ webgl: true });
    _acquireGpuFrameTimes('RENDER');
    expect(_keepTimedUids(['r:1:a:f1'])).toEqual(['r:1:a:f1']);
  });
});
