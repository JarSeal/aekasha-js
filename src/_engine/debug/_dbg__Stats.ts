import { createDebuggerTab, updateDebuggerTab } from './DebuggerGUI';
import { GPU_MEMORY_TAB_ID } from './GPUMemory';
import { defaultStatsOptions, type StatsOptions } from './Stats';
import { setBootOverride } from '../features/physics/debug/_dbg__PhysicsBootOverrides';
import { getConfig } from '../kernel/config/Config';
import {
  DEFAULT_PROFILER_SETTINGS,
  getProfilerSettings,
  openProfilerTab,
  setProfilerSettings,
  toggleProfilerWindow,
  type ProfilerSettings,
} from './Profiler';
import { getDebugKeyChordLabel } from './DefaultDebugKeyBindings';
import { _getGpuTimerSupport } from './_dbg__GPUTimer';
import {
  _onStatsFrameEnd,
  _onStatsFrameStart,
  _recordPhysicsStep,
  _removeStatsPanels,
  _setStatsPanels,
} from './_dbg__StatsPanels';

const LS_KEY = 'AEK_debugStats';
const STATS_TAB_ID = 'statsControls';
const PROFILER_KEY_ID = 'sc-toggle-profiler';

const statsConfig: StatsOptions = {
  trackFPS: true,
  trackCPU: true,
  trackTFPS: true,
  trackGPU: false,
  trackCPT: false,
  trackHz: false,
  horizontal: false,
  enabled: true,
};

/** The profiler's name with its key (CONFIG.ts' rebinding): 'Open the profiler (F8)' */
const getProfilerTooltip = () => {
  const chord = getDebugKeyChordLabel(PROFILER_KEY_ID);
  return chord ? `Open the profiler (${chord})` : 'Open the profiler';
};

/** Shows the stats panels as the settings say (p807 D4), live: every toggle but PHY's. */
const applyStatsSettings = () => {
  const cfg = statsConfig;
  if (!cfg.enabled) {
    _removeStatsPanels();
    return;
  }
  const isProfilerEntry = Boolean(getProfilerSettings()?.openFromStatsPanels);
  _setStatsPanels({
    panels: {
      TFPS: Boolean(cfg.trackTFPS),
      FPS: Boolean(cfg.trackFPS),
      CPU: Boolean(cfg.trackCPU),
      // PHY only while physics step tracking is on (a boot setting): with it off nothing
      // measures, so the panel would sit at nothing and misrepresent physics as free
      PHY: Boolean(getConfig().physics?.stepStatsEnabled),
      GPU: Boolean(cfg.trackGPU),
      CPT: Boolean(cfg.trackCPT),
    },
    // Hz is a line of the FPS panel
    showHz: Boolean(cfg.trackHz && cfg.trackFPS),
    horizontal: Boolean(cfg.horizontal),
    activate: isProfilerEntry
      ? {
          label: 'Open the profiler',
          tooltip: getProfilerTooltip(),
          onActivate: toggleProfilerWindow,
        }
      : null,
  });
};

/** A setting changed: the panels, and the tab (the Hz toggle's state follows FPS) */
const onSettingChange = () => {
  applyStatsSettings();
  updateDebuggerTab(STATS_TAB_ID);
};

/**
 * Builds the stats panels from the Statistics tab's settings (p807 D4).
 * @param config optional configurations for stats
 */
export const _initStats = (config?: StatsOptions) => {
  Object.assign(statsConfig, defaultStatsOptions, config);
  // Registered first: the registration hydrates the persisted values into statsConfig, which
  // the panels are built from
  setDebuggerUI();
  applyStatsSettings();
};

/** A rendered frame's end: the panels' figures (the main loop's). */
export const _updateRestOfStats = () => _onStatsFrameEnd();

/** A measured physics step: the PHY panel's figure. */
export const _updatePhysicsPanel = (value: number) => _recordPhysicsStep(value);

/** A main loop frame's start: the CPU span's start and the refresh rate's interval. */
export const _startCustomMeasurements = () => _onStatsFrameStart();

