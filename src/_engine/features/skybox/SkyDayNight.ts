// The sky box's per-frame side (split from SkyBox.ts, p615): skyBoxSystem with the sky clock, the
// day-night cycle's API (p113) and the env bake schedule while the cycle moves. It reads the
// active sky box from SkyBox.ts and never the other way round: a clear restarts the clock
// through the hook the install sets (_setSkyBoxClearHook).
import * as THREE from 'three/webgpu';
import { isCurrentlyLoading } from '../../kernel/scene/SceneLoader';
import { type ECSWorld, getECSWorld } from '../../kernel/ecs/ECS';
import type { FeatureContext } from '../../kernel/init/Features';
import { ECSSystemStage } from '../../kernel/loop/SystemStages';
import { getElapsedTime, isAppPlaying } from '../../kernel/loop/MainLoop';
import type { SkyBoxDef } from './SkyBoxTypes';
import { ENV_DEFAULTS } from './layers/Base';
import {
  applySkyTimeUniforms,
  computeMoonDirectionOf,
  computeSunDirectionOf,
  getMoonCount,
  getSunCount,
  isDayNightEnabled,
  type SkyUniforms,
} from './SkyComposite';
import { isEnvBakeRequested, requestEnvBake, runRequestedEnvBake } from './SkyEnvironment';
import { runRequestedStaticLayersBake } from './SkyStaticLayers';
import { updateSkyLightsForTime, updateSkyLightsFrame } from './SkyLights';
import { advanceSkyTime, DAY_NIGHT_DEFAULTS, getMoonPhaseOf, wrap24 } from './SkyTime';
import { _setSkyBoxClearHook, type ActiveSkyBox, getActiveSkyBox, isBakeDynamic } from './SkyBox';

// Day-night (p113). Runtime only: nothing here writes the definition or the debug overrides.
// The setters are no-ops without an active sky box with day-night on.

/** The active sky box's day-night time, or null (no sky box, or day-night off). */
const getSkyTime = () => {
  const active = getActiveSkyBox();
  return active && isDayNightEnabled(active.def) ? active.time : null;
};

/**
 * Sets the time of day (hours, wrapped into [0, 24)). The sky, sun and lights follow on the
 * next frame, whether the cycle is playing or not. A no-op without an active sky box with
 * `dayNight` on.
 * @example
 * ```ts
 * import { getTimeOfDay, pauseDayNight, setTimeOfDay } from 'aekasha/skybox';
 *
 * // A frozen sunset, then on from there
 * pauseDayNight();
 * setTimeOfDay(19.5);
 * const hours = getTimeOfDay(); // 19.5
 * ```
 */
export const setTimeOfDay = (hours: number) => {
  const time = getSkyTime();
  if (!time || !Number.isFinite(hours)) return;
  time.timeOfDay = wrap24(hours);
  time.isDirty = true;
};

/** The time of day in hours [0, 24), or null without day-night. */
export const getTimeOfDay = () => getSkyTime()?.timeOfDay ?? null;

/** Runs the day-night cycle (it advances with its `timeSource`). */
export const playDayNight = () => {
  const time = getSkyTime();
  if (time) time.playing = true;
};

/** Stops the day-night cycle where it is (setTimeOfDay still moves it). */
export const pauseDayNight = () => {
  const time = getSkyTime();
  if (time) time.playing = false;
};

/**
 * Whether the day-night cycle is playing (false without day-night). Playing isn't moving: a
 * `timeSource` that is stopped (`'APP'` while the app loop is paused, `'MANUAL'`) or a speed of 0
 * holds it.
 */
export const isDayNightPlaying = () => Boolean(getSkyTime()?.playing);

/** Sets the cycle's time multiplier: negative runs it backwards, 0 freezes it. */
export const setDayNightSpeed = (multiplier: number) => {
  const time = getSkyTime();
  if (!time || !Number.isFinite(multiplier)) return;
  // Reversing catches the environment up once (a stop does too, see scheduleDayNightBake)
  if (multiplier * time.speed < 0) needsCatchUpBake = true;
  time.speed = multiplier;
};

/** The cycle's time multiplier, or null without day-night. */
export const getDayNightSpeed = () => getSkyTime()?.speed ?? null;

/** Sets how many real seconds 24 in-game hours take (at speed 1). */
export const setDayNightCycleDuration = (seconds: number) => {
  const time = getSkyTime();
  if (time && Number.isFinite(seconds) && seconds > 0) time.cycleDurationSec = seconds;
};

