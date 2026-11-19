import { getRenderer } from 'aekasha';
import type * as THREE from 'three/webgpu';

// p309 D4's open question (Phase 4, section 5): WebGL2's GPU time for a decal pool's batch. The
// stats panel's GPU figure times the whole frame (three's one timer query per render context), so
// this times the pools' own objects instead, with `EXT_disjoint_timer_query_webgl2` queries of its
// own: `POOLS` wraps each object's `onBeforeRender` / `onAfterRender` (three r187 calls them around
// the object's geometry, node and binding updates, its uploads, and its draw), `FRAME` the whole
// render submit (the probe's render start to its frame end), for comparing with the stats panel.
// A WebGL2 timer query can't nest, so three's own must be off (no stats GPU panel, the profiler
// closed): a begin while another query is active skips that object and drops the frame
// (`busyFrames`), and a disjoint result drops it too. WebGL2 only.

/** What's timed: the pools' objects, or the whole render submit */
export type GpuProfileMode = 'POOLS' | 'FRAME';

/** A profile's result: the timed frames' GPU time (ms) */
export type GpuProfileResult = {
  mode: GpuProfileMode;
  frames: number;
  /** Frames with every query's result, none disjoint */
  framesTimed: number;
  busyFrames: number;
  disjointFrames: number;
  /** Queries a timed frame had, median (objects drawn, or 1 for `FRAME`) */
  queriesPerFrame: number;
  medianMs: number;
  p90Ms: number;
  meanMs: number;
};

type TimerExt = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };
type Hooked = {
  object: THREE.Object3D;
  hadOwnBefore: boolean;
  hadOwnAfter: boolean;
  before: THREE.Object3D['onBeforeRender'];
  after: THREE.Object3D['onAfterRender'];
};
type FrameQueries = { queries: WebGLQuery[]; isBusy: boolean };

/** Frames a profile waits past its last for the queries' results */
const DRAIN_FRAMES = 30;

const quantile = (values: number[], q: number) => {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
};

/**
 * A profiler the probe drives: `renderStart` and `frameEnd` from its systems, `startAsync` from
 * the bench.
 */
export const createGpuProfiler = () => {
  let run: {
    mode: GpuProfileMode;
    gl: WebGL2RenderingContext;
    ext: TimerExt;
    left: number;
    drain: number;
    current: FrameQueries;
    pending: FrameQueries[];
    times: number[];
    queryCounts: number[];
    busyFrames: number;
    disjointFrames: number;
    hooked: Hooked[];
    resolve: (result: GpuProfileResult) => void;
  } | null = null;
  const spare: WebGLQuery[] = [];

  /** Whether this profiler's query is the active one (an end never closes another's) */
  let isOpen = false;
  const begin = () => {
    if (!run || run.left <= 0 || isOpen) return;
    const { gl, ext, current } = run;
    if (gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) {
      current.isBusy = true;
      return;
    }
    const query = spare.pop() ?? gl.createQuery();
    if (!query) return;
    gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    current.queries.push(query);
    isOpen = true;
  };
  const end = () => {
    if (!run || !isOpen) return;
    run.gl.endQuery(run.ext.TIME_ELAPSED_EXT);
    isOpen = false;
  };

  const hook = (object: THREE.Object3D): Hooked => {
    const entry: Hooked = {
      object,
      hadOwnBefore: Object.prototype.hasOwnProperty.call(object, 'onBeforeRender'),
      hadOwnAfter: Object.prototype.hasOwnProperty.call(object, 'onAfterRender'),
      before: object.onBeforeRender,
      after: object.onAfterRender,
    };
    // Its own hook first (a batch culls and builds its draw lists there), then the query
    object.onBeforeRender = function (...args) {
      entry.before.apply(this, args);
      begin();
    };
    object.onAfterRender = function (...args) {
      end();
      entry.after.apply(this, args);
    };
    return entry;
  };
  const unhook = (entry: Hooked) => {
    const object = entry.object as unknown as Record<string, unknown>;
    if (entry.hadOwnBefore) entry.object.onBeforeRender = entry.before;
    else delete object.onBeforeRender;
    if (entry.hadOwnAfter) entry.object.onAfterRender = entry.after;
    else delete object.onAfterRender;
  };

  /** Reads the oldest frames whose queries all have their results */
  const poll = () => {
    if (!run) return;
    const { gl, ext, pending } = run;
    while (pending.length > 0) {
      const frame = pending[0];
      const isReady = frame.queries.every((q) =>
        gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)
      );
      if (!isReady) return;
      pending.shift();
      const isDisjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
      let ns = 0;
      for (const q of frame.queries) {
        ns += gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
        spare.push(q);
      }
      if (isDisjoint) run.disjointFrames++;
      else if (frame.isBusy) run.busyFrames++;
      else {
        run.times.push(ns / 1e6);
        run.queryCounts.push(frame.queries.length);
      }
    }
  };

  const finish = () => {
    if (!run) return;
    const done = run;
    run = null;
    for (const entry of done.hooked) unhook(entry);
    const { times } = done;
    done.resolve({
      mode: done.mode,
      frames: times.length + done.busyFrames + done.disjointFrames,
      framesTimed: times.length,
      busyFrames: done.busyFrames,
      disjointFrames: done.disjointFrames,
      queriesPerFrame: quantile(done.queryCounts, 0.5),
      medianMs: quantile(times, 0.5),
      p90Ms: quantile(times, 0.9),
      meanMs: times.length ? times.reduce((a, b) => a + b, 0) / times.length : NaN,
    });
  };

  return {
    /**
     * Times the next `frames` frames (`objects`: the pools' objects, for `POOLS`).
     * @throws on WebGPU or without the timer query extension
     */
    startAsync: (mode: GpuProfileMode, frames: number, objects: Iterable<THREE.Object3D>) =>
      new Promise<GpuProfileResult>((resolve) => {
        if (run) throw new Error('a GPU profile is running');
        const gl = (getRenderer()?.backend as { gl?: WebGL2RenderingContext } | undefined)?.gl;
        const ext = gl?.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
        if (!gl || !ext) throw new Error('WebGL2 with EXT_disjoint_timer_query_webgl2 only');
        gl.getParameter(ext.GPU_DISJOINT_EXT); // clears the flag
        run = {
          mode,
          gl,
          ext,
          left: Math.max(1, frames),
          drain: DRAIN_FRAMES,
          current: { queries: [], isBusy: false },
          pending: [],
          times: [],
          queryCounts: [],
          busyFrames: 0,
          disjointFrames: 0,
          hooked: mode === 'POOLS' ? [...objects].map(hook) : [],
          resolve,
        };
      }),
    /** The render submit starts (the probe's last APP_RENDER_SYNC system) */
    renderStart: () => {
      if (run?.mode === 'FRAME' && run.left > 0) begin();
    },
    /** A frame ends (the probe's first LATE_MAIN system) */
    frameEnd: () => {
      if (!run) return;
      if (run.left > 0) {
        // `FRAME`'s query; a `POOLS` one left open by an object whose after hook didn't run
        end();
        run.pending.push(run.current);
        run.current = { queries: [], isBusy: false };
        run.left--;
      } else {
        run.drain--;
      }
      poll();
      if (run && run.left === 0 && (run.pending.length === 0 || run.drain <= 0)) finish();
    },
  };
};
