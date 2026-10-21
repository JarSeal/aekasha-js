import type { Renderer } from 'three/webgpu';
import { IS_DEBUG_ENV } from '../kernel/config/Config';
import type { DebugModuleRef } from '../kernel/config/DebugModules';
import { loadDebugModuleAsync, useDebug } from '../kernel/config/DebugModules';

/**
 * The on-screen stats panels' options: the Statistics tab's.
 * @internal
 */
export type StatsOptions = {
  /** stats-gl builds its FPS and CPU panels together (only via its own trackFPS), so these two
   * are applied by always building both and detaching the panel afterwards. */
  trackFPS?: boolean;
  trackCPU?: boolean;
  /** Engine-side panel (not stats-gl's): time spent in app logic, as a theoretical FPS. */
  trackTFPS?: boolean;
  trackGPU?: boolean;
  trackCPT?: boolean;
  /** Drawn as a small overlay inside the CPU panel, so it requires trackCPU. */
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
 * Initializes statistics for debugging. The main loop's.
 * @internal
 * @param config ({@link StatsOptions}) optional configurations for stats
 * @returns the stats-gl `Stats` instance, or nothing while the debug module isn't loaded
 */
export const initStats = (config?: StatsOptions) => useDebug(debugGUI)?._initStats(config);

/**
 * Updates the stats panels after a frame's render: the main loop's.
 * @internal
 */
export const updateRestOfStats = (renderer: Renderer) => {
  useDebug(debugGUI)?._updateRestOfStats(renderer);
};

/**
 * Sets the physics panel's value: the physics step stats'.
 * @internal
 */
export const updatePhysicsPanel = (value: number) => {
  useDebug(debugGUI)?._updatePhysicsPanel(value);
};

/**
 * Applies the profiler's "open from stats panels" setting to the stats panels (their pointer and
 * title) and refreshes the Statistics tab's toggle of it. Debug env only. The profiler's.
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

/**
 * Returns the stats-gl `Stats` instance. The main loop's, the ray casts' and the spatial grid's.
 * @internal
 * @returns it, or nothing while the debug module isn't loaded
 */
export const getStats = () => useDebug(debugGUI)?._getStats();

/**
 * The stats panels' container CMP: the boot's.
 * @internal
 */
export const getStatsCmp = () => useDebug(debugGUI)?._getStatsCmp();