/**
 * The unit world direction toward a sun, into `out` (with day-night on, for the current time
 * of day, including a setTimeOfDay made this frame). suns[0]'s is there without any suns too:
 * it's the atmosphere's.
 * @param out the vector written
 * @param i the sun's index in the definition's `suns`
 * @returns `out`, or null (no active sky box, or no such sun)
 * @example
 * ```ts
 * import * as THREE from 'three/webgpu';
 * import { getSunDirection } from 'aekasha/skybox';
 *
 * // Is the sun up? (A scratch vector: no allocation per frame)
 * const toSun = new THREE.Vector3();
 * const isDay = (getSunDirection(toSun)?.y ?? -1) > 0;
 * ```
 */
export const getSunDirection = (out: THREE.Vector3, i = 0) => {
  const active = getActiveSkyBox();
  if (!active || i < 0 || (i > 0 && i >= getSunCount(active.def))) return null;
  return computeSunDirectionOf(active.def, i, active.time.timeOfDay, out);
};

const _sunDirection = new THREE.Vector3();

/** A sun's elevation above the horizon in radians (negative below it), or null (see
 * getSunDirection). */
export const getSunElevation = (i = 0) => {
  const direction = getSunDirection(_sunDirection, i);
  return direction ? Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1)) : null;
};

/**
 * The unit world direction toward a moon, into `out` (with day-night on, for the current time
 * and its phase).
 * @param out the vector written
 * @param i the moon's index in the definition's `moons`
 * @returns `out`, or null (no active sky box, or no such moon)
 */
export const getMoonDirection = (out: THREE.Vector3, i = 0) => {
  const active = getActiveSkyBox();
  if (!active || i < 0 || i >= getMoonCount(active.def)) return null;
  return computeMoonDirectionOf(active.def, i, active.time, out);
};

/** A moon's phase in [0, 1) (0 new, 0.5 full): with day-night, the running one (a 'CYCLE' moon
 * advances with the days). Null without an active sky box or such a moon. */
export const getMoonPhase = (i = 0) => {
  const active = getActiveSkyBox();
  if (!active || i < 0 || i >= getMoonCount(active.def)) return null;
  return getMoonPhaseOf(active.def, active.time, isDayNightEnabled(active.def), i);
};

// Budgeted re-bakes while the cycle moves (p110 §0.3): a re-bake once the sky has turned more
// than env.updateAngleDeg since the last bake, at most env.maxUpdatesPerSec, plus one bake to
// catch up when it stops (pause, speed 0, the end of a scrub or a one-off setTimeOfDay) or
// reverses. A cycle that keeps playing after a setTimeOfDay jump catches up within the rate
// cap (bakeEnvironment() bakes on the next frame). env.dynamic: false turns all of it off.

/** The sun's and moon's directions the last env bake saw (any bake), and when it ran (the main
 * loop's elapsed time in seconds: real time, or frames counted under a fixed frame delta, so the
 * bakes run on the same frames in every run of a test). */
const lastBakeSunDir = new THREE.Vector3();
const lastBakeMoonDir = new THREE.Vector3();
let lastBakeTimeSec = -Infinity;
/** Whether the time moved on the previous day-night step. */
let wasTimeMoving = false;
/** Set when the cycle reverses: the next step bakes once to catch up. */
let needsCatchUpBake = false;
/** Any movement at all counts for the catch-up bake. */
const CATCH_UP_ANGLE_COS = Math.cos(THREE.MathUtils.degToRad(0.01));

/** Whether the sun or the moon has turned further from the last bake's direction than
 * `angleCos` (a cosine). */
const hasSkyTurnedSinceBake = (u: SkyUniforms, angleCos: number) =>
  // The primary sun and moon only: the extra suns turn with the sky and the second moon moves
  // like the first (by the time of day), about as fast
  u.suns[0].direction.value.dot(lastBakeSunDir) < angleCos ||
  u.moons[0].direction.value.dot(lastBakeMoonDir) < angleCos;

