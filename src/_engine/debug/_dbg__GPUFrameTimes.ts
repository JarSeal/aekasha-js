/**
 * The GPU time of each rendered frame (p807 D5), for the profiler's GPU row and the stats panels'
 * GPU and CPT panels. Debug only.
 *
 * - A side (RENDER, COMPUTE) is measured while anyone holds it (_acquireGpuFrameTimes). The
 *   first hold takes the GPU timer and adds the frame closer, the last release gives both back.
 * - Every render and compute context opened between two closer runs belongs to that frame (a
 *   MAIN-stage bake included). The closer (a LATE_MAIN system after every other, and an
 *   'AFTER_RENDER' view frame listener in an editor view, where the scene's stages don't run)
 *   ends the frame's record and requests a resolve. A record completes once a resolved batch has
 *   every uid of the held sides, and its frame goes to the listeners (_onGpuFrameTime) a few
 *   frames late. One that waits GPU_MAX_PENDING_RESOLVES batches is dropped, never reported
 *   wrong.
 * - WebGL: a context opened inside another has no query of its own (_keepTimedUids), so a frame
 *   sums its outer contexts, which hold the nested ones' time.
 */
import { getECSWorld } from '../kernel/ecs/ECS';
import { ECSSystemStage } from '../kernel/loop/SystemStages';
import { addViewFrameListener } from '../kernel/render/Views';
import {
  _acquireGpuTimer,
  _keepTimedUids,
  _onComputeContext,
  _onRenderContext,
  _onTimestampsResolved,
  _releaseGpuTimer,
  _requestTimestampResolve,
  _sumGpuMs,
} from './_dbg__GPUTimer';

/** What's timed: the render passes, or the compute dispatches. */
export type GpuFrameTimesSide = 'RENDER' | 'COMPUTE';

/** One resolved frame, read only in its listener call (the object is reused). */
export type GpuFrameTime = {
  /** GPU ms of the frame's render passes, null while RENDER isn't held. */
  renderMs: number | null;
  /** GPU ms of the frame's compute dispatches (0 without any), null while COMPUTE isn't held. */
  computeMs: number | null;
};

type GpuFrameListener = (time: Readonly<GpuFrameTime>) => void;
type GpuFrameRecord = { renderUids: string[]; computeUids: string[]; age: number };

/** Resolved batches a record waits for its timestamps before it is dropped. */
const GPU_MAX_PENDING_RESOLVES = 8;
const GPU_RECORD_POOL_SIZE = GPU_MAX_PENDING_RESOLVES + 2;
const CLOSER_SYSTEM_ID = 'aekGpuFrameTimesCloser';
/** After every other LATE_MAIN system, so a late render pass still counts for the frame. */
const CLOSER_ORDER = -10000;

const holders: Record<GpuFrameTimesSide, number> = { RENDER: 0, COMPUTE: 0 };
const listeners = new Set<GpuFrameListener>();
const result: GpuFrameTime = { renderMs: null, computeMs: null };
const freeRecords: GpuFrameRecord[] = Array.from({ length: GPU_RECORD_POOL_SIZE }, () => ({
  renderUids: [],
  computeUids: [],
  age: 0,
}));
const pendingRecords: GpuFrameRecord[] = [];
let currentRecord: GpuFrameRecord | null = null;
let isTimerHeld = false;
/** A batch's frames are going to the listeners: a release of the last hold from one of them (a
 * measurement that has its frames) stops the timing after the batch, since the stop recycles the
 * records the batch is still walking */
let isCollecting = false;
let isStopPending = false;
let removeTimerListeners: (() => void) | null = null;
let removeViewCloser: (() => void) | null = null;
const counts = { completed: 0, dropped: 0 };

const recycleRecord = (record: GpuFrameRecord) => {
  record.renderUids.length = 0;
  record.computeUids.length = 0;
  record.age = 0;
  freeRecords.push(record);
};

const takeRecord = () => {
  // Out of records: drop the oldest pending frame
  if (!freeRecords.length) {
    const oldest = pendingRecords.shift();
    if (oldest) {
      counts.dropped++;
      recycleRecord(oldest);
    }
  }
  return freeRecords.pop() || null;
};