const setDebuggerUI = () => {
  // GPU and CPT need timestamp queries
  const hasNoGpuTimer = () => _getGpuTimerSupport() === 'NONE';
  createDebuggerTab({
    id: STATS_TAB_ID,
    title: 'Statistics',
    icon: 'speedometer',
    // A refresh re-reads what it shows: kept open on a scene change (p806 D5)
    keepOnSceneChange: true,
    lsKey: LS_KEY,
    state: statsConfig,
    persistKeys: [
      'enabled',
      'trackTFPS',
      'trackFPS',
      'trackCPU',
      'trackHz',
      'trackGPU',
      'trackCPT',
      'horizontal',
    ],
    content: () => {
      // Physics step tracking drives the PHY panel, so it belongs among these panel toggles —
      // but unlike its neighbours it is not a stats setting: it lives with the other boot-time
      // physics overrides and is equally reachable from the Physics API tab. Bound through a
      // proxy so there is exactly one stored source of truth, not a copy in LS_KEY that could
      // drift from it.
      const physicsStepTrackingProxy = {
        stepStatsEnabled: Boolean(getConfig().physics?.stepStatsEnabled),
      };
      // Bound to the profiler's own settings object (one source of truth, persisted by the
      // profiler). The fallback only exists if the profiler failed to load.
      const profilerSettings = (getProfilerSettings() as ProfilerSettings | undefined) || {
        ...DEFAULT_PROFILER_SETTINGS,
      };
      return [
        {
          pane: true,
          content: [
            {
              type: 'folder',
              id: 'performance',
              title: 'Performance Measuring',
              content: [
                { key: 'enabled', label: 'Enable measuring', onChange: onSettingChange },
                // Ordered to mirror the panels' own top-to-bottom order on screen
                // (STATS_PANEL_ORDER), so the toggle list reads the same way the display does.
                { key: 'trackTFPS', label: 'Track TFPS', onChange: onSettingChange },
                { key: 'trackFPS', label: 'Track FPS', onChange: onSettingChange },
                { key: 'trackCPU', label: 'Track CPU', onChange: onSettingChange },
                // Hz has no panel of its own (a line of the FPS panel), so it is only offered
                // while FPS is on; applyStatsSettings leaves it out of a persisted combination
                // where FPS is off.
                {
                  key: 'trackHz',
                  label: 'Track Hz (shown in the FPS panel)',
                  disabled: () => !statsConfig.trackFPS,
                  onChange: onSettingChange,
                },
                // A boot setting: physics' step stats are configured at boot
                {
                  key: 'stepStatsEnabled',
                  target: physicsStepTrackingProxy,
                  label: 'Track PHY (after a reload)',
                  onChange: (value) => setBootOverride({ stepStatsEnabled: Boolean(value) }),
                },
                {
                  key: 'trackGPU',
                  label: 'Track GPU',
                  disabled: hasNoGpuTimer,
                  onChange: onSettingChange,
                },
                {
                  key: 'trackCPT',
                  label: 'Track CPT',
                  disabled: hasNoGpuTimer,
                  onChange: onSettingChange,
                },
              ],
            },
            {
              type: 'folder',
              id: 'outlook',
              title: 'Measuring Outlook',
              content: [{ key: 'horizontal', label: 'Horizontal', onChange: onSettingChange }],
            },
            {
              type: 'button',
              label: 'Draw calls, memory',
              title: 'Open GPU memory',
              onClick: () => openProfilerTab(GPU_MEMORY_TAB_ID),
            },
            {
              type: 'folder',
              id: 'profiler',
              title: 'Profiler',
              content: [
                {
                  type: 'button',
                  label: 'Profiler',
                  title: getProfilerTooltip(),
                  onClick: toggleProfilerWindow,
                },
                {
                  key: 'openFromStatsPanels',
                  target: profilerSettings,
                  label:
                    'Profiler mega window can be opened by clicking the on screen stats panels',
                  onChange: (value) => setProfilerSettings({ openFromStatsPanels: Boolean(value) }),
                },
              ],
            },
          ],
        },
      ];
    },
  });

  // - texture count, texture sizes, list of textures (and type, sizes, dimensions)
};

/** The profiler's "open from stats panels" setting changed: the panels become its button or a
 * group, and the Statistics tab's toggle of it is refreshed. */
export const _applyProfilerEntryPoint = () => {
  applyStatsSettings();
  updateDebuggerTab(STATS_TAB_ID);
};
