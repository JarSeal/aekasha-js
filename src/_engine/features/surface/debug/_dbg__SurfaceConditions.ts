// The surface conditions' debug tab (p307 D1): the live values as sliders and selects over the
// public API (runtime only, like the sky box's day-night Transport: no overrides, no undo, no
// LS), the weather buttons, and a readout of what the simulation steps with; with the
// `rainOcclusion()` feature, its map's switch, update interval and render stats (p307 Phase 6).
import { createBakeStats } from '../../../debug/_dbg__BakeStats';
import { createDebuggerTab, type DebuggerPaneItem } from '../../../debug/DebuggerGUI';
import {
  _setRainOcclusionRenderHooks,
  getRainOcclusionDebugState,
  isRainOcclusionEnabled,
  setRainOcclusionEnabled,
  setRainOcclusionUpdateFrames,
} from '../RainOcclusion';
import {
  getSurfaceConditions,
  getSurfaceSunFactorNow,
  getSurfaceTime,
  setSurfaceConditions,
  startRain,
  stopRain,
} from '../SurfaceConditions';
import {
  getSurfaceWindFactor,
  SURFACE_CONDITIONS_DEFAULTS,
  type SurfaceConditionsMode,
} from '../SurfaceConditionsModel';

const SURFACE_CONDITIONS_TAB_ID = 'surfaceConditionsControls';

/** The shower button's rain: ramp up, hold, ramp down (seconds of the surface clock). */
const SHOWER = { rampSec: 10, durationSec: 60 };
/** The snowfall button's cover and how long it takes to settle. */
const SNOWFALL = { temperature: -5, transitionSec: 30 };

/** The water level the switch turns back on at (the last one shown). */
let lastWaterLevel = 0;

const read = () => getSurfaceConditions() ?? SURFACE_CONDITIONS_DEFAULTS;

/** What the fields bind to: each read the live state, each write the public API (at once). */
const values = {
  get wetness() {
    return read().wetness;
  },
  set wetness(value: number) {
    setSurfaceConditions({ wetness: value });
  },
  get rain() {
    return read().rain;
  },
  set rain(value: number) {
    setSurfaceConditions({ rain: value });
  },
  get puddleLevel() {
    return read().puddleLevel;
  },
  set puddleLevel(value: number) {
    setSurfaceConditions({ puddleLevel: value });
  },
  get snowCoverage() {
    return read().snowCoverage;
  },
  set snowCoverage(value: number) {
    setSurfaceConditions({ snowCoverage: value });
  },
  get temperature() {
    return read().temperature;
  },
  set temperature(value: number) {
    setSurfaceConditions({ temperature: value });
  },
  get dryingRate() {
    return read().dryingRate;
  },
  set dryingRate(value: number) {
    setSurfaceConditions({ dryingRate: value });
  },
  get windX() {
    return read().wind[0];
  },
  set windX(value: number) {
    setSurfaceConditions({ wind: [value, read().wind[1]] });
  },
  get windZ() {
    return read().wind[1];
  },
  set windZ(value: number) {
    setSurfaceConditions({ wind: [read().wind[0], value] });
  },
  get hasWaterLevel() {
    return read().waterLevel !== null;
  },
  set hasWaterLevel(value: boolean) {
    setSurfaceConditions({ waterLevel: value ? lastWaterLevel : null });
  },
  get waterLevel() {
    const level = read().waterLevel;
    if (level !== null) lastWaterLevel = level;
    return lastWaterLevel;
  },
  set waterLevel(value: number) {
    lastWaterLevel = value;
    setSurfaceConditions({ waterLevel: value });
  },
  get mode() {
    return read().mode;
  },
  set mode(value: SurfaceConditionsMode) {
    setSurfaceConditions({ mode: value });
  },
};

/** What the readout monitors show. */
const readouts = {
  get surfaceTime() {
    return `${(getSurfaceTime() ?? 0).toFixed(1)} s`;
  },
  get sunFactor() {
    return (getSurfaceSunFactorNow() ?? 1).toFixed(2);
  },
  get windFactor() {
    return getSurfaceWindFactor(read().wind).toFixed(2);
  },
};

const isWaterLevelOff = () => read().waterLevel === null;

/** The rain occlusion map's render stats (CPU and GPU ms a render; see _dbg__BakeStats.ts) */
const rainMapStats = createBakeStats();
_setRainOcclusionRenderHooks(rainMapStats.hooks);

/**
 * The rain occlusion map's render stats, as the folder shows them (and a measuring script reads).
 * @internal
 */
export const rainOcclusionStatsView = rainMapStats.view;

/** The rain occlusion map's fields: its switch and update interval, its state's readouts */
const rainMap = {
  get isEnabled() {
    return isRainOcclusionEnabled() ?? false;
  },
  set isEnabled(value: boolean) {
    setRainOcclusionEnabled(value);
  },
  get updateFrames() {
    return getRainOcclusionDebugState()?.opts.updateFrames ?? 0;
  },
  set updateFrames(value: number) {
    setRainOcclusionUpdateFrames(value);
  },
  get status() {
    const state = getRainOcclusionDebugState();
    if (!state) return '-';
    if (!state.hasConsumer) return 'idle (no material reads it)';
    return state.isEnabled ? 'on' : 'off (open sky)';
  },
  get size() {
    const opts = getRainOcclusionDebugState()?.opts;
    return opts ? `${opts.size}², ${opts.extent} m, ±${opts.height} m` : '-';
  },
  get renders() {
    return getRainOcclusionDebugState()?.renders ?? 0;
  },
  get centre() {
    return getRainOcclusionDebugState()?.centre ?? '-';
  },
};