const closeFrame = () => {
  const record = currentRecord;
  if (!record || (!record.renderUids.length && !record.computeUids.length)) return;
  _keepTimedUids(record.renderUids);
  _keepTimedUids(record.computeUids);
  pendingRecords.push(record);
  currentRecord = takeRecord();
  _requestTimestampResolve();
};

const onRenderContext = (uid: string) => currentRecord?.renderUids.push(uid);
const onComputeContext = (uid: string) => currentRecord?.computeUids.push(uid);

const collectFrames = (
  render: ReadonlyMap<string, number>,
  compute: ReadonlyMap<string, number>
) => {
  const isRenderHeld = holders.RENDER > 0;
  const isComputeHeld = holders.COMPUTE > 0;
  let kept = 0;
  isCollecting = true;
  try {
    for (let i = 0; i < pendingRecords.length; i++) {
      const record = pendingRecords[i];
      const renderMs = isRenderHeld ? _sumGpuMs(render, record.renderUids) : null;
      const computeMs = isComputeHeld ? _sumGpuMs(compute, record.computeUids) : null;
      if ((isRenderHeld && renderMs === null) || (isComputeHeld && computeMs === null)) {
        if (++record.age < GPU_MAX_PENDING_RESOLVES) {
          pendingRecords[kept++] = record;
        } else {
          // Its batch went to another resolver (an app's own resolve), or a WebGL resolve in
          // flight cleared its queries
          counts.dropped++;
          recycleRecord(record);
        }
        continue;
      }
      counts.completed++;
      recycleRecord(record);
      result.renderMs = renderMs;
      result.computeMs = computeMs;
      for (const listener of listeners) listener(result);
    }
    pendingRecords.length = kept;
  } finally {
    // Also after a listener that threw: a stop asked for later must not wait forever
    isCollecting = false;
  }
  if (!isStopPending) return;
  isStopPending = false;
  // Unless a listener took a hold again meanwhile
  if (!holders.RENDER && !holders.COMPUTE) stop();
};

const start = () => {
  const timer = _acquireGpuTimer();
  if (!timer) return null;
  if (!timer.gpuAvailable) {
    _releaseGpuTimer();
    return false;
  }
  isTimerHeld = true;
  currentRecord = takeRecord();
  const removeRender = _onRenderContext(onRenderContext);
  const removeCompute = _onComputeContext(onComputeContext);
  const removeResolved = _onTimestampsResolved(collectFrames);
  removeTimerListeners = () => {
    removeRender();
    removeCompute();
    removeResolved();
  };
  getECSWorld().addSystem(ECSSystemStage.LATE_MAIN, CLOSER_SYSTEM_ID, closeFrame, CLOSER_ORDER);
  removeViewCloser = addViewFrameListener(closeFrame, 'AFTER_RENDER');
  return true;
};

const stop = () => {
  isTimerHeld = false;
  getECSWorld().removeSystem(CLOSER_SYSTEM_ID);
  removeViewCloser?.();
  removeViewCloser = null;
  removeTimerListeners?.();
  removeTimerListeners = null;
  if (currentRecord) recycleRecord(currentRecord);
  currentRecord = null;
  while (pendingRecords.length) recycleRecord(pendingRecords.pop() as GpuFrameRecord);
  _releaseGpuTimer();
};

/**
 * Takes a hold on one side's frame times. Pair every call that returns true with
 * _releaseGpuFrameTimes of the same side.
 * @returns true when held, false when the renderer has no timestamp queries, null when it
 * doesn't exist yet (nothing is held either way)
 */
export const _acquireGpuFrameTimes = (side: GpuFrameTimesSide) => {
  if (!isTimerHeld) {
    const started = start();
    if (!started) return started;
  }
  holders[side]++;
  return true;
};

/** Releases a hold on one side; the last hold of both gives the GPU timer back. */
export const _releaseGpuFrameTimes = (side: GpuFrameTimesSide) => {
  if (holders[side] === 0) return;
  holders[side]--;
  if (holders.RENDER || holders.COMPUTE || !isTimerHeld) return;
  if (isCollecting) isStopPending = true;
  else stop();
};

/** Calls `listener` with every resolved frame while a side is held, a few frames late.
 * @returns a function that removes the listener */
export const _onGpuFrameTime = (listener: GpuFrameListener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The frames completed and dropped since the page loaded (the tests and the p807 gate read
 * them). */
export const _getGpuFrameTimesCounts = (): Readonly<typeof counts> => counts;