const scheduleDayNightBake = (current: ActiveSkyBox, moved: boolean) => {
  const def = current.def;
  if (!current.isComposite || !isBakeDynamic(def)) return;
  if (moved && !needsCatchUpBake) {
    const maxPerSec = def.env?.maxUpdatesPerSec ?? ENV_DEFAULTS.maxUpdatesPerSec;
    if (maxPerSec <= 0 || getElapsedTime() - lastBakeTimeSec < 1 / maxPerSec) return;
    const angleDeg = def.env?.updateAngleDeg ?? ENV_DEFAULTS.updateAngleDeg;
    if (hasSkyTurnedSinceBake(current.uniforms, Math.cos(THREE.MathUtils.degToRad(angleDeg)))) {
      requestEnvBake();
    }
    return;
  }
  if (!wasTimeMoving && !needsCatchUpBake) return;
  needsCatchUpBake = false;
  if (hasSkyTurnedSinceBake(current.uniforms, CATCH_UP_ANGLE_COS)) requestEnvBake();
};

/** Records what a bake that just ran saw (for the day-night bake rules). */
const noteEnvBake = (current: ActiveSkyBox | null) => {
  if (!current) return;
  lastBakeSunDir.copy(current.uniforms.suns[0].direction.value);
  lastBakeMoonDir.copy(current.uniforms.moons[0].direction.value);
  lastBakeTimeSec = getElapsedTime();
};

/** Last frame's getElapsedTime: the day-night step and the sky clock advance by the difference,
 * which (unlike the MAIN delta) is 0 on the frame the master loop pauses and the frame it resumes. */
let lastElapsedTime = 0;
/** The sky box's own clock (seconds), which the clouds drift by: it advances with the main loop's
 * elapsed time, so it stands still while the master loop is paused and in editor views, and
 * (here) while a scene loads. Under a fixed frame delta (the scene runner's test clock) it counts
 * frames. Restarts with every clear. */
let skyClockSec = 0;

const isTimeSourceRunning = (def: SkyBoxDef) => {
  const source = def.dayNight?.timeSource ?? DAY_NIGHT_DEFAULTS.timeSource;
  return source === 'MAIN' || (source === 'APP' && isAppPlaying());
};

/**
 * Advances the active sky box's day-night time by `dt` (seconds) and, when it changed, writes the
 * sun-dependent uniforms and lights. Stands still while a scene loads, so a scene starts at its
 * start time. Allocates nothing.
 */
const stepDayNight = (current: ActiveSkyBox | null, world: ECSWorld, dt: number) => {
  if (!current || !isDayNightEnabled(current.def) || isCurrentlyLoading()) return;
  const time = current.time;
  if (isTimeSourceRunning(current.def) && advanceSkyTime(time, dt, current.def)) {
    time.isDirty = true;
  }
  const moved = time.isDirty;
  if (moved) {
    time.isDirty = false;
    applySkyTimeUniforms(current.uniforms, current.def, time);
    updateSkyLightsForTime(current.def, current.uniforms, world);
  }
  scheduleDayNightBake(current, moved);
  wasTimeMoving = moved;
};

// System

/** A scene's clouds start from the same place on every visit. */
const restartSkyClock = () => {
  skyClockSec = 0;
};

/**
 * Installs the sky box's system and the sky clock's restart on every clear (the `skyBox()`
 * feature's install, SkyBoxFeature.ts).
 * @internal
 */
export const installSkyBoxSystem = (ctx: FeatureContext) => {
  _setSkyBoxClearHook(restartSkyClock);
  ctx.registerPlugin((world) => {
    // MAIN, order 1: before object3DSyncSystem (order 0), where the sky lights' transforms go
    world.addSystem(ECSSystemStage.MAIN, 'skyBoxSystem', skyBoxSystem, 1);
  });
};

/** Advances the sky clock and steps the day-night cycle, moves the sky lights with their follow
 * point, and runs a requested static-layer bake and then env bake (it samples the static layers),
 * never while a scene loads. The sky box is global: only the default world drives it. */
function skyBoxSystem(world: ECSWorld) {
  if (world !== getECSWorld()) return;
  const active = getActiveSkyBox();
  const elapsed = getElapsedTime();
  const dt = elapsed - lastElapsedTime;
  lastElapsedTime = elapsed;
  const isLoading = isCurrentlyLoading();
  if (!isLoading) skyClockSec += dt;
  if (active) active.uniforms.clouds.time.value = skyClockSec;
  stepDayNight(active, world, dt);
  updateSkyLightsFrame(world);
  if (isLoading) return;
  // The environment follows the static layers (activation requests both anyway)
  if (runRequestedStaticLayersBake() && active && isBakeDynamic(active.def)) requestEnvBake();
  if (!isEnvBakeRequested()) return;
  // The bake's clouds are frozen where the view's are now
  if (active) active.uniforms.clouds.bakeTime.value = skyClockSec;
  if (runRequestedEnvBake()) noteEnvBake(active);
}
