// The surface conditions' runtime (p307 D1): the one global state, its stable uniforms, the
// surface clock and surfaceConditionsSystem, which steps the model (SurfaceConditionsModel.ts)
// every frame. The `surfaceConditions()` feature creates it at its install: without the feature,
// the getters return null and the setters throw naming it.
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { type ECSWorld, getECSWorld } from '../../kernel/ecs/ECS';
import type { FeatureContext } from '../../kernel/init/Features';
import { getElapsedTime, isAppPlaying } from '../../kernel/loop/MainLoop';
import { ECSSystemStage } from '../../kernel/loop/SystemStages';
import type { SceneData } from '../../kernel/scene/Scene';
import { isCurrentlyLoading } from '../../kernel/scene/SceneLoader';
import {
  applySurfaceConditions,
  createSurfaceConditionsState,
  createSurfaceDynamics,
  getSurfaceSunFactor,
  resetSurfaceConditions,
  startSurfaceRain,
  stepSurfaceDynamics,
  stepSurfaceSimulation,
  stopSurfaceRain,
  type SurfaceConditions,
  type SurfaceConditionsInput,
  type SurfaceDynamics,
} from './SurfaceConditionsModel';

/** What the surface clock (and the simulation) runs with: `'APP'` stops with the app loop (its
 * pause, F7), `'MAIN'` only with the master loop. Both stand still while a scene loads. */
export type SurfaceTimeSource = 'APP' | 'MAIN';

/** Reads the sun's elevation in radians (negative below the horizon) for the drying, or null
 * without a sun. */
export type SurfaceSunSource = () => number | null;

/**
 * The surface conditions as uniform nodes, which a TSL material binds when it's built: created
 * once, the same nodes for the app's lifetime, so a material never goes stale.
 */
export type SurfaceConditionNodes = {
  /** {@link SurfaceConditions}' `wetness` */
  readonly wetness: THREE.UniformNode<'float', number>;
  /** {@link SurfaceConditions}' `rain` */
  readonly rain: THREE.UniformNode<'float', number>;
  /** {@link SurfaceConditions}' `puddleLevel` */
  readonly puddleLevel: THREE.UniformNode<'float', number>;
  /** {@link SurfaceConditions}' `waterLevel`, {@link SURFACE_WATER_LEVEL_NONE} for none */
  readonly waterLevel: THREE.UniformNode<'float', number>;
  /** {@link SurfaceConditions}' `snowCoverage` */
  readonly snowCoverage: THREE.UniformNode<'float', number>;
  /** {@link SurfaceConditions}' `temperature` */
  readonly temperature: THREE.UniformNode<'float', number>;
  /** {@link SurfaceConditions}' `wind`, x and z */
  readonly wind: THREE.UniformNode<'vec2', THREE.Vector2>;
  /** The surface clock in seconds (the ripples' and streaks' time; see {@link getSurfaceTime}) */
  readonly time: THREE.UniformNode<'float', number>;
};

/** The `waterLevel` uniform's value without a water level: far below any world. */
export const SURFACE_WATER_LEVEL_NONE = -1e9;

/** The running state, created by the feature's install. */
type SurfaceRuntime = {
  state: SurfaceConditions;
  dynamics: SurfaceDynamics;
  timeSource: SurfaceTimeSource;
  sunSource: SurfaceSunSource | null;
  /** The last step's sun factor (the debug tab's readout) */
  sunFactor: number;
  /** The surface clock, seconds: restarts on every scene's exit */
  timeSec: number;
  /** Last frame's `getElapsedTime()`: the clock advances by the difference */
  lastElapsedTime: number;
  nodes: SurfaceConditionNodes | null;
};

let runtime: SurfaceRuntime | null = null;

const assertInstalled = (caller: string): SurfaceRuntime => {
  if (runtime) return runtime;
  throw new Error(
    `${caller}: the surface conditions feature isn't installed. List surfaceConditions() from 'aekasha/surface' in InitEngine's features.`
  );
};

/** Writes the state into the uniforms (when a material has asked for them). Allocates nothing. */
const writeNodes = (rt: SurfaceRuntime) => {
  const nodes = rt.nodes;
  if (!nodes) return;
  const state = rt.state;
  nodes.wetness.value = state.wetness;
  nodes.rain.value = state.rain;
  nodes.puddleLevel.value = state.puddleLevel;
  nodes.waterLevel.value = state.waterLevel ?? SURFACE_WATER_LEVEL_NONE;
  nodes.snowCoverage.value = state.snowCoverage;
  nodes.temperature.value = state.temperature;
  nodes.wind.value.set(state.wind[0], state.wind[1]);
  nodes.time.value = rt.timeSec;
};

