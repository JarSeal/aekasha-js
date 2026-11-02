import { createDebuggerTab, updateDebuggerTab } from './DebuggerGUI';
import { GPU_MEMORY_TAB_ID } from './GPUMemory';
import { getHUDRootCMP } from '../ui/core/HUD';
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
import {
  _createStatsPanels,
  _getStatsPanelsRoot,
  _onStatsFrameEnd,
  _onStatsFrameStart,
  _recordPhysicsStep,
} from './_dbg__StatsPanels';

const LS_KEY = 'AEK_debugStats';
const STATS_TAB_ID = 'statsControls';

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

/** Every change reloads the app: the panels are only built once, at boot. */
const RELOAD_NOTE = '(reloads the app)';

/**
 * Builds the stats panels from the Statistics tab's settings (p807 D4).
 * @param config optional configurations for stats
 */
export const _initStats = (config?: StatsOptions) => {
  Object.assign(statsConfig, defaultStatsOptions, config);
  // Registered first: the registration hydrates the persisted values into statsConfig, which
  // the panels below are built from
  setDebuggerUI();
  const cfg = statsConfig;
  if (!cfg.enabled) return;
  const root = _createStatsPanels({
    panels: {
      TFPS: Boolean(cfg.trackTFPS),
      FPS: Boolean(cfg.trackFPS),
      CPU: Boolean(cfg.trackCPU),
      // PHY only while physics step tracking is on: with it off nothing measures, so the panel
      // would sit at nothing and misrepresent physics as free
      PHY: Boolean(getConfig().physics?.stepStatsEnabled),
      GPU: Boolean(cfg.trackGPU),
      CPT: Boolean(cfg.trackCPT),
    },
    // Hz is a line of the FPS panel
    showHz: Boolean(cfg.trackHz && cfg.trackFPS),
    horizontal: Boolean(cfg.horizontal),
  });
  root.elem.addEventListener('click', (e) => {
    if (!getProfilerSettings()?.openFromStatsPanels) return;
    e.stopPropagation();
    toggleProfilerWindow();
  });
  getHUDRootCMP().add(root);
  _applyProfilerEntryPoint();
};

/** A rendered frame's end: the panels' figures (the main loop's). */
export const _updateRestOfStats = () => _onStatsFrameEnd();

/** A measured physics step: the PHY panel's figure. */
export const _updatePhysicsPanel = (value: number) => _recordPhysicsStep(value);

/** A main loop frame's start: the CPU span's start and the refresh rate's interval. */
export const _startCustomMeasurements = () => _onStatsFrameStart();

const setDebuggerUI = () => {
  const reloadApp = () => location.reload();
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
              title: `Performance Measuring ${RELOAD_NOTE}`,
              content: [
                { key: 'enabled', label: 'Enable measuring', onChange: reloadApp },
                // Ordered to mirror the panels' own top-to-bottom order on screen
                // (PANEL_ORDER), so the toggle list reads the same way the display does.
                { key: 'trackTFPS', label: 'Track TFPS', onChange: reloadApp },
                { key: 'trackFPS', label: 'Track FPS', onChange: reloadApp },
                { key: 'trackCPU', label: 'Track CPU', onChange: reloadApp },
                // Hz has no panel of its own (a line of the FPS panel), so it is only offered
                // while FPS is on. _initStats leaves it out for an already-persisted
                // combination where FPS is off.
                {
                  key: 'trackHz',
                  label: 'Track Hz (shown in the FPS panel)',
                  disabled: () => !statsConfig.trackFPS,
                  onChange: reloadApp,
                },
                {
                  key: 'stepStatsEnabled',
                  target: physicsStepTrackingProxy,
                  label: 'Track PHY',
                  onChange: (value) => setBootOverride({ stepStatsEnabled: Boolean(value) }),
                },
                { key: 'trackGPU', label: 'Track GPU', onChange: reloadApp },
                { key: 'trackCPT', label: 'Track CPT', onChange: reloadApp },
              ],
            },
            {
              type: 'folder',
              id: 'outlook',
              title: `Measuring Outlook ${RELOAD_NOTE}`,
              content: [{ key: 'horizontal', label: 'Horizontal', onChange: reloadApp }],
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
                  title: 'Open profiler (F8)',
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

export const _getStatsCmp = () => _getStatsPanelsRoot();

/** The stats panels show that a click opens the profiler (when its setting allows it), and the
 * Statistics tab's toggle of the setting is refreshed. */
export const _applyProfilerEntryPoint = () => {
  const statsCmp = _getStatsPanelsRoot();
  if (statsCmp) {
    const isOn = Boolean(getProfilerSettings()?.openFromStatsPanels);
    statsCmp.elem.style.cursor = isOn ? 'pointer' : '';
    if (isOn) {
      statsCmp.elem.title = 'Open the profiler';
    } else {
      statsCmp.elem.removeAttribute('title');
    }
  }
  updateDebuggerTab(STATS_TAB_ID);
};
