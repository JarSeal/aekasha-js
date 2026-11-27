// The device capability check's observer (p240 Phase 4, D1-D4): once a scene runs, it samples the
// main loop's rendered frames (their interval, the loop's CPU time, and every 4th whether the
// previous frame's GPU work was still running) in windows of `observe.frames`, and hands each
// window, summarized and classified (`DeviceObservation.ts`), to the check. Started by the check
// when `observe.enabled` (its module `import()`ed only then); it runs until the page goes.
//
// Frames left out (D3), each breaking the window, which starts again: a scene load, the warm-up
// after a load settles (`warmUpMs`), a scene not in `sceneIds`, a hidden page and the frame after
// it shows, an editor view, the master loop paused (no frame runs, so the first after it is left
// out too), a gap over 1 s, a check measuring (`hold`), and a change of the drawing buffer's size.
// A frame the max FPS limiter skipped isn't a window's frame: its CPU time goes to the next one's.
//
// The GPU-busy marks reach three's backend (`renderer.backend.device` / `.gl`, as the debug GPU
// timer does): WebGPU's `queue.onSubmittedWorkDone()` (its promise is the mark's allocation, so
// only every 4th frame), WebGL2's fence. Re-check both on a three upgrade.
import { addFrameProbe, type FrameProbe, onVisibilityChange } from '../loop/MainLoop';
import { getRenderer } from '../render/Renderer';
import { getCurrentSceneId } from '../scene/Scene';
import { addSceneHooks } from '../scene/SceneHooks';
import {
  classifyObservation,
  type DeviceObservationFrames,
  readComparedIntervalMs,
  summarizeObservationFrames,
} from './DeviceObservation';
import type { DeviceObservation, DeviceObserveConfig } from './DeviceCapabilitiesTypes';

/**
 * `observe.warmUpMs`' default, ms.
 * @internal
 */
export const DEFAULT_OBSERVE_WARM_UP_MS = 5000;

/**
 * `observe.frames`' default.
 * @internal
 */
export const DEFAULT_OBSERVE_FRAMES = 300;
const MIN_FRAMES = 30;
const MAX_FRAMES = 2000;
/** A gap between two rendered frames longer than this isn't a frame (the profiler's rule), ms */
const MAX_GAP_MS = 1000;
/** Every how many window frames the GPU's queue is marked */
const MARK_EVERY = 4;

/**
 * A mark on the GPU's queue: `place` after a frame's work is submitted, `read` at the next frame's
 * start (whether that work had finished), `cancel` drops a placed one.
 * @internal
 */
export type ObserverGpuMarker = {
  place: () => void;
  read: () => boolean;
  cancel: () => void;
};

/**
 * What the observer reads from the engine and the browser: the real ones in
 * `readEngineObserverEnv()`, fakes in its tests.
 * @internal
 */
export type DeviceObserverEnv = {
  addFrameProbe: (probe: FrameProbe) => () => void;
  onVisibilityChange: (fn: (isHidden: boolean) => void) => () => void;
  /** Calls `fn` whenever a scene load has settled (failed or not); returns the remover. */
  onSceneLoadSettled: (fn: () => void) => () => void;
  getSceneId: () => string | null;
  getDrawingBufferWidth: () => number;
  getDrawingBufferHeight: () => number;
  /** The GPU's queue marker, null when it can't be reached (no renderer yet, an unknown backend). */
  getGpuMarker: () => ObserverGpuMarker | null;
  /** Ms since the epoch (a window's `at`). */
  getEpochMs: () => number;
};

/**
 * The observer's settings: the config's, the refresh rate (the last report's) and where its
 * windows go.
 * @internal
 */
export type DeviceObserverOptions = DeviceObserveConfig & {
  /** The display's measured refresh rate, read when a window ends. */
  getRefreshHz: () => number | null;
  /** Every finished current. */
  onWindow: (observation: DeviceObservation) => void;
};

/**
 * A running observer.
 * @internal
 */
export type DeviceObserver = {
  /** Leaves frames out until the returned release is called (a check measuring). */
  hold: () => () => void;
  /** The observer's state (no frames to measure, a scene's warm-up, measuring), the current
   * window's frames so far and a window's size, for the debug tab. */
  getProgress: () => { state: DeviceObserverState; frames: number; windowFrames: number };
  /** Stops observing: the probe and the hooks removed. */
  stop: () => void;
};

