import { loadDebugModuleAsync } from '../kernel/config/DebugModules';

/**
 * Calls `listener` with the GPU time of every rendered frame, for as long as it's listened to: the
 * figure the stats panels' GPU panel and the profiler's GPU row show, for a debug tool's own
 * measurement (average a number of frames after a warm-up). Debug env only.
 * @param listener called with the milliseconds the GPU spent on a frame's render passes (every
 * pass of the frame summed, a bake rendered that frame included), a few frames after the frame
 * @returns a function that removes the listener and, as the last one, stops the timing
 * @remarks The listener is never called outside the debug env, before the renderer exists, or
 * where the GPU has no timer queries (WebGPU needs its `timestamp-query` feature, WebGL 2
 * `EXT_disjoint_timer_query_webgl2`): give a measurement a timeout. On WebGL about two frames in
 * three get a figure. On WebGPU the passes' durations are summed, which overestimates a frame of
 * several dependent passes on a tile-based GPU: compare one scene's configurations, not the
 * backends. Timing costs a little itself, so remove the listener when the measurement ends.
 * @example
 * ```ts
 * import { onGpuFrameTime } from 'aekasha/debug';
 *
 * const samples: number[] = [];
 * const stop = onGpuFrameTime((gpuMs) => {
 *   samples.push(gpuMs);
 *   if (samples.length < 120) return;
 *   stop();
 *   console.log(`GPU ms: ${(samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(2)}`);
 * });
 * ```
 */
export const onGpuFrameTime = (listener: (gpuMs: number) => void): (() => void) => {
  // Folds the listener and the loader out of a production build
  if (!__AEK_DEBUG__) return () => {};
  let isRemoved = false;
  let stop: (() => void) | null = null;
  void loadDebugModuleAsync(() => import('./_dbg__GPUFrameTimes'), false, 'GPU frame times').then(
    (ref) => {
      const frameTimes = ref?.current;
      // Removed while the module loaded, or nothing to time with (no renderer yet, no queries)
      if (!frameTimes || isRemoved || !frameTimes._acquireGpuFrameTimes('RENDER')) return;
      const removeListener = frameTimes._onGpuFrameTime((time) => {
        if (time.renderMs !== null) listener(time.renderMs);
      });
      stop = () => {
        removeListener();
        frameTimes._releaseGpuFrameTimes('RENDER');
      };
    },
    // The loader logged it
    () => {}
  );
  return () => {
    isRemoved = true;
    stop?.();
    stop = null;
  };
};