const unitSlider = (key: keyof typeof values, label: string): DebuggerPaneItem => ({
  key,
  target: values,
  label,
  min: 0,
  max: 1,
  step: 0.01,
});

const buildWeatherFolder = (): DebuggerPaneItem => ({
  type: 'folder',
  id: 'surfaceWeather',
  title: 'Weather',
  content: [
    {
      type: 'button',
      title: `Rain shower (${SHOWER.rampSec} s up, ${SHOWER.durationSec} s, ${SHOWER.rampSec} s down)`,
      onClick: () => startRain(1, SHOWER),
    },
    { type: 'button', title: 'Stop rain', onClick: () => stopRain({ rampSec: SHOWER.rampSec }) },
    {
      type: 'button',
      title: 'Dry now',
      onClick: () => {
        stopRain();
        setSurfaceConditions({ wetness: 0, puddleLevel: 0 });
      },
    },
    {
      type: 'button',
      title: 'Soak',
      onClick: () => setSurfaceConditions({ wetness: 1, puddleLevel: 1 }),
    },
    {
      type: 'button',
      title: `Snowfall (${SNOWFALL.temperature} °C, cover over ${SNOWFALL.transitionSec} s)`,
      onClick: () => {
        setSurfaceConditions({ temperature: SNOWFALL.temperature });
        setSurfaceConditions({ snowCoverage: 1 }, { transitionSec: SNOWFALL.transitionSec });
      },
    },
  ],
});

const buildValuesFolder = (): DebuggerPaneItem => ({
  type: 'folder',
  id: 'surfaceValues',
  title: 'Conditions (runtime)',
  content: [
    {
      key: 'mode',
      target: values,
      label: 'Mode',
      options: [
        { text: 'Simulated (rain wets, sun dries)', value: 'SIMULATED' },
        { text: 'Manual (the app sets them)', value: 'MANUAL' },
      ],
    },
    unitSlider('wetness', 'Wetness'),
    unitSlider('rain', 'Rain'),
    unitSlider('puddleLevel', 'Puddle level'),
    unitSlider('snowCoverage', 'Snow cover'),
    { key: 'temperature', target: values, label: 'Temperature (°C)', min: -30, max: 40, step: 0.5 },
    { key: 'dryingRate', target: values, label: 'Drying (/min)', min: 0, max: 2, step: 0.01 },
    { key: 'windX', target: values, label: 'Wind x (m/s)', min: -20, max: 20, step: 0.1 },
    { key: 'windZ', target: values, label: 'Wind z (m/s)', min: -20, max: 20, step: 0.1 },
    { key: 'hasWaterLevel', target: values, label: 'Water level' },
    {
      key: 'waterLevel',
      target: values,
      label: 'Water level y',
      step: 0.1,
      disabled: isWaterLevelOff,
    },
  ],
});

const buildReadoutFolder = (): DebuggerPaneItem => ({
  type: 'folder',
  id: 'surfaceReadout',
  title: 'Simulation',
  content: [
    { key: 'surfaceTime', target: readouts, label: 'Surface clock', readonly: true, interval: 250 },
    { key: 'sunFactor', target: readouts, label: 'Sun factor', readonly: true, interval: 250 },
    { key: 'windFactor', target: readouts, label: 'Wind factor', readonly: true, interval: 250 },
  ],
});

/** The rain occlusion map's folder (the `rainOcclusion()` feature's) */
const buildRainOcclusionFolder = (): DebuggerPaneItem => ({
  type: 'folder',
  id: 'surfaceRainOcclusion',
  title: 'Rain occlusion map',
  content: [
    { key: 'isEnabled', target: rainMap, label: 'Shelters' },
    {
      key: 'updateFrames',
      target: rainMap,
      label: 'Render every (frames, 0: on moves)',
      min: 0,
      max: 120,
      step: 1,
    },
    { key: 'status', target: rainMap, label: 'Status', readonly: true, interval: 250 },
    { key: 'size', target: rainMap, label: 'Map', readonly: true },
    { key: 'renders', target: rainMap, label: 'Renders', readonly: true, interval: 250 },
    {
      key: 'bakesPerSec',
      target: rainMapStats.view,
      label: 'Renders / s',
      readonly: true,
      interval: 500,
    },
    { key: 'cpuMs', target: rainMapStats.view, label: 'CPU ms', readonly: true, interval: 500 },
    { key: 'gpuMs', target: rainMapStats.view, label: 'GPU ms', readonly: true, interval: 500 },
    { key: 'centre', target: rainMap, label: 'Centre', readonly: true, interval: 250 },
  ],
});

/**
 * Creates the surface conditions' drawer tab (the `surfaceConditions()` feature's `onDebug`).
 * @internal
 */
export const _createSurfaceConditionsDebugTab = () => {
  createDebuggerTab({
    id: SURFACE_CONDITIONS_TAB_ID,
    title: 'Surface conditions',
    icon: 'droplet',
    uiLsKey: 'AEK_debugSurfaceConditionsUI',
    // The simulated values move on their own
    refreshIntervalMs: 250,
    // Everything is read through getters: nothing to rebuild on a scene change
    keepOnSceneChange: true,
    content: () => [
      {
        pane: true,
        content: [
          buildWeatherFolder(),
          buildValuesFolder(),
          buildReadoutFolder(),
          ...(getRainOcclusionDebugState() ? [buildRainOcclusionFolder()] : []),
        ],
      },
    ],
  });
};