/**
 * The current surface conditions (read-only: the live state, which changes every frame in
 * `'SIMULATED'` mode; copy what you keep), or null without the `surfaceConditions()` feature.
 * @example
 * ```ts
 * import { getSurfaceConditions } from 'aekasha/surface';
 *
 * const isWet = (getSurfaceConditions()?.wetness ?? 0) > 0.5;
 * ```
 */
export const getSurfaceConditions = (): Readonly<SurfaceConditions> | null =>
  runtime?.state ?? null;

/** Options of {@link setSurfaceConditions}. */
export type SetSurfaceConditionsOpts = {
  /** Moves each number there over this many seconds of the surface clock, linearly. Default 0:
   * at once. `mode`, and a water level from or to none, always switch at once. */
  transitionSec?: number;
};

/**
 * Sets any of the surface conditions, at once or over `transitionSec`. A value that isn't a
 * finite number is ignored, and each is kept within its range (`wetness`, `rain`, `puddleLevel`
 * and `snowCoverage` within [0, 1], `dryingRate` 0 or more). In `'SIMULATED'` mode the
 * simulation takes a value over again once its transition ends.
 * @throws when the `surfaceConditions()` feature isn't installed
 * @remarks The latest call wins per value: one made while a value moves starts its transition
 * again from where it is. A scene's exit puts every value back to its default.
 * @example
 * ```ts
 * import { setSurfaceConditions } from 'aekasha/surface';
 *
 * // A drizzle over the next half a minute, on a cool, still evening
 * setSurfaceConditions({ rain: 0.3, temperature: 8, wind: [0, 0] }, { transitionSec: 30 });
 * ```
 */
export const setSurfaceConditions = (
  input: SurfaceConditionsInput,
  opts?: SetSurfaceConditionsOpts
) => {
  const rt = assertInstalled('setSurfaceConditions');
  applySurfaceConditions(rt.state, rt.dynamics, input, opts?.transitionSec);
  writeNodes(rt);
};

/** Options of {@link startRain}. */
export type StartRainOpts = {
  /** Seconds the rain takes to reach its intensity (and, with `durationSec`, to stop). Default 0. */
  rampSec?: number;
  /** Stops the rain once it has run this many seconds at its intensity, over the same ramp.
   * Default: it rains until {@link stopRain}. */
  durationSec?: number;
};

/**
 * Starts the rain (`rain` to `intensity`, 0 to 1). In `'SIMULATED'` mode it wets the surfaces and
 * fills the puddles while it falls, and they dry after.
 * @throws when the `surfaceConditions()` feature isn't installed
 * @example
 * ```ts
 * import { startRain } from 'aekasha/surface';
 *
 * // A shower: 10 s to full rain, a minute of it, 10 s to stop
 * startRain(1, { rampSec: 10, durationSec: 60 });
 * ```
 */
export const startRain = (intensity: number, opts?: StartRainOpts) => {
  const rt = assertInstalled('startRain');
  startSurfaceRain(rt.state, rt.dynamics, intensity, opts?.rampSec, opts?.durationSec);
  writeNodes(rt);
};

/** Options of {@link stopRain}. */
export type StopRainOpts = {
  /** Seconds the rain takes to stop. Default 0. */
  rampSec?: number;
};

/**
 * Stops the rain (and a stop `startRain`'s `durationSec` scheduled).
 * @throws when the `surfaceConditions()` feature isn't installed
 */
export const stopRain = (opts?: StopRainOpts) => {
  const rt = assertInstalled('stopRain');
  stopSurfaceRain(rt.state, rt.dynamics, opts?.rampSec);
  writeNodes(rt);
};

/**
 * The surface conditions as uniform nodes for a TSL material (created on the first call, the same
 * ones after), or null without the `surfaceConditions()` feature: a material then builds dry.
 * @example
 * ```ts
 * import { mix } from 'three/tsl';
 * import { getSurfaceConditionNodes } from 'aekasha/surface';
 *
 * const nodes = getSurfaceConditionNodes();
 * // Darker as it gets wetter
 * if (nodes) material.colorNode = mix(dryColor, dryColor.mul(0.6), nodes.wetness);
 * ```
 */
