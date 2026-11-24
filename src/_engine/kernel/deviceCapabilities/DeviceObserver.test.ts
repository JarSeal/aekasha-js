import { describe, expect, it } from 'vitest';
import type { FrameProbe, LoopState } from '../loop/MainLoop';
import type { DeviceObservation } from './DeviceCapabilitiesTypes';
import { type DeviceObserverEnv, startDeviceObserver } from './DeviceObserver';

const LOOP_STATE: LoopState = {
  masterPlay: true,
  appPlay: true,
  isMasterPlaying: true,
  isAppPlaying: true,
  playSpeedMultiplier: 1,
  maxFPS: 0,
  maxFPSInterval: 0,
  isWindowHidden: false,
  isUnloading: false,
  isLoadingScene: false,
  isSceneSuspended: false,
};

/** A fake engine: frames driven by hand, a GPU queue whose marks finish as `gpuDone` says */
const createHarness = (options: { warmUpMs?: number; frames?: number; sceneIds?: string[] }) => {
  const fake = {
    probe: null as FrameProbe | null,
    onHidden: null as ((isHidden: boolean) => void) | null,
    onSettled: null as (() => void) | null,
    sceneId: 'gym' as string | null,
    width: 1920,
    height: 1080,
    gpuDone: true,
    placed: 0,
    now: 0,
  };
  let isMarkDone = true;
  const env: DeviceObserverEnv = {
    addFrameProbe: (probe) => {
      fake.probe = probe;
      return () => (fake.probe = null);
    },
    onVisibilityChange: (fn) => {
      fake.onHidden = fn;
      return () => (fake.onHidden = null);
    },
    onSceneLoadSettled: (fn) => {
      fake.onSettled = fn;
      return () => (fake.onSettled = null);
    },
    getSceneId: () => fake.sceneId,
    getDrawingBufferWidth: () => fake.width,
    getDrawingBufferHeight: () => fake.height,
    getGpuMarker: () => ({
      place: () => {
        fake.placed++;
        isMarkDone = fake.gpuDone;
      },
      read: () => isMarkDone,
      cancel: () => undefined,
    }),
    getEpochMs: () => 1_700_000_000_000,
  };
  const windows: DeviceObservation[] = [];
  const observer = startDeviceObserver(
    { ...options, getRefreshHz: () => 60, onWindow: (w) => windows.push(w) },
    env
  );
  /** Runs `count` rendered frames, each `intervalMs` after the last, its loop taking `cpuMs` */
  const runFrames = (count: number, intervalMs: number, cpuMs = 2, state = LOOP_STATE) => {
    for (let i = 0; i < count; i++) {
      fake.now += intervalMs;
      fake.probe?.begin(fake.now);
      fake.probe?.end(fake.now + cpuMs, true, state);
    }
  };
  return { fake, observer, windows, runFrames };
};

describe('the device observer', () => {
  it("hands over a window of the scene's frames after the warm-up", () => {
    const { windows, runFrames, observer } = createHarness({ warmUpMs: 1000, frames: 40 });
    runFrames(60, 1000 / 60); // the warm-up, from the first frame's end
    expect(windows).toHaveLength(0);
    expect(observer.getProgress().state).toBe('WARMING_UP');
    runFrames(41, 1000 / 60);
    expect(observer.getProgress()).toEqual({ state: 'MEASURING', frames: 0, windowFrames: 40 });
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      sceneId: 'gym',
      frames: 40,
      p50FrameMs: 16.667,
      p50CpuMs: 2,
      comparedIntervalMs: 16.667,
      pixelWidth: 1920,
      pixelHeight: 1080,
      limitedBy: 'REFRESH',
    });
  });

  it('tells a slow GPU from a cap by the GPU-busy marks', () => {
    const { fake, windows, runFrames } = createHarness({ warmUpMs: 0, frames: 40 });
    fake.gpuDone = false;
    runFrames(41, 33.3);
    fake.gpuDone = true;
    runFrames(40, 33.3);
    expect(windows.map((w) => [w.limitedBy, w.gpuBusyShare])).toEqual([
      ['GPU', 1],
      ['CAPPED', 0],
    ]);
    expect(fake.placed).toBeGreaterThan(15);
  });

  it('leaves out a load, the warm-up after it, a paused loop and a gap', () => {
    const { fake, windows, runFrames } = createHarness({ warmUpMs: 500, frames: 40 });
    runFrames(50, 20);
    runFrames(5, 20, 2, { ...LOOP_STATE, isLoadingScene: true });
    fake.onSettled?.();
    runFrames(30, 20); // 600 ms: the warm-up, then 5 frames
    runFrames(1, 20, 2, { ...LOOP_STATE, masterPlay: false });
    runFrames(20, 20);
    expect(windows).toHaveLength(0);
    fake.now += 2000; // a gap breaks the window
    runFrames(40, 20);
    expect(windows).toHaveLength(0);
    runFrames(1, 20);
    expect(windows).toHaveLength(1);
  });

  it("observes only the config's scenes", () => {
    const { fake, windows, runFrames, observer } = createHarness({
      warmUpMs: 0,
      frames: 30,
      sceneIds: ['largeWorld'],
    });
    runFrames(40, 20);
    expect(windows).toHaveLength(0);
    expect(observer.getProgress().state).toBe('WAITING');
    fake.sceneId = 'largeWorld';
    fake.onSettled?.();
    runFrames(31, 20);
    expect(windows.map((w) => w.sceneId)).toEqual(['largeWorld']);
  });

  it('starts the window again on a hidden page, a resize and a hold', () => {
    const { fake, windows, runFrames, observer } = createHarness({ warmUpMs: 0, frames: 30 });
    runFrames(20, 20);
    fake.onHidden?.(true);
    runFrames(20, 20);
    fake.width = 1280;
    runFrames(20, 20);
    const release = observer.hold();
    runFrames(5, 20);
    release();
    runFrames(20, 20);
    expect(windows).toHaveLength(0);
    runFrames(11, 20);
    expect(windows).toHaveLength(1);
    expect(windows[0].pixelWidth).toBe(1280);
  });

  it('counts a frame the limiter skipped into the next rendered one, not as a frame', () => {
    const { fake, windows } = createHarness({ warmUpMs: 0, frames: 30 });
    const state = { ...LOOP_STATE, maxFPS: 30, maxFPSInterval: 1000 / 30 };
    for (let i = 0; i < 62; i++) {
      fake.now += 1000 / 60;
      fake.probe?.begin(fake.now);
      fake.probe?.end(fake.now + 1, i % 2 === 1, state);
    }
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      p50FrameMs: 33.333,
      p50CpuMs: 2,
      comparedIntervalMs: 33.333,
      limitedBy: 'REFRESH',
    });
  });

  it('stops: its probe and hooks removed', () => {
    const { fake, observer } = createHarness({});
    observer.stop();
    expect([fake.probe, fake.onHidden, fake.onSettled]).toEqual([null, null, null]);
  });
});
