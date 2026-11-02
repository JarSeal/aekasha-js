import { IS_DEBUG_ENV } from '../kernel/config/Config';
import type { DebugModuleRef } from '../kernel/config/DebugModules';
import { loadDebugModuleAsync, useDebug } from '../kernel/config/DebugModules';

/**
 * The on-screen stats panels' options: the Statistics tab's.
 * @internal
 */
export type StatsOptions = {
  /** Rendered frames per second (the frame probe's, as the profiler's FPS row). */
  trackFPS?: boolean;
  /** The main loop's CPU time per frame (the profiler's CPU row). */
  trackCPU?: boolean;
  /** Time spent in the main loop, as a theoretical FPS. */
  trackTFPS?: boolean;
  /** GPU time per frame (render passes), where the renderer has timestamp queries. */
  trackGPU?: boolean;
  /** GPU time per frame of the compute dispatches, where the renderer has timestamp queries. */
  trackCPT?: boolean;
  /** The display's refresh rate, a line of the FPS panel, so it requires trackFPS. */
  trackHz?: boolean;
  logsPerSecond?: number;
  graphsPerSecond?: number;
  samplesLog?: number;
  samplesGraph?: number;
  precision?: number;
  horizontal?: boolean;
  mode?: number;
  enabled?: boolean;
};

/**
 * The stats panels' defaults: the Statistics tab's.
 * @internal
 */
export const defaultStatsOptions = {
  trackFPS: true,
  trackCPU: true,
  trackTFPS: true,
  trackGPU: false,
  trackHz: false,
  trackCPT: false,
  // PHY tracking is deliberately absent here: it lives with the boot-time physics overrides
  // (see _dbg__PhysicsBootOverrides.ts), because physics initializes long before initStats()
  // and so cannot read this. The Statistics tab's "Track PHY" toggle writes there instead.
  horizontal: false,
  enabled: true,
};

type StatsGUIModule = typeof import('./_dbg__Stats');
let debugGUI: DebugModuleRef<StatsGUIModule> | null = null;

/**
 * Loads the stats panels' module (debug env): the boot's.
 * @internal
 */
export const registerStatsModule = async () => {
  if (!IS_DEBUG_ENV) return;
  debugGUI = await loadDebugModuleAsync(() => import('./_dbg__Stats'));
};

/**
 * Builds the on-screen stats panels from the Statistics tab's settings. The main loop's.
 * @internal
 */
export const initStats = (config?: StatsOptions) => useDebug(debugGUI)?._initStats(config);

/**
 * Updates the stats panels at a rendered frame's end (after the render and the late loopers): the
 * main loop's.
 * @internal
 */
export const updateRestOfStats = () => {
  useDebug(debugGUI)?._updateRestOfStats();
};

/**
 * Sets the physics panel's value: the physics step stats'.
 * @internal
 */
export const updatePhysicsPanel = (value: number) => {
  useDebug(debugGUI)?._updatePhysicsPanel(value);
};

/**
 * Applies the profiler's "open from stats panels" setting to the stats panels (its button, or a
 * group) and refreshes the Statistics tab's toggle of it. Debug env only. The profiler's.
 * @internal
 */
export const updateStatsProfilerEntryPoint = () => {
  useDebug(debugGUI)?._applyProfilerEntryPoint();
};

/**
 * Starts a frame's measurements of the engine's own panels: the main loop's.
 * @internal
 */
export const startCustomMeasurements = () => {
  useDebug(debugGUI)?._startCustomMeasurements();
};