/**
 * What the observer is doing: left out frames (a load, an editor view, a hidden page, a paused loop,
 * a check, a scene not observed: `WAITING`), a scene's warm-up, or measuring a current.
 * @internal
 */
export type DeviceObserverState = 'WAITING' | 'WARMING_UP' | 'MEASURING';

type WebGPUQueueLike = { onSubmittedWorkDone: () => Promise<unknown> };
type ObservedBackend = {
  isWebGPUBackend?: boolean;
  device?: { queue: WebGPUQueueLike } | null;
  gl?: WebGL2RenderingContext | null;
};

/** WebGPU's marker: a mark is done once its `onSubmittedWorkDone` resolved; an older mark resolving
 * late never stands for a newer one. */
const createWebGPUMarker = (queue: WebGPUQueueLike): ObserverGpuMarker => {
  let placedId = 0;
  let doneId = 0;
  return {
    place: () => {
      const id = ++placedId;
      queue.onSubmittedWorkDone().then(
        () => {
          if (id > doneId) doneId = id;
        },
        () => undefined
      );
    },
    read: () => doneId >= placedId,
    cancel: () => {
      // A later place supersedes it
    },
  };
};

/** WebGL2's marker: a fence, signalled once the GPU has run the commands before it. The status
 * changes only between tasks, and the next frame is a later task. */
const createWebGL2Marker = (gl: WebGL2RenderingContext): ObserverGpuMarker => {
  let sync: WebGLSync | null = null;
  const drop = () => {
    if (sync) gl.deleteSync(sync);
    sync = null;
  };
  return {
    place: () => {
      drop();
      sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    },
    read: () => {
      if (!sync) return true;
      const isDone = gl.getSyncParameter(sync, gl.SYNC_STATUS) === gl.SIGNALED;
      drop();
      return isDone;
    },
    cancel: drop,
  };
};

/**
 * The engine's and the browser's side of the observer.
 * @internal
 */
export const readEngineObserverEnv = (): DeviceObserverEnv => {
  let markerBackend: ObservedBackend | null = null;
  let marker: ObserverGpuMarker | null = null;
  return {
    addFrameProbe,
    onVisibilityChange,
    onSceneLoadSettled: (fn) => addSceneHooks({ loadSettled: fn }),
    getSceneId: () => getCurrentSceneId(),
    getDrawingBufferWidth: () => getRenderer()?.domElement.width ?? 0,
    getDrawingBufferHeight: () => getRenderer()?.domElement.height ?? 0,
    getGpuMarker: () => {
      const backend = (getRenderer()?.backend ?? null) as unknown as ObservedBackend | null;
      if (backend !== markerBackend) {
        markerBackend = backend;
        marker = null;
        if (backend?.isWebGPUBackend && backend.device) {
          marker = createWebGPUMarker(backend.device.queue);
        } else if (backend?.gl) {
          marker = createWebGL2Marker(backend.gl);
        }
      }
      return marker;
    },
    getEpochMs: () => Date.now(),
  };
};

// p240 Phase 4
/**
 * Starts observing the main loop's frames: each window of `frames` rendered frames (the frames
 * the file's header lists left out) goes to `onWindow`, summarized and classified. Windows follow
 * each other while nothing breaks them.
 * @internal
 */
