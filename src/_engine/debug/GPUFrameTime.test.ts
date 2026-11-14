import { beforeEach, describe, expect, it, vi } from 'vitest';

type FrameListener = (time: { renderMs: number | null; computeMs: number | null }) => void;

// The frame record, faked: what it holds and who listens
const fake = vi.hoisted(() => ({
  acquired: true as boolean | null,
  holds: 0,
  listeners: new Set<FrameListener>(),
}));
vi.mock('./_dbg__GPUFrameTimes', () => ({
  _acquireGpuFrameTimes: () => {
    if (fake.acquired) fake.holds++;
    return fake.acquired;
  },
  _releaseGpuFrameTimes: () => {
    fake.holds--;
  },
  _onGpuFrameTime: (listener: FrameListener) => {
    fake.listeners.add(listener);
    return () => fake.listeners.delete(listener);
  },
}));

import { initEnvironment } from '../kernel/config/Config';
import { onGpuFrameTime } from './GPUFrameTime';

/** The module's dynamic import and the calls after it. */
const flushAsync = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const emit = (renderMs: number | null) => {
  for (const listener of fake.listeners) listener({ renderMs, computeMs: null });
};

describe('onGpuFrameTime (p304 Phase 6)', () => {
  beforeEach(() => {
    initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });
    fake.acquired = true;
    fake.holds = 0;
    fake.listeners.clear();
  });

  it("holds the render side while it's listened to and passes each frame's render ms", async () => {
    const frames: number[] = [];
    const remove = onGpuFrameTime((gpuMs) => frames.push(gpuMs));
    await flushAsync();
    expect(fake.holds).toBe(1);

    emit(1.5);
    emit(null);
    emit(2.25);
    expect(frames).toEqual([1.5, 2.25]);

    remove();
    expect(fake.holds).toBe(0);
    expect(fake.listeners.size).toBe(0);
    // A second call does nothing more
    remove();
    expect(fake.holds).toBe(0);
  });

  it('holds nothing when it was removed before the module loaded', async () => {
    const remove = onGpuFrameTime(() => undefined);
    remove();
    await flushAsync();
    expect(fake.holds).toBe(0);
    expect(fake.listeners.size).toBe(0);
  });

  it.each([false, null])('never listens when the frame times return %s', async (acquired) => {
    fake.acquired = acquired;
    const remove = onGpuFrameTime(() => undefined);
    await flushAsync();
    expect(fake.listeners.size).toBe(0);
    expect(remove).not.toThrow();
    expect(fake.holds).toBe(0);
  });

  it('never listens outside the debug env', async () => {
    initEnvironment({ search: '', env: { VITE_APP_ENV: 'development' } });
    const remove = onGpuFrameTime(() => undefined);
    await flushAsync();
    expect(fake.holds).toBe(0);
    remove();
  });
});