export const getSurfaceConditionNodes = (): SurfaceConditionNodes | null => {
  const rt = runtime;
  if (!rt) return null;
  if (!rt.nodes) {
    rt.nodes = {
      wetness: uniform(0),
      rain: uniform(0),
      puddleLevel: uniform(0),
      waterLevel: uniform(SURFACE_WATER_LEVEL_NONE),
      snowCoverage: uniform(0),
      temperature: uniform(0),
      wind: uniform(new THREE.Vector2()),
      time: uniform(0),
    };
    writeNodes(rt);
  }
  return rt.nodes;
};

/**
 * The surface clock in seconds (the ripples' and streaks' time), or null without the
 * `surfaceConditions()` feature. It advances with the main loop's elapsed time per the feature's
 * `timeSource`, stands still while a scene loads and restarts at every scene's exit, so a scene's
 * surfaces look the same on every visit (and under the scene runner's test clock, on every run).
 */
export const getSurfaceTime = () => runtime?.timeSec ?? null;

/**
 * Sets what the drying reads the sun's elevation from (null: none, the sun factor is 1). The
 * engine's features don't import each other, so the app ties it to its sky.
 * @throws when the `surfaceConditions()` feature isn't installed
 * @example
 * ```ts
 * import { getSunElevation } from 'aekasha/skybox';
 * import { setSurfaceSunSource } from 'aekasha/surface';
 *
 * // Surfaces dry faster under a high sun, slowest at night
 * setSurfaceSunSource(() => getSunElevation());
 * ```
 */
export const setSurfaceSunSource = (source: SurfaceSunSource | null) => {
  assertInstalled('setSurfaceSunSource').sunSource = source;
};

/**
 * The sun factor the last step dried with (1 without a sun source; the debug tab's readout), or
 * null without the feature.
 * @internal
 */
export const getSurfaceSunFactorNow = () => runtime?.sunFactor ?? null;

/** Whether the surface clock runs this frame: never while a scene loads. */
const isClockRunning = (rt: SurfaceRuntime) =>
  !isCurrentlyLoading() && (rt.timeSource === 'MAIN' || isAppPlaying());

/** Advances the surface clock, the transitions and the simulation, and writes the uniforms. The
 * state is global: only the default world drives it. Allocates nothing. */
function surfaceConditionsSystem(world: ECSWorld) {
  const rt = runtime;
  if (!rt || world !== getECSWorld()) return;
  const elapsed = getElapsedTime();
  const dt = elapsed - rt.lastElapsedTime;
  rt.lastElapsedTime = elapsed;
  if (dt <= 0 || !isClockRunning(rt)) return;
  rt.timeSec += dt;
  stepSurfaceDynamics(rt.state, rt.dynamics, dt);
  rt.sunFactor = getSurfaceSunFactor(rt.sunSource ? rt.sunSource() : null);
  stepSurfaceSimulation(rt.state, rt.dynamics, dt, rt.sunFactor);
  writeNodes(rt);
}

/**
 * A scene's exit: the defaults, no transition, and the clock at 0.
 * @internal
 */
export const resetSurfaceConditionsForScene = () => {
  const rt = runtime;
  if (!rt) return;
  resetSurfaceConditions(rt.state, rt.dynamics);
  rt.timeSec = 0;
  writeNodes(rt);
};

/**
 * The next scene's own values (its JSON `surfaceConditions`), applied before its scene code runs.
 * @internal
 */
export const applySceneSurfaceConditions = (sceneData: SceneData) => {
  const rt = runtime;
  if (!rt || !sceneData.surfaceConditions) return;
  applySurfaceConditions(rt.state, rt.dynamics, sceneData.surfaceConditions);
  writeNodes(rt);
};

/**
 * Creates the running state and registers `surfaceConditionsSystem` (the `surfaceConditions()`
 * feature's install).
 * @internal
 */
export const installSurfaceConditions = (ctx: FeatureContext, timeSource: SurfaceTimeSource) => {
  runtime = {
    state: createSurfaceConditionsState(),
    dynamics: createSurfaceDynamics(),
    timeSource,
    sunSource: null,
    sunFactor: 1,
    timeSec: 0,
    lastElapsedTime: getElapsedTime(),
    nodes: null,
  };
  ctx.registerPlugin((world) => {
    // MAIN, order 1 like skyBoxSystem, after it when the sky box is installed first: the sun
    // source reads this frame's sun
    world.addSystem(ECSSystemStage.MAIN, 'surfaceConditionsSystem', surfaceConditionsSystem, 1);
  });
};