export const startDeviceObserver = (
  options: DeviceObserverOptions,
  env: DeviceObserverEnv = readEngineObserverEnv()
): DeviceObserver => {
  const warmUpMs = Math.max(0, options.warmUpMs ?? DEFAULT_OBSERVE_WARM_UP_MS);
  const frameCount = Math.round(
    Math.min(MAX_FRAMES, Math.max(MIN_FRAMES, options.frames ?? DEFAULT_OBSERVE_FRAMES))
  );
  const sceneIds = options.sceneIds ?? null;

  const current: DeviceObservationFrames = {
    intervals: new Float64Array(frameCount),
    cpuTimes: new Float64Array(frameCount),
    count: 0,
    marks: 0,
    busy: 0,
  };
  let windowWidth = 0;
  let windowHeight = 0;
  let beginTime = 0;
  /** The previous rendered frame's begin, -1: the next rendered frame starts the intervals */
  let lastRenderedBegin = -1;
  let pendingCpu = 0;
  let isMarkPlaced = false;
  /** This frame's begin read the mark placed in the window: 1 busy, 0 done, -1 no mark read */
  let busyRead = -1;
  /** -1: start the warm-up on the next rendered frame (a load settled, or the start) */
  let warmUpUntil = -1;
  let isSceneObserved = false;
  let holds = 0;
  let state: DeviceObserverState = 'WAITING';

  const breakWindow = () => {
    current.count = 0;
    current.marks = 0;
    current.busy = 0;
    if (isMarkPlaced) env.getGpuMarker()?.cancel();
    isMarkPlaced = false;
  };

  /** Breaks the window and leaves out the next frame's interval too (it spans the break) */
  const breakFrames = () => {
    breakWindow();
    lastRenderedBegin = -1;
  };

  const finishWindow = (maxFPSInterval: number) => {
    const comparedIntervalMs = readComparedIntervalMs(options.getRefreshHz(), maxFPSInterval);
    const sceneId = env.getSceneId();
    const stats = summarizeObservationFrames(current);
    breakWindow();
    // Without a refresh rate nothing tells whether the frames came as fast as allowed
    if (comparedIntervalMs === null || !sceneId) return;
    options.onWindow({
      sceneId,
      at: env.getEpochMs(),
      ...stats,
      comparedIntervalMs,
      pixelWidth: windowWidth,
      pixelHeight: windowHeight,
      limitedBy: classifyObservation(stats, comparedIntervalMs),
    });
  };

  const probe: FrameProbe = {
    begin: (now) => {
      beginTime = now;
      busyRead = -1;
      if (isMarkPlaced) {
        isMarkPlaced = false;
        const marker = env.getGpuMarker();
        if (marker) busyRead = marker.read() ? 0 : 1;
      }
    },
    end: (now, rendered, loopState) => {
      pendingCpu += now - beginTime;
      if (!rendered) return;
      const cpuMs = pendingCpu;
      pendingCpu = 0;
      if (
        holds > 0 ||
        loopState.isLoadingScene ||
        loopState.isSceneSuspended ||
        loopState.isWindowHidden ||
        !loopState.masterPlay
      ) {
        state = 'WAITING';
        breakFrames();
        return;
      }
      if (warmUpUntil < 0) {
        warmUpUntil = now + warmUpMs;
        const sceneId = env.getSceneId();
        isSceneObserved = sceneId !== null && (!sceneIds || sceneIds.includes(sceneId));
      }
      const prevBegin = lastRenderedBegin;
      lastRenderedBegin = beginTime;
      if (!isSceneObserved || now < warmUpUntil) {
        state = isSceneObserved ? 'WARMING_UP' : 'WAITING';
        breakWindow();
        return;
      }
      state = 'MEASURING';
      if (prevBegin < 0) return;
      const interval = beginTime - prevBegin;
      if (interval > MAX_GAP_MS) {
        breakWindow();
        return;
      }

      const width = env.getDrawingBufferWidth();
      const height = env.getDrawingBufferHeight();
      if (current.count > 0 && (width !== windowWidth || height !== windowHeight)) {
        breakWindow();
      } else if (busyRead >= 0) {
        // The mark was placed in this window (a break cancels it)
        current.marks++;
        current.busy += busyRead;
      }
      windowWidth = width;
      windowHeight = height;
      current.intervals[current.count] = interval;
      current.cpuTimes[current.count] = cpuMs;
      current.count++;

      if (current.count >= frameCount) {
        finishWindow(loopState.maxFPS > 0 ? loopState.maxFPSInterval : 0);
      } else if (current.count % MARK_EVERY === 0) {
        const marker = env.getGpuMarker();
        if (marker) {
          marker.place();
          isMarkPlaced = true;
        }
      }
    },
  };

  const removers = [
    env.addFrameProbe(probe),
    env.onVisibilityChange(breakFrames),
    env.onSceneLoadSettled(() => {
      breakFrames();
      warmUpUntil = -1;
    }),
  ];

  return {
    hold: () => {
      holds++;
      breakFrames();
      let isReleased = false;
      return () => {
        if (isReleased) return;
        isReleased = true;
        holds--;
      };
    },
    getProgress: () => ({ state, frames: current.count, windowFrames: frameCount }),
    stop: () => {
      breakWindow();
      for (const remove of removers.splice(0)) remove();
    },
  };
};
